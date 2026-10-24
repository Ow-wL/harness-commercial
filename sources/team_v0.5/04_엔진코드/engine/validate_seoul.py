#!/usr/bin/env python3
"""
C안 — 서울 상권 데이터로 업종별 집적 효과를 검증하고 집적 계수(α)를 제안한다.

질문: "점포가 많이 모인 상권일수록 가게 하나당 매출이 높은가?"
  높아진다(양의 상관)  → 집적형  α=1.0   (모일수록 손님이 더 온다)
  거의 무관            → 중간형  α=0.5
  낮아진다(음의 상관)  → 근린형  α=0.0   (나눠 먹는다)

입력 (서울 열린데이터광장, 같은 분기로 받을 것)
  1) 서울시 상권분석서비스(추정매출-상권)  OA-15572
  2) 서울시 상권분석서비스(점포-상권)      OA-15577
  ※ 파일은 CP949인 경우가 많다. 이 스크립트가 자동으로 시도한다.

실행
  python3 validate_seoul.py 추정매출.csv 점포.csv [분기코드 예: 20262]
출력
  집적효과_서울검증.csv  — 업종별 상관계수, 표본 수, 제안 α, 현재 α
"""
import sys
import pandas as pd
from scipy.stats import spearmanr
import config as C

# 서울 서비스업종명 → 우리 소분류 코드
SEOUL_TO_CODE = {
    "한식음식점": "I20101", "중식음식점": "I20201", "일식음식점": "I20301", "양식음식점": "I20401",
    "제과점": "I21001", "패스트푸드점": "I21004", "치킨전문점": "I21006", "분식전문점": "I21007",
    "호프-간이주점": "I21103", "커피-음료": "I21201", "노래방": "R10407", "당구장": "R10310",
    "PC방": "R10406", "미용실": "S20701", "네일숍": "S20703", "피부관리실": "S20702",
    "세탁소": "S20901", "편의점": "G20405", "슈퍼마켓": "G20404", "의약품": "G21501",
    "일반교습학원": "P10501", "전자게임장": "R10404",
}
RHO_CUT = 0.15         # |ρ| 이 값 이하면 중간형
MIN_AREAS = 30         # 상권 수가 이보다 적으면 판정 보류


def _read(path):
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"인코딩을 알 수 없습니다: {path}")


def _col(df, *cands):
    for c in cands:
        if c in df.columns:
            return c
    raise KeyError(f"필요한 열이 없습니다: {cands} / 실제 열: {list(df.columns)[:15]}…")


def suggest_alpha(rho, p, n):
    if n < MIN_AREAS or rho != rho:
        return None
    if p < 0.05 and rho > RHO_CUT:
        return 1.0
    if p < 0.05 and rho < -RHO_CUT:
        return 0.0
    return 0.5


def validate(sales: pd.DataFrame, stores: pd.DataFrame, quarter=None) -> pd.DataFrame:
    q_s, q_t = _col(sales, "기준_년분기_코드"), _col(stores, "기준_년분기_코드")
    if quarter is None:
        quarter = int(sales[q_s].max())
    sales, stores = sales[sales[q_s] == int(quarter)], stores[stores[q_t] == int(quarter)]

    a_s, a_t = _col(sales, "상권_코드"), _col(stores, "상권_코드")
    b_s, b_t = _col(sales, "서비스_업종_코드_명"), _col(stores, "서비스_업종_코드_명")
    amt = _col(sales, "당월_매출_금액")
    n_st = _col(stores, "유사_업종_점포_수", "점포_수")

    # 상권 집적도 = 그 상권의 전 업종 점포 수 합
    total = stores.groupby(a_t)[n_st].sum().rename("상권_전체점포")
    rows = []
    for name, code in SEOUL_TO_CODE.items():
        s = sales[sales[b_s] == name].groupby(a_s)[amt].sum().rename("매출")
        t = stores[stores[b_t] == name].groupby(a_t)[n_st].sum().rename("동종점포")
        df = pd.concat([s, t], axis=1).join(total).dropna()
        df = df[df.동종점포 > 0]
        df["점포당매출"] = df.매출 / df.동종점포
        n = len(df)
        rho, p = spearmanr(df.상권_전체점포, df.점포당매출) if n >= 3 else (float("nan"), 1.0)
        rows.append({"서울_업종": name, "업종코드": code, "업종명": C.CODE_NAME.get(code),
                     "상권수": n, "상관계수_ρ": round(float(rho), 3), "p값": round(float(p), 4),
                     "제안_α": suggest_alpha(rho, p, n), "현재_α": C.agg_alpha(code)})
    out = pd.DataFrame(rows)
    out["일치"] = out.제안_α == out.현재_α
    out.attrs["분기"] = quarter
    return out


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    res = validate(_read(sys.argv[1]), _read(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else None)
    res.to_csv("집적효과_서울검증.csv", index=False, encoding="utf-8-sig")
    print(f"분기 {res.attrs['분기']}\n", res.to_string(index=False))
    k = res.제안_α.notna().sum()
    print(f"\n판정 {k}개 중 현재 α와 일치 {int(res.일치.sum())}개. "
          f"다른 업종은 config.AGGLOMERATION을 제안 α로 바꾸고 run_all을 다시 돌린다.")
