"""
v0.4 집적 효과 규칙 검증.   실행: python3 test_agglomeration.py   (pytest도 가능)

  G1 29개 업종 모두 집적 계수(α)가 정의돼 있다 (0, 0.5, 1 중 하나)
  G2 근린형(α=0)은 집적도 지표가 없고 v0.3과 점수가 같다
  G3 집적형은 다른 조건이 같을 때 반경 점포가 많을수록 경쟁성이 높다
  G4 집적형이라도 근린형보다 같은 조건에서 번화가 가점이 크다 (α에 비례)
  G5 비교 분포(agg_ref)가 없으면 집적도는 '제외'로 처리되고 v0.3과 같다
  G6 breakdown 기여도 합 == 관점 점수 (집적도 포함)
  G7 잠재수요는 여러 인구 열을 계수로 합칠 수 있다 (방문인구 입력 칸)
"""
import pandas as pd
import config as C
import scoring as S
from radius_demand import radius_profile

REF_DEMAND = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
REF_SHARE = [0.002, 0.004, 0.006, 0.008, 0.01, 0.02, 0.03, 0.05]
REF_NALL = [100, 300, 500, 800, 1200, 1600, 2200, 3000]
PANEL = {"same_biz_share": REF_SHARE, "same_biz_net_change_1y": [None] * 8}


def comp(code, n_all, n_same=10, demand=40000, agg_ref=REF_NALL):
    site = S.Site(lat=37.49, lng=126.72, biz_code=code)
    rp = {"n_all": n_all, "n_same": n_same, "반경수요": demand}
    return S.score_competition(site, {}, PANEL, [], rp, REF_DEMAND, agg_ref)


def test_G1_alpha_defined():
    assert set(C.AGGLOMERATION) == set(C.CODE_NAME)
    assert set(C.AGGLOMERATION.values()) <= {0.0, 0.5, 1.0}


def test_G2_neighborhood_unchanged():
    a = comp("S20901", 2000)                       # 세탁소 α=0
    b = comp("S20901", 2000, agg_ref=None)
    assert a.score == b.score
    assert "p3" not in [x["key"] for x in a.breakdown]


def test_G3_agglomeration_bonus():
    lo, hi = comp("I21103", 300), comp("I21103", 2900)   # 생맥주 α=1, 동종 10곳 고정
    # 전체 점포가 늘면 동종비중이 낮아져 p1도 오르므로, p3 기여만 따로 확인
    p3 = {x["key"]: x for x in hi.breakdown}["p3"]
    assert p3["score"] > 80 and p3["기여도"] > 0
    assert hi.score > lo.score


def test_G4_bonus_scales_with_alpha():
    gain = lambda code: comp(code, 2900).score - comp(code, 2900, agg_ref=None).score
    assert gain("I21103") > gain("R10406") > gain("S20901") == 0   # 집적형 > 중간형 > 근린형


def test_G5_missing_ref_excluded():
    r = comp("I21103", 2000, agg_ref=None)
    p3 = {x["key"]: x for x in r.breakdown}["p3"]
    assert p3["상태"].startswith("제외")


def test_G6_breakdown_sums():
    for code in ["I21103", "R10406", "S20901"]:
        r = comp(code, 1500)
        s = sum(x["기여도"] for x in r.breakdown if x["기여도"] is not None)
        assert abs(s - r.score) <= 0.15, (code, s, r.score)


def test_G7_demand_columns():
    shops = pd.DataFrame({"위도": [37.49, 37.4901], "경도": [126.72, 126.7201],
                          "상권업종소분류코드": ["I21103", "G20405"],
                          "시군구명": ["부평구"] * 2, "행정동명": ["부평1동"] * 2})
    pop = pd.DataFrame({"시군구명": ["부평구"], "행정동명": ["부평1동"],
                        "총인구": [10000], C.VISIT_COL: [8000]})
    tot = pd.DataFrame({"시군구명": ["부평구"], "행정동명": ["부평1동"], "전체점포수": [2]})
    r0 = radius_profile(37.49, 126.72, shops, pop, "I21103", 500, "총인구", tot)
    r1 = radius_profile(37.49, 126.72, shops, pop, "I21103", 500,
                        {"총인구": 1.0, C.VISIT_COL: C.VISIT_COEF}, tot)
    assert r0["반경수요"] == 10000
    assert r1["반경수요"] == 10000 + 8000 * C.VISIT_COEF
    assert r1["수요_구성"] == {"총인구": 1.0, C.VISIT_COL: C.VISIT_COEF}


if __name__ == "__main__":
    import sys
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn(); print("PASS", name)
            except AssertionError as e:
                fails += 1; print("FAIL", name, e)
    sys.exit(1 if fails else 0)
