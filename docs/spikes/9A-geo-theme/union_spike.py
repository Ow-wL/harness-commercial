#!/usr/bin/env python3
"""
묶음 A 스파이크 s1 — 행정동 158개 polygon을 union해 구 경계 11개 + 인천 외곽선 1개를 만들고, 검수 페이지용 임시 파일을 쓴다.

    python docs/spikes/9A-geo-theme/union_spike.py        # → frontend/spike/_geo/gu.geojson, outline.geojson (git 제외)

제품 구현은 scripts/build_geo.py에 같은 규칙으로 넣고 매니페스트에 올린다(이 스크립트는 검수 재현용).
규칙(스파이크에서 정한 값):
  - union 뒤 면적 0 m²의 구멍(부동소수 잡음, 남동구 2개·외곽 3개)은 지운다. 20,000 m² 미만 구멍, 2,000 m² 미만 조각도 지운다.
  - 표시용 단순화: 구 경계 tol 1e-4°(약 10 m, 줌 14까지 1px 미만), 외곽선 2e-4°(약 20 m). 좌표 소수 5자리(≈1 m).
  - 라벨 기준점은 shapely representative_point (polygon 안에 있음을 보장).
데이터 출처는 data/geo/인천_행정동경계_2026.geojson 그대로다(새 다운로드 없음).
"""
from __future__ import annotations

import json
import math
import os
import sys

import shapely
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, "data", "geo", "인천_행정동경계_2026.geojson")
OUT = os.path.join(ROOT, "frontend", "spike", "_geo")
K_M2 = (111_000 * 111_000 * math.cos(math.radians(37.5)))   # deg² → m² (인천 위도 근사)


def clean(g, min_hole_m2=20_000, min_island_m2=2_000, tol=1e-4):
    parts = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = []
    for p in parts:
        if p.area * K_M2 < min_island_m2:
            continue
        rings = [i for i in p.interiors if Polygon(i).area * K_M2 >= min_hole_m2]
        out.append(Polygon(p.exterior, rings))
    m = MultiPolygon(out) if len(out) > 1 else out[0]
    return shapely.simplify(m, tol, preserve_topology=True)


def rounded(obj, nd=5):
    return json.loads(json.dumps(obj), parse_float=lambda x: round(float(x), nd))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    gj = json.load(open(SRC, encoding="utf-8"))
    by_gu: dict[tuple[str, str], list] = {}
    for f in gj["features"]:
        p = f["properties"]
        by_gu.setdefault((p["시군구코드"], p["시군구명"]), []).append(shape(f["geometry"]))
    gu_feats, raw_unions = [], []
    for (code, name), geoms in sorted(by_gu.items()):
        u = unary_union(geoms).buffer(0)
        raw_unions.append(u)
        c = u.representative_point()
        g = clean(u, tol=1e-4)
        parts = 1 if g.geom_type == "Polygon" else len(g.geoms)
        print(f"{code} {name}: parts={parts} area≈{u.area * K_M2 / 1e6:.0f}km² label=({c.y:.5f},{c.x:.5f})")
        gu_feats.append({"type": "Feature",
                         "properties": {"시군구코드": code, "시군구명": name, "label_lat": round(c.y, 5), "label_lng": round(c.x, 5)},
                         "geometry": rounded(mapping(g))})
    outline = clean(unary_union(raw_unions).buffer(0), tol=2e-4)
    print(f"outline parts={len(outline.geoms) if outline.geom_type != 'Polygon' else 1}")
    os.makedirs(OUT, exist_ok=True)
    dump = lambda name, fc: open(os.path.join(OUT, name), "w", encoding="utf-8").write(  # noqa: E731
        json.dumps(fc, ensure_ascii=False, separators=(",", ":")))
    dump("gu.geojson", {"type": "FeatureCollection", "features": gu_feats})
    dump("outline.geojson", {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "인천광역시"}, "geometry": rounded(mapping(outline))}]})
    for n in ("gu.geojson", "outline.geojson"):
        print(n, f"{os.path.getsize(os.path.join(OUT, n)):,} bytes")


if __name__ == "__main__":
    main()
