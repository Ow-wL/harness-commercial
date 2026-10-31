"""
가까운 역 시간대별 승하차 (TASKS 13-41, D-040) — 시간대·인구 카드(/insights)의 화면 자료. 점수와 무관하다.

자료: data/extra/station_ridership.csv(+ .meta.json) — scripts/build_station_ridership.py 가 인천교통공사 원본(공공데이터포털 15159353,
이용허락범위 제한 없음)에서 만든 역 × 평일/주말 × 승차/하차 × 20개 시간대 하루 평균. 인천교통공사 노선(인천1·2호선, 7호선 인천 구간)만
들어 있어 같은 역의 코레일 이용자(예: 부평·주안의 경인선)는 없다 — 응답 coverage 로 밝힌다.
- 앱 수명 동안 1회 읽는다(파일이 없으면 기능 없음 — /insights station 은 null).
- 역 좌표는 엔진이 읽은 RuntimeData.stations(name 은 괄호 부기 없는 이름, 68역 모두 일치)를 쓴다 — 새 좌표 자료를 두지 않는다.
- 분석 좌표에서 자료가 있는 역 중 가장 가까운 역이 MAX_DISTANCE_M 안이면 그 역, 아니면 null(엔진 입지성의 최근접역과 다를 수 있다).
"""
from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

logger = logging.getLogger("backend.ridership")

ROOT = Path(__file__).resolve().parents[2]
PATH_ENV = "STATION_RIDERSHIP_PATH"
DEFAULT_PATH = ROOT / "data" / "extra" / "station_ridership.csv"
MAX_DISTANCE_M = 1000
BAND_KEYS = ["lt06"] + [f"h{h:02d}" for h in range(6, 24)] + ["ge24"]
BAND_LABELS = ["06시 전"] + [f"{h}시" for h in range(6, 24)] + ["24시 후"]


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class StationDay:
    board: list[int]
    alight: list[int]
    days: int


@dataclass(frozen=True)
class StationRow:
    name: str
    lines: str
    weekday: StationDay
    weekend: StationDay


class RidershipStore:
    def __init__(self, rows: dict[str, StationRow], meta: dict):
        self.rows, self.meta = rows, meta

    @classmethod
    def load(cls, path: Optional[str] = None) -> Optional["RidershipStore"]:
        p = Path(path or os.environ.get(PATH_ENV) or DEFAULT_PATH)
        if not p.exists():
            logger.info("station ridership file missing — feature off")
            return None
        df = pd.read_csv(p, encoding="utf-8", dtype={"station": str, "lines": str})
        meta_path = p.with_suffix(".meta.json")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        rows: dict[str, StationRow] = {}
        for name, g in df.groupby("station"):
            def day(t: str) -> StationDay:
                sub = g[g["daytype"] == t]
                pick = lambda d: [int(x) for x in sub[sub["direction"] == d][BAND_KEYS].iloc[0]] if not sub[sub["direction"] == d].empty \
                    else [0] * len(BAND_KEYS)
                return StationDay(board=pick("board"), alight=pick("alight"), days=int(sub["days"].max()) if not sub.empty else 0)
            rows[str(name)] = StationRow(name=str(name), lines=str(g["lines"].iloc[0]), weekday=day("평일"), weekend=day("주말"))
        return cls(rows, meta)

    def nearest(self, stations: pd.DataFrame, lat: float, lng: float, max_m: float = MAX_DISTANCE_M) -> Optional[tuple[StationRow, float]]:
        """엔진 역 좌표 중 자료가 있는 역만 — 가장 가까운 역과 직선거리(m). max_m 밖이면 None."""
        best: Optional[tuple[StationRow, float]] = None
        for name, s_lat, s_lng in stations[["name", "lat", "lng"]].itertuples(index=False):
            row = self.rows.get(str(name))
            if row is None:
                continue
            d = haversine_m(lat, lng, float(s_lat), float(s_lng))
            if d <= max_m and (best is None or d < best[1]):
                best = (row, d)
        return best
