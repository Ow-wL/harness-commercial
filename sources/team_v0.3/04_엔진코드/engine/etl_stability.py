#!/usr/bin/env python3
"""
지방행정 인허가 데이터 → 안정성 패널 (코호트 생존율 · 폐업률)

입력: 문화_인터넷컴퓨터게임시설제공업.csv  (file.localdata.go.kr, CP949, 51컬럼)
출력: 패널_안정성.csv  — 시군구 × 생존율/폐업률/평균업력

확인된 사실 (2026-05-07 갱신본)
  · 인코딩 CP949
  · 좌표계 EPSG:5174 "보정계수 안 들어간 Bessel 중부원점TM" (제공처 명시)
    → 다만 이 ETL은 좌표를 쓰지 않는다. 주소 문자열로 시군구를 뽑는다.
  · 주소에 2026-07 행정구역 개편이 반영되어 있다 (서해구·제물포구·검단구·영종구)
  · 인천 4,705건, 인허가 1999~2026

🔴 공간 해상도를 시군구로 두는 이유
  인천 PC방 인허가가 4,705건이고 행정동은 158개다. 동당 30건이지만
  '연도별 코호트'로 쪼개면 동·연도당 1~2건이 되어 생존율이 의미를 잃는다.
  → 시군구(11개) 단위로 계산하고, 스코어링에 fallback='gugu'로 기록한다.
  (config.MIN_COHORT_N 기준을 통과하지 못하면 인천 전체 평균으로 한 단계 더 내려간다)

⚠️ 'censoring' 처리
  2024년 인허가 업소는 아직 3년이 지나지 않았다. 이들을 분모에 넣으면
  '아직 안 망했다'가 '3년 생존'으로 잘못 집계되어 생존율이 부풀려진다.
  → 관측기준일에서 N년이 지난 코호트만 N년 생존율의 분모로 쓴다.

⚠️ 종료 판정
  영업상태명이 '영업/정상'·'휴업'이 아닌 모든 상태를 영업 종료로 본다.
  ('폐업'뿐 아니라 '취소/말소/만료/정지/중지'도 실질적 종료다.
   인천 기준 폐업 2,672 + 취소·말소 1,017 → 둘을 합쳐야 실태에 맞다.)
"""
from __future__ import annotations
import re, sys
import numpy as np
import pandas as pd

ALIVE = {"영업/정상", "휴업"}
HORIZONS = (1, 3, 5)
# 생존율 코호트 시작 연도. 인허가 데이터는 2000년 이전 폐업 기록이 거의 없고(인천 일반음식점:
# 1990년 폐업 1건, 1994년 43건 — 반면 같은 시기 인허가는 수천 건), PC방은 2007~08년 법 개정으로
# 일괄 재등록됐다. 오래된 코호트를 넣으면 '기록 없는 폐업'이 생존으로 잡혀 생존율이 부풀려진다.
# → 모든 업종에 같은 창(2013년 이후 인허가)을 쓴다. 업력·폐업률은 전체 기록으로 계산한다.
COHORT_FROM = pd.Timestamp("2013-01-01")


def load(path: str, sido: str = "인천") -> pd.DataFrame:
    df = pd.read_csv(path, encoding="cp949", low_memory=False)
    n0 = len(df)
    addr = df["지번주소"].fillna("") + " " + df["도로명주소"].fillna("")
    df = df[addr.str.contains(sido, na=False)].copy()
    df["주소"] = addr[df.index]
    df["시군구"] = df["주소"].str.extract(rf"{sido}\S*\s+(\S+[구군])")[0]

    df["인허가일"] = pd.to_datetime(df["인허가일자"], errors="coerce")
    df["폐업일"] = pd.to_datetime(df["폐업일자"], errors="coerce")
    df = df.dropna(subset=["인허가일", "시군구"])

    df["종료여부"] = ~df["영업상태명"].isin(ALIVE)
    # 폐업일자가 비어 있는 종료 건은 인허가취소일자로 보완
    cancel = pd.to_datetime(df["인허가취소일자"], errors="coerce")
    df["종료일"] = df["폐업일"].fillna(cancel)
    df["생존일수"] = (df["종료일"] - df["인허가일"]).dt.days

    bad = df["종료여부"] & df["종료일"].isna()
    print(f"[load] 전국 {n0:,} → {sido} {len(df):,}건 "
          f"(종료 {int(df.종료여부.sum()):,} / 영업중 {int((~df.종료여부).sum()):,})")
    if bad.any():
        print(f"       ⚠ 종료인데 종료일 불명 {int(bad.sum())}건 → 생존율 분자에서 제외")
    return df


def survival(df: pd.DataFrame, asof: pd.Timestamp, years: int,
             cohort_from: pd.Timestamp | None = COHORT_FROM) -> dict:
    """
    N년 생존율. asof 기준으로 N년이 경과한 코호트만 분모에 넣는다 (censoring).
    cohort_from 이전 인허가는 기록 누락 때문에 제외한다.
    """
    days = years * 365
    cohort = df[df["인허가일"] <= asof - pd.Timedelta(days=days)]
    if cohort_from is not None:
        cohort = cohort[cohort["인허가일"] >= cohort_from]
    if len(cohort) == 0:
        return {"n": 0, "rate": None}
    died = ((cohort["종료여부"]) & (cohort["생존일수"].notna())
            & (cohort["생존일수"] <= days)).sum()
    return {"n": len(cohort), "rate": 1 - died / len(cohort)}


def build(df: pd.DataFrame) -> pd.DataFrame:
    asof = df["종료일"].max()
    if pd.isna(asof):
        asof = df["인허가일"].max()
    print(f"[build] 관측기준일 {asof.date()}")

    rows = []
    for gu, g in list(df.groupby("시군구")) + [("__인천전체__", df)]:
        r = {"시군구": gu, "총인허가": len(g),
             "영업중": int((~g.종료여부).sum()),
             "종료": int(g.종료여부.sum())}
        for y in HORIZONS:
            s = survival(g, asof, y)
            r[f"생존율_{y}년"] = None if s["rate"] is None else round(s["rate"], 4)
            r[f"표본_{y}년"] = s["n"]
        # 평균 업력 — 영업중은 현재까지, 종료는 영업 기간
        tenure = np.where(g.종료여부, g["생존일수"], (asof - g["인허가일"]).dt.days)
        r["평균업력_년"] = round(float(np.nanmean(tenure)) / 365, 2)
        # 최근 3년 폐업률 — 최근 3년 안에 종료된 건 / 그 기간 초 영업중이던 건
        recent = asof - pd.Timedelta(days=3 * 365)
        base = g[(g["인허가일"] <= recent)]
        closed = base[(base["종료일"] >= recent) & base["종료여부"]]
        r["최근3년_폐업률"] = round(len(closed) / len(base), 4) if len(base) else None
        rows.append(r)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "인허가_PC방.csv"
    df = load(src)
    panel = build(df)
    panel.to_csv("패널_안정성.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_안정성.csv ({len(panel)}행)\n")
    show = ["시군구", "총인허가", "영업중", "생존율_1년", "생존율_3년", "생존율_5년",
            "평균업력_년", "최근3년_폐업률"]
    print(panel[show].to_string(index=False))
