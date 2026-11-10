"""업종별 인천 행정동 점수 지도(전시 개선 13-46) 자료 만들기 — 점수 계산은 바꾸지 않는다.

행정동 경계 158개마다 한 지점(엔진 동 중심점, 그 점이 다른 동으로 판정되면 경계 안 대표점)에서 반경 500m 로
백엔드 POST /rank 를 그대로 불러(TestClient — 운영과 같은 경로·같은 엔진 analyze) 29개 업종 종합점수를 모은다.
어느 지점도 그 동으로 분석되지 않으면(반경 안 자료 없음 422 등) 그 동은 점수 없음(null)으로 둔다 — 화면은 회색.
결과는 화면이 /health 의 엔진·데이터 버전과 대조해 맞을 때만 그린다(frontend/src/lib/heatmap.ts).

  SCORING_ENGINE_VERSION=v0_5_1 DATA_VERSION=2026-09 python scripts/build_heatmap.py [--out frontend/public/heatmap.json]

출력 형식: {engine, data, radius_m, generated, method, dongs: [{gu_code, gu, dong, lat, lng}], scores: {biz_code: [점수|null …]}}
(scores 의 i번째 = dongs 의 i번째, 소수 1자리)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY = ROOT / "data" / "geo" / "인천_행정동경계_2026.geojson"
RADIUS_M = 500


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "frontend" / "public" / "heatmap.json"))
    args = ap.parse_args()

    sys.path.insert(0, str(ROOT))
    from fastapi.testclient import TestClient
    from shapely.geometry import shape
    from backend.app import main as M
    from scoring_engine.service import AnalysisService

    features = json.loads(BOUNDARY.read_text(encoding="utf-8"))["features"]
    svc = AnalysisService()
    cent = svc.rt.centroids
    dongs, scores, fallback, missing = [], {}, [], []
    started = time.time()
    with TestClient(M.create_app(service=svc, warm_biz=[])) as c:
        health = c.get("/health").json()
        engine, data = health["engine"]["version"], health["data"]["version"]
        for i, f in enumerate(features):
            p = f["properties"]
            rows = cent[cent["행정동명"] == p["행정동명"]]
            points = [(float(r["위도"]), float(r["경도"])) for _, r in rows.iterrows()]
            rep = shape(f["geometry"]).representative_point()
            points.append((rep.y, rep.x))                  # 경계 안 대표점 (마지막 후보)
            body, why = None, []
            for n, (lat, lng) in enumerate(points):
                res = c.post("/rank", json={"lat": lat, "lng": lng, "radius_m": RADIUS_M})
                if res.status_code == 200 and res.json()["dong_name"] == p["행정동명"]:
                    body = res.json()
                    if n == len(points) - 1:
                        fallback.append(p["행정동명"])
                    break
                why.append(str(res.status_code) if res.status_code != 200 else f"→{res.json()['dong_name']}")
            lat, lng = (body["lat"], body["lng"]) if body else points[-1]
            dongs.append({"gu_code": p["시군구코드"], "gu": p["시군구명"], "dong": p["행정동명"],
                          "lat": round(lat, 6), "lng": round(lng, 6)})
            if body is None:
                missing.append(f"{p['시군구명']} {p['행정동명']}({','.join(why)})")
                continue
            for item in body["items"]:
                scores.setdefault(item["biz_code"], [None] * len(features))[i] = (
                    None if item["overall"] is None else round(item["overall"], 1))
            if (i + 1) % 20 == 0:
                print(f"{i + 1}/{len(features)} ({time.time() - started:.0f}s)", flush=True)

    out = {
        "engine": engine,
        "data": data,
        "radius_m": RADIUS_M,
        "generated": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%dT%H:%M:%S+09:00"),
        "method": "행정동마다 한 지점(동 중심점, 다른 동으로 판정되면 경계 안 대표점)에서 반경 500m 기본 가중치 종합점수",
        "dongs": dongs,
        "scores": scores,
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    nulls = sum(v is None for vs in scores.values() for v in vs)
    print(f"{args.out}: 동 {len(dongs)} · 업종 {len(scores)} · 점수 없음 {nulls} · 대표점 사용 {len(fallback)} {fallback} · "
          f"엔진 {engine} · 데이터 {data} · {time.time() - started:.0f}s")
    print(f"점수 없음 동 {len(missing)}: {missing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
