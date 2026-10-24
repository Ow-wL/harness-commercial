"""
엔진 v0.5.1(`mvp-0.5.1`, D-029) — v0.5 + 분동 배분 결함 수정(팀 엔진 유래: 분동 인구비 이중 적용).

  V-split    같은 모체 경계·같은 총량에서 분동 전후 반경 배분(거주·종사자·타겟·잠재수요)이 보존된다
             — 합성 사례(tests/split_dong_case.py) + 실데이터(아라1·2동, 운서1·2동을 모체 1행으로 합친 패널과 같은 값)
  V-team     팀 단위 테스트 29건이 그대로 통과한다(분동 비율을 쓰지 않는 테스트들)
  V-golden   v0.5.1@300·500·1,000 == golden v0.5.1 (tests/golden/v0.5.1, scripts/golden_v0_5.py)
v0.5 대비 바뀐 범위(고객성·경쟁성·종합·경고·엔진버전만)는 파일만 보는 tests/test_engine_v0_5_1_diff.py 가 확인한다.
"""
import glob
import importlib
import os

import pandas as pd
import pytest

import scoring_engine
import scoring_engine.config as C
from helpers import ROOT, deep_diff, load_json, normalize
from scoring_engine.context import BUPYEONG_STATION

BIZ = list(C.CODE_NAME)
SPLIT = {"아라동": ["아라1동", "아라2동"], "운서동": ["운서1동", "운서2동"]}


def golden(radius: int) -> dict:
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "golden", "v0.5.1", f"r{radius}", "json", "*.json")))
    return {g["meta"]["업종코드"]: g for g in map(load_json, files)}


def test_engine_is_v0_5_1():
    assert scoring_engine.ENGINE_KEY == "v0_5_1" and scoring_engine.ENGINE_VERSION == "mvp-0.5.1"
    assert scoring_engine.AREA_WEIGHTED and scoring_engine.RADIUS_OPTIONS_M == (300, 500, 1000)


# ── V-split ─────────────────────────────────────────────
@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_split_dong_allocation_preserved_synthetic(tmp_path, radius):
    import split_dong_case as S
    geo = tmp_path / "parent.geojson"
    S.write_parent_geojson(geo)
    before, after = S.allocate(geo, S.UNSPLIT, radius), S.allocate(geo, S.SPLIT, radius)
    assert after["ratios"] == {"아라1동": 1.0, "아라2동": 1.0}
    for col in (*S.COLS, "반경수요"):
        assert after[col] == pytest.approx(before[col], rel=1e-12), col
        assert before[col] > 0


def test_split_dong_allocation_preserved_real_data(service):
    """실데이터: 분동 패널 그대로의 반경 배분 == 분동을 모체 1행(합계)으로 합친 패널의 배분 — 4개 분동 중심점, 세 반경."""
    from scoring_engine import radius_demand
    from scoring_engine.boundary import load_dong_areas
    from scoring_engine.reference import customer_cols, demand_table
    rt, biz = service.rt, "R10406"
    assert {d: r for _, d, *_, r in rt.areas.items if d in sum(SPLIT.values(), [])} == {
        "아라1동": 1.0, "아라2동": 1.0, "운서1동": 1.0, "운서2동": 1.0}
    cols = customer_cols(biz)
    merged = rt.panel.copy()
    for parent, kids in SPLIT.items():
        rows = merged[merged["행정동명"].isin(kids)]
        assert len(rows) == 2 and rows["시군구명"].nunique() == 1
        one = rows.iloc[[0]].copy()
        one["행정동명"] = parent
        for c in set(cols) | {"총인구", "종사자수"}:
            one[c] = rows[c].sum()
        merged = pd.concat([merged.drop(rows.index), one], ignore_index=True)
    merged_areas = load_dong_areas(merged)
    cent = rt.centroids.set_index("행정동명")
    for dong in sum(SPLIT.values(), []):
        lat, lng = float(cent.loc[dong, "위도"]), float(cent.loc[dong, "경도"])
        for r in (300, 500, 1000):
            kw = dict(pop_col=C.DEMAND_COLS, extra_cols=cols, same_weights=C.same_weights(biz))
            a = radius_demand.radius_profile(lat, lng, rt.shops, demand_table(rt.panel, biz), biz, r, areas=rt.areas, **kw)
            b = radius_demand.radius_profile(lat, lng, rt.shops, demand_table(merged, biz), biz, r, areas=merged_areas, **kw)
            for k in ["반경수요"] + [f"반경_{c}" for c in cols]:
                assert a[k] == pytest.approx(b[k], rel=1e-9), (dong, r, k)
            assert a["반경_총인구"] > 0


# ── V-team ───────────────────────────────────────────────
TEAM_UNIT_MODULES = {"test_weights": 8, "test_access": 6, "test_agglomeration": 7, "test_v05": 8}


def _team_cases():
    for name, n in TEAM_UNIT_MODULES.items():
        mod = importlib.import_module(name)
        assert os.path.dirname(mod.__file__) == scoring_engine.ENGINE_DIR
        fns = [getattr(mod, f) for f in sorted(dir(mod)) if f.startswith("test_")]
        assert len(fns) == n
        yield from (pytest.param(fn, id=f"{name}::{fn.__name__}") for fn in fns)


TEAM_CASES = list(_team_cases())


def test_team_unit_test_count():
    assert len(TEAM_CASES) == 29


@pytest.mark.parametrize("fn", TEAM_CASES)
def test_team_unit(fn):
    fn()


# ── V-golden ─────────────────────────────────────────────
@pytest.mark.golden
@pytest.mark.parametrize("radius", [500, 300, 1000])
def test_v_golden_v0_5_1(service, radius):
    g = golden(radius)
    assert sorted(g) == sorted(BIZ)
    bad = []
    for biz in BIZ:
        got = normalize(service.analyze(BUPYEONG_STATION, biz, radius_m=radius))
        assert got["meta"]["분석반경_m"] == radius and got["meta"]["엔진버전"] == "mvp-0.5.1"
        assert got["지표"][1]["raw"]["인구_기준"] == f"반경 {radius}m 배분"
        diffs = deep_diff(got, g[biz])
        if diffs:
            bad.append(f"{C.CODE_NAME[biz]}: " + "; ".join(diffs[:5]))
    assert not bad, "\n".join(bad)


@pytest.mark.golden
def test_reference_cache_keys(service):
    service.cache.warm()
    assert service.cache.stats() == {"competition_entries": 87, "location_entries": 18}
    assert service.rt.areas.stats() == {"entries": 158 * 3, "points": 158}


# ── API ──────────────────────────────────────────────────
def test_api_v0_5_1(service):
    from fastapi.testclient import TestClient
    from backend.app import main as M
    body = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "radius_m": 1000}
    with TestClient(M.create_app(service=service, warm_biz=[])) as c:
        assert c.get("/health").json()["engine"] == {"version": "mvp-0.5.1", "radius_options": [300, 500, 1000],
                                                     "default_radius_m": 500}
        a, n = c.post("/analyze", json=body), c.post("/nearby-stores", json=body)
        assert a.status_code == 200 and n.status_code == 200
        raw = a.json()["result"]["지표"][2]["raw"]
        assert a.json()["result"]["meta"]["엔진버전"] == "mvp-0.5.1"
        assert n.json()["count"] == raw["동종점포수"] == raw["동종점포수_정확일치"] == 17
