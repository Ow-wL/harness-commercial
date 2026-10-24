"""
v0.5 인구 면적 배분용 행정동 경계 (D-028) — 엔진 v0.5 에서만 쓴다(AREA_WEIGHTED).

경계 파일 data/geo/SGIS_행정동경계_2025_2Q_인천.geojson
  = 팀 전달 v0.5 07_가공데이터/경계_인천_행정동.geojson 의 바이트 동일 사본 (SGIS 2025년 2분기, 156개 Polygon, WGS84).
  용도는 "반경 안 인구를 행정동 경계 면적 비율로 나누기"(etl_boundary.DongAreas) 하나다.
  지도 표시·행정동 판정은 2026-07 경계(인천_행정동경계_2026.geojson, location.py)가 그대로 맡는다 — 서로 대체하지 않는다.
  2026-07 신설 분동(아라1·2동, 운서1·2동)은 모체 동 경계로 연결된다(158/158, 이름 기준). 팀 v0.5 는 거기에 분동 인구비를
  한 번 더 곱해 배분 인구가 줄어드는 결함이 있다 — v0_5 는 팀 결과 보존용으로 그대로, 수정은 v0_5_1(D-029).

엔진 함수를 고치지 않는다. 여기서 하는 일은 두 가지뿐이다.
  load_dong_areas  DongAreas(path, panel) 를 부르되 경계 파일을 UTF-8 로 읽게 한다. 엔진은 open(path) 에 인코딩을 주지 않아
                   Windows 기본 인코딩(cp949)에서는 UnicodeDecodeError 가 난다(Docker/Linux 는 UTF-8 이라 그대로 동작).
                   etl_boundary 모듈 이름공간에 open 을 잠깐 넣었다 빼는 방식이며, 앱 시작 때 한 번만 부른다.
  ReusedAreas      비교 모집단 중심점(158개)의 면적 가중치 w = |원 ∩ 동| / |동| 를 (위도, 경도, 반경)마다 한 번만 계산해
                   29개 업종이 같이 쓴다. 값은 DongAreas.weights 그대로(같은 함수, 같은 입력) — 업종과 무관하다.
                   요청 지점(중심점이 아닌 좌표)은 저장하지 않고 매번 계산한다(약 10ms, 메모리 상한 없음 문제를 만들지 않는다).
"""
from __future__ import annotations

import builtins
import functools
import os
from typing import Iterable, Optional

import pandas as pd

from . import AREA_WEIGHTED

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POP_BOUNDARY_FILE = "SGIS_행정동경계_2025_2Q_인천.geojson"
POP_BOUNDARY_PATH = os.path.join(ROOT, "data", "geo", POP_BOUNDARY_FILE)
POP_BOUNDARY_AS_OF = "2025-2Q"          # SGIS 행정구역 통계 및 경계 bnd_dong_00_2025_2Q (2026-07 개편 전)


def load_dong_areas(panel: pd.DataFrame, path: str = POP_BOUNDARY_PATH):
    """etl_boundary.DongAreas(path, panel) — 경계 파일만 UTF-8 로 읽힌다. 결과 객체는 엔진 클래스 그대로다."""
    if not AREA_WEIGHTED:
        raise RuntimeError("면적 배분 경계는 엔진 v0.5·v0.5.1(SCORING_ENGINE_VERSION=v0_5|v0_5_1)에서만 쓴다")
    from . import etl_boundary
    etl_boundary.open = functools.partial(builtins.open, encoding="utf-8")   # 모듈 전역 이름 — builtins 보다 먼저 찾는다
    try:
        return etl_boundary.DongAreas(path, panel)
    finally:
        del etl_boundary.open


class ReusedAreas:
    """DongAreas 와 같은 weights(lat, lng, radius_m) 인터페이스. 등록한 중심점 좌표만 결과를 재사용한다."""

    def __init__(self, areas, points: Iterable[tuple[float, float]]):
        self.areas = areas
        self.items = areas.items                       # 엔진 객체와 같은 연결 목록(검사·보고용)
        self._points = {(float(a), float(b)) for a, b in points}
        self._cache: dict[tuple[float, float, int], pd.DataFrame] = {}

    def weights(self, lat, lng, radius_m=500) -> pd.DataFrame:
        key = (float(lat), float(lng), int(radius_m))
        if key[:2] not in self._points:
            return self.areas.weights(lat, lng, radius_m)
        hit = self._cache.get(key)
        if hit is None:
            hit = self.areas.weights(lat, lng, radius_m)
            self._cache[key] = hit                     # 한 번의 dict 대입 — 같은 값을 두 스레드가 넣어도 같다
        return hit.copy()                              # 호출자가 고쳐도 저장본은 그대로

    def stats(self) -> dict:
        return {"entries": len(self._cache), "points": len(self._points)}


def linked_dongs(areas) -> Optional[list[tuple[str, str]]]:
    """패널 (시군구명, 행정동명) 중 경계에 연결된 것 — 158/158 이어야 한다(엔진은 미연결을 출력만 하고 넘어간다)."""
    return None if areas is None else [(gu, dong) for gu, dong, *_ in areas.items]
