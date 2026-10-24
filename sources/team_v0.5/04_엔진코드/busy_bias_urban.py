"""
번화가 쏠림 (도시 지역, 거주인구 통제) — busy_bias_check.py의 보완
  상위·하위 20% 단순 비교는 '하위 20% = 강화·옹진 등 사람이 거의 없는 곳'이라 번화가 효과와 시골 효과가 섞인다.
  그래서 반경 거주인구 5천 명 이상 동(112곳)만 남기고, 반경 거주인구를 통제한 편상관(순위 기준)을 본다.
  편상관 > 0 : 같은 인구일 때 점포가 많은 곳(번화가)일수록 점수가 높다
실행: python3 busy_bias_urban.py v0.4 v0.5   (busy_bias_check.py를 각 버전으로 먼저 돌려 둘 것)
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "engine"))
os.chdir(os.path.join(HERE, "..", "07_가공데이터"))
import numpy as np, pandas as pd
from scipy.stats import spearmanr, rankdata
from etl_boundary import DongAreas
panel = pd.read_csv("패널_통합.csv", encoding="utf-8-sig")
shops = pd.read_csv("인천_상가_정제.csv", encoding="utf-8-sig", low_memory=False)
cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
A = DongAreas("경계_인천_행정동.geojson", panel)
pop = []
for _, c in cent.iterrows():
    w = A.weights(c["위도"], c["경도"]).merge(panel[["시군구명", "행정동명", "총인구"]])
    pop.append((w.w * w.총인구).sum())
cent["동"] = cent.시군구명 + " " + cent.행정동명; cent["반경거주"] = pop
def partial(x, y, z):
    rx, ry, rz = rankdata(x), rankdata(y), rankdata(z)
    ex = rx - np.polyval(np.polyfit(rz, rx, 1), rz); ey = ry - np.polyval(np.polyfit(rz, ry, 1), rz)
    return np.corrcoef(ex, ey)[0, 1]
out = []
for ver in sys.argv[1:]:
    d = pd.read_csv(f"../05_분석결과/중심점_158x29_점수_{ver}.csv", encoding="utf-8-sig").merge(cent[["동", "반경거주"]], on="동")
    u = d[d.반경거주 >= 5000]
    for (nm, ty), g in u.groupby(["업종", "유형"]):
        g = g.dropna(subset=["종합"])
        hi, lo = g[g.번화가 >= g.번화가.quantile(2/3)], g[g.번화가 <= g.번화가.quantile(1/3)]
        out.append({"버전": ver, "업종": nm, "유형": ty, "도시동수": len(g),
                    "편상관": partial(g.번화가, g.종합, g.반경거주), "격차_상위1/3-하위1/3": hi.종합.mean() - lo.종합.mean(),
                    **{f"편상관_{k}": partial(g.번화가, g[k], g.반경거주) for k in ["market", "customer", "competition", "location"] if g[k].notna().sum() > 20}})
R = pd.DataFrame(out)
R.to_csv("../05_분석결과/번화가_쏠림_도시지역_비교.csv", index=False, encoding="utf-8-sig")
print("도시 지역(반경 거주 5천 명 이상) 동 수:", (cent.반경거주 >= 5000).sum(), "/ 158")
print(R.groupby(["버전", "유형"])[["편상관", "격차_상위1/3-하위1/3", "편상관_market", "편상관_customer", "편상관_competition", "편상관_location"]].mean().round(2).to_string())
