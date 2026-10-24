"""
번화가 쏠림 점검 — 종합 점수 전체가 '번화가일수록 높게' 나오는가?

방법
  인천 158개 행정동 중심점을 각각 분석 지점으로 놓고, 29개 업종의 5대 관점·종합 점수를
  부평역과 같은 규칙(같은 엔진, 같은 비교 분포)으로 계산한다.
  '번화가 정도' = 반경 500m 전체 점포 수.
  업종별로 번화가 정도와 종합 점수의 순위상관(ρ), 상위 20% − 하위 20% 평균 차이를 낸다.
  ※ 임대료(S4)는 상권 9곳만 있어 중심점에는 붙이지 않는다(웹 서비스와 같은 조건).

실행
  python3 busy_bias_check.py                 # 이 폴더의 engine (v0.5)
  python3 busy_bias_check.py <엔진폴더>       # 다른 버전과 비교 (예: v0.4의 04_엔진코드/engine)
출력
  05_분석결과/번화가_쏠림_점검_<버전>.csv (업종별) · 요약 표 출력
"""
import sys, os, re, warnings
warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, "engine")
sys.path.insert(0, ENGINE)
DATA = os.path.join(HERE, "..", "07_가공데이터")
OUT = os.path.join(HERE, "..", "05_분석결과")
os.chdir(DATA)
import numpy as np, pandas as pd
from scipy.stats import spearmanr
import config as C
from scoring import Site, analyze
import radius_demand as RD
from etl_location import load_stations, load_schools, build_anchor_points, site_profile

V05 = hasattr(C, "same_weights")
AREAS = None
shops = pd.read_csv("인천_상가_정제.csv", encoding="utf-8-sig", low_memory=False)
panel = pd.read_csv("패널_통합.csv", encoding="utf-8-sig", dtype={"행정동코드": str})
mkt = pd.read_csv("패널_시장성_202608.csv", encoding="utf-8-sig", dtype={"시군구코드": str}).set_index("시군구코드")
stab = pd.read_csv("패널_안정성.csv", encoding="utf-8-sig"); stab["업종코드"] = "R10406"
STAB = pd.concat([stab, pd.read_csv("패널_안정성_음식.csv", encoding="utf-8-sig")], ignore_index=True)
st = load_stations("역사_전국도시철도.xlsx")
anch = build_anchor_points(load_schools("학교_전국.csv"), shops)
cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
P = cent.merge(panel, on=["시군구명", "행정동명"], how="left")
P["구코드"] = P["행정동코드"].str[:5]
if V05 and os.path.exists("경계_인천_행정동.geojson") and os.path.exists(os.path.join(ENGINE, "etl_boundary.py")):
    from etl_boundary import DongAreas
    AREAS = DongAreas("경계_인천_행정동.geojson", panel)

base = {k: [None] * len(P) for k in ["pop_by_sex_age", "same_biz_net_change_1y", "station_strength",
        "anchor_strength", "nearest_station_m", "bus_stop_density", "survival_3y", "closure_rate",
        "avg_tenure", "gugu_rent_per_sqm", "gugu_spend_yoy"]}
base.update(pop_total=P["총인구"].tolist(), workers=P["종사자수"].tolist(),
            solo_household_share=P["1인가구비중"].tolist(),
            inflow_daily=mkt["일평균_유입"].tolist(),
            inflow_by_hour=[[float(r[f"h{h:02d}"]) for h in range(24)] for _, r in mkt.iterrows()],
            work_ratio=mkt["work_ratio"].tolist())


def stab_ref(biz):
    t = STAB[STAB.업종코드 == biz]
    if t.empty:
        return None, None
    gu = t[(t.시군구 != "__인천전체__") & (t.표본_3년 >= C.MIN_COHORT_N_GUGU)]
    return ({"survival_3y": gu["생존율_3년"].tolist(), "closure_rate": gu["최근3년_폐업률"].tolist(),
             "avg_tenure": gu["평균업력_년"].tolist()}, t.set_index("시군구"))


def agg_type(code):
    return C.AGG_TYPE_LABEL.get(C.agg_alpha(code), "?") if hasattr(C, "agg_alpha") else "-"


rows = []
for biz, tgt in C.CODE_NAME.items():
    tcol = f"타겟_{tgt}"
    if tcol not in P.columns:
        continue
    XC = [tcol, "총인구", "종사자수"]
    popd = panel[["시군구명", "행정동명"] + XC].loc[:, lambda d: ~d.columns.duplicated()]
    if V05:
        ref, _ = RD.build_reference(shops, popd, biz, 500, pop_col=C.DEMAND_COLS, extra_cols=XC, same_weights=C.same_weights(biz),
                                    **({"areas": AREAS} if AREAS is not None else {}))
    else:
        ref, _ = RD.build_reference(shops, popd, biz, 500)
    ref = cent[["시군구명", "행정동명"]].merge(ref, on=["시군구명", "행정동명"], how="left")
    locs = [site_profile(r["위도"], r["경도"], st, anch, biz) for _, r in cent.iterrows()]
    lref = {k: [x[k] for x in locs] for k in ["역세권_강도", "유인시설_근접도", "최근접역_거리m"]}
    lref["유인시설_종류별"] = {t: [x["유인시설_종류별"].get(t, 0.0) for x in locs]
                         for t in C.ANCHOR.get(biz, C.DEFAULT_ANCHOR)}
    sref, sgu = stab_ref(biz)
    pn = dict(base)
    if sref:
        pn.update(sref)
    pn["target_pop"] = P[tcol].tolist(); pn["target_share"] = P[f"타겟비중_{tgt}"].tolist()
    pn["n_same_biz"] = P[tgt].tolist(); pn["same_biz_share"] = ref["반경_동종비중"].fillna(0).tolist()
    if V05:
        pn["same_biz_count"] = ref.loc[ref["반경_동종점포"] > 0, "반경_동종점포"].tolist()
        _, cpanel = RD.customer_inputs({**ref.iloc[0].to_dict()}, ref, tcol)
        pn.update(cpanel)
    p2ref = ref.loc[ref["반경_동종점포"] > 0, "반경_점포당수요"].dropna().tolist()
    aref = ref["반경_전체점포"].tolist()
    for i, r in P.iterrows():
        rr = ref.iloc[i]
        rp = {"n_all": int(rr["반경_전체점포"]), "n_same": rr["반경_동종점포"], "반경수요": rr["반경_수요"]}
        if V05:
            rp["n_same_정확일치"] = int(rr["반경_정확일치_동종"])
        g = mkt.loc[r["구코드"]]
        dong = {"pop_total": r["총인구"], "target_pop": r[tcol], "target_share": r[f"타겟비중_{tgt}"],
                "workers": r["종사자수"], "solo_household_share": r["1인가구비중"],
                "inflow_daily": float(g["일평균_유입"]), "inflow_by_hour": [float(g[f"h{h:02d}"]) for h in range(24)],
                "work_ratio": float(g["work_ratio"]), "gugu_spend_yoy": None, "same_biz_net_change_1y": None,
                "bus_stop_density": None, "gugu_rent_per_sqm": None}
        n_coh = 0
        if sgu is not None and r["시군구명"] in sgu.index:
            s = sgu.loc[r["시군구명"]]
            dong.update({"survival_3y__gugu_sobun": float(s["생존율_3년"]),
                         "closure_rate__gugu_sobun": float(s["최근3년_폐업률"]),
                         "avg_tenure__gugu_sobun": float(s["평균업력_년"])})
            n_coh = int(s["표본_3년"])
        if V05:
            dong.update({"target_pop": rr[f"반경_{tcol}"],
                         "target_share": (rr[f"반경_{tcol}"] / rr["반경_총인구"]) if rr["반경_총인구"] else None,
                         "workers": rr["반경_종사자수"], "pop_radius": rr["반경_총인구"]})
        lp = {k: lref[k][i] for k in ["역세권_강도", "유인시설_근접도", "최근접역_거리m"]}
        lp["유인시설_종류별"] = {t: v[i] for t, v in lref["유인시설_종류별"].items()}
        site = Site(lat=r["위도"], lng=r["경도"], biz_code=biz)
        res = analyze(site, dong, pn, [], [], [], {"dong_sobun": 0, "dong_jung": 0, "gugu_sobun": n_coh,
                                                    "incheon_avg": 9999},
                      radius_profile=rp, radius_ref=p2ref, agg_ref=aref, loc_profile=lp, loc_ref=lref, schools=[])
        sc = {x["key"]: x["score"] for x in res["지표"]}
        rows.append({"업종": tgt, "유형": agg_type(biz), "동": f'{r["시군구명"]} {r["행정동명"]}',
                     "번화가": int(rr["반경_전체점포"]), "종합": res["종합"]["점수"], **sc})

df = pd.DataFrame(rows)
ver = os.environ.get("VER") or (getattr(C, "REFERENCE_LABEL", None) and "v0.5" or "v0.4")
summ = []
for (nm, ty), g in df.groupby(["업종", "유형"]):
    g = g.dropna(subset=["종합"])
    hi, lo = g[g.번화가 >= g.번화가.quantile(.8)], g[g.번화가 <= g.번화가.quantile(.2)]
    summ.append({"업종": nm, "유형": ty, "ρ_종합": round(spearmanr(g.번화가, g.종합)[0], 2),
                 "격차_종합": round(hi.종합.mean() - lo.종합.mean(), 1),
                 **{f"격차_{k}": round(hi[k].mean() - lo[k].mean(), 1)
                    for k in ["market", "customer", "competition", "location", "stability"]}})
S = pd.DataFrame(summ)
S.to_csv(os.path.join(OUT, f"번화가_쏠림_점검_{ver}.csv"), index=False, encoding="utf-8-sig")
df.to_csv(os.path.join(OUT, f"중심점_158x29_점수_{ver}.csv"), index=False, encoding="utf-8-sig")
pd.set_option("display.width", 220)
print(f"== {ver} ({ENGINE})")
print(S.sort_values(["유형", "격차_종합"]).to_string(index=False))
print(S.groupby("유형")[["ρ_종합", "격차_종합", "격차_market", "격차_customer", "격차_competition",
                       "격차_location", "격차_stability"]].mean().round(2))
