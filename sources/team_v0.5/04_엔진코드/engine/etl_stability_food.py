#!/usr/bin/env python3
"""
음식 업종 인허가(일반음식점·휴게음식점, 인천) → 업종별 안정성 패널

입력 (공공데이터포털, 행정안전부 인허가, CP949, 인천 추출본)
  식품_일반음식점_인천광역시.csv   108,872건
  식품_휴게음식점_인천광역시.csv    29,229건

출력: 패널_안정성_음식.csv — 엔진 업종코드 × 시군구 × (생존율·폐업률·업력)

생존율 계산은 PC방과 같은 etl_stability.survival/build 를 그대로 쓴다
(censoring 보정, '영업/정상'·'휴업' 외 상태는 모두 종료).

업종 매핑 원칙
  인허가 데이터의 '업태구분명'은 소진공 업종 소분류보다 거칠다. 그래서
  (1) 상호에 업종이 드러나는 경우(피자·버거·치킨·토스트·빙수·제과)를 먼저 상호로 분류하고
  (2) 나머지를 업태구분명으로 분류한다. 한 업소는 한 업종에만 들어간다.
  어디에도 안 맞는 업태(한식 외 '기타', 뷔페, 출장조리 등)는 버린다.
  ⚠ 빵/도넛은 '제과점영업' 파일이 없어 휴게음식점의 '과자점' 업태 + 제과 상호로 대신한다(근사).
"""
from __future__ import annotations
import re, sys
import numpy as np
import pandas as pd
import etl_stability as ES

# (1) 상호 키워드 — 위에서부터 먼저 맞는 것
NAME_RULES = [
    ("I21003", r"피자|pizza"),
    ("I21004", r"버거|burger|맥도날드|롯데리아|맘스터치|KFC"),
    ("I21006", r"치킨|통닭|chicken"),
    ("I21005", r"토스트|샌드위치|샐러드|서브웨이|이삭"),
    ("I21008", r"빙수|아이스크림|배스킨|젤라또|설빙"),
    ("I21001", r"베이커리|제과|도넛|도너츠|파리바게|뚜레쥬르|브레드|빵"),
]
# (2) 업태구분명 — (파일, 업태) → 업종코드
UPTAE_RULES = {
    ("일반", "한식"): "I20101",
    ("일반", "중국식"): "I20201",
    ("일반", "일식"): "I20301", ("일반", "횟집"): "I20301",
    ("일반", "경양식"): "I20401", ("일반", "패밀리레스트랑"): "I20401",
    ("일반", "통닭(치킨)"): "I21006",
    ("일반", "호프/통닭"): "I21103",
    ("일반", "정종/대포집/소주방"): "I21104", ("일반", "감성주점"): "I21104",
    ("일반", "분식"): "I21007", ("일반", "김밥(도시락)"): "I21007",
    ("일반", "패스트푸드"): "I21004", ("휴게", "패스트푸드"): "I21004",
    ("일반", "까페"): "I21201", ("휴게", "커피숍"): "I21201",
    ("휴게", "아이스크림"): "I21008",
    ("휴게", "과자점"): "I21001",
}
FOOD_CODES = sorted(set(UPTAE_RULES.values()) | {c for c, _ in NAME_RULES})


def _load(path: str, kind: str) -> pd.DataFrame:
    raw = pd.read_csv(path, encoding="cp949", low_memory=False)
    if "인허가취소일자" not in raw.columns:      # 음식점 파일에는 이 열이 없다
        raw["인허가취소일자"] = np.nan
    import os, tempfile
    fd, tmp = tempfile.mkstemp(suffix=".csv"); os.close(fd)
    try:
        raw.to_csv(tmp, index=False, encoding="cp949", errors="replace")
        df = ES.load(tmp)
    finally:
        os.remove(tmp)
    df["파일"] = kind
    return df


def classify(df: pd.DataFrame) -> pd.Series:
    name = df["사업장명"].fillna("").astype(str)
    out = pd.Series(None, index=df.index, dtype=object)
    for code, pat in NAME_RULES:
        hit = out.isna() & name.str.contains(pat, case=False, regex=True)
        out[hit] = code
    key = list(zip(df["파일"], df["업태구분명"].fillna("")))
    by_uptae = pd.Series([UPTAE_RULES.get(k) for k in key], index=df.index)
    out = out.fillna(by_uptae)
    return out


def build_food(general: str, rest: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    df = pd.concat([_load(general, "일반"), _load(rest, "휴게")], ignore_index=True)
    df["업종코드"] = classify(df)
    mapped = df.dropna(subset=["업종코드"])
    asof = df["종료일"].max()
    rows = []
    for code, g in mapped.groupby("업종코드"):
        p = ES.build(g)
        p.insert(0, "업종코드", code)
        rows.append(p)
    panel = pd.concat(rows, ignore_index=True)
    coverage = (df.assign(매핑=df["업종코드"].notna())
                  .groupby(["파일", "업태구분명"])["매핑"].agg(["size", "mean"])
                  .sort_values("size", ascending=False))
    print(f"[food] 전체 {len(df):,}건 중 매핑 {len(mapped):,}건 ({len(mapped)/len(df)*100:.1f}%), "
          f"관측기준일 {asof.date()}")
    return panel, coverage


if __name__ == "__main__":
    g = sys.argv[1] if len(sys.argv) > 1 else "permits/일반음식점_인천.csv"
    r = sys.argv[2] if len(sys.argv) > 2 else "permits/휴게음식점_인천.csv"
    panel, cov = build_food(g, r)
    panel.to_csv("패널_안정성_음식.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_안정성_음식.csv ({len(panel)}행)")
