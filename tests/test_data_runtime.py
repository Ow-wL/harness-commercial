"""런타임 데이터 존재·스키마 — 엔진이 실제로 읽는 컬럼과 행 수."""
import os

import pandas as pd
import pytest

import scoring_engine.config as C
from scoring_engine.runtime import DEFAULT_DATA_DIR, RUNTIME_FILES, biz_panel_columns


@pytest.mark.parametrize("name", sorted(RUNTIME_FILES))
def test_file_exists(name):
    assert os.path.isfile(os.path.join(DEFAULT_DATA_DIR, name)), name


@pytest.mark.parametrize("name", sorted(n for n, (_, cols) in RUNTIME_FILES.items() if cols))
def test_required_columns(name):
    enc, cols = RUNTIME_FILES[name]
    path = os.path.join(DEFAULT_DATA_DIR, name)
    df = pd.read_excel(path, nrows=0) if name.endswith(".xlsx") else pd.read_csv(path, encoding=enc, nrows=0)
    missing = [c for c in cols if c not in df.columns]
    assert not missing, f"{name}: 필수 컬럼 없음 {missing}"


def test_panel_has_all_29_biz_columns_and_158_dongs():
    p = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_통합.csv"), encoding="utf-8-sig")
    missing = [c for c in biz_panel_columns() if c not in p.columns]
    assert not missing, missing
    assert len(p) == 158 and not p.duplicated(["시군구명", "행정동명"]).any()


def test_market_panel_11_gu_and_code_consistency():
    m = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_시장성_202608.csv"), encoding="utf-8-sig",
                    dtype={"시군구코드": str})
    p = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_통합.csv"), encoding="utf-8-sig",
                    dtype={"행정동코드": str})
    assert len(m) == 11 and m["시군구코드"].is_unique
    # 시군구코드 == 행정동코드 앞 5자리 (Context Builder 가 이 관계에 의존한다)
    assert set(p["행정동코드"].str[:5]) == set(m["시군구코드"])
    assert p.groupby(p["행정동코드"].str[:5])["시군구명"].nunique().max() == 1


def test_stability_panels():
    s = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_안정성.csv"), encoding="utf-8-sig")
    f = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_안정성_음식.csv"), encoding="utf-8-sig")
    assert "__인천전체__" in set(s["시군구"])
    assert set(f["업종코드"]) <= set(C.CODE_NAME)
    assert len(set(f["업종코드"])) == 14


def test_shops_admin_keys_match_panel():
    cols = ["시군구명", "행정동명"]
    shops = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "인천_상가_정제.csv"), encoding="utf-8-sig",
                        usecols=cols)[cols]
    p = pd.read_csv(os.path.join(DEFAULT_DATA_DIR, "패널_통합.csv"), encoding="utf-8-sig", usecols=cols)[cols]
    assert set(map(tuple, shops.drop_duplicates().values)) == set(map(tuple, p.values))


def test_rent_loader_validates_format():
    from scoring_engine.etl_rent import incheon_areas, load_rent
    rent = incheon_areas(load_rent(os.path.join(DEFAULT_DATA_DIR, "임대료_소규모상가_R-ONE.csv")))
    assert len(rent) == 9 and "부평" in set(rent["상권"])
