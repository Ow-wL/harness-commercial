"""
동종 점포 조회 — 분석 지점 반경 안의 같은 업종 점포 목록 (4차, docs/DECISIONS.md D-019).

엔진 경쟁성(radius_demand.radius_profile)과 같은 기준을 그대로 쓴다.
  거리   radius_demand.haversine_m(lat, lng, 위도, 경도) — 엔진 함수, 같은 배열(RuntimeData.shops)
  반경   거리 <= config.RADIUS_M (500m, 경계 포함)
  업종   상권업종소분류코드 == 업종코드
→ 목록 길이 == radius_profile 의 n_same == 분석 결과 경쟁성.raw.동종점포수 (tests/test_nearby.py).

표시용이다. 점수 계산에는 쓰지 않고 엔진 입력·출력을 바꾸지 않는다.
RuntimeData 를 다시 읽지 않는다 — 생성 시 좌표·업종 배열을 한 번 잡아 두고 요청마다 거리만 계산한다.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import config as C, radius_demand
from .runtime import RuntimeData

# 상가(상권)정보 기준일 — sources/team_v0.3/00_README.md 데이터 표, docs/DATA.md. 데이터를 바꾸면 함께 바꾼다.
SHOPS_AS_OF = "2026-06-30"


@dataclass(frozen=True)
class NearbyStore:
    id: str                         # 상가업소번호
    name: Optional[str]             # 상호명 (없으면 None)
    road_address: Optional[str]     # 도로명주소 (없으면 None)
    jibun_address: Optional[str]    # 지번주소 (없으면 None)
    lat: float
    lng: float
    distance_m: int                 # 분석 지점과의 직선거리(m, 반올림). 도보 거리가 아니다


def _text(value) -> Optional[str]:
    """빈 값(NaN·None·공백)은 None — 화면이 "정보 없음"으로 표시한다."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    s = str(value).strip()
    return s or None


class NearbyStoreFinder:
    def __init__(self, rt: RuntimeData):
        shops = rt.shops
        self._shops = shops
        # radius_profile 과 같은 열·같은 값(.values)으로 거리·업종을 판정한다
        self._lat = shops["위도"].values
        self._lng = shops["경도"].values
        self._code = shops["상권업종소분류코드"].values

    def find(self, lat: float, lng: float, biz_code: str, radius_m: float = C.RADIUS_M) -> list[NearbyStore]:
        """반경 안 같은 업종 점포, 가까운 순 (같은 거리면 데이터 순서)."""
        d = radius_demand.haversine_m(lat, lng, self._lat, self._lng)
        hit = np.flatnonzero((d <= radius_m) & (self._code == biz_code))
        order = hit[np.argsort(d[hit], kind="stable")]
        rows = self._shops.iloc[order]
        return [NearbyStore(id=str(r.상가업소번호), name=_text(r.상호명), road_address=_text(r.도로명주소),
                            jibun_address=_text(r.지번주소), lat=float(r.위도), lng=float(r.경도),
                            distance_m=int(round(float(dist))))
                for r, dist in zip(rows.itertuples(index=False), d[order])]
