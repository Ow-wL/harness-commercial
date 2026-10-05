"""
ContextBuilder (scoring_engine/location.py) — 좌표 → SiteContext → AnalysisService (TASKS 1-7).

정책: rent_area 는 항상 None (MVP 일반 좌표는 R-ONE 임대료 상권을 연결하지 않음, D-015), 부평역 등 특정 좌표 특별 처리 없음, 반경 500m 안 점포 0개 → NoDataNearby,
      구월1동/3동 경계는 SGIS 공식 경계로 교정된 data/geo 를 그대로 쓴다 (D-017, 좌표별 예외 없음).
테스트 좌표는 데이터에서 만들거나, 고정 좌표면 전제를 데이터로 먼저 확인한다.
"""
import json
import types

import pytest
from shapely.geometry import Point, shape

from helpers import deep_diff, normalize
from scoring_engine import config as C, radius_demand
from scoring_engine.context import BUPYEONG_STATION, SiteContext
from scoring_engine.location import (DEFAULT_BOUNDARY_PATH, ContextBuilder, ContextDataError, InvalidCoordinate,
                                     LocationOutside, LocationResolver, NoDataNearby, default_resolver)

BUPYEONG = (37.4894, 126.7246)               # golden(BUPYEONG_STATION) 좌표
EMPTY_LAND = (37.3669, 126.4157)             # 영종구 용유동 polygon 안, 반경 500m 점포 0개 (전제는 테스트에서 확인)
INTEGRATION_BIZ = ("R10406", "I21201", "S20701")   # PC방(안정성 있음), 카페, 미용실


@pytest.fixture(scope="module")
def rt(service):
    return service.rt


@pytest.fixture(scope="module")
def builder(rt):
    return ContextBuilder(rt, resolver=default_resolver())


@pytest.fixture(scope="module")
def geoms():
    with open(DEFAULT_BOUNDARY_PATH, encoding="utf-8") as f:
        return {ft["properties"]["행정동코드"]: shape(ft["geometry"]) for ft in json.load(f)["features"]}


def inner(geom):
    p = geom.representative_point()
    return p.y, p.x


def n_shops(rt, lat, lng):
    """엔진 함수로 직접 센 반경 내 점포 수 (ContextBuilder 와 독립)."""
    return int((radius_demand.haversine_m(lat, lng, rt.shops["위도"].values, rt.shops["경도"].values)
                <= C.RADIUS_M).sum())


# ── 부평역 ───────────────────────────────────────────────
def test_bupyeong_station_coordinate(builder):
    ctx = builder.build(*BUPYEONG)
    assert ctx == SiteContext(label="부평구 부평1동", lat=37.4894, lng=126.7246, gu_code="28237",
                              gu_name="부평구", dong_name="부평1동", rent_area=None)


def test_bupyeong_admin_fields_equal_golden_context(builder):
    ctx = builder.build(*BUPYEONG)
    pick = lambda c: (c.lat, c.lng, c.gu_code, c.gu_name, c.dong_name)  # noqa: E731
    assert pick(ctx) == pick(BUPYEONG_STATION)
    assert ctx.rent_area is None and BUPYEONG_STATION.rent_area == "부평"     # golden fixture 는 그대로


# ── 일반 좌표 / 분동 ─────────────────────────────────────
def test_every_dong_interior_point_builds_its_context(builder, rt, geoms):
    panel = rt.panel.assign(행정동코드=rt.panel["행정동코드"].astype(str)).set_index("행정동코드")
    built = 0
    for code, g in geoms.items():
        lat, lng = inner(g)
        if n_shops(rt, lat, lng) == 0:
            with pytest.raises(NoDataNearby):
                builder.build(lat, lng)
            continue
        ctx = builder.build(lat, lng)
        row = panel.loc[code]
        assert (ctx.gu_code, ctx.gu_name, ctx.dong_name) == (code[:5], row["시군구명"], row["행정동명"])
        assert ctx.label == f"{row['시군구명']} {row['행정동명']}" and ctx.rent_area is None
        built += 1
    assert built >= 100


@pytest.mark.parametrize("code,gu,dong", [
    ("28155540", "영종구", "운서1동"), ("28155550", "영종구", "운서2동"),
    ("28290570", "검단구", "아라1동"), ("28290580", "검단구", "아라2동"),
])
def test_split_dongs(builder, rt, code, gu, dong):
    """분동 지역: 그 동 라벨 점포 좌표(데이터)로 build → 해당 동."""
    shops = rt.shops[rt.shops["행정동코드"].astype(str) == code]
    for _, s in shops.head(50).iterrows():
        lat, lng = float(s["위도"]), float(s["경도"])
        if default_resolver().resolve(lat, lng).dong_code != code:
            continue                                   # 경계 근접 점포는 건너뛴다 (D-010)
        ctx = builder.build(lat, lng)
        assert (ctx.gu_code, ctx.gu_name, ctx.dong_name) == (code[:5], gu, dong)
        return
    pytest.fail(f"{dong}: 자기 polygon 안 점포를 찾지 못함")


def test_former_guwol_conflict_builds_guwol3(builder):
    """교정으로 구월1동 → 구월3동이 된 구역 안의 좌표 (D-010 → D-017, backend pass-through 와 같은 좌표).
    교정 전 결과는 구월1동이었다. 이 좌표가 SGIS 공식 구월3동 polygon 안이라는 것은 tests/test_geo_data.py 가 확인한다.
    SGIS 공식 판정은 구월3동 → ContextBuilder 도 구월3동 (경계 데이터로, 좌표 예외 없이)."""
    ctx = builder.build(37.4482, 126.7035)
    assert (ctx.gu_code, ctx.gu_name, ctx.dong_name, ctx.label) == ("28200", "남동구", "구월3동", "남동구 구월3동")


# ── 실패 ─────────────────────────────────────────────────
@pytest.mark.parametrize("lat,lng", [(37.5663, 126.9779), (37.30, 125.80)], ids=["서울시청", "서해"])
def test_outside_fails(builder, lat, lng):
    with pytest.raises(LocationOutside):
        builder.build(lat, lng)


@pytest.mark.parametrize("lat,lng", [(float("nan"), 126.7), (37.5, float("inf")), (91, 126.7), ("37.5", 126.7)])
def test_invalid_coordinate_fails(builder, lat, lng):
    with pytest.raises(InvalidCoordinate):
        builder.build(lat, lng)


def test_no_data_nearby(builder, rt, geoms):
    lat, lng = EMPTY_LAND
    assert geoms["28155560"].contains(Point(lng, lat)) and n_shops(rt, lat, lng) == 0     # 전제
    with pytest.raises(NoDataNearby):
        builder.build(lat, lng)


def test_store_location_is_analyzable(builder, rt):
    """점포 좌표 자체는 반경 안에 점포가 최소 1개(자기 자신) — NoDataNearby 가 아니다."""
    s = rt.shops.iloc[0]
    ctx = builder.build(float(s["위도"]), float(s["경도"]))
    assert builder.shops_within_radius(ctx.lat, ctx.lng) >= 1


@pytest.mark.parametrize("lat,lng", [BUPYEONG, (37.4482, 126.7035), (37.5970, 126.7102), EMPTY_LAND])
def test_radius_count_matches_engine_n_all(builder, rt, lat, lng):
    """NoDataNearby 판정의 점포 수 == 엔진 radius_profile 의 n_all (같은 거리·같은 반경)."""
    rp = radius_demand.radius_profile(lat, lng, rt.shops, rt.panel[["시군구명", "행정동명", "총인구"]], "R10406",
                                      C.RADIUS_M, dong_total_shops=rt.shops.groupby(["시군구명", "행정동명"])
                                      .size().rename("전체점포수").reset_index())
    assert builder.shops_within_radius(lat, lng) == rp["n_all"]


def test_panel_code_missing_is_context_data_error(rt, geoms):
    """resolver(전체 158) 와 runtime panel(1개 빠짐) 이 어긋나면 내부 불일치 오류."""
    fake = types.SimpleNamespace(panel=rt.panel[rt.panel["행정동코드"].astype(str) != "28237510"],
                                 market=rt.market, shops=rt.shops)
    b = ContextBuilder(fake, resolver=default_resolver())
    with pytest.raises(ContextDataError):
        b.build(*inner(geoms["28237510"]))
    assert not issubclass(ContextDataError, ValueError)            # 입력 오류(LocationError)와 구분


def test_market_code_missing_is_context_data_error(rt, geoms):
    fake = types.SimpleNamespace(panel=rt.panel, market=rt.market[rt.market["시군구코드"] != "28237"],
                                 shops=rt.shops)
    with pytest.raises(ContextDataError):
        ContextBuilder(fake, resolver=default_resolver()).build(*inner(geoms["28237510"]))


def test_builder_default_resolver_uses_runtime_panel(rt):
    b = ContextBuilder(rt)
    assert isinstance(b.resolver, LocationResolver) and b.build(*BUPYEONG).dong_name == "부평1동"


# ── AnalysisService 통합 ─────────────────────────────────
@pytest.mark.parametrize("biz", INTEGRATION_BIZ)
def test_built_context_runs_engine(service, builder, biz):
    ctx = builder.build(*BUPYEONG)
    res = service.analyze(ctx, biz)
    assert res["meta"]["업종코드"] == biz and res["meta"]["행정동"] == "부평구 부평1동"
    assert res["meta"]["query"] == f"부평구 부평1동 근처 {C.CODE_NAME[biz]}"
    assert [i["key"] for i in res["지표"]] == ["market", "customer", "competition", "location", "stability"]
    assert isinstance(res["종합"]["점수"], float) and res["초보자_접근성"] is not None


@pytest.mark.parametrize("biz", INTEGRATION_BIZ)
def test_built_context_is_deterministic(service, builder, biz):
    a = normalize(service.analyze(builder.build(*BUPYEONG), biz))
    b = normalize(service.analyze(builder.build(*BUPYEONG), biz))
    assert not deep_diff(a, b)


def test_bupyeong_rent_independent_perspectives_match_golden_context(service, builder):
    """같은 좌표·행정동이므로 임대료와 무관한 4개 관점 점수는 golden 컨텍스트와 같다. 안정성(S4)·종합은 다를 수 있다."""
    got = service.analyze(builder.build(*BUPYEONG), "R10406")
    want = service.analyze(BUPYEONG_STATION, "R10406")
    pick = lambda r: {i["key"]: (i["score"], i["raw"]) for i in r["지표"] if i["key"] != "stability"}  # noqa: E731
    assert not deep_diff(normalize(pick(got)), normalize(pick(want)))


@pytest.mark.parametrize("lat,lng", [(37.4482, 126.7035), (37.5970, 126.7102)], ids=["구월교정구역", "아라"])
def test_other_locations_run_engine(service, builder, lat, lng):
    res = service.analyze(builder.build(lat, lng), "I21201")
    assert len(res["지표"]) == 5 and res["meta"]["엔진버전"] == "mvp-0.3"
