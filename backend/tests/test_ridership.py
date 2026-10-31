"""
TASKS 13-41 — 가까운 역 시간대별 승하차 (scripts/build_station_ridership.py, backend/app/ridership.py, /insights station, D-040).

계약: 변환은 괄호 부기를 뗀 역 이름 · 같은 날 환승역 호선 합 · 평일(월~금)/주말 하루 평균. 저장소의 집계 파일은 엔진 역 목록과 이름이 모두 맞고
값이 음수가 아니다. /insights 는 1km 안 자료 있는 역을 station 으로, 없으면 null. 점수(/analyze)와 무관하다.
"""
import importlib.util
import json
import types
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app.ridership import BAND_KEYS, DEFAULT_PATH, MAX_DISTANCE_M, RidershipStore

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("build_station_ridership", ROOT / "scripts" / "build_station_ridership.py")
B = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B)


def raw_rows():
    """꾸민 원본(CP949): 2026-06-01(월)·06-02(화)·06-06(토), 환승역 '인천시청'은 1·2호선 두 행."""
    rows = []
    for d in ("2026-06-01", "2026-06-02", "2026-06-06"):
        for line, name, k in ((1, "인천시청", 10), (2, "인천시청", 5), (1, "가정(루원시티)", 1)):
            for io, mult in (("승차", 1), ("하차", 2)):
                rows.append({"연번": len(rows) + 1, "수송일자": d, "호선명": line, "역번호": 1, "역명": name, "승하차구분": io,
                             **{band: k * mult * (2 if d == "2026-06-06" else 1) for band in B.BANDS}})
    return pd.DataFrame(rows)


def test_build_sums_transfer_lines_and_averages_by_daytype(tmp_path):
    raw = tmp_path / "raw.csv"
    raw_rows().to_csv(raw, index=False, encoding="cp949")
    out, meta = B.build(raw, "2026-06-01", "2026-06-30")
    assert sorted(out["station"].unique()) == ["가정", "인천시청"]                                 # 괄호 부기 뗀 이름
    row = lambda s, t, d: out[(out.station == s) & (out.daytype == t) & (out.direction == d)].iloc[0]  # noqa: E731
    assert row("인천시청", "평일", "board")["h08"] == 15 and row("인천시청", "평일", "alight")["h08"] == 30   # 1·2호선 합
    assert row("인천시청", "주말", "board")["h08"] == 30 and row("인천시청", "평일", "board")["days"] == 2
    assert row("인천시청", "평일", "board")["lines"] == "인천1호선·인천2호선"
    assert meta["stations"] == 2 and meta["period"] == {"from": "2026-06-01", "to": "2026-06-30"} and "코레일" in meta["coverage"]
    with pytest.raises(SystemExit):
        B.build(raw, "2027-01-01", "2027-01-31")                                                 # 기간 밖


def test_committed_aux_file_matches_engine_stations(real_service):
    df = pd.read_csv(DEFAULT_PATH, encoding="utf-8")
    meta = json.loads(DEFAULT_PATH.with_suffix(".meta.json").read_text(encoding="utf-8"))
    assert list(df.columns) == ["station", "lines", "daytype", "direction", "days", *BAND_KEYS]
    assert df["station"].nunique() == meta["stations"] == 68 and len(df) == 68 * 4
    assert (df[BAND_KEYS] >= 0).all().all() and (df["days"] > 0).all()
    assert set(df["station"]) <= set(real_service.rt.stations["name"])                          # 엔진 역 좌표로 찾는다
    assert meta["source"]["portal_id"] == "15159353" and "제한 없음" in meta["source"]["license"]


def test_nearest_within_one_km(real_service):
    store = RidershipStore.load()
    hit = store.nearest(real_service.rt.stations, 37.4894, 126.7246)                              # 부평역 앞
    assert hit[0].name == "부평" and hit[0].lines == "인천1호선" and 0 < hit[1] < 200
    assert store.nearest(real_service.rt.stations, 37.7466, 126.4880) is None                    # 강화읍 — 1km 안에 역 없음
    assert MAX_DISTANCE_M == 1000


def test_insights_station_field_and_missing_file(real_service, tmp_path):
    shim = types.SimpleNamespace(rt=real_service.rt, cache=types.SimpleNamespace(warm=lambda b: None))
    with TestClient(M.create_app(service=shim, warm_biz=[])) as c:
        st = c.post("/insights", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "I21201"}).json()["station"]
        assert st["name"] == "부평" and len(st["bands"]) == 20 and len(st["weekday"]["alight"]) == 20
        assert st["period_from"] == "2025-07-01" and st["source"] == "인천교통공사" and "경인선" in st["coverage"]
        assert c.post("/insights", json={"lat": 37.7466, "lng": 126.4880, "biz_code": "I21201"}).json()["station"] is None
    empty = RidershipStore({}, {})
    with TestClient(M.create_app(service=shim, warm_biz=[], ridership=empty)) as c:
        assert c.post("/insights", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "I21201"}).json()["station"] is None
    assert RidershipStore.load(str(tmp_path / "none.csv")) is None                                 # 파일이 없으면 기능 없음
