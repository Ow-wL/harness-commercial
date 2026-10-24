"""
스코어링 엔진 동작 확인용 데모.
⚠ 여기 쓰이는 데이터는 전부 합성(synthetic)입니다. 실제 공공데이터가 아닙니다.
   실제 데이터가 붙기 전에 엔진 구조와 출력 계약을 검증하는 용도입니다.
"""
import json, random, math
import numpy as np
import config as C
from scoring import Site, analyze

rng = random.Random(42)
N_DONG = 154  # 인천 행정동 수 (실제 값으로 교체 필요)

def make_dong(i, boost=1.0):
    pop_total = int(rng.gauss(18000, 7000) * boost)
    pop_total = max(3000, pop_total)
    pop = {}
    for age in range(0, 100):
        # 20~40대에 봉우리
        share = math.exp(-((age - 38) ** 2) / (2 * 20 ** 2))
        for sex in ("M", "F"):
            pop[(sex, age)] = max(0, int(pop_total * share / 100 * rng.uniform(0.8, 1.2)))
    hourly = [max(0.1, rng.gauss(1, .4) * (1 + math.sin((h - 8) / 24 * 2 * math.pi))) for h in range(24)]
    return {
        "pop_total": pop_total,
        "pop_by_sex_age": pop,
        "workers": int(rng.gauss(6000, 4000) * boost),
        "solo_household_share": min(.75, max(.12, rng.gauss(.33, .10))),
        "inflow_daily": int(rng.gauss(22000, 12000) * boost),
        "inflow_by_hour": hourly,
        "purpose_share_shopping": min(.4, max(.03, rng.gauss(.14, .05))),
        "gugu_spend_yoy": rng.gauss(.02, .08),
        "same_biz_net_change_1y": rng.randint(-3, 4),
        "bus_stop_density": max(0, rng.gauss(11, 5)),
        "gugu_rent_per_sqm": max(8000, rng.gauss(26000, 9000)),
        "survival_3y__dong_sobun": min(.9, max(.25, rng.gauss(.55, .12))),
        "closure_rate__dong_sobun": min(.45, max(.04, rng.gauss(.15, .06))),
        "avg_tenure__dong_sobun": max(1.5, rng.gauss(7.2, 2.6)),
    }

dongs = [make_dong(i) for i in range(N_DONG)]
# 부평역 일대를 유동·직장 강한 동으로 설정
target = make_dong(0, boost=2.3)
target["purpose_share_shopping"] = 0.21
target["survival_3y__dong_sobun"] = 0.48
target["closure_rate__dong_sobun"] = 0.22
# PC방 영업시간(방과후~심야)에 유입이 몰리도록
target["inflow_by_hour"] = [1,1,1,1,1,1,2,4, 5,5,5,6, 7,8,9,11, 13,14,13,11, 9,7,5,3]
dongs[0] = target

n_same_panel = [max(0, int(rng.gauss(4, 3))) for _ in range(N_DONG)]
n_same_panel[0] = 9

panel = {
    "pop_total": [d["pop_total"] for d in dongs],
    "pop_by_sex_age": [d["pop_by_sex_age"] for d in dongs],
    "workers": [d["workers"] for d in dongs],
    "solo_household_share": [d["solo_household_share"] for d in dongs],
    "inflow_daily": [d["inflow_daily"] for d in dongs],
    "inflow_by_hour": [d["inflow_by_hour"] for d in dongs],
    "purpose_share_shopping": [d["purpose_share_shopping"] for d in dongs],
    "gugu_spend_yoy": [d["gugu_spend_yoy"] for d in dongs],
    "n_same_biz": n_same_panel,
    "same_biz_share": [n / max(1, int(rng.gauss(90, 40))) for n in n_same_panel],
    "same_biz_net_change_1y": [d["same_biz_net_change_1y"] for d in dongs],
    "station_strength": [max(0, rng.gauss(9000, 7000)) for _ in range(N_DONG)],
    "anchor_strength": [max(0, rng.gauss(1.5, 1.1)) for _ in range(N_DONG)],
    "nearest_station_m": [max(60, rng.gauss(900, 600)) for _ in range(N_DONG)],
    "bus_stop_density": [d["bus_stop_density"] for d in dongs],
    "survival_3y": [d["survival_3y__dong_sobun"] for d in dongs],
    "closure_rate": [d["closure_rate__dong_sobun"] for d in dongs],
    "avg_tenure": [d["avg_tenure__dong_sobun"] for d in dongs],
    "gugu_rent_per_sqm": [d["gugu_rent_per_sqm"] for d in dongs],
}

# 부평역 좌표 (실제값)
SITE_LAT, SITE_LNG = 37.4894, 126.7246

stores = []
for k in range(9):  # 반경 내 PC방 9개
    stores.append({"biz_code": "R10406", "biz_name": "PC방", "lat": SITE_LAT + rng.gauss(0, .0025),
                   "lng": SITE_LNG + rng.gauss(0, .0025)})
for k in range(140):  # 그 외 업종
    stores.append({"biz_code": "I20101", "biz_name": "한식", "lat": SITE_LAT + rng.gauss(0, .003),
                   "lng": SITE_LNG + rng.gauss(0, .003)})

stations = [
    {"name": "부평역", "lat": 37.4894, "lng": 126.7246, "daily_riders": 98000},
    {"name": "부평시장역", "lat": 37.4966, "lng": 126.7236, "daily_riders": 21000},
    {"name": "동수역", "lat": 37.4842, "lng": 126.7145, "daily_riders": 9000},
]
facilities = [
    {"type": "고등학교", "lat": 37.4912, "lng": 126.7280},
    {"type": "중학교",   "lat": 37.4869, "lng": 126.7211},
    {"type": "학원",     "lat": 37.4901, "lng": 126.7255},
    {"type": "학원",     "lat": 37.4885, "lng": 126.7262},
    {"type": "오피스",   "lat": 37.4890, "lng": 126.7230},
]

site = Site.from_query(SITE_LAT, SITE_LNG, "부평역 근처 피시방",
                       dong_code="2823710100", dong_name="부평구 부평1동")

cohort_counts = {"dong_sobun": 14, "dong_jung": 62, "gugu_sobun": 190, "incheon_avg": 9999}

if __name__ == "__main__":
    result = analyze(site, dongs[0], panel, stores, stations, facilities, cohort_counts)
    print(json.dumps(result, ensure_ascii=False, indent=2))
