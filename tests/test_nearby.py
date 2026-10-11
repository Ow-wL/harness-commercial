"""
4차 — 동종 점포 조회(scoring_engine/nearby.py)가 엔진 경쟁성과 같은 기준인지 검증한다 (D-019).

  1) 부평역 29개 업종: 조회 수 == 엔진 결과 경쟁성.raw.동종점포수 (bupyeong_results, golden 과 같은 좌표)
  2) 여러 지점 × 29개 업종: 조회 수 == radius_demand.radius_profile 의 n_same (엔진 함수 직접 호출)
  3) 0곳 지점(송도 PC방): 빈 목록 == 엔진 동종점포수 0
  4) 목록 규칙: 반경 이내, 가까운 순, 같은 업종, 직선거리 정수 m
"""
import math

import pytest

from scoring_engine import config as C, radius_demand
from scoring_engine.context import BUPYEONG_STATION
from scoring_engine.location import ContextBuilder
from scoring_engine.nearby import SHOPS_AS_OF, NearbyStoreFinder, _text

POINTS = {
    "부평역": (37.4894, 126.7246),
    "구월": (37.448, 126.703),
    "송도": (37.392512, 126.639034),
    "강화읍": (37.7469, 126.4878),
}


@pytest.fixture(scope="module")
def rt(service):
    return service.rt


@pytest.fixture(scope="module")
def finder(rt):
    return NearbyStoreFinder(rt)


@pytest.fixture(scope="module")
def dong_total(rt):
    # radius_demand.build_reference 가 radius_profile 에 넘기는 것과 같은 행정동별 전체 점포수
    return rt.shops.groupby(["시군구명", "행정동명"]).size().rename("전체점포수").reset_index()


def test_bupyeong_count_equals_engine_result_for_all_29(finder, bupyeong_results):
    for biz, res in bupyeong_results.items():
        engine_n = next(i for i in res["지표"] if i["key"] == "competition")["raw"]["동종점포수"]
        assert len(finder.find(BUPYEONG_STATION.lat, BUPYEONG_STATION.lng, biz)) == engine_n, biz


@pytest.mark.parametrize("name", list(POINTS))
def test_count_equals_radius_profile_n_same(finder, rt, dong_total, name):
    lat, lng = POINTS[name]
    pop = rt.panel[["시군구명", "행정동명", "총인구"]]
    for biz in C.CODE_NAME:
        rp = radius_demand.radius_profile(lat, lng, rt.shops, pop, biz, C.RADIUS_M, dong_total_shops=dong_total)
        assert len(finder.find(lat, lng, biz)) == rp["n_same"], (name, biz)


def test_zero_stores_matches_engine(finder, service, rt):
    lat, lng = POINTS["송도"]
    ctx = ContextBuilder(rt).build(lat, lng)
    res = service.analyze(ctx, "R10406")
    competition = next(i for i in res["지표"] if i["key"] == "competition")
    assert competition["raw"]["동종점포수"] == 0
    assert finder.find(ctx.lat, ctx.lng, "R10406") == []


@pytest.mark.parametrize("biz", ["R10406", "I21201", "G20405"])
def test_list_rules(finder, rt, biz):
    lat, lng = POINTS["부평역"]
    stores = finder.find(lat, lng, biz)
    assert stores, biz
    dists = [s.distance_m for s in stores]
    assert dists == sorted(dists)
    codes = rt.shops.set_index("상가업소번호").loc[[s.id for s in stores], "상권업종소분류코드"]
    assert set(codes) == {biz}
    for s in stores:
        exact = float(radius_demand.haversine_m(lat, lng, [s.lat], [s.lng])[0])
        assert exact <= C.RADIUS_M and s.distance_m == round(exact)
        assert isinstance(s.distance_m, int)


def test_bupyeong_pc_bang_first_store(finder):
    stores = finder.find(37.4894, 126.7246, "R10406")
    assert len(stores) == 12
    assert stores[0].distance_m == 115 and stores[0].name and stores[0].road_address


def test_text_cleanup_and_as_of():
    assert _text(math.nan) is None and _text(None) is None and _text("  ") is None
    assert _text(" 부평역점 ") == "부평역점"
    assert SHOPS_AS_OF == "2026-06-30"         # sources/team_v0.3/00_README.md 데이터 표
