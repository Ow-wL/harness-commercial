"""
TASKS 1-5a 공식 확인: 구월1동/구월3동 known conflict(D-010) 점포 좌표의 현재 행정동을 SGIS 공식 OpenAPI로 판정한다.

  python scripts/verify_guwol_admin_dong.py

조사 전용. 아무것도 수정하지 않고 파일도 쓰지 않는다 (집계 결과만 stdout). D-010 기록(2026-10-06)을 재현한다.
- 대상: 교정 전 2차 가공 경계(data/geo/raw/HangJeongDong_ver20260701.geojson, 매니페스트 sha256 확인)의 구월1동
        polygon 안에 있는 구월3동(28200521) 라벨 점포. 2,486개 점포 / 439개 좌표가 아니면 중단.
        (data/geo 경계는 D-017 로 교정돼 지금 resolver 로는 이 집합을 고를 수 없다)
- 비교: SGIS 판정 ↔ 점포 라벨 ↔ 교정 전 polygon(구월1동) ↔ 현재 LocationResolver(교정 후)
- 인증·호출: scripts/sgis_api.py (.env 의 SGIS_CONSUMER_KEY / SGIS_CONSUMER_SECRET. 인증값·token·raw 응답은
  출력·저장하지 않는다). 역지오코딩 addr_type=20 "행정동(읍면동)" → emdong_cd, emdong_nm.
"""
from __future__ import annotations

import collections
import json
import os
import sys
import time

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, os.path.join(ROOT, "tests"))

import pandas as pd  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import shape  # noqa: E402

import build_geo as B  # noqa: E402
from scoring_engine.location import default_resolver  # noqa: E402
from sgis_api import SgisError, from_env  # noqa: E402
from test_location_agreement import resolve_codes  # noqa: E402

EXPECTED_STORES = 2486
EXPECTED_COORDS = 439
LABEL_CODE, POLYGON_CODE = "28200521", "28200510"        # 구월3동 라벨 → 교정 전 polygon 구월1동 (D-010)
GUWOL1, GUWOL3 = "구월1동", "구월3동"
# 컨트롤 지점: 충돌 구역과 떨어진 행정동 polygon 내부점. SGIS 판정이 polygon 과 같아야 파이프라인을 믿는다
#   (구월2동·구월4동·간석1동 = 충돌 구역 주변 남동구, 부평1동·연수1동 = 다른 구. 2026-07 개편 구는 피한다)
CONTROL_CODES = ["28200520", "28200522", "28200530", "28237510", "28185761"]


def norm(name) -> str:
    return "".join(str(name).split()).replace("·", ".")


def pct(n: int, total: int) -> str:
    return f"{n:>5} / {total} ({n / total * 100:5.1f}%)" if total else f"{n} / 0"


def uncorrected_guwol1():
    """교정 전 2차 가공 경계의 구월1동 polygon (raw, 매니페스트 해시 확인)."""
    fn, url = B.RAW["2026"]
    path = os.path.join(B.RAW_DIR, fn)
    with open(B.MANIFEST, encoding="utf-8") as f:
        want = json.load(f)["files"][f"raw/{fn}"]["sha256"]
    if not os.path.isfile(path) or B.sha256(path) != want:
        raise SystemExit(f"중단: {path} 가 없거나 매니페스트와 다르다 — {url} 에서 받는다")
    (row,) = [r for r in B.load_incheon("2026") if r["code"] == POLYGON_CODE]
    return row["geom"]


def load_targets() -> pd.DataFrame:
    df = pd.read_csv(os.path.join(ROOT, "data", "runtime", "인천_상가_정제.csv"), encoding="utf-8-sig",
                     dtype={"행정동코드": str}, usecols=["행정동코드", "시군구명", "행정동명", "위도", "경도"],
                     low_memory=False)
    df = df[df["행정동코드"] == LABEL_CODE].copy()
    inside = shapely.covers(uncorrected_guwol1(), shapely.points(df["경도"].values, df["위도"].values))
    target = df[inside].copy()
    target["resolved"] = resolve_codes(default_resolver(), target["위도"].values, target["경도"].values)
    return target


def control_points() -> list[tuple[str, str, float, float]]:
    """data/geo 경계의 polygon 내부점(representative_point) — LocationResolver 로 다시 확인한 것만."""
    with open(os.path.join(ROOT, "data", "geo", "인천_행정동경계_2026.geojson"), encoding="utf-8") as f:
        feats = {ft["properties"]["행정동코드"]: ft for ft in json.load(f)["features"]}
    resolver = default_resolver()
    out = []
    for code in CONTROL_CODES:
        ft = feats[code]
        p = shape(ft["geometry"]).representative_point()
        r = resolver.resolve(p.y, p.x)
        assert r.dong_code == code
        out.append((code, ft["properties"]["행정동명"], p.y, p.x))
    return out


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    target = load_targets()
    coords = target.groupby(["위도", "경도"]).size().rename("stores").reset_index()
    print(f"대상 점포 {len(target)} / distinct 좌표 {len(coords)}")
    if len(target) != EXPECTED_STORES or len(coords) != EXPECTED_COORDS:
        print(f"중단: 기대값(점포 {EXPECTED_STORES}, 좌표 {EXPECTED_COORDS})과 다르다. SGIS 조회를 시작하지 않는다.")
        return 2
    assert set(target["행정동명"]) == {GUWOL3}
    print(f"현재 LocationResolver(교정 후) 판정: {target['resolved'].value_counts(dropna=False).to_dict()}")
    current = target.groupby(["위도", "경도"])["resolved"].first()

    try:
        sgis = from_env()
    except SgisError as e:
        print(f"중단: {e}")
        return 2

    # sanity 1: 좌표변환 왕복 (4326 → 5179 → 4326)
    lat0, lng0 = map(float, coords.iloc[0][["위도", "경도"]])
    x0, y0 = sgis.to_utmk(lat0, lng0)
    lat1, lng1 = sgis.to_wgs84(x0, y0)
    roundtrip = max(abs(lat1 - lat0), abs(lng1 - lng0))
    print(f"[sanity] 좌표변환 왕복 오차 {roundtrip:.2e}° (UTM-K x={x0:.1f}, y={y0:.1f})")
    if roundtrip > 1e-6 or not (900_000 < x0 < 1_000_000 and 1_900_000 < y0 < 2_000_000):
        print("중단: 좌표변환 결과가 UTM-K(EPSG:5179) 인천 범위가 아니다")
        return 3

    # sanity 2: 컨트롤 지점 — 충돌과 무관한 polygon 내부점은 SGIS 와 polygon 이 같은 행정동이어야 한다
    ok = 0
    controls = control_points()
    for code, name, lat, lng in controls:
        got = sgis.admin_dong(lat, lng)
        same = norm(got["emdong_nm"]) == norm(name)
        ok += same
        print(f"[sanity] 컨트롤 {code} {name:<8} → SGIS {got['sgg_nm']} {got['emdong_nm']} ({got['emdong_cd']}) {'일치' if same else '불일치'}")
    if ok != len(controls):
        print("중단: 컨트롤 지점 판정이 polygon 과 다르다 — 파이프라인(좌표계·addr_type)을 먼저 확인해야 한다")
        return 3

    # 본 조회: 439개 좌표
    results: list[dict] = []
    failures = collections.Counter()
    t0 = time.time()
    for i, row in enumerate(coords.itertuples(index=False), 1):
        try:
            r = sgis.admin_dong(float(row.위도), float(row.경도))
            results.append({"ok": True, **r})
        except SgisError as e:
            results.append({"ok": False})
            failures[str(e)] += 1
        if i % 50 == 0:
            print(f"  ... {i}/{len(coords)} ({time.time() - t0:.0f}s)")
    coords["ok"] = [r["ok"] for r in results]
    coords["sgis_name"] = [norm(r["emdong_nm"]) if r["ok"] else None for r in results]
    coords["sgis_code"] = [r.get("emdong_cd") for r in results]
    coords["sgis_sgg"] = [r.get("sgg_nm") for r in results]

    def bucket(r) -> str:
        if not r["ok"]:
            return "조회 실패"
        return {GUWOL1: GUWOL1, GUWOL3: GUWOL3}.get(r["sgis_name"], "기타 행정동")

    coords["bucket"] = coords.apply(bucket, axis=1)
    n_c, n_s = len(coords), int(coords["stores"].sum())
    order = [GUWOL1, GUWOL3, "기타 행정동", "조회 실패"]

    print(f"\nSGIS 조회 성공 {int(coords['ok'].sum())} / 실패 {int((~coords['ok']).sum())} (API 호출 {sgis.calls}회)")
    print("\n좌표 기준 분포")
    for b in order:
        print(f"  {b:<8} {pct(int((coords['bucket'] == b).sum()), n_c)}")
    print("점포 기준 분포")
    for b in order:
        print(f"  {b:<8} {pct(int(coords.loc[coords['bucket'] == b, 'stores'].sum()), n_s)}")

    other = coords[coords["bucket"] == "기타 행정동"]
    if len(other):
        print("기타 행정동")
        for (sgg, code, name), g in other.groupby(["sgis_sgg", "sgis_code", "sgis_name"]):
            print(f"  {sgg} {name} ({code}): 좌표 {len(g)}, 점포 {int(g['stores'].sum())}")
    print("SGIS 행정동 코드 (이름별)")
    for (name, code), g in coords[coords["ok"]].groupby(["sgis_name", "sgis_code"]):
        print(f"  {name} → {code} (좌표 {len(g)})")

    ok_c = coords[coords["ok"]]
    print("\n비교 (조회 성공분 기준)")
    for label, expected in (("교정 전 polygon = 구월1동", GUWOL1), ("점포 라벨 = 구월3동", GUWOL3)):
        m = ok_c["sgis_name"] == expected
        print(f"  {label} vs SGIS — 좌표 {pct(int(m.sum()), len(ok_c))}, 점포 {pct(int(ok_c.loc[m, 'stores'].sum()), int(ok_c['stores'].sum()))}")
    names = {"28200510": GUWOL1, "28200521": GUWOL3}
    cur = ok_c.apply(lambda r: names.get(current[(r["위도"], r["경도"])]), axis=1)
    m = cur == ok_c["sgis_name"]
    print(f"  현재 LocationResolver(교정 후, D-017) vs SGIS — 좌표 {pct(int(m.sum()), len(ok_c))}, "
          f"점포 {pct(int(ok_c.loc[m, 'stores'].sum()), int(ok_c['stores'].sum()))}")

    if failures:
        print("\n조회 실패 사유")
        for msg, n in failures.most_common():
            print(f"  {n:>4}  {msg}")
    lng_range = coords.groupby("bucket")["경도"].agg(["min", "max", "size"])
    print("\n판정별 경도 범위 (참고)")
    print(lng_range.to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
