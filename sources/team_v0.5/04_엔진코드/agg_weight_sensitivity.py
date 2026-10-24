"""집적도 가중치(AGG_BASE_WEIGHT)를 0~0.6으로 바꿨을 때 부평역 29개 업종 순위가 어떻게 바뀌는가"""
import json, glob, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "engine")); import config as C
OUT = os.path.join(HERE, "..", "05_분석결과")
from scipy.stats import spearmanr
K = C.PERSPECTIVES
rows = []
for p in glob.glob(os.path.join(OUT, "업종별_상세JSON", "full_*.json")):
    d = json.load(open(p)); m = d["meta"]
    s = {i["key"]: i["score"] for i in d["지표"]}
    bd = {b["key"]: b["score"] for b in [i for i in d["지표"] if i["key"] == "competition"][0]["breakdown"]}
    rows.append((m["업종"], m["업종그룹"], s, bd, C.agg_alpha(m["업종코드"])))
def total(w3):
    out = {}
    for nm, g, s, bd, a in rows:
        parts = {"p2": .5, "p1": .3}; 
        if a > 0 and bd.get("p3") is not None: parts["p3"] = w3 * a
        comp = sum(bd[k] * w for k, w in parts.items()) / sum(parts.values())
        ss = dict(s, competition=comp)
        W = C.WEIGHTS[g]; av = [k for k in K if ss[k] is not None]
        out[nm] = sum(ss[k] * W[k] for k in av) / sum(W[k] for k in av)
    return out
base = total(C.AGG_BASE_WEIGHT); v03 = total(0.0); names = sorted(base)
rk = lambda t: sorted(names, key=lambda n: -t[n])
print("w3   ρ(기본값 0.35 대비)  ρ(집적도 없음 대비)  PC방순위  상위5")
res = {}
for w3 in [0, .1, .2, .35, .5, .6]:
    t = total(w3)
    r1 = spearmanr([t[n] for n in names], [base[n] for n in names])[0]
    r0 = spearmanr([t[n] for n in names], [v03[n] for n in names])[0]
    top = rk(t)[:5]; pc = rk(t).index("PC방") + 1
    res[w3] = dict(rho_v04=round(r1, 3), rho_v03=round(r0, 3), pc=pc, top5=top)
    print(f"{w3:.2f}  {r1:.3f}       {r0:.3f}       {pc:>3d}     {top}")
json.dump(res, open(os.path.join(OUT, "집적도가중치_민감도.json"), "w"), ensure_ascii=False, indent=1)
