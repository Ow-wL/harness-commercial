#!/usr/bin/env python3
"""
소진공 상가(상권)정보 → 인천 행정동 경쟁성 패널 구축

입력: 소상공인시장진흥공단_상가(상권)정보_인천_YYYYMM.csv  (UTF-8, 39컬럼)
출력: 인천_상가_정제.csv   중복 제거된 점포 원장
      패널_경쟁성.csv       행정동 158개 × 업종별 점포수

검증된 사실 (2026-06-30 기준 데이터):
  · 인코딩은 UTF-8 (CP949 아님). 소진공이 업소명 오류 때문에 UTF-8로 전환했다
  · 좌표가 이미 WGS84(경도/위도) → 좌표계 변환 불필요
  · 행정동코드/행정동명이 내장 → point-in-polygon 조인 불필요
  · 행정구역 개편(2026-07-01) 반영됨 — 제물포구/영종구/서해구/검단구
  · 업종코드 매칭률 100% (247개 소분류 중 246개 출현)

사용법:
  python etl_shops.py 인천_상가.csv
  python etl_shops.py 인천_상가.csv --site 37.4894 126.7246 --biz R10406 --radius 500
"""
import argparse, sys
import numpy as np
import pandas as pd

USECOLS = ["상가업소번호", "상호명", "상권업종대분류코드", "상권업종대분류명",
           "상권업종중분류코드", "상권업종소분류코드", "상권업종소분류명",
           "시도명", "시군구명", "행정동코드", "행정동명",
           "지번주소", "도로명주소", "경도", "위도"]

# ⚠ 라벨은 config.CODE_NAME을 단일 출처로 쓴다.
#   여기서 별도 라벨('생맥주' vs '생맥주 전문')을 쓰면 다른 ETL과 컬럼명이 어긋나
#   조인이 KeyError로 죽거나, 더 나쁘게는 조용히 NaN이 된다.
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import config as _C

# config.BIZ_GROUP이 선언한 업종 전체를 패널에 담는다.
# 일부만 담으면 그 밖의 업종을 질의할 때 KeyError로 죽는다.
PANEL_CODES = dict(_C.CODE_NAME)


def load(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="utf-8-sig", low_memory=False, usecols=USECOLS)
    n0 = len(df)

    # ── 중복 제거 ──────────────────────────────────────────────
    # 같은 상호·좌표·업종인데 상가업소번호만 다른 레코드가 존재한다.
    # 사업자 승계 등으로 신규 번호가 부여되고 구 레코드가 남은 것으로 보인다.
    # 상가업소번호에 등록연월(YYYYMM)이 들어 있어 최신본만 남긴다.
    df["등록연월"] = df["상가업소번호"].str.extract(r"(\d{6})")[0]
    df = (df.sort_values("등록연월")
            .drop_duplicates(subset=["상호명", "경도", "위도", "상권업종소분류코드"],
                             keep="last")
            .reset_index(drop=True))
    print(f"[load] {n0:,} → {len(df):,}행  (중복 {n0-len(df):,}건 제거, {(n0-len(df))/n0*100:.1f}%)")

    bad = df[["경도", "위도", "행정동코드", "상권업종소분류코드"]].isna().any(axis=1).sum()
    if bad:
        print(f"[load] ⚠ 필수 컬럼 결측 {bad:,}행 제외")
        df = df.dropna(subset=["경도", "위도", "행정동코드", "상권업종소분류코드"])

    # 좌표 sanity check — 인천 범위를 크게 벗어나면 좌표계를 의심해야 한다
    if not (123 < df["경도"].median() < 128 and 36 < df["위도"].median() < 39):
        print("[load] ⚠ 좌표가 WGS84 인천 범위를 벗어난다. 좌표계를 확인할 것.")
    return df


def haversine_m(lat0, lng0, lats, lngs):
    """기준점 1개 vs 배열. 벡터화되어 있어 13만 건도 즉시 처리된다."""
    R = 6_371_000.0
    p1, p2 = np.radians(lat0), np.radians(np.asarray(lats, dtype=float))
    dl = np.radians(np.asarray(lngs, dtype=float) - lng0)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def build_panel(df: pd.DataFrame) -> pd.DataFrame:
    """행정동 × 업종 점포수 패널. 모든 백분위 계산의 기준 모집단이 된다."""
    panel = (df.groupby(["행정동코드", "행정동명", "시군구명"])
               .size().rename("전체점포수").reset_index())
    for code, label in PANEL_CODES.items():
        s = df[df["상권업종소분류코드"] == code].groupby("행정동코드").size().rename(label)
        panel = panel.merge(s, on="행정동코드", how="left")
    panel[list(PANEL_CODES.values())] = panel[list(PANEL_CODES.values())].fillna(0).astype(int)
    return panel


def analyze_site(df, panel, lat, lng, biz_code, radius_m=500):
    """특정 좌표 반경 내 경쟁 현황. 스코어링 엔진의 score_competition 입력이 된다."""
    d = haversine_m(lat, lng, df["위도"], df["경도"])
    near = df[d <= radius_m].copy()
    near["거리m"] = d[d <= radius_m]
    same = near[near["상권업종소분류코드"] == biz_code]

    label = PANEL_CODES.get(biz_code, biz_code)
    print(f"\n[site] ({lat}, {lng}) 반경 {radius_m}m / 업종 {biz_code} {label}")
    print(f"  전체 점포 {len(near):,}개  ·  동종 {len(same)}개  ·  동종비중 {len(same)/max(len(near),1):.4f}")
    print(f"  걸친 행정동 {near['행정동명'].nunique()}개: {', '.join(sorted(near['행정동명'].unique()))}")

    if label in panel.columns:
        col = panel[label]
        print(f"  인천 전체 {label} {int(col.sum()):,}개 / 0개인 행정동 {(col==0).sum()}개 ({(col==0).mean()*100:.0f}%)")

    if len(same):
        print(f"\n  동종업종 목록 (가까운 순):")
        for _, r in same.sort_values("거리m").head(15).iterrows():
            print(f"    {r['거리m']:5.0f}m  {str(r['상호명'])[:24]:26s} {r['행정동명']}")
    else:
        print("  ⚠ 반경 내 동종업종 0개 — 미개척 상권. 경쟁성 점수를 산출하지 않는다.")
    return {"n_all": len(near), "n_same": len(same),
            "dongs": sorted(near["행정동명"].unique())}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--site", nargs=2, type=float, metavar=("LAT", "LNG"))
    ap.add_argument("--biz", default="R10406")
    ap.add_argument("--radius", type=int, default=500)
    ap.add_argument("--out-dir", default=".")
    a = ap.parse_args()

    df = load(a.csv)
    panel = build_panel(df)
    print(f"[panel] 행정동 {len(panel)}개 / 시군구 {panel['시군구명'].nunique()}개")

    df.to_csv(f"{a.out_dir}/인천_상가_정제.csv", index=False, encoding="utf-8-sig")
    panel.to_csv(f"{a.out_dir}/패널_경쟁성.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 인천_상가_정제.csv, 패널_경쟁성.csv 저장")

    if a.site:
        analyze_site(df, panel, a.site[0], a.site[1], a.biz, a.radius)
