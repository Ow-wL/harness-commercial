"""
분동 배분 재현 사례 (D-029) — 같은 모체 경계·같은 총량에서 분동 전후 반경 배분 인구가 보존되는지.

팀 엔진 v0.5 `etl_boundary.DongAreas`는 SGIS 2025 경계에 없는 신설 분동(아라1·2동, 운서1·2동)을 모체 경계로 연결하면서
가중치에 "분동 인구 ÷ 형제 분동 인구 합"(ratio)을 곱한다. 그런데 패널 값(총인구·타겟 인구·종사자)은 이미 분동별 값이라
배분 인구 = 면적 비율 × ratio × 분동 인구가 되어 인구비가 두 번 들어간다(합계가 모체 총량보다 작아진다).
비율은 팀 `etl_sgis.attach`에서 온 규칙이다 — 거기서는 SGIS **모체** 통계를 분동에 나누므로 맞다.

이 모듈은 합성 경계(정사각형 모체 동 1개) + 합성 패널 두 벌(분동 전 1행 / 분동 후 2행, 총량 같음)로 radius_profile 을 돌린다.
엔진 버전마다(v0.5: 결함 재현 고정, v0.5.1: 보존) tests/engine_v0_5*/ 가 이 함수를 부른다.
"""
from __future__ import annotations

import json
import math

import pandas as pd

LAT, LNG = 37.59, 126.67
HALF_M = 2000                                   # 모체 동 = 4km × 4km 정사각형 (반경 500·1,000m 원이 모두 안에 든다)
COLS = ["총인구", "종사자수", "타겟_PC방"]
UNSPLIT = [("아라동", 80_000, 9_000, 9_800)]
SPLIT = [("아라1동", 47_000, 5_400, 5_800), ("아라2동", 33_000, 3_600, 4_000)]   # 열마다 합 = UNSPLIT


def write_parent_geojson(path) -> None:
    dlon, dlat = HALF_M / (111_320 * math.cos(math.radians(LAT))), HALF_M / 110_540
    ring = [[LNG - dlon, LAT - dlat], [LNG - dlon, LAT + dlat], [LNG + dlon, LAT + dlat],
            [LNG + dlon, LAT - dlat], [LNG - dlon, LAT - dlat]]              # SGIS 파일처럼 외곽링 시계방향
    gj = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"ADM_CD": "23080880", "ADM_NM": "아라동"},
         "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)


def panel(rows) -> pd.DataFrame:
    return pd.DataFrame([{"시군구명": "검단구", "행정동명": d, **dict(zip(COLS, v))} for d, *v in rows])


def shops() -> pd.DataFrame:
    return pd.DataFrame({"위도": [LAT, LAT + 0.001], "경도": [LNG, LNG], "상권업종소분류코드": ["R10406", "I21201"],
                         "시군구명": ["검단구"] * 2, "행정동명": ["아라1동"] * 2})


def allocate(geojson_path, rows, radius_m: int) -> dict:
    """합성 패널(rows)로 DongAreas 를 만들고 모체 중심 반경 radius_m 의 배분 값(거주·종사자·타겟·잠재수요)."""
    from scoring_engine import config as C, radius_demand
    from scoring_engine.boundary import load_dong_areas
    p = panel(rows)
    areas = load_dong_areas(p, path=str(geojson_path))
    rp = radius_demand.radius_profile(LAT, LNG, shops(), p, "R10406", radius_m, pop_col=C.DEMAND_COLS,
                                      extra_cols=COLS, same_weights=C.same_weights("R10406"), areas=areas)
    return {"총인구": rp["반경_총인구"], "종사자수": rp["반경_종사자수"], "타겟_PC방": rp["반경_타겟_PC방"],
            "반경수요": rp["반경수요"], "ratios": {d: r for _, d, *_, r in areas.items}}
