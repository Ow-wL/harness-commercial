"""
사후 검증 — 점수가 높은 곳의 음식점이 실제로 더 오래 살아남았나?

방법
  busy_bias_check.py가 만든 '158개 동 중심점 × 29개 업종' 점수를 쓴다.
  각 중심점 반경 500m 안에서 2013년 이후 개업한 음식점(인허가)의 실제 3년 생존율을 업종별로 구하고,
  점수와의 순위상관(ρ)을 업종별로 낸다.
  ⚠ 안정성 관점은 같은 인허가 자료로 만든 구 단위 생존율이라 정답을 미리 본 셈이 된다.
    그래서 안정성을 뺀 4관점 종합으로 검증한다.
실행
  python3 survival_validation.py v0.4 v0.5      (05_분석결과/중심점_158x29_점수_<버전>.csv 필요)
"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "engine"))
import numpy as np, pandas as pd, warnings; warnings.filterwarnings("ignore")
from scipy.spatial import cKDTree
from scipy.stats import spearmanr
import config as C, etl_stability_food as F
from coord5174 import to_wgs84
RAW, DATA, OUT = (os.path.join(HERE, "..", d) for d in ("08_원본_인허가", "07_가공데이터", "05_분석결과"))
MIN_OPEN, MIN_AREAS = 10, 15

df = pd.concat([F._load(os.path.join(RAW, "식품_일반음식점_인천.csv"), "일반"),
                F._load(os.path.join(RAW, "식품_휴게음식점_인천.csv"), "휴게")], ignore_index=True)
df["업종코드"] = F.classify(df)
x = pd.to_numeric(df["좌표정보(X)"], errors="coerce"); y = pd.to_numeric(df["좌표정보(Y)"], errors="coerce")
df["lat"], df["lng"] = to_wgs84(x, y)
asof = df["종료일"].max()
c = df[df.업종코드.notna() & df.lat.between(37, 38) & (df.인허가일 >= "2013-01-01")
       & (df.인허가일 <= asof - pd.Timedelta(days=1095))].copy()
c["생존3년"] = ~(c.종료여부 & (c.생존일수 < 1095))
shops = pd.read_csv(os.path.join(DATA, "인천_상가_정제.csv"), encoding="utf-8-sig", low_memory=False)
cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
cent["동"] = cent.시군구명 + " " + cent.행정동명
k = np.cos(np.radians(37.45))
tree = cKDTree(np.c_[c.lng.values * k * 111320, c.lat.values * 110540])
rows = []
for _, r in cent.iterrows():
    sub = c.iloc[tree.query_ball_point([r["경도"] * k * 111320, r["위도"] * 110540], 500)]
    for code, g in sub.groupby("업종코드"):
        rows.append({"동": r["동"], "업종코드": code, "개업수": len(g), "실제_3년생존율": g.생존3년.mean()})
sv = pd.DataFrame(rows); sv = sv[sv.개업수 >= MIN_OPEN]
code_of = {n: cd for cd, n in C.CODE_NAME.items()}
res = []
for ver in sys.argv[1:] or ["v0.5"]:
    d = pd.read_csv(os.path.join(OUT, f"중심점_158x29_점수_{ver}.csv"), encoding="utf-8-sig")
    d["업종코드"] = d.업종.map(code_of)
    def c4(r):
        W = C.WEIGHTS[C.group_of(r.업종코드)]; ks = [q for q in ["market", "customer", "competition", "location"] if pd.notna(r[q])]
        return sum(r[q] * W[q] for q in ks) / sum(W[q] for q in ks)
    d["종합_안정성제외"] = d.apply(c4, axis=1)
    m = d.merge(sv, on=["동", "업종코드"])
    for cd, g in m.groupby("업종코드"):
        if len(g) >= MIN_AREAS:
            res.append({"버전": ver, "업종": C.CODE_NAME[cd], "동수": len(g),
                        "ρ(점수, 실제 3년 생존율)": round(spearmanr(g.종합_안정성제외, g.실제_3년생존율)[0], 2)})
R = pd.DataFrame(res)
R.to_csv(os.path.join(OUT, "사후검증_점수_vs_실제생존.csv"), index=False, encoding="utf-8-sig")
print(R.pivot(index="업종", columns="버전", values="ρ(점수, 실제 3년 생존율)").to_string())
print("업종 평균 ρ:", R.groupby("버전")["ρ(점수, 실제 3년 생존율)"].mean().round(3).to_dict())
