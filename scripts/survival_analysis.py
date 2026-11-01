"""
12-24 사후검증 분석 — survival_repro.py 가 만든 중심점 점수로 불확실성·베이스라인·코호트 민감도를 계산한다.

  python scripts/survival_analysis.py <엔진> [--boot 2000]      (v0_5 | v0_5_1)
  출력: docs/validation/survival_<엔진>.json

결과는 과거 개업 코호트와의 **사후 연관**이지 예측 성능이 아니다(입력 자료가 코호트보다 뒤 시점이다).
표본 규칙(반경 500m, 개업 10건 이상, 동 15곳 이상, 안정성 제외 4관점)은 팀 survival_validation.py 와 같다.
블록 부트스트랩은 2km 격자 단위 — 반경이 겹치는 이웃 동이 같이 뽑히게 해 독립 표본처럼 세지 않는다.
인허가 읽기·업종 분류·좌표 변환은 작업 사본의 팀 모듈을 그대로 쓴다.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from scipy.stats import spearmanr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = {"v0_5": "v0.5", "v0_5_1": "v0.5.1"}
RADIUS, MIN_OPEN, MIN_AREAS, BLOCK_M, SEED = 500, 10, 15, 2000, 20261101
PERSPECTIVES = ["market", "customer", "competition", "location"]
KX, KY = np.cos(np.radians(37.45)) * 111320, 110540


def rho(a, b) -> float | None:
    a, b = np.asarray(a, float), np.asarray(b, float)
    ok = ~(np.isnan(a) | np.isnan(b))
    if ok.sum() < 3 or np.ptp(a[ok]) == 0 or np.ptp(b[ok]) == 0:
        return None
    return float(spearmanr(a[ok], b[ok])[0])


def load_cohort(F, to_wgs84, raw: str) -> pd.DataFrame:
    df = pd.concat([F._load(os.path.join(raw, "식품_일반음식점_인천.csv"), "일반"),
                    F._load(os.path.join(raw, "식품_휴게음식점_인천.csv"), "휴게")], ignore_index=True)
    df["업종코드"] = F.classify(df)
    x = pd.to_numeric(df["좌표정보(X)"], errors="coerce")
    y = pd.to_numeric(df["좌표정보(Y)"], errors="coerce")
    df["lat"], df["lng"] = to_wgs84(x, y)
    asof = df["종료일"].max()
    c = df[df.업종코드.notna() & df.lat.between(37, 38) & (df.인허가일 >= "2013-01-01")
           & (df.인허가일 <= asof - pd.Timedelta(days=1095))].copy()
    c["생존3년"] = ~(c.종료여부 & (c.생존일수 < 1095))
    c["종료일불명"] = c.종료여부 & c.생존일수.isna()
    c.attrs["asof"] = str(asof.date())
    return c


def outcomes(c: pd.DataFrame, cent: pd.DataFrame, mask=None, drop_unknown=False) -> pd.DataFrame:
    """동 중심점 × 업종의 실제 3년 생존율 — 팀 스크립트와 같은 집계."""
    use = c if mask is None else c[mask]
    if drop_unknown:
        use = use[~use.종료일불명]
    tree = cKDTree(np.c_[use.lng.values * KX, use.lat.values * KY])
    rows = []
    for _, r in cent.iterrows():
        sub = use.iloc[tree.query_ball_point([r["경도"] * KX, r["위도"] * KY], RADIUS)]
        for code, g in sub.groupby("업종코드"):
            rows.append({"동": r["동"], "업종코드": code, "개업수": len(g), "실제": g.생존3년.mean()})
    sv = pd.DataFrame(rows)
    return sv[sv.개업수 >= MIN_OPEN]


def per_biz(m: pd.DataFrame, col: str) -> dict[str, float]:
    out = {}
    for cd, g in m.groupby("업종코드"):
        if len(g) >= MIN_AREAS:
            v = rho(g[col], g["실제"])
            if v is not None:
                out[cd] = v
    return out


def ci(values: list[float]) -> list[float] | None:
    v = np.array([x for x in values if x is not None and not np.isnan(x)])
    return None if len(v) < 100 else [round(float(np.percentile(v, 2.5)), 3), round(float(np.percentile(v, 97.5)), 3)]


def bootstrap(m: pd.DataFrame, n_boot: int, block_col: str | None) -> dict:
    """같은 재표본을 전 업종에 함께 적용해 업종 평균 ρ 의 구간도 낸다. block_col 없으면 동 단위."""
    rng = np.random.default_rng(SEED)
    key = block_col or "동"
    groups = {k: g for k, g in m.groupby(key)}
    keys = list(groups)
    base = per_biz(m, "점수")
    per: dict[str, list[float]] = {cd: [] for cd in base}
    means: list[float] = []
    for _ in range(n_boot):
        picked = rng.integers(0, len(keys), len(keys))
        s = pd.concat([groups[keys[i]] for i in picked], ignore_index=True)
        vals = []
        for cd in base:
            g = s[s.업종코드 == cd]
            v = rho(g["점수"], g["실제"]) if len(g) >= 5 else None
            per[cd].append(np.nan if v is None else v)
            if v is not None:
                vals.append(v)
        if vals:
            means.append(float(np.mean(vals)))
    return {"업종평균": ci(means), "업종별": {cd: ci(v) for cd, v in per.items()}, "블록수": len(keys)}


def bootstrap_models(m: pd.DataFrame, columns: dict[str, str], n_boot: int, block_col: str) -> dict:
    """같은 재표본으로 모델마다 업종 평균 ρ 를 내고, 4관점(점수)과의 차이 구간을 함께 낸다."""
    rng = np.random.default_rng(SEED)
    groups = {k: g for k, g in m.groupby(block_col)}
    keys = list(groups)
    codes = list(per_biz(m, "점수"))
    means: dict[str, list[float]] = {label: [] for label in columns}
    diffs: dict[str, list[float]] = {label: [] for label in columns}
    for _ in range(n_boot):
        s = pd.concat([groups[keys[i]] for i in rng.integers(0, len(keys), len(keys))], ignore_index=True)
        by = {cd: s[s.업종코드 == cd] for cd in codes}
        base = [rho(g["점수"], g["실제"]) if len(g) >= 5 else None for g in by.values()]
        for label, col in columns.items():
            vals = [rho(g[col], g["실제"]) if len(g) >= 5 else None for g in by.values()]
            pairs = [(v, b) for v, b in zip(vals, base) if v is not None and b is not None]
            if pairs:
                means[label].append(float(np.mean([v for v, _ in pairs])))
                diffs[label].append(float(np.mean([v - b for v, b in pairs])))
    return {label: {"구간": ci(means[label]), "4관점과의 차이 구간": ci(diffs[label])} for label in columns}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("engine", choices=list(LABEL))
    ap.add_argument("--boot", type=int, default=2000)
    a = ap.parse_args()
    base = os.path.join(ROOT, ".gstack", "validation-12-24", a.engine)
    ver = LABEL[a.engine]
    sys.dont_write_bytecode = True
    sys.path.insert(0, os.path.join(base, "04_엔진코드", "engine"))
    import config as C
    import etl_stability_food as F
    from coord5174 import to_wgs84

    c = load_cohort(F, to_wgs84, os.path.join(base, "08_원본_인허가"))
    shops = pd.read_csv(os.path.join(base, "07_가공데이터", "인천_상가_정제.csv"), encoding="utf-8-sig", low_memory=False)
    cent = shops.groupby(["시군구명", "행정동명"])[["위도", "경도"]].mean().reset_index()
    cent["동"] = cent.시군구명 + " " + cent.행정동명
    panel = pd.read_csv(os.path.join(base, "07_가공데이터", "패널_통합.csv"), encoding="utf-8-sig", dtype={"행정동코드": str})
    panel["동"] = panel.시군구명 + " " + panel.행정동명
    scores = pd.read_csv(os.path.join(base, "05_분석결과", f"중심점_158x29_점수_{ver}.csv"), encoding="utf-8-sig")
    code_of = {n: cd for cd, n in C.CODE_NAME.items()}
    scores["업종코드"] = scores.업종.map(code_of)

    def composite(row, keys):
        w = C.WEIGHTS[C.group_of(row.업종코드)]
        ks = [q for q in keys if pd.notna(row[q])]
        return sum(row[q] * w[q] for q in ks) / sum(w[q] for q in ks) if ks else np.nan

    scores["점수"] = scores.apply(lambda r: composite(r, PERSPECTIVES), axis=1)
    for drop in PERSPECTIVES:
        scores[f"제외_{drop}"] = scores.apply(lambda r: composite(r, [k for k in PERSPECTIVES if k != drop]), axis=1)
    scores = scores.merge(panel[["동", "총인구", "종사자수"]], on="동", how="left")
    scores = scores.merge(cent[["동", "위도", "경도"]], on="동", how="left")
    scores["블록"] = ((scores.경도 * KX // BLOCK_M).astype(int).astype(str) + "_"
                    + (scores.위도 * KY // BLOCK_M).astype(int).astype(str))
    scores["구"] = scores.동.str.split().str[0]

    sv = outcomes(c, cent)
    m = scores.merge(sv, on=["동", "업종코드"])
    name = C.CODE_NAME
    biz_base = per_biz(m, "점수")
    named = lambda d: {name[k]: round(v, 3) for k, v in d.items()}
    mean = lambda d: round(float(np.mean(list(d.values()))), 3) if d else None

    columns = {"4관점(기준)": "점수", "5관점 종합(안정성 포함, 정답 누출)": "종합", "반경 점포 수(번화가)": "번화가",
               "동 총인구": "총인구", "동 종사자수": "종사자수"}
    columns.update({f"단일 {k}": k for k in PERSPECTIVES})
    columns.update({f"{k} 제외 3관점": f"제외_{k}" for k in PERSPECTIVES})
    models = {label: {"업종평균": mean(d := per_biz(m, col)), "업종별": named(d)} for label, col in columns.items()}
    for label, v in bootstrap_models(m, columns, a.boot, "블록").items():
        models[label].update(v)

    # 코호트 민감도 — 표본 규칙은 같고 개업 시기·종료일 불명 처리만 바꾼다
    cohorts = {}
    for label, mask, drop in (("2013~2017 개업", c.인허가일 < "2018-01-01", False),
                              ("2018 이후 개업", c.인허가일 >= "2018-01-01", False),
                              ("종료일 불명 제외", None, True)):
        d = per_biz(scores.merge(outcomes(c, cent, mask, drop), on=["동", "업종코드"]), "점수")
        cohorts[label] = {"업종평균": mean(d), "업종수": len(d), "업종별": named(d)}

    # 공간 겹침 — 이웃 동의 500m 반경이 얼마나 겹치는가
    xy = np.c_[cent.경도 * KX, cent.위도 * KY]
    near = cKDTree(xy).query(xy, k=2)[0][:, 1]
    tree = cKDTree(np.c_[c.lng.values * KX, c.lat.values * KY])
    hits = np.concatenate([np.array(h, dtype=int) for h in tree.query_ball_point(xy, RADIUS)])
    counted = np.bincount(hits, minlength=len(c))

    boot_dong = bootstrap(m, a.boot, None)
    boot_block = bootstrap(m, a.boot, "블록")
    boot_gu = bootstrap(m, a.boot, "구")
    sample = m[m.업종코드.isin(biz_base)].groupby("업종코드").agg(동수=("동", "size"), 개업수합=("개업수", "sum"),
                                                                 개업수중앙값=("개업수", "median"), 생존율평균=("실제", "mean"))
    per_table = [{"업종": name[cd], "동수": int(s.동수), "개업수합(겹침 포함)": int(s.개업수합), "동별 개업수 중앙값": float(s.개업수중앙값),
                  "동 평균 생존율": round(float(s.생존율평균), 3), "ρ": round(biz_base[cd], 3),
                  "구간_동": boot_dong["업종별"][cd], "구간_2km블록": boot_block["업종별"][cd]}
                 for cd, s in sample.iterrows()]

    out = {"엔진": ver, "관측기준일": c.attrs["asof"], "코호트_건수": len(c), "종료일불명_건수": int(c.종료일불명.sum()),
           "규칙": {"반경m": RADIUS, "최소개업": MIN_OPEN, "최소동": MIN_AREAS, "블록m": BLOCK_M, "부트스트랩": a.boot, "시드": SEED},
           "업종평균ρ": mean(biz_base), "구간": {"동": boot_dong["업종평균"], "2km블록": boot_block["업종평균"], "구": boot_gu["업종평균"]},
           "블록수": {"동": boot_dong["블록수"], "2km블록": boot_block["블록수"], "구": boot_gu["블록수"]},
           "업종별": per_table, "모델비교": models, "코호트민감도": cohorts,
           "공간겹침": {"이웃 동 중심점 거리 중앙값m": round(float(np.median(near))), "1km 안에 이웃이 있는 동 비율": round(float((near < 2 * RADIUS).mean()), 3),
                    "반경에 든 개업 중 2개 동 이상에 세인 비율": round(float((counted >= 2).sum() / max((counted >= 1).sum(), 1)), 3)}}
    os.makedirs(os.path.join(ROOT, "docs", "validation"), exist_ok=True)
    path = os.path.join(ROOT, "docs", "validation", f"survival_{a.engine}.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(json.dumps({k: out[k] for k in ("엔진", "관측기준일", "코호트_건수", "종료일불명_건수", "업종평균ρ", "구간", "블록수", "공간겹침")}, ensure_ascii=False, indent=1))
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
