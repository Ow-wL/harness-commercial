"""
data/geo — 행정동 경계와 2024→2026 crosswalk 의 무결성·키 정합성 (docs/DECISIONS.md D-009).

  원본 data/geo/raw/   git 제외. 있으면 매니페스트 해시 검사, 없으면 SKIP (가공 파일 검사는 계속)
  SGIS 입력 data/geo/SGIS_*.geojson  commit. 공식 경계 geometry(UTM-K) + provenance. 구월1동/구월3동 교정 근거 (D-017)
  가공 data/geo/*      commit. 매니페스트 해시 + runtime panel 158개 행정동과 정확히 일치
  시군구 경계·외곽선 인천_시군구경계_2026.geojson  행정동 경계 union (구 11 + 외곽선 1, docs/spikes/9A-geo-theme s1 규칙)
매니페스트를 새 출력으로 덮어써서 통과시키지 않는다. 경계 교체는 새 결정(DECISIONS)과 함께만.
"""
import csv
import json
import os

import pandas as pd
import pytest
from shapely import STRtree
from shapely.geometry import shape
from shapely.ops import unary_union

from helpers import ROOT, RUNTIME_DIR, M
import build_geo as B  # noqa: E402  (helpers 가 scripts/ 를 sys.path 에 넣는다)

GEO_DIR = os.path.join(ROOT, "data", "geo")
GEO_MANIFEST = os.path.join(ROOT, "tests", "manifests", "geo.sha256.json")
BOUNDARY = os.path.join(GEO_DIR, "인천_행정동경계_2026.geojson")
CROSSWALK = os.path.join(GEO_DIR, "행정동_crosswalk_2024_2026.csv")
GU_OUTLINE = os.path.join(GEO_DIR, "인천_시군구경계_2026.geojson")
# 시군구 경계·외곽선은 표시용으로 단순화(구 1e-4°·외곽 2e-4°)·정리(작은 구멍·조각 제거)한 것이라 행정동 union 과 정확히 같지 않다.
# 2026-10-19 실측(대칭차 면적 / union 면적): 구 최대 2.92e-3(옹진군)·2.79e-3(제물포구), 외곽선 2.33e-3; 구끼리 겹침 최대 3.3e-4.
GU_SIMPLIFY_TOL = 5e-3      # 대칭차 면적 ≤ 0.5 % × union 면적
GU_OVERLAP_TOL = 1e-3       # 구끼리 겹침 면적 ≤ 0.1 % × 작은 쪽 면적
GU_POINT_TOL_DEG = 1e-4     # 행정동 대표점 ↔ 구 polygon 허용 거리 (단순화 폭, 실측 0)

with open(GEO_MANIFEST, encoding="utf-8") as _f:
    MANIFEST_FILES = json.load(_f)["files"]

# 2024 → 2026 분동 (2026-07-01 인천 개편). 기계적 비교 결과를 고정한다 — 바뀌면 데이터가 바뀐 것이다.
EXPECTED_SPLITS = {
    "28110628": {"28155540", "28155550"},   # 중구 운서동 → 영종구 운서1동·운서2동
    "28260740": {"28290570", "28290580"},   # 서구 아라동 → 검단구 아라1동·아라2동
}
# 경계 원문은 '·', runtime panel 은 '.' 을 쓰는 행정동 (코드는 같다)
SEPARATOR_ONLY = {"28125590", "28125610", "28125650", "28177520", "28177540", "28177610"}
GUWOL1, GUWOL3 = "28200510", "28200521"
# SGIS transcoord(src=5179 → dst=4326) 응답 (2026-10-06, SGIS 구월1동·구월3동 경계 꼭짓점): (x, y, 위도, 경도)
SGIS_TRANSCOORD = [
    (930876.1048999992, 1939015.004100001, 37.447738890024304, 126.71851838028503),
    (930546.4978999989, 1937870.3423000001, 37.43739746356523, 126.71490012599105),
    (929991.5612000009, 1940014.5946, 37.45668153299831, 126.70842408134419),
    (929304.8384000007, 1938550.7796000005, 37.443436105874454, 126.700800467295),
    (928707.5861999997, 1938965.3588000005, 37.44712680276846, 126.69400913362381),
]


@pytest.fixture(scope="module")
def panel():
    return pd.read_csv(os.path.join(RUNTIME_DIR, "패널_통합.csv"), encoding="utf-8-sig",
                       dtype={"행정동코드": str}, usecols=["행정동코드", "시군구명", "행정동명"])


@pytest.fixture(scope="module")
def features():
    with open(BOUNDARY, encoding="utf-8") as f:
        return json.load(f)["features"]


@pytest.fixture(scope="module")
def crosswalk():
    with open(CROSSWALK, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


# ── 무결성 ────────────────────────────────────────────────
@pytest.mark.parametrize("rel", sorted(k for k, v in MANIFEST_FILES.items() if v["git"]))
def test_processed_files_match_manifest(rel):
    path = os.path.join(GEO_DIR, rel)
    assert os.path.isfile(path), f"가공 파일 없음: {rel}"
    assert M.sha256(path) == MANIFEST_FILES[rel]["sha256"], f"{rel} 가 매니페스트와 다르다"


@pytest.mark.parametrize("rel", sorted(k for k, v in MANIFEST_FILES.items() if not v["git"]))
def test_raw_files_match_manifest(rel):
    path = os.path.join(GEO_DIR, rel)
    if not os.path.isfile(path):
        pytest.skip(f"원본 없음 (git 제외): {rel} — 매니페스트 url 에서 받으면 검사한다")
    assert M.sha256(path) == MANIFEST_FILES[rel]["sha256"], f"{rel} 가 매니페스트와 다르다"


def test_geo_dir_has_no_unlisted_files():
    listed = {k for k in MANIFEST_FILES if "/" not in k}
    actual = {fn for fn in os.listdir(GEO_DIR)
              if os.path.isfile(os.path.join(GEO_DIR, fn)) and not fn.startswith(("README", "."))}
    assert actual == listed, f"매니페스트에 없는 파일: {sorted(actual - listed)}"


# ── 경계 ↔ runtime panel ─────────────────────────────────
def test_boundary_codes_equal_panel_158(panel, features):
    codes = [f["properties"]["행정동코드"] for f in features]
    assert len(codes) == len(set(codes)) == 158
    assert set(codes) == set(panel["행정동코드"])


def test_boundary_names_follow_panel(panel, features):
    by_code = panel.set_index("행정동코드")
    for f in features:
        p = f["properties"]
        row = by_code.loc[p["행정동코드"]]
        assert (p["시군구명"], p["행정동명"]) == (row["시군구명"], row["행정동명"]), p
        assert p["시군구코드"] == p["행정동코드"][:5] and p["행정기관코드"][:8] == p["행정동코드"]
        if p["경계_행정동명"] != p["행정동명"]:
            assert p["행정동코드"] in SEPARATOR_ONLY and p["경계_행정동명"].replace("·", ".") == p["행정동명"], p


def test_boundary_polygons_valid_and_disjoint(features):
    """점 → 행정동 판정이 하나로 정해지려면 polygon 이 유효하고 서로 겹치지 않아야 한다."""
    geoms = [shape(f["geometry"]) for f in features]
    assert all(g.is_valid and not g.is_empty and g.geom_type in ("Polygon", "MultiPolygon") for g in geoms)
    tree = STRtree(geoms)
    for i, g in enumerate(geoms):
        for j in tree.query(g):
            if j > i:
                assert g.intersection(geoms[j]).area <= 1e-9 * min(g.area, geoms[j].area), \
                    (features[i]["properties"]["행정동코드"], features[j]["properties"]["행정동코드"])


# ── SGIS 공식 경계 교정 (D-017) ───────────────────────────
@pytest.fixture(scope="module")
def sgis_wgs84():
    sg = B.load_sgis()
    return {name.split()[-1]: B.utmk_geometry_to_wgs84(ft["geometry"]) for name, ft in sg.items()}


def test_sgis_input_is_geometry_and_provenance_only():
    with open(os.path.join(GEO_DIR, B.SGIS_BOUNDARY), encoding="utf-8") as f:
        fc = json.load(f)
    assert set(fc) == {"type", "name", "provenance", "features"}
    assert fc["provenance"]["year"] == B.SGIS_YEAR and fc["provenance"]["crs"] == "EPSG:5179"
    assert fc["provenance"]["api"] == "/OpenAPI3/boundary/hadmarea.geojson"
    assert [ft["properties"] for ft in fc["features"]] == [
        {"adm_cd": "23050510", "adm_nm": "인천광역시 남동구 구월1동"}, {"adm_cd": "23050530", "adm_nm": "인천광역시 남동구 구월3동"}]
    # 인증값·token·응답 메타(trId·errCd 등)는 저장하지 않는다 — 허용된 키만
    assert set(fc["provenance"]) == {"source", "api", "year", "adm_cd", "low_search", "kept", "crs", "note"}
    assert all(set(ft) == {"type", "properties", "geometry"} for ft in fc["features"])


@pytest.mark.parametrize("x,y,lat,lng", SGIS_TRANSCOORD)
def test_utmk_to_wgs84_matches_sgis_transcoord(x, y, lat, lng):
    got_lng, got_lat = B.utmk_to_wgs84(x, y)
    assert abs(got_lat - lat) < 1e-9 and abs(got_lng - lng) < 1e-9


def test_only_guwol_corrected_with_provenance(features):
    src = {f["properties"]["행정동코드"]: f["properties"]["경계_출처"] for f in features}
    assert {c for c, v in src.items() if v == B.SGIS_CORRECTED_SOURCE} == {GUWOL1, GUWOL3}
    assert all(v == B.VUSKI_SOURCE for c, v in src.items() if c not in (GUWOL1, GUWOL3))
    assert all(f["geometry"]["type"] == "MultiPolygon" for f in features)


def test_guwol_boundary_follows_sgis(features, sgis_wgs84):
    """교정 결과: 구월1동에는 SGIS 구월3동 영역이 없고, 구월3동에는 SGIS 구월1동 영역이 없다.
    두 동 합집합 안의 SGIS 구월3동 영역은 모두 구월3동이다."""
    g = {f["properties"]["행정동코드"]: shape(f["geometry"]) for f in features}
    g1, g3, s1, s3 = g[GUWOL1], g[GUWOL3], sgis_wgs84["구월1동"], sgis_wgs84["구월3동"]
    tol = 1e-9 * (g1.area + g3.area)
    assert g1.intersection(s3).area <= tol and g3.intersection(s1).area <= tol
    assert s3.intersection(g1.union(g3)).difference(g3).area <= tol
    # 2015-07-31 구월1동 일부 → 구월3동 편입의 방향: 구월3동이 커지고 구월1동이 줄었다 (교정 전 0.41 / 0.59 IoU)
    for ours, official in ((g1, s1), (g3, s3)):
        assert ours.intersection(official).area / ours.union(official).area >= 0.93


def test_guwol_correction_point_is_sgis_guwol3(sgis_wgs84):
    """backend pass-through·ContextBuilder 테스트의 구월 교정 구역 좌표가 SGIS 공식 구월3동 polygon 안에 있다."""
    from shapely.geometry import Point
    assert sgis_wgs84["구월3동"].contains(Point(126.7035, 37.4482))
    assert not sgis_wgs84["구월1동"].covers(Point(126.7035, 37.4482))


# ── crosswalk ────────────────────────────────────────────
def test_crosswalk_targets_equal_panel_158(panel, crosswalk):
    new = [r["신_행정동코드"] for r in crosswalk]
    assert len(new) == len(set(new)) == 158, "2026 행정동은 정확히 한 번씩 나와야 한다 (통합 없음)"
    assert set(new) == set(panel["행정동코드"])


def test_crosswalk_relations_are_mechanical(crosswalk):
    by_old = {}
    for r in crosswalk:
        by_old.setdefault(r["구_행정동코드"], []).append(r)
    assert len(by_old) == 156
    for old, rows in by_old.items():
        if old in EXPECTED_SPLITS:
            assert {r["신_행정동코드"] for r in rows} == EXPECTED_SPLITS[old]
            assert all(r["관계"] == "분동" and float(r["신기준_겹침비율"]) >= 0.995 for r in rows)
            assert sum(float(r["구기준_겹침비율"]) for r in rows) >= 0.995
        else:
            (r,) = rows
            assert r["관계"] == "1:1", r
            assert float(r["구기준_겹침비율"]) >= 0.995 and float(r["신기준_겹침비율"]) >= 0.995, r
            assert r["구_행정동명"].replace("·", ".") == r["신_행정동명"].replace("·", "."), r


def test_crosswalk_new_side_matches_boundary(features, crosswalk):
    b = {f["properties"]["행정동코드"]: f["properties"] for f in features}
    for r in crosswalk:
        p = b[r["신_행정동코드"]]
        assert (r["신_시군구명"], r["신_행정동명"]) == (p["시군구명"], p["경계_행정동명"]), r


# ── 시군구 경계·외곽선 (행정동 union, 9A s1) ───────────────
@pytest.fixture(scope="module")
def gu_outline_fc():
    with open(GU_OUTLINE, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def gu_geoms(gu_outline_fc):
    return {f["properties"]["시군구코드"]: shape(f["geometry"])
            for f in gu_outline_fc["features"] if f["properties"]["kind"] == "gu"}


@pytest.fixture(scope="module")
def dong_unions(features):
    """구별 행정동 union (단순화 전 기준값). 파일의 구 geometry 와 이 값의 차이가 단순화 허용 안이어야 한다."""
    by_gu = {}
    for f in features:
        by_gu.setdefault(f["properties"]["시군구코드"], []).append(shape(f["geometry"]))
    return {code: unary_union(geoms).buffer(0) for code, geoms in by_gu.items()}


def test_gu_outline_file_shape(gu_outline_fc, features):
    """feature 12개: 시군구코드 오름차순 구 11개 → 외곽선 1개. 속성 계약·MultiPolygon·CRS84·소수 5자리·끝 개행."""
    assert gu_outline_fc["type"] == "FeatureCollection" and gu_outline_fc["name"] == "인천_시군구경계_2026"
    assert gu_outline_fc["crs"] == {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}
    feats = gu_outline_fc["features"]
    assert len(feats) == 12
    gu_names = {}
    for f in features:
        gu_names[f["properties"]["시군구코드"]] = f["properties"]["시군구명"]
    assert len(gu_names) == 11
    assert [f["properties"] for f in feats[:11]] == [
        {"kind": "gu", "시군구코드": code, "시군구명": gu_names[code], "경계_출처": B.GU_OUTLINE_SOURCE}
        for code in sorted(gu_names)]
    assert feats[11]["properties"] == {"kind": "outline", "name": "인천광역시", "경계_출처": B.GU_OUTLINE_SOURCE}
    for f in feats:
        assert f["type"] == "Feature" and f["geometry"]["type"] == "MultiPolygon"
        g = shape(f["geometry"])
        assert g.is_valid and not g.is_empty, f["properties"]
        for poly in f["geometry"]["coordinates"]:
            for ring in poly:
                for lng, lat in ring:
                    assert round(lng, 5) == lng and round(lat, 5) == lat
                    assert 124 < lng < 127.5 and 36.8 < lat < 38.1, (lng, lat)
    with open(GU_OUTLINE, "rb") as f:
        raw = f.read()
    assert raw.endswith(b"\n") and b"\r" not in raw


def test_gu_matches_dong_union_within_simplify_tol(gu_geoms, dong_unions):
    assert set(gu_geoms) == set(dong_unions)
    for code, u in dong_unions.items():
        assert gu_geoms[code].symmetric_difference(u).area <= GU_SIMPLIFY_TOL * u.area, code


def test_gu_polygons_do_not_overlap(gu_geoms):
    codes = sorted(gu_geoms)
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            ga, gb = gu_geoms[a], gu_geoms[b]
            assert ga.intersection(gb).area <= GU_OVERLAP_TOL * min(ga.area, gb.area), (a, b)


def test_outline_matches_gu_union_within_simplify_tol(gu_outline_fc, dong_unions):
    outline = shape(gu_outline_fc["features"][11]["geometry"])
    whole = unary_union(list(dong_unions.values())).buffer(0)
    assert outline.symmetric_difference(whole).area <= GU_SIMPLIFY_TOL * whole.area


def test_dong_representative_points_inside_their_gu(features, gu_geoms, gu_outline_fc):
    outline = shape(gu_outline_fc["features"][11]["geometry"])
    for f in features:
        pt = shape(f["geometry"]).representative_point()
        gu = gu_geoms[f["properties"]["시군구코드"]]
        assert gu.distance(pt) <= GU_POINT_TOL_DEG, f["properties"]["행정동코드"]
        assert outline.distance(pt) <= GU_POINT_TOL_DEG, f["properties"]["행정동코드"]


def test_gu_outline_reproduces_from_boundary_file():
    """raw 없이도 재현: 커밋된 행정동 경계 → build_gu_outline → 직렬화가 커밋된 파일과 바이트 동일."""
    with open(BOUNDARY, encoding="utf-8") as f:
        boundary = json.load(f)
    got = json.dumps(B.build_gu_outline(boundary), ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(GU_OUTLINE, encoding="utf-8", newline="") as f:
        assert f.read() == got
