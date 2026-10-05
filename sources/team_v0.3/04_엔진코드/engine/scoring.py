"""
우리동네 상권분석 매니저 — 5대 관점 스코어링 엔진 (MVP, 규칙 기반)

설계 원칙
  1) 엔진은 '수치와 근거'까지만 만든다. 해석·행동제안은 LLM 담당 (역할 분리).
  2) 절대 매출액을 추정하지 않는다. 인천 내 상대 순위(백분위)로만 말한다.
  3) 모든 점수는 원시값을 함께 반환한다. 백분위는 순위만, 격차는 원시값이 담당.
  4) 데이터가 없으면 0점이 아니라 '제외 후 가중치 재정규화' + 결측 플래그.
  5) 모든 지표에 신뢰도(confidence)와 폴백 레벨을 붙인다. LLM이 이걸 읽고 말투를 조절한다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Optional, Sequence

import numpy as np

import config as C
import access as A


# ═══════════════════════════════════════════════════════════════
# 공통 유틸
# ═══════════════════════════════════════════════════════════════

def haversine_m(lat1, lng1, lat2, lng2) -> float:
    """두 좌표 간 거리(m). 좌표는 모두 WGS84 기준이어야 한다."""
    R = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def decay(dist_m: float, scale_m: float) -> float:
    """거리 감쇠. scale_m에서 0.37, 2*scale_m에서 0.14."""
    return math.exp(-dist_m / scale_m)


def pct_rank(value: Optional[float],
             population: Sequence[float],
             higher_is_better: bool = True) -> Optional[float]:
    """인천 전체 행정동 분포 대비 백분위(0~100). 표본이 너무 적으면 None."""
    if value is None:
        return None
    arr = np.asarray([x for x in population if x is not None and np.isfinite(x)], dtype=float)
    if arr.size < 5:
        return None
    p = float((arr < value).sum()) / arr.size * 100.0
    return p if higher_is_better else 100.0 - p


def time_fit(biz_hours: Sequence[float], dong_hourly: Sequence[float]) -> Optional[float]:
    """
    영업 시간대와 유입 시간대의 일치도.
    1.0 = 인천 평균 수준, >1.0 = 내 영업시간에 사람이 몰림, <1.0 = 엇갈림.
    """
    if dong_hourly is None or len(dong_hourly) != 24:
        return None
    w = np.asarray(biz_hours, dtype=float)
    p = np.asarray(dong_hourly, dtype=float)
    if w.sum() <= 0 or p.sum() <= 0:
        return None
    w, p = w / w.sum(), p / p.sum()
    return float(np.dot(w, p) * 24.0)


# ═══════════════════════════════════════════════════════════════
# 결과 컨테이너
# ═══════════════════════════════════════════════════════════════

@dataclass
class Indicator:
    """지표 하나의 계산 결과. LLM이 읽는 최소 단위."""
    key: str
    label: str
    score: Optional[float]            # 0~100 백분위. None = 계산 불가
    raw: dict = field(default_factory=dict)   # 원시값 (LLM이 문장에 쓸 실제 수치)
    confidence: str = "high"          # high / medium / low
    coverage: float = 1.0             # 세부지표 가중치 중 실제 계산된 비율
    fallback: str = "dong_sobun"      # 어느 해상도에서 계산됐는지
    flags: list = field(default_factory=list)
    note: str = ""
    breakdown: list = field(default_factory=list)   # 세부지표별 점수·가중치·원시값 (설명 가능성)


def _bd(key: str, parts: dict, raws: Optional[dict] = None) -> list:
    """
    세부지표 breakdown. parts = {sub_key: (백분위 or None, 설계 가중치)}.
    계산된 지표만 가중치를 재정규화해 '적용_가중치'로 보여준다. 결측은 제외로 표시.
    기여도 합 == 관점 점수 (반올림 오차 제외).
    """
    avail_w = sum(w for v, w in parts.values() if v is not None)
    out = []
    for sk, (v, w) in parts.items():
        used = (w / avail_w) if (v is not None and avail_w) else 0.0
        out.append({
            "key": sk,
            "label": C.SUB_LABELS[key][sk],
            "score": None if v is None else round(v, 1),
            "설계_가중치": w,
            "적용_가중치": round(used, 3),
            "기여도": None if v is None else round(v * used, 1),
            "원시값": (raws or {}).get(sk),
            "상태": "계산" if v is not None else "제외(데이터 없음)",
        })
    return out


# ═══════════════════════════════════════════════════════════════
# 폴백 사다리
#   행정동×소분류 → 행정동×중분류 → 군구×소분류 → 인천 평균
#   표본이 얇으면 해상도를 한 단계씩 낮추고, 그 사실을 반드시 기록한다.
# ═══════════════════════════════════════════════════════════════

FALLBACK_LADDER = [
    ("dong_sobun",  "행정동 × 업종소분류", "high"),
    ("dong_jung",   "행정동 × 업종중분류", "medium"),
    ("gugu_sobun",  "군구 × 업종소분류",   "medium"),
    ("incheon_avg", "인천 전체 업종평균",  "low"),
]


def resolve_cohort(cohort_counts: dict) -> tuple[str, str]:
    """
    cohort_counts: {"dong_sobun": n, "dong_jung": n, "gugu_sobun": n, "incheon_avg": n}
    표본 기준을 처음 만족하는 레벨을 반환한다.
    """
    for level, _label, conf in FALLBACK_LADDER:
        n = cohort_counts.get(level, 0)
        need = C.MIN_COHORT_N_GUGU if level == "gugu_sobun" else C.MIN_COHORT_N
        if level == "incheon_avg" or n >= need:
            return level, conf
    return "incheon_avg", "low"


# ═══════════════════════════════════════════════════════════════
# 1. 시장성 — 이 지역에 돈 쓸 사람이 오는가
# ═══════════════════════════════════════════════════════════════

def score_market(site, dong, panel) -> Indicator:
    """
    데이터: 수도권 생활이동(행정동 유입, 시간대별) + 인천e음(군구 소비 증감)
    M1 일평균 유입인구        가중 0.40
    M3 시간대 적합도          가중 0.30
    M2 업종연관 목적 유입비중  가중 0.20
    M4 군구 업종소비 증감률    가중 0.10
    """
    hours = C.HOUR_PROFILE.get(site.biz_code, C.DEFAULT_HOUR_PROFILE)
    flags, missing = [], []

    m1 = dong.get("inflow_daily")
    p1 = pct_rank(m1, panel["inflow_daily"])

    fit = time_fit(hours, dong.get("inflow_by_hour"))
    p3 = pct_rank(fit, [time_fit(hours, h) for h in panel["inflow_by_hour"]])
    if fit is None:
        missing.append("시간대별 유입")

    # M2 — 상권 성격 적합도 (구 설계의 '쇼핑목적 비중'을 대체. config.WORK_PREF 참조)
    #   직장성 = 출근유입 / (출근유입 + 귀가유입)
    #   적합도 = 1 - |업종 선호 - 지역 직장성|  (둘 다 0~1로 정규화)
    pref = (C.WORK_PREF.get(site.biz_code, C.DEFAULT_WORK_PREF) + 1) / 2
    def _fit(ws):
        if ws is None or not np.isfinite(ws):
            return None
        return 1.0 - abs(pref - ws)

    ws_list = [w for w in panel.get("work_ratio", []) if w is not None and np.isfinite(w)]
    if ws_list:
        lo, hi = min(ws_list), max(ws_list)
        rng = (hi - lo) or 1.0
        norm = lambda w: (w - lo) / rng
        m2 = _fit(norm(dong["work_ratio"])) if dong.get("work_ratio") is not None else None
        p2 = pct_rank(m2, [_fit(norm(w)) for w in ws_list])
    else:
        m2, p2 = None, None
        missing.append("상권성격(출근/귀가)")

    m4 = dong.get("gugu_spend_yoy")
    p4 = pct_rank(m4, panel["gugu_spend_yoy"])
    if m4 is None:
        missing.append("인천e음 소비 증감")

    parts = {"m1": (p1, 0.40), "m3": (p3, 0.30), "m2": (p2, 0.20), "m4": (p4, 0.10)}
    score, _, cov = _weighted(parts)

    if fit is not None and fit < 0.85:
        flags.append("영업시간대_유입_엇갈림")
    if fit is not None and fit > 1.20:
        flags.append("영업시간대_유입_집중")

    return Indicator(
        key="market", label="시장성", score=score,
        raw={
            "일평균_유입인구": m1,
            "시간대_적합도": round(fit, 2) if fit else None,
            "상권성격_적합도": round(m2, 3) if m2 is not None else None,
            "지역_직장성": round(dong["work_ratio"], 3) if dong.get("work_ratio") is not None else None,
            "업종_상권선호": C.WORK_PREF.get(site.biz_code, C.DEFAULT_WORK_PREF),
            "군구_업종소비_전년비": m4,
        },
        confidence=_conf("high" if not missing else "medium", cov), coverage=cov,
        flags=flags,
        note=f"결측: {', '.join(missing)}" if missing else "",
        breakdown=_bd("market", parts, {"m1": m1, "m3": None if fit is None else round(fit, 2),
                                         "m2": None if m2 is None else round(m2, 3), "m4": m4}),
    )


# ═══════════════════════════════════════════════════════════════
# 2. 고객성 — 내 업종의 손님이 여기 사는가/일하는가
# ═══════════════════════════════════════════════════════════════

def score_customer(site, dong, panel) -> Indicator:
    """
    데이터: 행정동 성·연령별 주민등록인구 + 1인세대 + SGIS 사업체 종사자
    C1 타겟연령 거주인구(규모)  가중 0.35
    C2 타겟연령 비중(농도)      가중 0.30
    C3 종사자 수(직장인구)      가중 0.20
    C4 1인세대 비중             가중 0.15  ※ 업종 민감도로 스케일링
    """
    profile = C.AGE_PROFILE.get(site.biz_code, C.DEFAULT_AGE_PROFILE)
    solo_sens = C.SOLO_SENSITIVITY.get(site.biz_code, C.DEFAULT_SOLO_SENS)

    def target_pop(pop_table) -> Optional[float]:
        """pop_table: {(sex, age): count}"""
        if not pop_table:
            return None
        total = 0.0
        for sex, lo, hi, w in profile:
            for age in range(lo, hi + 1):
                total += pop_table.get((sex, age), 0) * w
        return total

    # ETL이 타겟인구를 미리 계산해 두면 그걸 쓴다 (158개 동 × 220개 연령컬럼 재계산 회피)
    if dong.get("target_pop") is not None:
        c1 = dong["target_pop"]
        c2 = dong.get("target_share")
        p1 = pct_rank(c1, panel["target_pop"])
        p2 = pct_rank(c2, panel["target_share"])
    else:
        c1 = target_pop(dong.get("pop_by_sex_age"))
        total_pop = dong.get("pop_total")
        c2 = (c1 / total_pop) if (c1 is not None and total_pop) else None
        p1 = pct_rank(c1, [target_pop(t) for t in panel["pop_by_sex_age"]])
        p2 = pct_rank(c2, [
            (target_pop(t) / tp if (target_pop(t) is not None and tp) else None)
            for t, tp in zip(panel["pop_by_sex_age"], panel["pop_total"])
        ])

    c3 = dong.get("workers")
    p3 = pct_rank(c3, panel["workers"])

    c4 = dong.get("solo_household_share")
    p4_raw = pct_rank(c4, panel["solo_household_share"])
    # 민감도가 낮은 업종은 1인세대 신호를 중립(50)쪽으로 끌어당긴다
    p4 = None if p4_raw is None else 50 + (p4_raw - 50) * solo_sens

    parts = {"c1": (p1, 0.35), "c2": (p2, 0.30), "c3": (p3, 0.20), "c4": (p4, 0.15)}
    score, _, cov = _weighted(parts)

    flags = []
    if p1 is not None and p2 is not None:
        if p1 >= 70 and p2 < 40:
            flags.append("모수는_크나_타겟농도_낮음")
        if p1 < 40 and p2 >= 70:
            flags.append("타겟농도_높으나_모수_작음")

    tgt = ", ".join(f"{s} {lo}~{hi}세" for s, lo, hi, _ in profile)
    return Indicator(
        key="customer", label="고객성", score=score,
        raw={
            "타겟_정의": tgt,
            "타겟연령_거주인구": None if c1 is None else round(c1),
            "타겟연령_비중": None if c2 is None else round(c2, 3),
            "종사자수": c3,
            "1인세대_비중": c4,
        },
        confidence=_conf("high" if c1 is not None else "low", cov), coverage=cov,
        flags=flags,
        breakdown=_bd("customer", parts, {"c1": None if c1 is None else round(c1),
                                           "c2": None if c2 is None else round(c2, 3),
                                           "c3": c3, "c4": c4}),
    )


# ═══════════════════════════════════════════════════════════════
# 3. 경쟁성 — 파이 대비 경쟁자가 몇 명인가
# ═══════════════════════════════════════════════════════════════

def score_competition(site, dong, panel, stores, radius_profile=None, radius_ref=None) -> Indicator:
    """
    데이터: 소진공 상가(상권)정보 점포 좌표
    P2 점포당 잠재수요   가중 0.50   ← 주력. 밀도만 보면 번화가가 최악으로 나온다
    P1 동종점포 밀도     가중 0.30   (역방향)
    P4 최근 순증감       가중 0.20   (역방향, 신규진입 압력)

    ⚠ 동종점포 0개는 '경쟁 없음=만점'이 아니다.
      수요가 없어서 아무도 안 하는 것일 수 있으므로 수요 백분위로 대체하고 플래그를 세운다.
    """
    # radius_profile이 주어지면 면적가중 반경 수요를 쓴다 (권장).
    # 없으면 행정동 인구를 그대로 쓰는 근사로 떨어진다.
    #   ⚠ 반경이 여러 행정동에 걸칠 때, 점포는 반경 기준으로 세면서
    #     인구는 1개 동만 쓰면 분자·분모 기준이 어긋나 지점이 부당하게 불리해진다.
    #     radius_demand.radius_profile()이 이 비대칭을 해소한다.
    if radius_profile is not None:
        n_all = radius_profile["n_all"]
        n_same = radius_profile["n_same"]
        demand = radius_profile["반경수요"]
        demand_pop = list(radius_ref) if radius_ref is not None else []
    else:
        near = [s for s in stores
                if haversine_m(site.lat, site.lng, s["lat"], s["lng"]) <= C.RADIUS_M]
        same = [s for s in near if s.get("biz_code") == site.biz_code]
        n_same, n_all = len(same), len(near)
        demand = (dong.get("inflow_daily") or 0) * 0.3 + (dong.get("pop_total") or 0) * 0.7
        demand_pop = [
            (i or 0) * 0.3 + (p or 0) * 0.7
            for i, p in zip(panel["inflow_daily"], panel["pop_total"])
        ]
    flags = []

    if n_same == 0:
        # 미개척 상권. 기회인지 수요 공백인지 엔진은 판별할 수 없다.
        # → 점수를 매기지 않고(None) 수요 백분위만 근거로 넘겨 LLM이 양면 해석하게 한다.
        #   99점을 주면 종합점수가 부당하게 올라간다.
        demand_pct = pct_rank(demand, demand_pop) if demand_pop else None
        flags.append("미개척_동종점포_0개")
        return Indicator(
            key="competition", label="경쟁성", score=None,
            raw={"반경m": C.RADIUS_M, "동종점포수": 0, "전체점포수": n_all,
                 "점포당_잠재수요": None,
                 "해당지역_수요_백분위": demand_pct},
            confidence="low", coverage=0.0,
            flags=flags,
            note="반경 내 동종업종이 0개라 경쟁 지표를 산출하지 않았습니다. "
                 "경쟁 공백이 기회인지 수요 부재인지 엔진은 판별할 수 없습니다. "
                 f"참고로 이 지역의 수요 수준은 인천 상위 {100 - demand_pct:.0f}% 입니다."
                 if demand_pct is not None else
                 "반경 내 동종업종이 0개라 경쟁 지표를 산출하지 않았습니다.",
        )

    p2_raw = demand / n_same
    if radius_ref is not None:
        p2 = pct_rank(p2_raw, list(radius_ref))          # 이미 점포당수요 분포
    else:
        p2 = pct_rank(p2_raw, [d / max(n, 1) for d, n in zip(demand_pop, panel["n_same_biz"])])

    p1_raw = n_same / max(n_all, 1)
    p1 = pct_rank(p1_raw, panel["same_biz_share"], higher_is_better=False)

    p4_raw = dong.get("same_biz_net_change_1y")
    p4 = pct_rank(p4_raw, panel["same_biz_net_change_1y"], higher_is_better=False)

    parts = {"p2": (p2, 0.50), "p1": (p1, 0.30), "p4": (p4, 0.20)}
    score, _, cov = _weighted(parts)

    if n_all and n_same / n_all > 0.15:
        flags.append("동종업종_과밀")
    if p4_raw is not None and p4_raw > 0:
        flags.append("신규진입_증가중")

    return Indicator(
        key="competition", label="경쟁성", score=score,
        raw={
            "반경m": C.RADIUS_M,
            "동종점포수": n_same,
            "전체점포수": n_all,
            "동종업종_비중": round(p1_raw, 3),
            "반경_추정수요": round(demand),
            "점포당_잠재수요": round(p2_raw),
            "최근1년_동종_순증감": p4_raw,
        },
        confidence=_conf("high", cov), coverage=cov,
        flags=flags,
        breakdown=_bd("competition", parts, {"p2": round(p2_raw), "p1": round(p1_raw, 3), "p4": p4_raw}),
    )


# ═══════════════════════════════════════════════════════════════
# 4. 입지성 — 사람이 여기 올 이유가 있는가
# ═══════════════════════════════════════════════════════════════

def score_location(site, dong, panel, stations, facilities, loc_profile=None, loc_ref=None) -> Indicator:
    """
    데이터: 역 좌표+승하차, 학교 표준데이터, 버스정류장
    L2 역세권 강도(승하차 × 거리감쇠)  가중 0.35
    L3 업종별 유인시설 근접도          가중 0.35
    L1 최근접역 거리                   가중 0.20
    L4 버스정류장 밀도                 가중 0.10
    """
    anchors = C.ANCHOR.get(site.biz_code, C.DEFAULT_ANCHOR)

    # etl_location이 미리 계산한 프로파일을 쓴다 (권장).
    #   L2는 '환승 가중 역세권 강도'다. 승하차 실측이 아니다 —
    #   코레일 공공데이터가 일반철도 전용이라 광역전철 승하차를 구할 수 없기 때문.
    #   자세한 사유는 etl_location.py 모듈 docstring 참조.
    if loc_profile is not None:
        nearest = {"name": loc_profile.get("최근접역")}
        nearest_d = loc_profile.get("최근접역_거리m")
        l2_raw = loc_profile.get("역세권_강도")
        l3_raw = loc_profile.get("유인시설_근접도")
        ref = loc_ref or {}
        p2 = pct_rank(l2_raw, ref.get("역세권_강도", []))
        # 유인시설은 종류별 백분위를 낸 뒤 평균한다.
        # 합계로 한 번에 재면 개수가 많은 종류(오피스 12,162개)가 지배해
        # 그 종류를 쓰는 업종끼리 점수가 붙어버린다.
        per = loc_profile.get("유인시설_종류별") or {}
        ref_per = ref.get("유인시설_종류별") or {}
        ps = [pct_rank(v, ref_per.get(t, [])) for t, v in per.items()]
        ps = [x for x in ps if x is not None]
        p3 = sum(ps) / len(ps) if ps else pct_rank(l3_raw, ref.get("유인시설_근접도", []))
        p1 = pct_rank(nearest_d, ref.get("최근접역_거리m", []), higher_is_better=False)
        l4_raw, p4 = dong.get("bus_stop_density"), None
    elif stations:
        ds = [(haversine_m(site.lat, site.lng, s["lat"], s["lng"]), s) for s in stations]
        ds.sort(key=lambda x: x[0])
        nearest_d, nearest = ds[0]
        l2_raw = sum(s.get("daily_riders", 0) * decay(d, C.STATION_DECAY_M) for d, s in ds[:5])
        l3_raw = sum(
            decay(haversine_m(site.lat, site.lng, f["lat"], f["lng"]), C.FACILITY_DECAY_M)
            for f in facilities if f.get("type") in anchors) if facilities else None
        l4_raw = dong.get("bus_stop_density")
        p2 = pct_rank(l2_raw, panel["station_strength"])
        p3 = pct_rank(l3_raw, panel["anchor_strength"])
        p1 = pct_rank(nearest_d, panel["nearest_station_m"], higher_is_better=False)
        p4 = pct_rank(l4_raw, panel["bus_stop_density"])
    else:
        nearest_d = nearest = l2_raw = l3_raw = l4_raw = None
        p1 = p2 = p3 = p4 = None

    parts = {"l2": (p2, 0.35), "l3": (p3, 0.35), "l1": (p1, 0.20), "l4": (p4, 0.10)}
    score, _, cov = _weighted(parts)

    flags = []
    if nearest_d is not None and nearest_d <= 300:
        flags.append("역세권_300m내")
    if nearest_d is not None and nearest_d > 1000:
        flags.append("역세권_벗어남")

    return Indicator(
        key="location", label="입지성", score=score,
        raw={
            "최근접역": nearest.get("name") if nearest else None,
            "최근접역_거리m": None if nearest_d is None else round(nearest_d),
            "역세권_강도": None if l2_raw is None else round(l2_raw, 2),
            "역세권_강도_주": "환승 가중 근사 (승하차 실측 아님)",
            "유인시설_기준": ", ".join(anchors),
            "유인시설_근접도": None if l3_raw is None else round(l3_raw, 2),
            "유인시설_종류별": (loc_profile or {}).get("유인시설_종류별"),
            "반경500m_해당시설수": (loc_profile or {}).get("반경500m_해당시설수"),
            "버스정류장_밀도": l4_raw,
        },
        confidence=_conf("high" if (loc_profile is not None or stations) else "low", cov), coverage=cov,
        flags=flags,
        breakdown=_bd("location", parts, {"l2": None if l2_raw is None else round(l2_raw, 2),
                                           "l3": None if l3_raw is None else round(l3_raw, 2),
                                           "l1": None if nearest_d is None else round(nearest_d),
                                           "l4": l4_raw}),
    )


# ═══════════════════════════════════════════════════════════════
# 5. 안정성 — 버틸 수 있는가
# ═══════════════════════════════════════════════════════════════

def score_stability(site, dong, panel, cohort_counts) -> Indicator:
    """
    데이터: 행안부 인허가(인허가일자+폐업일자) + 인천시 소상공인통계 + 부동산원
    S1 3년 생존율     가중 0.40
    S2 최근 폐업률    가중 0.25 (역방향)
    S3 평균 업력      가중 0.20
    S4 군구 임대료    가중 0.15 (역방향)

    표본이 얇으면 폴백 사다리를 타고 해상도를 낮춘다. 그 사실을 반드시 기록한다.
    """
    level, conf = resolve_cohort(cohort_counts)

    s1 = dong.get(f"survival_3y__{level}")
    s2 = dong.get(f"closure_rate__{level}")
    s3 = dong.get(f"avg_tenure__{level}")
    s4 = dong.get("gugu_rent_per_sqm")

    p1 = pct_rank(s1, panel["survival_3y"])
    p2 = pct_rank(s2, panel["closure_rate"], higher_is_better=False)
    p3 = pct_rank(s3, panel["avg_tenure"])
    p4 = pct_rank(s4, panel["gugu_rent_per_sqm"], higher_is_better=False)

    parts = {"s1": (p1, 0.40), "s2": (p2, 0.25), "s3": (p3, 0.20), "s4": (p4, 0.15)}
    score, _, cov = _weighted(parts)

    flags = []
    if s2 is not None and s2 > 0.20:
        flags.append("폐업률_높음")
    if level != "dong_sobun":
        flags.append(f"해상도_저하__{level}")

    label_map = {k: v for k, v, _ in FALLBACK_LADDER}
    return Indicator(
        key="stability", label="안정성", score=score,
        raw={
            "3년_생존율": s1,
            "최근_폐업률": s2,
            "평균_업력_년": s3,
            "임대료_천원_㎡": s4,
            "임대료_상권": dong.get("rent_area"),
            "인천_업종평균_3년생존율": C_BASELINE_SURVIVAL_3Y,
        },
        confidence=_conf(conf, cov), coverage=cov, fallback=level,
        flags=flags,
        note=("표본이 부족해 " + label_map[level] + " 단위로 계산했습니다."
              if level != "dong_sobun" else ""),
        breakdown=_bd("stability", parts, {"s1": s1, "s2": s2, "s3": s3, "s4": s4}),
    )


# 인천시 소상공인통계(2021년 기준 최초 작성분) 생존율 기준선
# ※ 2023년 기준판 공표본으로 교체할 것
C_BASELINE_SURVIVAL_3Y = 0.552


def _conf(base: str, coverage: float) -> str:
    """세부지표가 많이 비면 신뢰도를 한 단계 내린다."""
    order = ["high", "medium", "low"]
    i = order.index(base)
    if coverage < 0.5:
        i = min(i + 2, 2)
    elif coverage < 0.8:
        i = min(i + 1, 2)
    return order[i]


# ═══════════════════════════════════════════════════════════════
# 가중 결합 — 결측은 제외하고 가중치를 재정규화한다
# ═══════════════════════════════════════════════════════════════

def _weighted(parts: dict) -> tuple[Optional[float], dict, float]:
    """반환: (점수, 재정규화된 가중치, coverage=원래 가중치 중 계산된 비율)"""
    total_w = sum(w for _, w in parts.values())
    avail = {k: (v, w) for k, (v, w) in parts.items() if v is not None}
    if not avail:
        return None, {}, 0.0
    tot = sum(w for _, w in avail.values())
    used = {k: w / tot for k, (_, w) in avail.items()}
    score = sum(v * used[k] for k, (v, _) in avail.items())
    return round(score, 1), used, (tot / total_w if total_w else 0.0)


# ═══════════════════════════════════════════════════════════════
# 종합
# ═══════════════════════════════════════════════════════════════

@dataclass
class Site:
    lat: float
    lng: float
    biz_code: str          # 소진공 상권업종 소분류 코드 (예: R10406)
    biz_name: str = ""     # 공식 소분류명. 비우면 코드로 자동 조회
    dong_code: str = ""
    dong_name: str = ""
    query: str = ""

    def __post_init__(self):
        if not self.biz_name:
            self.biz_name = C.CODE_NAME.get(self.biz_code, self.biz_code)

    @classmethod
    def from_query(cls, lat, lng, user_text, dong_code="", dong_name=""):
        """사용자 입력 문장에서 업종을 해석해 Site를 만든다. 실패하면 ValueError."""
        code, name = C.resolve_biz(user_text)
        if code is None:
            raise ValueError(
                f"'{user_text}'에서 분석 가능한 업종을 찾지 못했습니다. "
                f"상권업종 소분류 247개 중 하나여야 합니다."
            )
        return cls(lat=lat, lng=lng, biz_code=code, biz_name=name,
                   dong_code=dong_code, dong_name=dong_name, query=user_text)


def resolve_weights(group: str, user_weights: Optional[dict] = None,
                    importance: Optional[dict] = None) -> tuple[dict, dict]:
    """
    관점 가중치를 결정한다. 반환: (가중치 dict[합=1], 적용 내역 dict)

    우선순위: user_weights(직접 입력) > importance(중요도 1~5) > 업종그룹 기본값
      - importance: {관점: 1~5}. 3=기본 유지. 기본 가중치에 배수(IMPORTANCE_MULT)를 곱한 뒤 정규화.
                    생략한 관점은 3으로 본다.
      - user_weights: {관점: 0 이상 숫자}. 합이 1이 아니어도 된다(정규화). 생략한 관점은 기본값을 쓴다.
    규칙: 합계 1, 관점당 MIN_WEIGHT 이상. 입력이 잘못되면 ValueError (조용히 보정하지 않는다).
    """
    base = dict(C.WEIGHTS[group])
    ks = C.PERSPECTIVES
    info = {"출처": "기본(업종그룹)", "기본_가중치": {k: round(v, 3) for k, v in base.items()},
            "하한_적용": []}

    if user_weights is not None and importance is not None:
        raise ValueError("user_weights와 importance는 동시에 쓸 수 없습니다.")

    if user_weights is not None:
        bad = [k for k in user_weights if k not in ks]
        if bad:
            raise ValueError(f"알 수 없는 관점: {bad}. 허용: {ks}")
        raw = {}
        for k in ks:
            v = user_weights.get(k, base[k])
            if not isinstance(v, (int, float)) or v < 0 or v != v:
                raise ValueError(f"가중치 '{k}'는 0 이상의 숫자여야 합니다: {v!r}")
            raw[k] = float(v)
        info["출처"] = "사용자(직접 입력)"
    elif importance is not None:
        bad = [k for k in importance if k not in ks]
        if bad:
            raise ValueError(f"알 수 없는 관점: {bad}. 허용: {ks}")
        raw = {}
        for k in ks:
            lv = importance.get(k, 3)
            if lv not in C.IMPORTANCE_MULT:
                raise ValueError(f"중요도 '{k}'는 1~5 정수여야 합니다: {lv!r}")
            raw[k] = base[k] * C.IMPORTANCE_MULT[lv]
        info["출처"] = "사용자(중요도 1~5)"
        info["중요도"] = {k: importance.get(k, 3) for k in ks}
    else:
        raw = base

    tot = sum(raw.values())
    if tot <= 0:
        raise ValueError("가중치 합이 0입니다.")
    w = {k: raw[k] / tot for k in ks}

    # 하한 적용: 하한 미만인 관점을 MIN_WEIGHT로 올리고 나머지를 비례 축소 (합 1 유지)
    low = [k for k in ks if w[k] < C.MIN_WEIGHT]
    if low:
        rest = [k for k in ks if k not in low]
        room = 1.0 - C.MIN_WEIGHT * len(low)
        rest_sum = sum(w[k] for k in rest)
        w = {**{k: C.MIN_WEIGHT for k in low},
             **{k: w[k] / rest_sum * room for k in rest}}
        info["하한_적용"] = low
    info["적용_가중치"] = {k: round(w[k], 3) for k in ks}
    return w, info


def analyze(site: Site, dong, panel, stores, stations, facilities, cohort_counts,
            radius_profile=None, radius_ref=None,
            loc_profile=None, loc_ref=None,
            user_weights: Optional[dict] = None, importance: Optional[dict] = None,
            user_licenses: Optional[list] = None, schools=None) -> dict:
    group = C.group_of(site.biz_code)
    w, w_info = resolve_weights(group, user_weights, importance)

    inds = [
        score_market(site, dong, panel),
        score_customer(site, dong, panel),
        score_competition(site, dong, panel, stores, radius_profile, radius_ref),
        score_location(site, dong, panel, stations, facilities, loc_profile, loc_ref),
        score_stability(site, dong, panel, cohort_counts),
    ]

    # 계산된 세부지표가 너무 적으면 그 관점은 점수를 내지 않는다 (breakdown·raw는 그대로 남긴다)
    for i in inds:
        if i.score is not None and i.coverage < C.MIN_COVERAGE:
            i.flags.append("커버리지_부족_미산출")
            i.note = (i.note + " " if i.note else "") + (
                f"세부지표 {i.coverage*100:.0f}%만 계산되어 관점 점수는 산출하지 않았습니다 "
                f"(기준 {C.MIN_COVERAGE*100:.0f}%).")
            i.score = None

    parts = {i.key: (i.score, w[i.key]) for i in inds}
    total, used_w, total_cov = _weighted(parts)

    scored = [i for i in inds if i.score is not None]
    bottleneck = min(scored, key=lambda i: i.score) if scored else None
    strongest = max(scored, key=lambda i: i.score) if scored else None

    warnings = []
    # 병목 경고는 사용자 가중치와 무관하게 점수만으로 판정한다 (가중치를 낮춰 위험을 숨길 수 없다)
    if bottleneck and bottleneck.score < C.BOTTLENECK_THRESHOLD:
        warnings.append(
            f"{bottleneck.label}이(가) 인천 하위 {bottleneck.score:.0f}%로, "
            f"종합점수와 별개로 단일 병목입니다."
        )
        base_w = w_info["기본_가중치"].get(bottleneck.key)
        if w_info["출처"] != "기본(업종그룹)" and base_w is not None \
                and w_info["적용_가중치"][bottleneck.key] < base_w:
            warnings.append(
                f"설정하신 가중치에서 {bottleneck.label} 비중이 기본({base_w:.2f})보다 낮지만, "
                f"병목 경고는 가중치와 무관하게 표시됩니다."
            )
    if len(scored) < 5:
        missing = [i.label for i in inds if i.score is None]
        warnings.append(f"계산 불가 지표: {', '.join(missing)} (해당 가중치는 나머지에 재분배)")
    for i in inds:
        if "미개척_동종점포_0개" in i.flags:
            warnings.append("반경 내 동종업종이 0개입니다. 경쟁 공백이 기회인지 "
                            "수요 부재인지는 현장 확인이 필요합니다.")
        if i.coverage < 0.8 and i.score is not None:
            warnings.append(f"{i.label}은 세부지표의 {i.coverage*100:.0f}%만 "
                            f"계산되어 신뢰도가 낮습니다.")

    # 사용자 가중치를 썼다면, 기본 가중치로 계산한 종합도 같이 준다 (비교·설명용)
    base_total = None
    if w_info["출처"] != "기본(업종그룹)":
        base_total, _, _ = _weighted({i.key: (i.score, C.WEIGHTS[group][i.key]) for i in inds})

    # 초보자 접근성: 점수와 별개인 태그. 면허 보유 여부는 사용자 조건으로 받는다.
    access = A.access_tag(site.biz_code, user_licenses)
    if access is not None and A.ACCESS[site.biz_code]["입지규제"]:
        src = schools if schools is not None else facilities   # schools: 학교명·type·lat·lng (점수 계산과 분리)
        fac = src if isinstance(src, list) else (
            src.to_dict("records") if src is not None and hasattr(src, "to_dict") else None)
        access["주변_학교"] = A.school_check(getattr(site, "lat", None), getattr(site, "lng", None), fac)
        if access["주변_학교"] and access["주변_학교"]["학교수"] > 0:
            warnings.append(f"{site.biz_name}은(는) 학교 주변 입지 규제 업종이고, 이 지점 300m 안에 "
                            f"초·중·고 {access['주변_학교']['학교수']}곳이 있습니다. "
                            f"영업 가능 여부를 관할 교육지원청에 먼저 확인하세요.")
    if access is not None and access["제도_진입장벽"] == "높음":
        warnings.append(f"{site.biz_name} 제도 진입장벽 높음: {', '.join(access['이유'])}.")

    return {
        "meta": {
            "query": site.query,
            "업종": site.biz_name,
            "업종코드": site.biz_code,
            "업종그룹": group,
            "행정동": site.dong_name or site.dong_code,
            "분석반경_m": C.RADIUS_M,
            "정규화_기준": "인천 전체 행정동 백분위",
            "엔진버전": "mvp-0.3",
        },
        "종합": {
            "점수": total,
            "적용_가중치": {k: round(v, 3) for k, v in used_w.items()},
            "최고_지표": strongest.key if strongest else None,
            "병목_지표": bottleneck.key if bottleneck else None,
            "데이터_충족률": round(total_cov, 2),
            "가중치_출처": w_info["출처"],
            "기본_가중치": w_info["기본_가중치"],
            **({"중요도": w_info["중요도"]} if "중요도" in w_info else {}),
            **({"하한_적용": w_info["하한_적용"]} if w_info["하한_적용"] else {}),
            **({"기본가중치_종합점수": base_total} if base_total is not None else {}),
        },
        "지표": [asdict(i) for i in inds],
        "초보자_접근성": access,
        "경고": warnings,
        "면책": "본 점수는 공공데이터 기반 상대 순위이며 매출을 보장하지 않습니다. "
                "지원사업 해당 여부는 반드시 원문 공고로 확인하세요.",
    }
