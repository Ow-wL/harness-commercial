"""
Location Resolver — 좌표(WGS84 lat/lng) → 2026-07 기준 인천 행정동.

  data/geo/인천_행정동경계_2026.geojson (158개, docs/DECISIONS.md D-009) 의 polygon 으로 point-in-polygon 판정을 하고,
  행정동코드(8자리)로 runtime panel(패널_통합.csv) 행에 연결한다.

규칙
  - 행정동은 **코드로만** 식별한다. 이름 문자열로 조인하지 않는다 (경계 '·' / panel '.' 표기 차이, D-009).
  - 반환하는 시군구명·행정동명은 runtime panel 표기. 경계 원문 이름은 boundary_dong_name (추적용).
  - 2024→2026 crosswalk 는 쓰지 않는다 (검증용 산출물). 2026 polygon 을 직접 쓴다.
  - 경계선 위의 점: 내부(within)에 있는 polygon 이 없고 경계에 걸친(covered_by) polygon 이 여럿이면
    가장 작은 행정동코드를 택한다 → 같은 입력은 항상 같은 결과.
  - 어느 polygon 에도 속하지 않는 점(인천 밖, 바다)은 LocationOutside. 성공 결과를 만들지 않는다.
  - GeoJSON·panel 은 LocationResolver 생성 시 1회만 읽는다. 프로세스 공용 인스턴스는 default_resolver().

ContextBuilder — 좌표 → SiteContext (TASKS 1-7). service.AnalysisService.analyze 가 쓰는 필드를 아래처럼 채운다.
  lat, lng    입력 좌표 (검증된 float). 반경 프로파일·입지 프로파일의 분석 지점
  gu_code     resolve 된 행정동코드[:5] — 시장성 패널(패널_시장성_*.csv)의 시군구코드
  gu_name     runtime panel 시군구명 — 고객성 행 조회와 안정성 패널(패널_안정성*.csv)의 시군구
  dong_name   runtime panel 행정동명 — 고객성(패널_통합) 행 조회
  rent_area   None — 임대료 상권 연결 규칙(TASKS 1-6) 미결정. 부평역 등 특정 좌표도 특별 처리하지 않는다
  label       f"{시군구명} {행정동명}" — meta.query 문구("{label} 근처 {업종}")용 지점 이름
  반경 500m(config.RADIUS_M, 엔진의 haversine_m 과 같은 거리) 안에 점포가 하나도 없으면 NoDataNearby (eng review D8).

이 모듈은 HTTP 를 모른다. 오류 → 응답 코드 변환은 backend 가 한다.
"""
from __future__ import annotations

import functools
import json
import math
import numbers
import os
from dataclasses import dataclass
from typing import Optional

import pandas as pd
from shapely import STRtree
from shapely.geometry import Point, shape

from . import config as C, radius_demand
from .context import SiteContext
from .runtime import DEFAULT_DATA_DIR, ROOT, RuntimeData

DEFAULT_BOUNDARY_PATH = os.path.join(ROOT, "data", "geo", "인천_행정동경계_2026.geojson")
DEFAULT_PANEL_PATH = os.path.join(DEFAULT_DATA_DIR, "패널_통합.csv")


class LocationError(ValueError):
    """location 계층의 도메인 오류."""


class InvalidCoordinate(LocationError):
    """lat/lng 가 유한한 실수가 아니거나 범위(-90..90, -180..180) 밖."""


class LocationOutside(LocationError):
    """인천 행정동 경계 어디에도 속하지 않는 좌표 (인천 밖, 바다)."""


class NoDataNearby(LocationError):
    """행정동은 정해졌지만 반경(config.RADIUS_M) 안에 상가 점포가 하나도 없어 분석하지 않는 좌표."""


class ContextDataError(RuntimeError):
    """resolver 결과를 runtime 데이터(panel·시장성 패널)에 연결하지 못함. 입력 문제가 아니라 데이터 불일치."""


@dataclass(frozen=True)
class ResolvedLocation:
    lat: float
    lng: float
    dong_code: str              # 행정동코드 8자리 — canonical key (panel 행정동코드)
    gu_code: str                # 시군구코드 5자리 (= dong_code[:5])
    gu_name: str                # runtime panel 시군구명
    dong_name: str              # runtime panel 행정동명
    boundary_dong_name: str     # 경계 파일 원문 행정동명 (추적용, 조인에 쓰지 않는다)


def validate_coordinate(lat, lng) -> tuple[float, float]:
    """숫자·유한값·범위를 검사해 float 로 돌려준다. bool·문자열·None 은 거부."""
    out = []
    for name, v, lim in (("lat", lat, 90.0), ("lng", lng, 180.0)):
        if isinstance(v, bool) or not isinstance(v, numbers.Real):
            raise InvalidCoordinate(f"{name} 는 숫자여야 한다: {v!r}")
        f = float(v)
        if not math.isfinite(f):
            raise InvalidCoordinate(f"{name} 가 유한하지 않다: {v!r}")
        if not -lim <= f <= lim:
            raise InvalidCoordinate(f"{name} 범위(-{lim:g}..{lim:g}) 밖: {v!r}")
        out.append(f)
    return out[0], out[1]


def _panel_names(panel: Optional[pd.DataFrame]) -> dict[str, tuple[str, str]]:
    """행정동코드(str 8자리) → (시군구명, 행정동명). RuntimeData.panel 은 코드가 int 로 읽혀 있어 문자열로 맞춘다."""
    if panel is None:
        panel = pd.read_csv(DEFAULT_PANEL_PATH, encoding="utf-8-sig", dtype={"행정동코드": str},
                            usecols=["행정동코드", "시군구명", "행정동명"])
    codes = panel["행정동코드"].astype(str)
    if not codes.str.fullmatch(r"\d{8}").all() or not codes.is_unique:
        raise ValueError("panel 행정동코드는 중복 없는 8자리여야 한다")
    return dict(zip(codes, zip(panel["시군구명"], panel["행정동명"])))


class LocationResolver:
    def __init__(self, panel: Optional[pd.DataFrame] = None, boundary_path: str = DEFAULT_BOUNDARY_PATH):
        with open(boundary_path, encoding="utf-8") as f:
            features = json.load(f)["features"]
        names = _panel_names(panel)
        codes = [ft["properties"]["행정동코드"] for ft in features]
        if len(codes) != len(set(codes)) or set(codes) != set(names):
            raise ValueError("경계 행정동코드 집합 != runtime panel 행정동코드 집합 (D-009)")
        self._codes = codes
        self._boundary_names = [ft["properties"]["경계_행정동명"] for ft in features]
        self._geoms = [shape(ft["geometry"]) for ft in features]
        self._tree = STRtree(self._geoms)
        self._names = names

    def __len__(self) -> int:
        return len(self._codes)

    def resolve(self, lat, lng) -> ResolvedLocation:
        lat, lng = validate_coordinate(lat, lng)
        pt = Point(lng, lat)                       # GeoJSON 좌표 순서는 (경도, 위도)
        hits = self._tree.query(pt, predicate="within")
        if len(hits) == 0:
            hits = self._tree.query(pt, predicate="covered_by")
        if len(hits) == 0:
            raise LocationOutside(f"인천 행정동 경계 밖 좌표: lat={lat}, lng={lng}")
        i = min(hits, key=lambda k: self._codes[k])
        code = self._codes[i]
        gu_name, dong_name = self._names[code]
        return ResolvedLocation(lat=lat, lng=lng, dong_code=code, gu_code=code[:5], gu_name=gu_name,
                                dong_name=dong_name, boundary_dong_name=self._boundary_names[i])


class ContextBuilder:
    def __init__(self, rt: RuntimeData, resolver: Optional[LocationResolver] = None):
        self.rt = rt
        self.resolver = resolver or LocationResolver(panel=rt.panel)
        self._dongs = {str(code): (gu, dong) for code, gu, dong in
                       zip(rt.panel["행정동코드"], rt.panel["시군구명"], rt.panel["행정동명"])}
        self._market_codes = set(rt.market["시군구코드"].astype(str))
        self._shop_lat = rt.shops["위도"].to_numpy(dtype=float)
        self._shop_lng = rt.shops["경도"].to_numpy(dtype=float)

    def shops_within_radius(self, lat: float, lng: float) -> int:
        """반경 config.RADIUS_M 안의 점포 수 — radius_demand.radius_profile 의 n_all 과 같은 정의."""
        d = radius_demand.haversine_m(lat, lng, self._shop_lat, self._shop_lng)
        return int((d <= C.RADIUS_M).sum())

    def build(self, lat, lng) -> SiteContext:
        loc = self.resolver.resolve(lat, lng)          # InvalidCoordinate / LocationOutside
        names = self._dongs.get(loc.dong_code)
        if names is None:
            raise ContextDataError(f"runtime panel 에 행정동코드 없음: {loc.dong_code}")
        if names != (loc.gu_name, loc.dong_name):
            raise ContextDataError(f"resolver 와 runtime panel 이름 불일치 {loc.dong_code}: "
                                   f"{loc.gu_name} {loc.dong_name} / {names[0]} {names[1]}")
        if loc.gu_code not in self._market_codes:
            raise ContextDataError(f"시장성 패널에 시군구코드 없음: {loc.gu_code}")
        if self.shops_within_radius(loc.lat, loc.lng) == 0:
            raise NoDataNearby(f"반경 {C.RADIUS_M}m 안에 상가 점포 없음: lat={loc.lat}, lng={loc.lng}")
        gu_name, dong_name = names
        return SiteContext(label=f"{gu_name} {dong_name}", lat=loc.lat, lng=loc.lng, gu_code=loc.gu_code,
                           gu_name=gu_name, dong_name=dong_name, rent_area=None)


@functools.lru_cache(maxsize=1)
def default_resolver() -> LocationResolver:
    """프로세스 공용 resolver (기본 경계 + 기본 panel). 첫 호출에서만 파일을 읽는다."""
    return LocationResolver()
