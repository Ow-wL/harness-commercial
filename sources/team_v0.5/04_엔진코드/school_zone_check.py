"""학교 근처는 PC방에게 플러스인가? (v0.5 입지성 학교구역 제외의 근거)
영업 중 PC방 vs 영업 중 커피숍(학교 규제 없음)의 '가장 가까운 초·중·고까지 거리', 개업 거리별 3년 생존율"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "engine"))
import numpy as np, pandas as pd
import etl_stability as ES
from coord5174 import to_wgs84
RAW, DATA = os.path.join(HERE, "..", "08_원본_인허가"), os.path.join(HERE, "..", "07_가공데이터")


def nearest_m(lat, lon, slat, slon):
    la, lo = np.radians(lat)[:, None], np.radians(lon)[:, None]
    sla, slo = np.radians(slat)[None, :], np.radians(slon)[None, :]
    a = np.sin((sla - la) / 2)**2 + np.cos(la) * np.cos(sla) * np.sin((slo - lo) / 2)**2
    return (2 * 6371000 * np.arcsin(np.sqrt(a))).min(axis=1)


def with_ll(df):
    x = pd.to_numeric(df["좌표정보(X)"], errors="coerce"); y = pd.to_numeric(df["좌표정보(Y)"], errors="coerce")
    df["lat"], df["lon"] = to_wgs84(x, y)
    return df[df.lat.between(37, 38) & df.lon.between(126, 127)]


s = pd.read_csv(os.path.join(DATA, "학교_전국.csv"), encoding="cp949", low_memory=False)
s = s[s["소재지도로명주소"].astype(str).str.startswith("인천") & (s["운영상태"] == "운영") & s["학교급구분"].isin(["초등학교", "중학교", "고등학교"])]
slat, slon = s["위도"].astype(float).values, s["경도"].astype(float).values
pc = with_ll(ES.load(os.path.join(RAW, "문화_인터넷컴퓨터게임시설제공업_전국.csv")))
cafe = pd.read_csv(os.path.join(RAW, "식품_휴게음식점_인천.csv"), encoding="cp949", low_memory=False)
cafe = with_ll(cafe[(cafe["업태구분명"] == "커피숍") & (cafe["영업상태명"] == "영업/정상")].copy())
alive = pc[pc["영업상태명"].isin(["영업/정상", "휴업"])]
rows = []
for nm, d in [("PC방(영업 중)", alive), ("PC방(2013년 이후 개업, 전체)", pc[pc.인허가일 >= "2013-01-01"]), ("커피숍(영업 중, 비교군)", cafe)]:
    dist = nearest_m(d.lat.values, d.lon.values, slat, slon)
    rows.append({"대상": nm, "수": len(d), "200m 이내(%)": round((dist <= 200).mean() * 100, 1),
                 "200~500m(%)": round(((dist > 200) & (dist <= 500)).mean() * 100, 1), "가장 가까운 학교 중앙값(m)": int(np.median(dist))})
print(pd.DataFrame(rows).to_string(index=False))
asof = pc.종료일.max()
c = pc[(pc.인허가일 >= "2013-01-01") & (pc.인허가일 <= asof - pd.Timedelta(days=1095))].copy()
c["d"] = nearest_m(c.lat.values, c.lon.values, slat, slon)
c["생존3년"] = ~(c.종료여부 & (c.생존일수 < 1095))
g = c.groupby(pd.cut(c.d, [0, 200, 500, 1e9], labels=["200m 이내", "200~500m", "500m 밖"]), observed=True).생존3년.agg(["size", "mean"])
g["mean"] = (g["mean"] * 100).round(1); print(g.rename(columns={"size": "표본", "mean": "3년 생존율(%)"}))
