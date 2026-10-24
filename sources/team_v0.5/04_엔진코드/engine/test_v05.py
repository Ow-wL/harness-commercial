"""
v0.5 재검토 반영 규칙 검증.   실행: python3 test_v05.py   (pytest도 가능)

  V1 학교 주변 규제 업종은 학교 200m 안의 학교를 유인시설 가점에서 뺀다 (200~500m는 유지)
  V2 규제 업종이 아니면 학교 200m 안도 그대로 가점
  V3 1인가구 민감도가 음수인 가족형 업종은 1인가구가 많을수록 C4가 50 아래로 내려간다
  V4 종사자 민감도 = 0.5 + 0.5×WORK_PREF, 주거형 업종은 종사자 신호가 중립 쪽으로 줄어든다
  V5 역 의존도: 입지성 설계 가중치 합은 항상 1, 의존도가 낮으면 L3 비중이 커진다
  V6 대체업종: 실효 동종 점포 수 = 같은 업종 + 대체업종 × 계수
  V7 면적 배분: 동 하나에 완전히 들어가는 원은 w = 원 면적 ÷ 동 면적
  V8 α 수정 (카페 근린형, 한식 집적형, 양식 중간형), 29개 업종 모두 역 의존도·1인가구 민감도 정의
"""
import math
import numpy as np
import pandas as pd
from matplotlib.path import Path
import config as C
import scoring as S
import etl_location as L
from radius_demand import radius_profile


def _stations():
    return pd.DataFrame({"name": ["가역"], "lat": [37.50], "lng": [126.70], "가중치": [1.0]})


def _schools(d_m):
    """분석 지점(37.49, 126.72)에서 북쪽으로 d_m 떨어진 고등학교 1곳"""
    return pd.DataFrame({"type": ["고등학교"], "lat": [37.49 + d_m / 110_540], "lng": [126.72]})


def test_V1_school_zone_excluded_for_regulated():
    near = L.site_profile(37.49, 126.72, _stations(), _schools(100), "R10406")    # PC방, 학교 100m
    mid = L.site_profile(37.49, 126.72, _stations(), _schools(300), "R10406")     # 학교 300m
    assert near["유인시설_종류별"]["고등학교"] == 0.0 and near["학교구역_제외_학교수"] == 1
    assert mid["유인시설_종류별"]["고등학교"] > 0.3


def test_V2_not_regulated_keeps_school():
    p = L.site_profile(37.49, 126.72, _stations(), _schools(100), "I21007")       # 분식(고교 유인)
    assert p["유인시설_종류별"]["고등학교"] > 0.6 and p["학교구역_제외_학교수"] is None


def _customer(code, solo):
    site = S.Site(lat=37.49, lng=126.72, biz_code=code)
    ref = [10, 20, 30, 40, 50, 60, 70, 80]
    panel = {"target_pop": ref, "target_share": ref, "workers": ref, "solo_household_share": ref}
    dong = {"target_pop": 45, "target_share": 45, "workers": 75, "solo_household_share": solo}
    return {b["key"]: b for b in S.score_customer(site, dong, panel).breakdown}


def test_V3_family_business_solo_negative():
    hi = _customer("P10501", 79)["c4"]["score"]          # 학원, 1인가구 비중 최상위
    conv = _customer("G20405", 79)["c4"]["score"]        # 편의점
    assert hi < 50 < conv


def test_V4_worker_sensitivity():
    assert math.isclose(C.worker_sens("P10501"), 0.1) and math.isclose(C.worker_sens("I20101"), 0.85)
    academy = _customer("P10501", 45)["c3"]["score"]; lunch = _customer("I20101", 45)["c3"]["score"]
    assert 50 < academy < lunch


def test_V5_station_reliance_weights():
    for code in C.CODE_NAME:
        r = C.station_reliance(code)
        tot = 0.35 * r + (0.35 + 0.55 * (1 - r)) + 0.20 * r + 0.10
        assert math.isclose(tot, 1.0), code
    assert C.station_reliance("I21006") < C.station_reliance("I21201")   # 치킨 < 카페


def test_V6_substitutes():
    shops = pd.DataFrame({"위도": [37.49] * 4, "경도": [126.72] * 4,
                          "상권업종소분류코드": ["I21201", "I21201", "I21001", "I21008"],
                          "시군구명": ["부평구"] * 4, "행정동명": ["부평1동"] * 4})
    pop = pd.DataFrame({"시군구명": ["부평구"], "행정동명": ["부평1동"], "총인구": [1000]})
    tot = pd.DataFrame({"시군구명": ["부평구"], "행정동명": ["부평1동"], "전체점포수": [4]})
    rp = radius_profile(37.49, 126.72, shops, pop, "I21201", 500, "총인구", tot,
                        same_weights=C.same_weights("I21201"))
    assert rp["n_same_정확일치"] == 2 and math.isclose(rp["n_same"], 2 + 0.3 + 0.3)


class _OneDong:
    """반경 2km 정사각형 동 하나 (면적 16km²)"""
    def __init__(self):
        dlon, dlat = 2000 / (111_320 * math.cos(math.radians(37.49))), 2000 / 110_540
        sq = np.array([[126.72 - dlon, 37.49 - dlat], [126.72 + dlon, 37.49 - dlat],
                       [126.72 + dlon, 37.49 + dlat], [126.72 - dlon, 37.49 + dlat], [126.72 - dlon, 37.49 - dlat]])
        self.items = [("부평구", "부평1동", Path(sq), 16e6, (sq[:, 0].min(), sq[:, 0].max(), sq[:, 1].min(), sq[:, 1].max()), 1.0)]


def test_V7_area_weights():
    from etl_boundary import DongAreas
    d = _OneDong(); w = DongAreas.weights(d, 37.49, 126.72, 500)
    assert abs(w.w.iloc[0] - math.pi * 500**2 / 16e6) < 0.002


def test_V8_config_updates():
    assert C.agg_alpha("I21201") == 0.0 and C.agg_alpha("I20101") == 1.0 and C.agg_alpha("I20401") == 0.5
    assert set(C.STATION_RELIANCE) == set(C.CODE_NAME) == set(C.SOLO_SENSITIVITY)
    assert C.P1_MODE == "share" and "종사자수" in C.DEMAND_COLS


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
