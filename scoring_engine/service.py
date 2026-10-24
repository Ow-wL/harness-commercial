"""
Analysis service — v0.3 run_all.py 의 업종 루프 본문을 함수로 옮긴 어댑터.

scoring.analyze() 는 순수 계산 함수다 (파일 I/O 없음). 실제 데이터를 analyze() 입력
(site, dong, panel, cohort_counts, radius/loc profile·ref, schools)으로 바꾸는 책임은
v0.3 에서는 run_all.py 에 있었고, 여기서는 이 모듈이 진다.

규칙: 엔진 계산식을 바꾸지 않는다. run_all.py 와 같은 입력을 같은 순서로 만든다.
      tests/test_golden_regression.py 가 29개 업종 전체 출력이 v0.3 결과와 같은지 검사한다.

엔진 v0.5(AREA_WEIGHTED, D-028)는 팀 run_all.py v0.5 반복문 본문과 같은 입력을 만든다:
  radius_profile(..., pop_col=DEMAND_COLS, extra_cols=XC, same_weights=대체업종, areas=경계 면적 배분)
  → customer_inputs(rp, ref, 타겟_업종) 로 고객성 지점 값(dong)·비교 분포(panel)를 같은 반경 값으로 덮어쓴다
  → analyze(..., agg_ref=ref["반경_전체점포"], schools=학교) — 학교구역 경고·집적도. tests/engine_v0_5 가 golden v0.5 와 대조한다.
  반경 r 을 고르면 경쟁성·고객성·집적도·비교 분포가 모두 같은 r 로 계산된다(ReferenceCache 키 (업종, r)). 입지성·시장성·안정성은 반경과 무관.
"""
from __future__ import annotations

from typing import Optional

from . import AREA_WEIGHTED, RADIUS_OPTIONS_M, config as C, etl_location, radius_demand, scoring
from .context import SiteContext
from .reference import ReferenceCache, customer_cols, demand_table
from .runtime import RuntimeData, load_runtime

# run_all.py 가 analyze() 결과에 덧붙이는 후처리 (엔진 밖 규칙).
#   시장성 데이터(생활이동)는 시군구 해상도이므로 fallback·flag 를 명시한다.
MARKET_FALLBACK = "gugu"
MARKET_FLAG = "해상도_시군구"

SUMMARY_COLUMNS = ["업종코드", "업종명", "업종그룹", "시장성", "고객성", "경쟁성", "입지성", "안정성", "종합",
                   "병목", "충족률", "시간대_적합도", "역세권_강도", "유인시설_근접도", "반경내_동종점포",
                   "점포당_잠재수요", "제도_진입장벽", "인허가", "필요_면허"]


class AnalysisService:
    def __init__(self, rt: Optional[RuntimeData] = None, cache: Optional[ReferenceCache] = None):
        self.rt = rt or load_runtime()
        self.cache = cache or ReferenceCache(self.rt)
        self._base_panel = self.rt.base_panel()

    def analyze(self, ctx: SiteContext, biz: str, *, user_weights: Optional[dict] = None,
                importance: Optional[dict] = None, user_licenses: Optional[list] = None,
                radius_m: Optional[int] = None) -> dict:
        """radius_m: 분석 반경(None = config.RADIUS_M). 엔진이 받는 값(RADIUS_OPTIONS_M)만 — v0.3 은 500 뿐."""
        if biz not in C.CODE_NAME:
            raise ValueError(f"지원하지 않는 업종코드: {biz}")
        radius = C.RADIUS_M if radius_m is None else radius_m
        if radius not in RADIUS_OPTIONS_M:
            raise ValueError(f"지원하지 않는 분석 반경: {radius} (가능: {RADIUS_OPTIONS_M})")
        rt, cache = self.rt, self.cache
        tgt = C.CODE_NAME[biz]
        panel = rt.panel

        # ── 지점의 행정동·시군구 행 ─────────────────────────
        rows = panel[(panel.시군구명 == ctx.gu_name) & (panel.행정동명 == ctx.dong_name)]
        if rows.empty:
            raise KeyError(f"패널에 행정동 없음: {ctx.gu_name} {ctx.dong_name}")
        row = rows.iloc[0]
        g_rows = rt.market[rt.market.시군구코드 == ctx.gu_code]
        if g_rows.empty:
            raise KeyError(f"시장성 패널에 시군구코드 없음: {ctx.gu_code}")
        g = g_rows.iloc[0]

        # ── 비교 모집단 (캐시) ──────────────────────────────
        ref, dong_total = cache.competition(biz, radius)
        lref = cache.location(biz)
        stab_ref = cache.stability(biz)
        stab_row, stab_n = cache.stability_row(biz, ctx.gu_name) if stab_ref else (None, 0)

        # ── 지점 프로파일 (요청마다) ────────────────────────
        if AREA_WEIGHTED:
            rp = radius_demand.radius_profile(ctx.lat, ctx.lng, rt.shops, demand_table(panel, biz), biz, radius,
                                              pop_col=C.DEMAND_COLS, dong_total_shops=dong_total,
                                              extra_cols=customer_cols(biz), same_weights=C.same_weights(biz),
                                              areas=rt.areas)
            cust_dong, cust_panel = radius_demand.customer_inputs(rp, ref, f"타겟_{tgt}")
        else:
            rp = radius_demand.radius_profile(ctx.lat, ctx.lng, rt.shops, panel[["시군구명", "행정동명", "총인구"]],
                                              biz, radius, dong_total_shops=dong_total)
        lp = etl_location.site_profile(ctx.lat, ctx.lng, rt.stations, rt.anchors, biz)

        pn = dict(self._base_panel)
        if stab_ref:
            pn.update(stab_ref)
        pn["target_pop"] = panel[f"타겟_{tgt}"].tolist()
        pn["target_share"] = panel[f"타겟비중_{tgt}"].tolist()
        pn["n_same_biz"] = panel[tgt].tolist()
        pn["same_biz_share"] = ref["반경_동종비중"].fillna(0).tolist()
        if AREA_WEIGHTED:
            pn["same_biz_count"] = ref.loc[ref["반경_동종점포"] > 0, "반경_동종점포"].tolist()   # P1_MODE="count" 용(기본 share)
            pn.update(cust_panel)                                                                # 고객성 반경 비교 분포

        dong = {"pop_total": int(row["총인구"]),
                "target_pop": float(row[f"타겟_{tgt}"]), "target_share": float(row[f"타겟비중_{tgt}"]),
                "workers": float(row["종사자수"]), "solo_household_share": float(row["1인가구비중"]),
                "inflow_daily": float(g["일평균_유입"]),
                "inflow_by_hour": [float(g[f"h{h:02d}"]) for h in range(24)],
                "work_ratio": float(g["work_ratio"]),
                "gugu_spend_yoy": None, "same_biz_net_change_1y": None,
                "bus_stop_density": None, "gugu_rent_per_sqm": rt.rent_for(ctx.rent_area),
                "rent_area": ctx.rent_area,
                **({"survival_3y__gugu_sobun": float(stab_row["생존율_3년"]),
                    "closure_rate__gugu_sobun": float(stab_row["최근3년_폐업률"]),
                    "avg_tenure__gugu_sobun": float(stab_row["평균업력_년"])} if stab_row is not None else {})}
        if AREA_WEIGHTED:
            dong.update(cust_dong)                     # 반경 타겟 인구·비중·종사자 (팀 run_all v0.5)

        # run_all.py 와 같은 문구로 Site 를 만든다 (meta.query 가 golden 에 포함됨).
        site = scoring.Site.from_query(ctx.lat, ctx.lng, f"{ctx.label} 근처 {tgt}", dong_name=ctx.display_dong)
        if site.biz_code != biz:
            raise AssertionError(f"업종 문구 해석 불일치: {tgt} → {site.biz_code} (기대 {biz})")
        cc = {"dong_sobun": 0, "dong_jung": 0, "gugu_sobun": stab_n, "incheon_avg": 9999}

        res = scoring.analyze(
            site, dong, pn, [], [], [], cc,
            radius_profile=rp,
            radius_ref=ref.loc[ref["반경_동종점포"] > 0, "반경_점포당수요"].dropna().tolist(),
            **({"agg_ref": ref["반경_전체점포"].tolist()} if AREA_WEIGHTED else {}),   # v0.5 상권 집적도 비교 분포
            loc_profile=lp, loc_ref=lref,
            user_weights=user_weights, importance=importance, user_licenses=user_licenses,
            schools=rt.schools,
            # v0.3 analyze() 는 radius_m 인자가 없다(500 고정). 반경을 받는 엔진(v0.4·v0.5)에만 넘긴다
            **({"radius_m": radius} if len(RADIUS_OPTIONS_M) > 1 else {}))

        for i in res["지표"]:
            if i["key"] == "market":
                i["fallback"] = MARKET_FALLBACK
                i["flags"].append(MARKET_FLAG)
        return res

    def analyze_all(self, ctx: SiteContext) -> dict[str, dict]:
        """29개 업종 전체. 키는 업종코드, 순서는 config.CODE_NAME 순서."""
        return {biz: self.analyze(ctx, biz) for biz in C.CODE_NAME}


def summary_row(res: dict) -> dict:
    """run_all.py 의 순위표(CSV) 한 행과 같은 형식."""
    d = {i["key"]: i for i in res["지표"]}
    acc = res["초보자_접근성"] or {}
    return {"업종코드": res["meta"]["업종코드"], "업종명": res["meta"]["업종"], "업종그룹": res["meta"]["업종그룹"],
            "시장성": d["market"]["score"], "고객성": d["customer"]["score"],
            "경쟁성": d["competition"]["score"], "입지성": d["location"]["score"],
            "안정성": d["stability"]["score"],
            "종합": res["종합"]["점수"], "병목": res["종합"]["병목_지표"], "충족률": res["종합"]["데이터_충족률"],
            "시간대_적합도": d["market"]["raw"].get("시간대_적합도"),
            "역세권_강도": d["location"]["raw"].get("역세권_강도"),
            "유인시설_근접도": d["location"]["raw"].get("유인시설_근접도"),
            "반경내_동종점포": d["competition"]["raw"]["동종점포수"],
            "점포당_잠재수요": d["competition"]["raw"].get("점포당_잠재수요"),
            "제도_진입장벽": acc.get("제도_진입장벽"), "인허가": acc.get("인허가"), "필요_면허": acc.get("필요_면허")}


def ranking(results: dict[str, dict]) -> list[dict]:
    """종합점수 내림차순 (동점은 CODE_NAME 순서 유지 — run_all.py 의 stable sort 와 동일)."""
    rows = [summary_row(results[biz]) for biz in C.CODE_NAME if biz in results]
    rows.sort(key=lambda x: -x["종합"])
    return rows
