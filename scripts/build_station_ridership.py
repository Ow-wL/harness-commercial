"""
역 시간대별 승하차 → 화면용 작은 집계 (TASKS 13-41, docs/DATA_FLOW_POPULATION.md, D-040).

  python scripts/build_station_ridership.py <인천교통공사_일별_역별_시간대별_이용인원현황.csv> [--from 2025-07-01] [--to 2026-06-30]

입력: 공공데이터포털 15159353 "인천교통공사_일별 역별 시간대별 이용인원현황"(이용허락범위 제한 없음, CP949 CSV) — 원본은 저장소에 넣지 않는다.
출력: data/extra/station_ridership.csv + data/extra/station_ridership.meta.json (기간·출처·방법·원본 sha256)
- 역명은 괄호 부기를 뗀 이름(가정(루원시티) → 가정) — 엔진 RuntimeData.stations 의 name 과 같은 표기(68역 모두 일치, 2026-11-01).
- 같은 날 같은 역의 여러 호선(환승역) 행은 더한 뒤, 요일 구분별(평일 = 월~금, 주말 = 토·일. 공휴일은 따로 나누지 않는다)로
  하루 평균을 낸다. 20개 시간대(06시 이전, 06~24시 1시간씩, 24시 이후) × 승차·하차. 정수로 반올림.
- 점수와 무관한 화면 자료다(data/runtime 불변, D-006). 코레일 광역철도 자료는 원 게시판 이용 조건이 공공누리 4유형(변경금지)이라 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "extra"
OUT_CSV = OUT_DIR / "station_ridership.csv"
OUT_META = OUT_DIR / "station_ridership.meta.json"
BANDS = ["06시이전"] + [f"{h:02d}시-{h + 1:02d}시간대" for h in range(6, 24)] + ["24시이후"]
BAND_KEYS = ["lt06"] + [f"h{h:02d}" for h in range(6, 24)] + ["ge24"]
LINE_NAME = {1: "인천1호선", 2: "인천2호선", 7: "7호선"}      # 원본 호선명 코드 → 이름(7호선은 인천·부천 구간만)
SOURCE = {"name": "인천교통공사_일별 역별 시간대별 이용인원현황", "provider": "인천교통공사", "portal_id": "15159353",
          "url": "https://www.data.go.kr/data/15159353/fileData.do", "license": "이용허락범위 제한 없음(공공데이터포털)"}


def base_name(name: str) -> str:
    return re.sub(r"\(.*\)", "", str(name)).strip()


def build(raw: Path, start: str, end: str) -> tuple[pd.DataFrame, dict]:
    df = pd.read_csv(raw, encoding="cp949")
    missing = [c for c in ["수송일자", "역명", "승하차구분", *BANDS] if c not in df.columns]
    if missing:
        raise SystemExit(f"원본 열이 다르다: {missing}")
    df = df[(df["수송일자"] >= start) & (df["수송일자"] <= end)].copy()
    if df.empty:
        raise SystemExit("기간 안 행이 없다")
    df["역"] = df["역명"].map(base_name)
    lines = (df.groupby("역")["호선명"].apply(lambda s: "·".join(LINE_NAME.get(int(x), f"{x}호선") for x in sorted(set(s))))
             .rename("lines").reset_index().rename(columns={"역": "station"}))
    day = (df.groupby(["수송일자", "역", "승하차구분"], as_index=False)[BANDS].sum())          # 환승역: 호선 합
    day["요일"] = pd.to_datetime(day["수송일자"]).dt.dayofweek.map(lambda d: "주말" if d >= 5 else "평일")
    avg = day.groupby(["역", "요일", "승하차구분"])[BANDS].mean().round().astype(int).reset_index()
    days = day.groupby(["역", "요일"])["수송일자"].nunique().rename("일수").reset_index()
    out = avg.merge(days, on=["역", "요일"]).rename(columns=dict(zip(BANDS, BAND_KEYS)))
    out = out.rename(columns={"역": "station", "요일": "daytype", "승하차구분": "direction", "일수": "days"})
    out["direction"] = out["direction"].map({"승차": "board", "하차": "alight"})
    out = out.merge(lines, on="station").sort_values(["station", "daytype", "direction"]).reset_index(drop=True)
    meta = {"source": SOURCE, "period": {"from": start, "to": end}, "stations": int(out["station"].nunique()),
            "bands": dict(zip(BAND_KEYS, BANDS)), "daytype": {"평일": "월~금(공휴일 포함)", "주말": "토·일"},
            "coverage": "인천교통공사 노선(인천1·2호선, 7호선 인천·부천 구간)만 들어 있습니다. 같은 역의 코레일·공항철도 이용자는 빠져 있습니다(예: 부평·주안의 1호선 경인선)",
            "method": "같은 날 같은 역의 호선 합 → 요일 구분별 하루 평균(반올림). 게이트 승하차 태그 기준 — 환승·통과 인원 없음",
            "raw_sha256": hashlib.sha256(raw.read_bytes()).hexdigest(), "raw_rows": int(len(pd.read_csv(raw, encoding="cp949"))),
            "built": date.today().isoformat()}
    return out[["station", "lines", "daytype", "direction", "days", *BAND_KEYS]], meta


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("--from", dest="start", default="2025-07-01")
    ap.add_argument("--to", dest="end", default="2026-06-30")
    a = ap.parse_args(argv)
    out, meta = build(Path(a.raw), a.start, a.end)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_CSV, index=False, encoding="utf-8", lineterminator="\n")
    OUT_META.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{OUT_CSV.relative_to(ROOT)}: {len(out)}행, 역 {meta['stations']}개, 기간 {a.start}~{a.end}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
