"""부평역 — 전 업종 일괄 스코어링 (입지성 레퍼런스를 유인시설 집합 단위로 캐싱)"""
import sys, os, json, re, csv
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "engine"))
DATA = os.path.join(HERE, "..", "07_가공데이터")          # 입력: 가공 데이터
OUT  = os.path.join(HERE, "..", "05_분석결과")            # 출력: 순위표 + 업종별 JSON
os.makedirs(os.path.join(OUT, "업종별_상세JSON"), exist_ok=True)
os.chdir(DATA)
import pandas as pd
import config as C, scoring
from scoring import Site, analyze
from radius_demand import radius_profile, build_reference
from etl_location import load_stations, load_schools, build_anchor_points, site_profile
from etl_rent import load_rent, incheon_areas

LAT, LNG, GU = 37.4894, 126.7246, "28237"
shops = pd.read_csv("인천_상가_정제.csv", encoding="utf-8-sig", low_memory=False)
panel = pd.read_csv("패널_통합.csv", encoding="utf-8-sig")
mkt   = pd.read_csv("패널_시장성_202608.csv", encoding="utf-8-sig", dtype={"시군구코드":str})
stab  = pd.read_csv("패널_안정성.csv", encoding="utf-8-sig")
stab["업종코드"] = "R10406"
stab_food = pd.read_csv("패널_안정성_음식.csv", encoding="utf-8-sig")
STAB = pd.concat([stab, stab_food], ignore_index=True)

def stab_for(biz):
    """업종별 안정성: (구별 기준 분포 dict, 부평구 행, 부평구 3년 표본수). 표본 30건 미만 구는 기준에서 뺀다."""
    t = STAB[STAB.업종코드 == biz]
    if t.empty:
        return None, None, 0
    gu = t[(t.시군구 != "__인천전체__") & (t.표본_3년 >= C.MIN_COHORT_N_GUGU)]
    ref = {"survival_3y": gu["생존율_3년"].tolist(), "closure_rate": gu["최근3년_폐업률"].tolist(),
           "avg_tenure": gu["평균업력_년"].tolist()}
    me = t[t.시군구 == "부평구"]
    return ref, (me.iloc[0] if len(me) else None), (int(me.iloc[0]["표본_3년"]) if len(me) else 0)
st    = load_stations("역사_전국도시철도.xlsx")
_SCH  = load_schools("학교_전국.csv")
anch  = build_anchor_points(_SCH, shops)
cent  = shops.groupby(["시군구명","행정동명"])[["위도","경도"]].mean().reset_index()
row   = panel[(panel.시군구명=="부평구")&(panel.행정동명=="부평1동")].iloc[0]
g     = mkt[mkt.시군구코드==GU].iloc[0]

_loc_cache = {}
def loc_for(biz):
    key = tuple(C.ANCHOR.get(biz, C.DEFAULT_ANCHOR))
    if key not in _loc_cache:                       # 유인시설 집합이 같으면 재사용
        ref = [site_profile(r["위도"], r["경도"], st, anch, biz) for _, r in cent.iterrows()]
        d = {k: [x[k] for x in ref] for k in ["역세권_강도","유인시설_근접도","최근접역_거리m"]}
        d["유인시설_종류별"] = {t: [x["유인시설_종류별"].get(t, 0.0) for x in ref] for t in key}
        _loc_cache[key] = d
    return site_profile(LAT, LNG, st, anch, biz), _loc_cache[key]

N = len(panel); nones=[None]*N
base = {k: nones for k in ["pop_by_sex_age","same_biz_net_change_1y","station_strength",
        "anchor_strength","nearest_station_m","bus_stop_density","survival_3y",
        "closure_rate","avg_tenure","gugu_rent_per_sqm","gugu_spend_yoy"]}
base["pop_total"]=panel["총인구"].tolist()
base["workers"]=panel["종사자수"].tolist()
base["solo_household_share"]=panel["1인가구비중"].tolist()
base["inflow_daily"]=mkt["일평균_유입"].tolist()
base["inflow_by_hour"]=[[float(r[f"h{h:02d}"]) for h in range(24)] for _,r in mkt.iterrows()]
base["work_ratio"]=mkt["work_ratio"].tolist()
# 안정성은 시군구 해상도 (인천 11개 구). 코호트 표본이 얇아 행정동 단위는 불가능.
# (업종별로 루프 안에서 채운다 — stab_for)
# 임대료: 인천은 상권 9곳만 공표. 분석 지점(부평역)을 상권 '부평'에 명시적으로 연결한다.
_rent = incheon_areas(load_rent("임대료_소규모상가_R-ONE.csv"))
RENT_AREA = "부평"
base["gugu_rent_per_sqm"] = _rent["임대료_천원_㎡"].tolist()
RENT_VAL = float(_rent.loc[_rent["상권"]==RENT_AREA, "임대료_천원_㎡"].iloc[0])

rows=[]
for BIZ, tgt in C.CODE_NAME.items():
    if f"타겟_{tgt}" not in panel.columns: continue
    ref, dong_total = build_reference(shops, panel[["시군구명","행정동명","총인구"]], BIZ, 500)
    rp = radius_profile(LAT, LNG, shops, panel[["시군구명","행정동명","총인구"]], BIZ, 500,
                        dong_total_shops=dong_total)
    lp, lref = loc_for(BIZ)
    pn = dict(base)
    _ref, _s, _n = stab_for(BIZ)
    if _ref: pn.update(_ref)
    pn["target_pop"]=panel[f"타겟_{tgt}"].tolist(); pn["target_share"]=panel[f"타겟비중_{tgt}"].tolist()
    pn["n_same_biz"]=panel[tgt].tolist(); pn["same_biz_share"]=ref["반경_동종비중"].fillna(0).tolist()
    dong = {"pop_total":int(row["총인구"]),
            "target_pop":float(row[f"타겟_{tgt}"]),"target_share":float(row[f"타겟비중_{tgt}"]),
            "workers":float(row["종사자수"]),"solo_household_share":float(row["1인가구비중"]),
            "inflow_daily":float(g["일평균_유입"]),
            "inflow_by_hour":[float(g[f"h{h:02d}"]) for h in range(24)],
            "work_ratio":float(g["work_ratio"]),
            "gugu_spend_yoy":None,"same_biz_net_change_1y":None,
            "bus_stop_density":None,"gugu_rent_per_sqm":RENT_VAL,"rent_area":RENT_AREA,
            **({"survival_3y__gugu_sobun":float(_s["생존율_3년"]),
                "closure_rate__gugu_sobun":float(_s["최근3년_폐업률"]),
                "avg_tenure__gugu_sobun":float(_s["평균업력_년"])} if _s is not None else {})}
    site = Site.from_query(LAT, LNG, f"부평역 근처 {tgt}", dong_name="부평구 부평1동")
    cc = {"dong_sobun": 0, "dong_jung": 0,
          "gugu_sobun": _n, "incheon_avg": 9999}
    res = analyze(site, dong, pn, [], [], [], cc,
                  radius_profile=rp, radius_ref=ref.loc[ref["반경_동종점포"]>0,"반경_점포당수요"].dropna().tolist(),
                  loc_profile=lp, loc_ref=lref,
                  schools=load_schools("학교_전국.csv") if "_SCH" not in globals() else _SCH)
    for i in res["지표"]:
        if i["key"]=="market": i["fallback"]="gugu"; i["flags"].append("해상도_시군구")
    safe = re.sub(r'[/\\:*?"<>|]',"_",tgt).replace(" ","")
    json.dump(res, open(os.path.join(OUT,"업종별_상세JSON",f"full_{safe}.json"),"w"), ensure_ascii=False, indent=2)
    d = {i["key"]: i for i in res["지표"]}
    rows.append({"업종코드":BIZ,"업종명":tgt,"업종그룹":res["meta"]["업종그룹"],
        "시장성":d["market"]["score"],"고객성":d["customer"]["score"],
        "경쟁성":d["competition"]["score"],"입지성":d["location"]["score"],
        "안정성":d["stability"]["score"],
        "종합":res["종합"]["점수"],"병목":res["종합"]["병목_지표"],"충족률":res["종합"]["데이터_충족률"],
        "시간대_적합도":d["market"]["raw"].get("시간대_적합도"),
        "역세권_강도":d["location"]["raw"].get("역세권_강도"),
        "유인시설_근접도":d["location"]["raw"].get("유인시설_근접도"),
        "반경내_동종점포":d["competition"]["raw"]["동종점포수"],
        "점포당_잠재수요":d["competition"]["raw"].get("점포당_잠재수요"),
        "제도_진입장벽":(res["초보자_접근성"] or {}).get("제도_진입장벽"),
        "인허가":(res["초보자_접근성"] or {}).get("인허가"),
        "필요_면허":(res["초보자_접근성"] or {}).get("필요_면허")})
rows.sort(key=lambda x:-x["종합"])
with open(os.path.join(OUT,"부평역_업종별_적합도.csv"),"w",encoding="utf-8-sig",newline="") as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(f"\n{'업종':16s}{'시장':>6s}{'고객':>6s}{'경쟁':>6s}{'입지':>6s}{'안정':>6s}{'종합':>7s}  병목")
print("─"*66)
for x in rows[:6]+[None]+[r for r in rows if r['업종코드']=='R10406']+[None]+rows[-3:]:
    if x is None: print("  ⋮"); continue
    st_ = x['안정성'] if x['안정성'] is not None else float('nan')
    print(f"{x['업종명'][:15]:16s}{x['시장성']:6.1f}{x['고객성']:6.1f}{x['경쟁성']:6.1f}"
          f"{x['입지성']:6.1f}{st_:6.1f}{x['종합']:7.1f}  {x['병목']}")
print(f"\n충족률 {rows[0]['충족률']} · 유인시설 캐시 적중 {len(C.CODE_NAME)-len(_loc_cache)}/{len(C.CODE_NAME)}")
