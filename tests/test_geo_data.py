"""
data/geo — 행정동 경계와 2024→2026 crosswalk 의 무결성·키 정합성 (docs/DECISIONS.md D-009).

  원본 data/geo/raw/   git 제외. 있으면 매니페스트 해시 검사, 없으면 SKIP (가공 파일 검사는 계속)
  가공 data/geo/*      commit. 매니페스트 해시 + runtime panel 158개 행정동과 정확히 일치
매니페스트를 새 출력으로 덮어써서 통과시키지 않는다. 경계 교체는 새 결정(DECISIONS)과 함께만.
"""
import csv
import json
import os

import pandas as pd
import pytest
from shapely import STRtree
from shapely.geometry import shape

from helpers import ROOT, RUNTIME_DIR, M

GEO_DIR = os.path.join(ROOT, "data", "geo")
GEO_MANIFEST = os.path.join(ROOT, "tests", "manifests", "geo.sha256.json")
BOUNDARY = os.path.join(GEO_DIR, "인천_행정동경계_2026.geojson")
CROSSWALK = os.path.join(GEO_DIR, "행정동_crosswalk_2024_2026.csv")

with open(GEO_MANIFEST, encoding="utf-8") as _f:
    MANIFEST_FILES = json.load(_f)["files"]

# 2024 → 2026 분동 (2026-07-01 인천 개편). 기계적 비교 결과를 고정한다 — 바뀌면 데이터가 바뀐 것이다.
EXPECTED_SPLITS = {
    "28110628": {"28155540", "28155550"},   # 중구 운서동 → 영종구 운서1동·운서2동
    "28260740": {"28290570", "28290580"},   # 서구 아라동 → 검단구 아라1동·아라2동
}
# 경계 원문은 '·', runtime panel 은 '.' 을 쓰는 행정동 (코드는 같다)
SEPARATOR_ONLY = {"28125590", "28125610", "28125650", "28177520", "28177540", "28177610"}


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
