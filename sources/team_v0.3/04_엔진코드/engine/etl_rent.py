"""
상업용부동산 임대동향조사 — 소규모상가 상권별 임대료 (한국부동산원 R-ONE)

원본: R-ONE '임대동향 지역별 임대료(2024년3분기~)_소규모 상가' CSV (CP949, 단위 천원/㎡, 전용+공용 기준)
  - 헤더 3줄(분기명 / '임대료' / '천원/㎡') 뒤에 데이터가 시작한다.
  - 열: No, 시도, 구분, 상권, 분기별 값 ...
  - 시도 단위 합계행('인천')이 상권행과 같은 열에 섞여 있으므로 구분해야 한다.

⚠ 해상도: 인천은 구가 아니라 '상권' 9곳만 공표된다 (구월, 부평, 주안, 신포동 등).
   인천 158개 행정동 대부분은 대응하는 상권이 없다 → 분석 지점이 상권과 명시적으로 연결될 때만 쓴다.
"""
from __future__ import annotations
import pandas as pd

QUARTERS = ["2024Q3", "2024Q4", "2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"]


def load_rent(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, encoding="cp949", header=None, skiprows=3)
    if df.shape[1] != 4 + len(QUARTERS):
        raise ValueError(f"예상과 다른 열 개수({df.shape[1]}). 분기 구성이 바뀌었는지 확인하세요.")
    df.columns = ["No", "시도", "구분", "상권"] + QUARTERS
    for q in QUARTERS:
        df[q] = pd.to_numeric(df[q], errors="coerce")
    return df


def incheon_areas(df: pd.DataFrame, quarter: str = QUARTERS[-1]) -> pd.DataFrame:
    """인천 상권별 임대료. 시도 합계행(상권명이 시도명과 같은 행)은 제외한다."""
    inc = df[(df["시도"] == "인천") & (df["상권"] != "인천")].copy()
    if inc.empty:
        raise ValueError("인천 상권 행이 없습니다.")
    out = inc[["상권", quarter]].rename(columns={quarter: "임대료_천원_㎡"})
    first = QUARTERS[0]
    out["변화율_%_(첫분기대비)"] = ((inc[quarter] / inc[first] - 1) * 100).round(1).values
    return out.reset_index(drop=True)


def incheon_total(df: pd.DataFrame, quarter: str = QUARTERS[-1]) -> float:
    r = df[(df["시도"] == "인천") & (df["상권"] == "인천")]
    return float(r.iloc[0][quarter])


if __name__ == "__main__":
    import sys
    d = load_rent(sys.argv[1] if len(sys.argv) > 1 else "임대료_소규모상가_R-ONE.csv")
    a = incheon_areas(d)
    print(a.sort_values("임대료_천원_㎡", ascending=False).to_string(index=False))
    print("인천 전체:", incheon_total(d))
