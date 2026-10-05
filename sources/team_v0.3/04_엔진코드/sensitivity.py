"""가중치 민감도 분석 — 부평역 29개 업종. 관점 점수는 고정하고 가중치만 흔든다."""
import json, glob, os, numpy as np, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "engine"))
OUT = os.path.join(HERE, "..", "05_분석결과")
import config as C
K=["market","customer","competition","location","stability"]
inds={}
for p in glob.glob(os.path.join(OUT, "업종별_상세JSON", "full_*.json")):
    d=json.load(open(p)); m=d["meta"]
    inds[m["업종"]]={"g":m["업종그룹"],"s":{i["key"]:i["score"] for i in d["지표"]},"base":d["종합"]["점수"]}
names=sorted(inds)
def comp(ind,w,drop=()):
    s=ind["s"]; num=den=0
    for k in K:
        if s[k] is None or k in drop: continue
        num+=s[k]*w[k]; den+=w[k]
    return num/den
def base_w(ind): return {k:C.WEIGHTS[ind["g"]][k] for k in K}
def ranks(v): 
    o=np.argsort(-np.array(v)); r=np.empty(len(v),int); r[o]=np.arange(1,len(v)+1); return r
def spearman(a,b): 
    return float(np.corrcoef(ranks(a),ranks(b))[0,1])
def run(drop=()):
    base=[comp(inds[n],base_w(inds[n]),drop) for n in names]
    br=ranks(base)
    out={"base":dict(zip(names,base))}
    rng=np.random.default_rng(42)
    for delta in (0.2,0.5):
        rho=[];top3=[];top5=[];pc=[]
        for _ in range(5000):
            v=[]
            for n in names:
                w=base_w(inds[n]); w={k:w[k]*rng.uniform(1-delta,1+delta) for k in K}
                v.append(comp(inds[n],w,drop))
            r=ranks(v); rho.append(spearman(base,v))
            top3.append(len(set(np.argsort(-np.array(v))[:3])&set(np.argsort(-np.array(base))[:3])))
            top5.append(len(set(np.argsort(-np.array(v))[:5])&set(np.argsort(-np.array(base))[:5])))
            pc.append(r[names.index("PC방")])
        out[delta]=dict(rho_mean=float(np.mean(rho)),rho_p5=float(np.percentile(rho,5)),
            top3=float(np.mean(top3)),top5=float(np.mean(top5)),
            pc_rank_base=int(br[names.index("PC방")]),pc_p5=int(np.percentile(pc,5)),pc_p95=int(np.percentile(pc,95)),
            pc_min=int(min(pc)),pc_max=int(max(pc)))
    # equal weights
    eq=[comp(inds[n],{k:0.2 for k in K},drop) for n in names]
    out["equal_rho"]=spearman(base,eq); out["equal_pc_rank"]=int(ranks(eq)[names.index("PC방")])
    out["equal_top5_overlap"]=len(set(np.argsort(-np.array(eq))[:5])&set(np.argsort(-np.array(base))[:5]))
    # drop-one
    d1={}
    for k in K:
        if k in drop: continue
        v=[comp(inds[n],base_w(inds[n]),tuple(drop)+(k,)) for n in names]
        d1[k]=dict(rho=spearman(base,v),pc_rank=int(ranks(v)[names.index("PC방")]))
    out["drop_one"]=d1
    out["top5_base"]=[names[i] for i in np.argsort(-np.array(base))[:5]]
    return out
res={"A_전체(안정성은 13개 업종)":run(), "B_4관점(안정성 제외, 업종간 동일조건)":run(("stability",))}
json.dump(res,open(os.path.join(OUT,"sensitivity_result.json"),"w"),ensure_ascii=False,indent=1)
for k,v in res.items():
    print("\n==",k); print("top5:",v["top5_base"])
    for dl in (0.2,0.5):
        x=v[dl]; print(f" ±{int(dl*100)}% : ρ평균 {x['rho_mean']:.3f} (하위5% {x['rho_p5']:.3f}) top3유지 {x['top3']:.2f}/3 top5유지 {x['top5']:.2f}/5 | PC방 기준 {x['pc_rank_base']}위 → 90%구간 {x['pc_p5']}~{x['pc_p95']}위 (최소~최대 {x['pc_min']}~{x['pc_max']})")
    print(f" 동일가중: ρ {v['equal_rho']:.3f}, top5 겹침 {v['equal_top5_overlap']}/5, PC방 {v['equal_pc_rank']}위")
    print(" 관점 하나 제외:",{k:(round(d['rho'],3),d['pc_rank']) for k,d in v['drop_one'].items()})
