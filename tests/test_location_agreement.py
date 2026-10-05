"""
행정동 경계(LocationResolver) ↔ 상가 점포 행정동 라벨 일치율 (TASKS 1-5, docs/DECISIONS.md D-010).

  대상   data/runtime/인천_상가_정제.csv 전체 135,750개 (샘플링 없음 — 전수 resolve 약 3.5초)
  비교   점포 라벨 행정동코드 == resolver 행정동코드. 코드로만 비교한다 (이름 '.'/'·' 차이 무관)
  분모   전체 점포. resolve 실패(경계 밖)도 불일치로 센다. 제외 구역 없음
  floor  2026-10-06 전수 측정값(SGIS 구월 교정 후, D-017) − 2%p 를 0.1%p 단위로 내림 (D-010). 측정값을 바꿔 통과시키지 않는다
"""
import math
import os

import pandas as pd
import pytest

from helpers import RUNTIME_DIR
from scoring_engine.location import LocationError, default_resolver

# 해소된 구조적 충돌 (D-010 → D-017). 구월3동 라벨 점포 2,486개(좌표 439개)가 2차 가공 경계로는 구월1동이었다.
# SGIS 공식 역지오코딩 439/439 구월3동 → SGIS 2025 공식 경계로 구월1동/구월3동을 교정해 0건이 됐다. 다시 생기면 실패.
#   (라벨 코드, resolve 코드): 허용 건수
RESOLVED_CONFLICTS = {
    ("28200521", "28200510"): 0,      # 남동구 구월3동 라벨 → polygon 구월1동 (교정 전 2,486)
    ("28200510", "28200521"): 0,      # 반대 방향 — 교정이 구월1동 점포를 구월3동으로 넘기지 않았는지
}
OVERALL_FLOOR = 0.964                 # 측정 0.98456 (n=135,750, 제외 없음)
GU_FLOORS = {                         # 측정값 (n, rate)
    "강화군": 0.973,                  # 5,373  0.99330
    "검단구": 0.963,                  # 7,462  0.98365
    "계양구": 0.976,                  # 10,987 0.99636
    "남동구": 0.970,                  # 22,794 0.99096 (교정 전: 구월 충돌 2,486건 제외 20,308 0.98986 → 0.969)
    "미추홀구": 0.955,                # 18,733 0.97598
    "부평구": 0.941,                  # 20,970 0.96199
    "서해구": 0.978,                  # 17,430 0.99897
    "연수구": 0.974,                  # 16,885 0.99408
    "영종구": 0.970,                  # 6,262  0.99010
    "옹진군": 0.973,                  # 1,806  0.99336
    "제물포구": 0.944,                # 7,048  0.96410
}
# 동 단위 안전망: 구 floor 로는 점포가 적은 동(18개)이 통째로 틀려도 잡히지 않는다.
# 각 동 라벨 점포의 과반이 자기 동으로 판정돼야 한다. 측정 최저 0.7541 (제물포구 송림1동, n=61). 통째로 틀린 동은 ~0
DONG_MAJORITY_FLOOR = 0.5
DETERMINISM_SEED = 20261005
DETERMINISM_SAMPLE_PER_GU = 200
# 경계 원문 '·' / runtime 라벨 '.' 표기가 다른 행정동 (D-009)
SEPARATOR_ONLY = ("28125590", "28125610", "28125650", "28177520", "28177540", "28177610")


def resolve_codes(resolver, lats, lngs) -> list:
    out = []
    for lat, lng in zip(lats, lngs):
        try:
            out.append(resolver.resolve(float(lat), float(lng)).dong_code)
        except LocationError:
            out.append(None)
    return out


@pytest.fixture(scope="module")
def shops():
    df = pd.read_csv(os.path.join(RUNTIME_DIR, "인천_상가_정제.csv"), encoding="utf-8-sig",
                     dtype={"행정동코드": str}, usecols=["행정동코드", "시군구명", "행정동명", "위도", "경도"],
                     low_memory=False)
    df["resolved"] = resolve_codes(default_resolver(), df["위도"].values, df["경도"].values)
    df["match"] = df["resolved"] == df["행정동코드"]
    return df


def test_all_stores_evaluated(shops):
    assert len(shops) == 135750 and shops["행정동코드"].str.fullmatch(r"\d{8}").all()
    assert set(shops["시군구명"]) == set(GU_FLOORS)


def test_overall_agreement_at_or_above_floor(shops):
    rate = shops["match"].mean()
    assert rate >= OVERALL_FLOOR, f"전체 일치율 {rate:.5f} < floor {OVERALL_FLOOR}"


@pytest.mark.parametrize("gu", sorted(GU_FLOORS))
def test_gu_agreement_at_or_above_floor(shops, gu):
    d = shops[shops["시군구명"] == gu]
    rate = d["match"].mean()
    assert rate >= GU_FLOORS[gu], f"{gu} 일치율 {rate:.5f} < floor {GU_FLOORS[gu]} (n={len(d)})"


def test_every_dong_majority_resolves_to_itself(shops):
    rates = shops.groupby("행정동코드")["match"].agg(["mean", "size"])
    assert len(rates) == 158
    low = rates[rates["mean"] < DONG_MAJORITY_FLOOR]
    assert low.empty, f"라벨 점포 과반이 자기 동으로 판정되지 않는 동: {low.to_dict('index')}"


@pytest.mark.parametrize("pair", sorted(RESOLVED_CONFLICTS), ids=lambda p: f"{p[0]}->{p[1]}")
def test_resolved_conflicts_stay_resolved(shops, pair):
    n = int(((shops["행정동코드"] == pair[0]) & (shops["resolved"] == pair[1])).sum())
    assert n <= RESOLVED_CONFLICTS[pair], f"해소된 충돌 {pair} 이 {RESOLVED_CONFLICTS[pair]} → {n} 건으로 늘었다"


def test_guwol3_labels_resolve_to_guwol3(shops):
    """구월3동 라벨 3,793개: 교정 전 2,498개 불일치(충돌 2,486 + 경계 근접 12) → 교정 후 경계 근접 12개만 (D-017).
    충돌 2,486개(SGIS 공식 판정 구월3동)가 모두 구월3동으로 판정돼야 이 수가 나온다. 남은 12개는 이웃 동(주안4동 9·간석1동 3)."""
    d = shops[shops["행정동코드"] == "28200521"]
    assert len(d) == 3793
    other = d.loc[~d["match"], "resolved"].value_counts(dropna=False).to_dict()
    assert int((~d["match"]).sum()) <= 12 and "28200510" not in other, other


def test_comparison_is_by_code_not_name(shops):
    """'·'/'.' 표기가 다른 6개 동: 이름은 경계 원문과 다르지만 코드 비교로 일치한다."""
    resolver = default_resolver()
    d = shops[shops["행정동코드"].isin(SEPARATOR_ONLY)]
    assert len(d) > 0 and d["match"].mean() >= OVERALL_FLOOR
    for code in SEPARATOR_ONLY:
        row = d[(d["행정동코드"] == code) & d["match"]].iloc[0]
        r = resolver.resolve(float(row["위도"]), float(row["경도"]))
        assert r.dong_code == code and row["행정동명"] == r.dong_name != r.boundary_dong_name


def test_resolution_is_deterministic(shops):
    """고정 seed 로 구별 같은 수의 점포를 뽑아 새 resolver 로 다시 판정 → 전수 판정과 같아야 한다."""
    from scoring_engine.location import LocationResolver
    sample = shops.groupby("시군구명").sample(n=DETERMINISM_SAMPLE_PER_GU, random_state=DETERMINISM_SEED)
    again = shops.groupby("시군구명").sample(n=DETERMINISM_SAMPLE_PER_GU, random_state=DETERMINISM_SEED)
    assert sample.index.equals(again.index) and len(sample) == DETERMINISM_SAMPLE_PER_GU * len(GU_FLOORS)
    fresh = resolve_codes(LocationResolver(), sample["위도"].values, sample["경도"].values)
    assert fresh == sample["resolved"].tolist()


def test_floor_rule_documented():
    """floor = 측정값 − 2%p 를 0.1%p 단위로 내림 (D-010). 측정값이 상수 옆 주석과 맞는지 확인용."""
    measured = {"강화군": 0.99330, "검단구": 0.98365, "계양구": 0.99636, "남동구": 0.99096, "미추홀구": 0.97598,
                "부평구": 0.96199, "서해구": 0.99897, "연수구": 0.99408, "영종구": 0.99010, "옹진군": 0.99336,
                "제물포구": 0.96410}
    rule = lambda r: math.floor(round((r - 0.02) * 1000, 6)) / 1000  # noqa: E731
    assert {g: rule(r) for g, r in measured.items()} == GU_FLOORS
    assert rule(0.98456) == OVERALL_FLOOR
