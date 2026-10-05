"""
Location Resolver (scoring_engine/location.py) — 좌표 → 2026 인천 행정동 (TASKS 1-3, docs/DECISIONS.md D-009).

테스트 좌표는 눈대중이 아니라 데이터에서 만든다:
  내부 점   각 polygon 의 representative_point (polygon 내부가 보장되는 점)
  경계선 점 이웃한 두 polygon 의 공유 경계 좌표
  밖/바다   모든 polygon 합집합과의 거리를 먼저 확인한 고정 좌표
"""
import builtins
import json
import math
import os

import pandas as pd
import pytest
from shapely.geometry import Point, shape
from shapely.ops import unary_union

from helpers import RUNTIME_DIR
from scoring_engine import location as L

BOUNDARY = L.DEFAULT_BOUNDARY_PATH
# 분동 (D-009): 2024 운서동 → 운서1동·운서2동, 2024 아라동 → 아라1동·아라2동
WOONSEO = ("28155540", "28155550")
ARA = ("28290570", "28290580")
# 경계 원문 '·' / panel '.' 표기가 다른 행정동 (D-009)
SEPARATOR_ONLY = ("28125590", "28125610", "28125650", "28177520", "28177540", "28177610")


@pytest.fixture(scope="module")
def geoms():
    with open(BOUNDARY, encoding="utf-8") as f:
        return {ft["properties"]["행정동코드"]: shape(ft["geometry"]) for ft in json.load(f)["features"]}


@pytest.fixture(scope="module")
def union(geoms):
    return unary_union(list(geoms.values()))


@pytest.fixture(scope="module")
def panel():
    return pd.read_csv(os.path.join(RUNTIME_DIR, "패널_통합.csv"), encoding="utf-8-sig",
                       dtype={"행정동코드": str}, usecols=["행정동코드", "시군구명", "행정동명"])


@pytest.fixture(scope="module")
def resolver():
    return L.default_resolver()


def inner(geom):
    p = geom.representative_point()
    return p.y, p.x                                  # (lat, lng)


# ── 내부 좌표 → 정확한 코드 ───────────────────────────────
def test_every_dong_interior_point_resolves_to_its_code(resolver, geoms):
    wrong = {c: resolver.resolve(*inner(g)).dong_code for c, g in geoms.items()}
    wrong = {c: got for c, got in wrong.items() if got != c}
    assert len(geoms) == 158 and not wrong, wrong


@pytest.mark.parametrize("pair", [WOONSEO, ARA], ids=["운서1·2동", "아라1·2동"])
def test_split_dongs_are_distinguished(resolver, geoms, pair):
    a, b = pair
    pa, pb = inner(geoms[a]), inner(geoms[b])
    # 근거: 각 점은 자기 polygon 안에만 있다
    assert geoms[a].contains(Point(pa[1], pa[0])) and not geoms[b].covers(Point(pa[1], pa[0]))
    assert geoms[b].contains(Point(pb[1], pb[0])) and not geoms[a].covers(Point(pb[1], pb[0]))
    ra, rb = resolver.resolve(*pa), resolver.resolve(*pb)
    assert (ra.dong_code, rb.dong_code) == (a, b)
    assert ra.gu_name == rb.gu_name and ra.dong_name != rb.dong_name


def test_result_fields(resolver, geoms):
    lat, lng = inner(geoms["28155540"])
    r = resolver.resolve(lat, lng)
    assert (r.lat, r.lng) == (lat, lng)
    assert (r.dong_code, r.gu_code, r.gu_name, r.dong_name, r.boundary_dong_name) == \
        ("28155540", "28155", "영종구", "운서1동", "운서1동")


# ── panel 연결은 코드 기준 ────────────────────────────────
def test_names_come_from_panel_by_code(resolver, geoms, panel):
    by_code = panel.set_index("행정동코드")
    for code, g in geoms.items():
        r = resolver.resolve(*inner(g))
        assert (r.gu_name, r.dong_name) == (by_code.loc[code, "시군구명"], by_code.loc[code, "행정동명"])
        assert r.gu_code == code[:5]


@pytest.mark.parametrize("code", SEPARATOR_ONLY)
def test_separator_difference_does_not_matter(resolver, geoms, code):
    r = resolver.resolve(*inner(geoms[code]))
    assert r.dong_code == code
    assert "." in r.dong_name and "·" not in r.dong_name                  # panel 표기
    assert r.boundary_dong_name.replace("·", ".") == r.dong_name != r.boundary_dong_name


def test_runtime_panel_with_int_codes_is_accepted(geoms):
    """RuntimeData.panel 은 dtype 지정 없이 읽어 행정동코드가 int 다 (runtime.load_runtime) — 같은 결과여야 한다."""
    rt_panel = pd.read_csv(os.path.join(RUNTIME_DIR, "패널_통합.csv"), encoding="utf-8-sig")
    assert rt_panel["행정동코드"].dtype.kind == "i"
    r = L.LocationResolver(panel=rt_panel).resolve(*inner(geoms["28290580"]))
    assert (r.dong_code, r.dong_name) == ("28290580", "아라2동")


def test_panel_code_set_mismatch_is_rejected(panel):
    with pytest.raises(ValueError):
        L.LocationResolver(panel=panel[panel["행정동코드"] != "28155540"])


# ── 경계선 위 점 ─────────────────────────────────────────
def test_point_on_shared_border_is_deterministic(resolver, geoms):
    a, b = WOONSEO
    shared = geoms[a].boundary.intersection(geoms[b].boundary)
    coords = [c for part in getattr(shared, "geoms", [shared]) for c in part.coords]
    lng, lat = coords[len(coords) // 2]
    pt = Point(lng, lat)
    assert geoms[a].covers(pt) and geoms[b].covers(pt)                    # 근거: 두 polygon 경계 위
    assert not geoms[a].contains(pt) and not geoms[b].contains(pt)
    got = {resolver.resolve(lat, lng).dong_code for _ in range(3)}
    assert got == {min(a, b)}


# ── 경계 밖 ──────────────────────────────────────────────
@pytest.mark.parametrize("lat,lng,label", [
    (37.5663, 126.9779, "서울시청"),
    (35.1796, 129.0756, "부산시청"),
    (0.0, 0.0, "적도·본초자오선"),
])
def test_outside_incheon_fails(resolver, union, lat, lng, label):
    assert not union.covers(Point(lng, lat))
    with pytest.raises(L.LocationOutside):
        resolver.resolve(lat, lng)


@pytest.mark.parametrize("lat,lng", [(37.30, 125.80), (37.55, 126.20)])
def test_sea_fails(resolver, union, lat, lng):
    """인천 경계 범위 안의 바다. 모든 행정동 polygon 에서 0.05도(약 4km) 이상 떨어진 점."""
    minx, miny, maxx, maxy = union.bounds
    assert minx < lng < maxx and miny < lat < maxy and union.distance(Point(lng, lat)) >= 0.05
    with pytest.raises(L.LocationOutside):
        resolver.resolve(lat, lng)


# ── 좌표 검증 ────────────────────────────────────────────
@pytest.mark.parametrize("lat,lng", [
    (math.nan, 126.7), (37.5, math.nan), (math.inf, 126.7), (37.5, -math.inf),
    (90.0001, 126.7), (-91, 126.7), (37.5, 180.5), (37.5, -181),
    ("37.5", 126.7), (37.5, None), (True, 126.7), (37.5, [126.7]),
])
def test_invalid_coordinates_rejected(resolver, lat, lng):
    with pytest.raises(L.InvalidCoordinate):
        resolver.resolve(lat, lng)


def test_location_errors_are_value_errors():
    assert issubclass(L.InvalidCoordinate, L.LocationError) and issubclass(L.LocationOutside, L.LocationError)
    assert issubclass(L.LocationError, ValueError)


def test_numpy_and_int_inputs_accepted(resolver, geoms):
    import numpy as np
    lat, lng = inner(geoms["28237510"])
    assert resolver.resolve(np.float64(lat), np.float32(lng)).dong_code == "28237510"
    assert L.validate_coordinate(37, 126) == (37.0, 126.0)


# ── 캐시: 파일은 생성 시 1회만 읽는다 ─────────────────────
def test_resolve_does_not_read_files(monkeypatch, geoms):
    r = L.LocationResolver()

    def no_open(*a, **k):
        raise AssertionError("resolve 중 파일을 열었다")
    monkeypatch.setattr(builtins, "open", no_open)
    monkeypatch.setattr(pd, "read_csv", no_open)
    for code in WOONSEO + ARA:
        assert r.resolve(*inner(geoms[code])).dong_code == code


def test_default_resolver_is_shared():
    assert L.default_resolver() is L.default_resolver()
    assert len(L.default_resolver()) == 158
