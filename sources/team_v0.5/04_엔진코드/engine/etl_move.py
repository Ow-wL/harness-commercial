#!/usr/bin/env python3
"""
수도권 생활이동 (도착지 기준) → 인천 시장성 패널

입력: seoul_purpose_admdong1_in_YYYYMM.zip  (일별 CSV 30여 개, 각 8MB)
출력: 패널_시장성.csv  — 시군구 × 시간대 × 이동목적 집계

🔴 공간 해상도 (실측으로 확인, 조사 단계 결론을 정정)
   서울   : 행정동 단위 (427개 코드, 8자리 세부)
   경기   : 시군구 단위 (47개, 전부 '000' 종료)
   인천   : 시군구 단위 (11개, 전부 '000' 종료)  ← 행정동 아님!
   공식 문구 "행정동, 자치구 단위는 수도권 지역만"은
   '수도권 전체가 행정동'이 아니라 '서울은 행정동, 경기·인천은 자치구'라는 뜻이었다.
   → 인천 시장성은 시군구 해상도가 한계. 폴백 레벨을 'gugu'로 기록한다.

이동목적 코드 (설명서 확인, 실제 분포로 교차검증)
   1 출근 / 2 등교 / 3 귀가 / 4 쇼핑 / 5 관광 / 6 병원 / 7 기타

컬럼
   d_admdong_cd  도착지 코드 (인천은 시군구+'000')
   time_cd       ⚠ 균일하지 않다. 출퇴근 피크만 20분 단위다.
                 '00'~'06', '10'~'16', '20'~'23'  → 1시간 단위 (2자리)
                 '0700','0720','0740' … '1940'    → 20분 단위 (4자리)
                 2자리로만 파싱하면 07~09시·17~19시가 통째로 누락된다.
                 → to_hour()로 시간 단위로 접는다.
   move_purpose  이동목적 1~7
   male_00..70 / feml_00..70   성별 10세 단위 인구수 (소수)
   total_cnt     합계
"""
import csv, io, sys, zipfile
from collections import defaultdict

import pandas as pd

PURPOSE = {"1": "출근", "2": "등교", "3": "귀가", "4": "쇼핑",
           "5": "관광", "6": "병원", "7": "기타"}
AGE_BINS = ["00", "10", "20", "30", "40", "50", "60", "70"]


def to_hour(time_cd: str) -> int:
    """'07'→7, '0720'→7. 피크 시간대의 20분 단위를 1시간으로 접는다."""
    c = str(time_cd).strip()
    return int(c[:2]) if len(c) >= 2 else -1


def scan(zip_path: str, sido: str = "28"):
    """ZIP을 풀지 않고 스트리밍으로 훑는다. 월 2.3M행 × 2개월이라 전개하면 무겁다."""
    z = zipfile.ZipFile(zip_path)
    names = sorted(n for n in z.namelist() if n.endswith(".csv"))
    by_hour = defaultdict(float)       # (구, 시간)          -> 인원
    by_purp = defaultdict(float)       # (구, 목적)          -> 인원
    by_age  = defaultdict(float)       # (구, 성별, 연령대)   -> 인원
    by_day  = defaultdict(float)       # (구, 날짜)          -> 인원
    for nm in names:
        day = nm[-12:-4]
        with z.open(nm) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                code = row["d_admdong_cd"]
                if not code.startswith(sido):
                    continue
                gu = code[:5]
                t = float(row["total_cnt"] or 0)
                by_hour[(gu, to_hour(row["time_cd"]))] += t
                by_purp[(gu, row["move_purpose"])] += t
                by_day[(gu, day)] += t
                for s, pre in (("M", "male"), ("F", "feml")):
                    for a in AGE_BINS:
                        v = row.get(f"{pre}_{a}_cnt")
                        if v:
                            by_age[(gu, s, a)] += float(v)
    n_days = len(names)
    th, tp = sum(by_hour.values()), sum(by_purp.values())
    ok = abs(th - tp) / max(tp, 1) < 1e-6
    print(f"[scan] {zip_path.rsplit('/',1)[-1]}  일수 {n_days}  구 {len({k[0] for k in by_day})}개")
    print(f"       정합성 시간합={th:,.0f} 목적합={tp:,.0f} {'✅' if ok else '❌ 불일치 — 파싱 누락 의심'}")
    if not ok:
        raise SystemExit("시간대 집계 누락. time_cd 파싱을 확인할 것.")
    return by_hour, by_purp, by_age, by_day, n_days


def build(zip_path, sido="28") -> pd.DataFrame:
    by_hour, by_purp, by_age, by_day, n_days = scan(zip_path, sido)
    gus = sorted({k[0] for k in by_day})
    rows = []
    for gu in gus:
        hours = [by_hour.get((gu, h), 0.0) for h in range(24)]
        tot = sum(hours)
        pur = {PURPOSE[p]: by_purp.get((gu, p), 0.0) for p in PURPOSE}
        r = {"시군구코드": gu,
             "일평균_유입": tot / n_days,
             "관측일수": n_days}
        for h in range(24):
            r[f"h{h:02d}"] = hours[h] / n_days
        for k, v in pur.items():
            r[f"목적_{k}"] = v / n_days
            r[f"목적비중_{k}"] = (v / tot) if tot else None
        for s in ("M", "F"):
            for a in AGE_BINS:
                r[f"{s}{a}"] = by_age.get((gu, s, a), 0.0) / n_days
        rows.append(r)
    return pd.DataFrame(rows)


if __name__ == "__main__":
    out = []
    for zp in sys.argv[1:]:
        ym = zp.rsplit("_", 1)[-1].replace(".zip", "")
        df = build(zp)
        df.insert(1, "기준연월", ym)
        out.append(df)
    res = pd.concat(out, ignore_index=True)
    res.to_csv("패널_시장성.csv", index=False, encoding="utf-8-sig")
    print(f"[out] 패널_시장성.csv  ({len(res)}행 × {len(res.columns)}열)")
