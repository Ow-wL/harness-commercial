"""v0.3 vs v0.4 — 번화가 불리 점검 (인천 158개 동 중심점, 반경 500m)
각 동 중심점을 분석지점으로 보고 경쟁성 점수를 같은 규칙으로 계산해,
반경 전체 점포 수 상위 20%(번화가)와 하위 20%(한산)의 평균을 비교한다."""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "engine"))
OUT = os.path.join(HERE, "..", "05_분석결과")
os.chdir(os.path.join(HERE, "..", "07_가공데이터"))
import pandas as pd, numpy as np
from scipy.stats import spearmanr
import config as C
from scoring import pct_rank
from radius_demand import build_reference

shops = pd.read_csv("인천_상가_정제.csv", encoding="utf-8-sig", low_memory=False)
panel = pd.read_csv("패널_통합.csv", encoding="utf-8-sig")
rows = []
for biz, nm in C.CODE_NAME.items():
    ref, _ = build_reference(shops, panel[["시군구명", "행정동명", "총인구"]], biz, 500)
    has = ref[ref.반경_동종점포 > 0].copy()
    p2ref = has.반경_점포당수요.tolist(); p1ref = ref.반경_동종비중.fillna(0).tolist(); nref = ref.반경_전체점포.tolist()
    a = C.agg_alpha(biz)
    has["p2"] = [pct_rank(v, p2ref) for v in has.반경_점포당수요]
    has["p1"] = [pct_rank(v, p1ref, higher_is_better=False) for v in has.반경_동종비중]
    has["p3"] = [pct_rank(v, nref) for v in has.반경_전체점포]
    has["v03"] = (has.p2 * .5 + has.p1 * .3) / .8
    w3 = C.AGG_BASE_WEIGHT * a
    has["v04"] = (has.p2 * .5 + has.p1 * .3 + has.p3 * w3) / (.8 + w3)
    q80, q20 = has.반경_전체점포.quantile(.8), has.반경_전체점포.quantile(.2)
    busy, quiet = has[has.반경_전체점포 >= q80], has[has.반경_전체점포 <= q20]
    rows.append({"업종": nm, "유형": C.AGG_TYPE_LABEL[a], "동수": len(has),
                 "v03_번화가": busy.v03.mean(), "v03_한산": quiet.v03.mean(),
                 "v04_번화가": busy.v04.mean(), "v04_한산": quiet.v04.mean(),
                 "v03_상관": spearmanr(has.반경_전체점포, has.v03)[0],
                 "v04_상관": spearmanr(has.반경_전체점포, has.v04)[0]})
df = pd.DataFrame(rows).round(2)
df["v03_격차"] = (df.v03_번화가 - df.v03_한산).round(1); df["v04_격차"] = (df.v04_번화가 - df.v04_한산).round(1)
df.to_csv(os.path.join(OUT, "번화가_불리_점검_v03_v04.csv"), index=False, encoding="utf-8-sig")
pd.set_option("display.width", 200)
print(df.sort_values(["유형", "v04_격차"]).to_string(index=False))
print(df.groupby("유형")[["v03_격차", "v04_격차", "v03_상관", "v04_상관"]].mean().round(2))
