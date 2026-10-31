"""
FastAPI backend (TASKS 3-1, docs/DECISIONS.md D-012).

  python -m uvicorn backend.app.main:app --reload

수명 주기
  import 시점에는 아무것도 읽지 않는다 (module-level app 은 create_app() 결과일 뿐).
  lifespan 시작: AnalysisService 1회 생성(RuntimeData 로드, 약 4s) → 요청 수신 시작
                 → ReferenceCache warm 을 background thread 에서 업종 하나씩 진행 (29개 약 60s)
  lifespan 종료: warm thread 에 중지 신호 → 진행 중인 업종 1개가 끝나면 멈춘다 (최대 WARM_JOIN_TIMEOUT_S 대기)
  warm 되지 않은 업종은 ReferenceCache 가 요청 시 계산한다. 이미 계산된 키는 warm 중에도 잠금을 기다리지 않고,
  요청이 build 를 기다리면 warm 이 다음 build 를 미룬다 (8-D2a, scoring_engine/reference.py).

테스트: create_app(service=공유 서비스, warm_biz=[...]) — RuntimeData 를 다시 읽지 않고 지정 업종만 warm.

엔드포인트: GET /health (3-1), GET /businesses (3-2, 엔진 config.BIZ_GROUP 그대로),
            POST /analyze (3-3, ContextBuilder → AnalysisService, 엔진 결과는 변형 없이 result 에;
                           13-15 선택 필드 insights = 시군구 시간대 유입 원값 + 업종 영업 시간대 프로파일 — result 와 별개, 실패하면 null),
            POST /nearby-stores (4차, 반경 안 동종 점포 목록 — /analyze 와 같은 좌표 검증·엔진 반경·업종 기준, D-019),
            POST /places {q} (12-14, 장소 이름 검색 프록시 — backend/app/places.py, 키가 없으면 503, /health places.enabled 로 광고, D-036)
            POST /rank {lat, lng, radius_m?} (13-16, 한 지점의 29개 업종 기본 가중치 종합점수 순위 — "점수가 높은 업종"일 뿐 추천이 아니다.
                       엔진 analyze 29회, 프로세스 안 LRU 캐시 RANK_CACHE_MAX 건 — 같은 좌표·반경 재요청은 다시 계산하지 않는다)
            GET /stations (13-17, 엔진이 이미 읽은 인천권 물리적 역 목록 — RuntimeData.stations, xlsx 를 다시 읽지 않는다. 노선명은 없다)
분석 반경(8-D2, D-024): /analyze·/nearby-stores 의 선택 필드 radius_m(생략 = config.RADIUS_M 500). 엔진이 받는 값
          (scoring_engine.RADIUS_OPTIONS_M — v0.3 은 500 하나, v0.4 는 300·500·1,000)만, 그 밖은 422 invalid_radius.
          GET /health 의 engine.radius_options 로 광고한다(프런트는 2개 이상일 때만 반경 선택을 보인다).
데이터 버전(묶음 C, docs/DATA_VERSIONING.md): GET /health 의 data = {version, as_of: {역할 키: 자료 기준일}} — 이 프로세스가 읽은
          RuntimeData 의 버전 메타(환경변수 DATA_VERSION, 기본 data/runtime = 2026-06). /nearby-stores 의 as_of 도 같은 메타(shops)에서 온다.
          /analyze 응답 스키마는 바꾸지 않는다(프런트 Zod strict). 대신 /analyze·/nearby-stores 성공 응답 헤더 X-Data-Version 에
          데이터 버전 id 를 싣는다 — 프런트가 결과마다 데이터 버전을 알아 결과 캐시·A/B 비교를 버전별로 나눈다(9-C4, D-033).
frontend: frontend_dist(또는 환경변수 FRONTEND_DIST)를 주면 Vite build 를 같은 origin 에서 서빙한다 — API route 다음에
          붙어서 API 가 항상 우선, 나머지 GET 은 SPA fallback (backend/app/frontend.py, D-018). 주지 않으면 API 만.
오류 계약: backend/app/errors.py (3-5) — 사용자 입력·분석 불가 422, 내부 오류 500 + request_id
ContextBuilder 는 첫 /analyze 때 1회 만들어 app.state 에 둔다 (lazy — /health·/businesses 만 쓰는 앱은 만들지 않는다).
"""
from __future__ import annotations

import logging
import math
import os
import threading
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Annotated, Any, Iterable, Literal, Optional

from fastapi import FastAPI, Request, Response
from fastapi.routing import APIRoute
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, StrictFloat, StrictInt, StrictStr

from scoring_engine import ENGINE_VERSION, RADIUS_OPTIONS_M, config as C, scoring
from scoring_engine.location import ContextBuilder, InvalidCoordinate, LocationOutside, NoDataNearby
from scoring_engine.nearby import NearbyStoreFinder
from scoring_engine.runtime import resolve_data_version

from .ai import (ANALYZE_PER_MINUTE, ASK_PER_DAY, ASK_SCHEMA, ASK_TASK, MAX_HISTORY_TURNS, MAX_QUESTION_CHARS,
                 MAX_TURN_CHARS, PREFERRED, PROMPT_VERSION, STAGES, SUMMARY_NEW_PER_DAY, SUMMARY_SCHEMA, SUMMARY_TASK,
                 AiRefused, AiService, AiUpstreamError, MinuteLimiter, clean_items, context_json)
from .errors import (AI_BUDGET, AI_LIMITED, AI_UNAVAILABLE, AI_UPSTREAM, ERROR_RESPONSES, INVALID_ANALYSIS_OPTIONS,
                     INVALID_BUSINESS, INVALID_COORDINATE, INVALID_QUERY, INVALID_QUESTION, INVALID_RADIUS,
                     LOCATION_OUTSIDE, NO_DATA_NEARBY, PLACES_UNAVAILABLE, PLACES_UPSTREAM, RATE_LIMITED, ApiError,
                     ErrorDetail, error_json, install_error_handlers)
from .frontend import mount_frontend
from .places import MAX_QUERY_CHARS, PlacesClient, PlacesUpstreamError
from scoring_engine.service import AnalysisService

logger = logging.getLogger("backend.warm")
DATA_VERSION_HEADER = "X-Data-Version"   # /analyze·/nearby-stores 성공 응답의 데이터 버전 id (9-C4, D-033)
# 12-1: 응답 gzip. StaticFiles 도 Cloud Run 도 압축하지 않아 JS 525KB·행정동 GeoJSON 611KB 가 원본 크기로 내려갔다(약 1.38MB →
# gzip 약 0.40MB). Accept-Encoding: gzip 요청에만, 이 크기 이상의 본문만(작은 JSON·오류 응답은 그대로). 헤더(X-Data-Version·Cache-Control)는 유지된다
GZIP_MIN_BYTES = 1024


class Business(BaseModel):
    code: str           # 상권업종 소분류 코드 (config.CODE_NAME 키)
    name: str           # 업종명 (config.CODE_NAME 값)
    group: str          # 업종그룹 키 (config.CODE_GROUP 값, 예: "A_고객밀착형")


class BusinessGroup(BaseModel):
    code: str           # config.BIZ_GROUP 키
    name: str           # 표시명 = 키에서 "A_" 같은 접두어를 뗀 것
    businesses: list[Business]


class BusinessCatalog(BaseModel):
    groups: list[BusinessGroup]
    total: int


# 요청 경계 검증 (3-5): JSON 숫자만(문자열·bool 거부, coercion 없음), 유한값, 범위. 엔진 규칙과 같은 의미만 쓴다.
Perspective = Literal[tuple(C.PERSPECTIVES)]                                  # 엔진 config.PERSPECTIVES
Latitude = Annotated[StrictFloat, Field(ge=-90, le=90, allow_inf_nan=False)]
Longitude = Annotated[StrictFloat, Field(ge=-180, le=180, allow_inf_nan=False)]
ImportanceLevel = Annotated[StrictInt, Field(ge=1, le=5)]                       # 엔진: "1~5 정수"
Weight = Annotated[StrictFloat, Field(ge=0, allow_inf_nan=False)]               # 엔진: "0 이상의 숫자"
RadiusM = StrictInt                                                             # 값 검사는 엔드포인트(invalid_radius)


class AnalyzeRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr                                   # config.CODE_NAME 여부는 엔드포인트에서 (invalid_business)
    importance: Optional[dict[Perspective, ImportanceLevel]] = None
    user_weights: Optional[dict[Perspective, Weight]] = None
    user_licenses: Optional[list[StrictStr]] = None
    radius_m: Optional[RadiusM] = None                    # 8-D2: 생략·null = config.RADIUS_M


class AnalyzeContext(BaseModel):
    """ContextBuilder 가 만든 SiteContext 중 응답에 내보내는 필드."""
    lat: float
    lng: float
    gu_code: str
    gu_name: str
    dong_name: str
    label: str
    rent_area: Optional[str]     # MVP 일반 좌표는 R-ONE 임대료 상권을 연결하지 않아 항상 null (D-015)


class HourlyInflow(BaseModel):
    """시군구 생활이동 시간대 유입 (13-15) — 엔진이 시장성에 쓰는 RuntimeData.market 행의 원값 그대로(정규화하지 않음)."""
    gu_code: str
    gu_name: str
    as_of: Optional[str]         # 시장성 패널 자료 기준일 (데이터 버전 메타 market_panel)
    daily: float                 # 일평균_유입
    by_hour: list[float]         # h00..h23 24개
    work_ratio: Optional[float]


HOURS_PROFILE_NOTE = "업종별 영업 시간대 프로파일은 추정치입니다"


class InsightsRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr                                   # /analyze 와 같은 규칙 (invalid_business)


class InsightsResponse(BaseModel):
    """POST /insights 설명 자료 (13-15). 점수에 쓰이지 않는다. /analyze 응답과 분리한 이유: 배포 전부터 열려 있던 이전 화면은
    /analyze 를 strict 스키마로 검사해 모르는 필드가 오면 거절한다(Codex R1-3) — /analyze 는 v0.0.16 형태 그대로 둔다."""
    biz_code: str
    gu_code: str
    gu_name: str
    engine_version: str                      # 응답을 만든 프로세스의 엔진(= /analyze meta.엔진버전) — 화면의 버전 대조(R1-9)
    inflow: Optional[HourlyInflow]           # 시군구 행이 없으면 null
    hours_profile: Optional[list[float]]     # 엔진 config.HOUR_PROFILE[업종] (24개, 합 1) — 업종에 없으면 null
    hours_profile_note: Optional[str]        # HOURS_PROFILE_NOTE (hours_profile 이 있을 때)


class AnalyzeResponse(BaseModel):
    context: AnalyzeContext
    result: dict[str, Any]       # AnalysisService.analyze 반환 dict 그대로 (엔진 JSON 계약: docs/ENGINE.md)


class NearbyStoresRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr
    radius_m: Optional[RadiusM] = None                    # 8-D2: /analyze 와 같은 규칙


class NearbyStore(BaseModel):
    id: str                          # 상가업소번호
    name: Optional[str]              # 상호명 (없으면 null)
    road_address: Optional[str]      # 도로명주소 (없으면 null)
    jibun_address: Optional[str]     # 지번주소 (없으면 null)
    lat: float
    lng: float
    distance_m: int                  # 분석 지점과의 직선거리(m). 도보 거리가 아니다


class PlacesRequest(BaseModel):
    q: StrictStr                     # 장소 이름 (본문 — 요청 로그 경로에 검색어가 남지 않게 GET 쿼리를 쓰지 않는다)


class PlaceItem(BaseModel):
    name: str                        # 장소 이름 (NAVER title, 태그 제거)
    category: str
    road_address: Optional[str]
    jibun_address: Optional[str]
    lat: float                       # 좌표 선택용 — 분석 행정동은 /analyze 가 좌표로 판정한다
    lng: float


class PlacesResponse(BaseModel):
    count: int
    places: list[PlaceItem]


class NearbyStoresResponse(BaseModel):
    lat: float                       # 판정에 쓴 좌표 = 요청 좌표 (ContextBuilder 검증 후)
    lng: float
    biz_code: str
    radius_m: int                    # 쓴 분석 반경 (요청 radius_m, 생략이면 config.RADIUS_M)
    as_of: str                       # 상가(상권)정보 자료 기준일 (데이터 버전 메타 — RuntimeData.as_of("shops"))
    count: int                       # == len(stores) == 같은 조건 /analyze 의 경쟁성.raw.동종점포수
    stores: list[NearbyStore]        # 가까운 순


class SummaryRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr
    radius_m: Optional[RadiusM] = None


class AiItem(BaseModel):
    text: str
    fields: list[str]                        # 근거로 쓴 자료 키(예: 지표.competition.raw.동종점포수)


class SummaryResponse(BaseModel):
    """13-23 AI 요약. 점수는 바꾸지 않는다 — 엔진 결과를 읽어 문장으로만. cached: 같은 조건·데이터·엔진·프롬프트 버전의 저장분."""
    engine_version: str
    prompt_version: str
    model: str
    cached: bool
    good: list[AiItem]
    bad: list[AiItem]
    check: list[AiItem]


class AskTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: StrictStr


class AskProfile(BaseModel):
    """13-26 선택형 프로필(화면 로컬 저장, 요청 때만 보낸다)."""
    stage: Optional[Literal["예비", "1년 미만", "운영 중"]] = None
    youth: Optional[bool] = None
    preferred: Optional[list[StrictStr]] = None


class AskRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr
    radius_m: Optional[RadiusM] = None
    question: StrictStr
    history: list[AskTurn] = []
    profile: Optional[AskProfile] = None


class ProfileSuggestion(BaseModel):
    stage: Optional[str]
    youth: Optional[bool]
    preferred: Optional[list[str]]


class AskResponse(BaseModel):
    engine_version: str
    model: str
    answer: str
    fields: list[str]
    out_of_scope: bool
    profile_suggestion: Optional[ProfileSuggestion]


class RankRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    radius_m: Optional[RadiusM] = None                    # /analyze 와 같은 규칙 (invalid_radius)


class RankWeakest(BaseModel):
    key: str                         # 지표 key (종합.병목_지표)
    label: str                       # 지표 label (예: "경쟁성")
    score: Optional[float]           # 그 지표 점수 (없으면 null)


class RankItem(BaseModel):
    biz_code: str                    # config.CODE_NAME 키
    name: str                        # meta.업종
    group: str                       # meta.업종그룹
    overall: Optional[float]         # 종합.점수 (산출 불가면 null — 목록 끝)
    weakest: Optional[RankWeakest]   # 종합.병목_지표 에 해당하는 지표 (없으면 null)
    coverage: Optional[float]        # 종합.데이터_충족률 (없으면 null)
    regulated: bool                  # 경고 첫 줄이 학교구역 규제(⚠ … 학교 주변 영업 규제 업종) — 프런트 lib/warnings.isSchoolZoneWarning 과 같은 규칙
    warnings: int                    # len(경고)


class RankResponse(BaseModel):
    """한 지점의 업종별 종합점수 순위 — 기본 가중치만. '점수가 높은 업종'이지 추천이 아니다(면책 정책)."""
    lat: float
    lng: float
    radius_m: int
    gu_name: str
    dong_name: str
    count: int                       # == len(items) == len(config.CODE_NAME)
    items: list[RankItem]            # overall 내림차순(동점은 CODE_NAME 순서, null 은 끝)
    engine_version: str              # 계산한 엔진(= /analyze meta.엔진버전) — 화면이 분석 결과와 같은 엔진인지 확인한다(R1-9)


class Station(BaseModel):
    name: str                        # 표시명 (정규화된 역명 + "역", 예: "부평역")
    lat: float
    lng: float
    lines: list[str]                 # 노선명 — 엔진이 읽은 구조에 노선명이 없어 항상 [] (line_count 참고)
    transfer: bool                   # 환승 병합 결과 노선 레코드가 2개 이상
    line_count: int                  # 병합된 노선별 레코드 수 (엔진 stations.노선수)


class StationsResponse(BaseModel):
    count: int
    as_of: Optional[str]             # 역사 자료 기준일 (데이터 버전 메타 stations)
    stations: list[Station]


RANK_CACHE_MAX = 64                  # 13-16: 프로세스 안 /rank 결과 캐시 상한 (좌표 6자리·반경 키)


def rank_items(results: dict[str, dict]) -> list[RankItem]:
    """엔진 결과(업종코드 → analyze dict, CODE_NAME 순서) → 순위 항목. 정렬은 scoring_engine.service.ranking 과 같이
    종합점수 내림차순·stable(동점은 CODE_NAME 순서), 종합점수 null 은 끝."""
    items = []
    for biz in C.CODE_NAME:
        res = results.get(biz)
        if res is None:
            continue
        total = res["종합"]
        weak_key = total.get("병목_지표")
        weak = None
        if weak_key is not None:
            ind = next((i for i in res["지표"] if i["key"] == weak_key), None)
            if ind is not None:
                weak = RankWeakest(key=ind["key"], label=ind["label"], score=ind.get("score"))
        warnings = res.get("경고") or []
        first = warnings[0] if warnings and isinstance(warnings[0], str) else ""
        items.append(RankItem(biz_code=biz, name=res["meta"]["업종"], group=res["meta"]["업종그룹"],
                              overall=total.get("점수"), weakest=weak, coverage=total.get("데이터_충족률"),
                              regulated=first.startswith("⚠") and "학교 주변 영업 규제 업종" in first,
                              warnings=len(warnings)))
    items.sort(key=lambda it: (it.overall is None, -(it.overall if it.overall is not None else 0.0)))
    return items


def build_insights(rt, biz: str, gu_code: str, gu_name: str) -> InsightsResponse:
    """13-15: RuntimeData.market(시군구 행)과 엔진 config.HOUR_PROFILE 로 설명 자료를 만든다. 점수 계산과 무관. 예외는 호출자가 처리."""
    inflow = None
    rows = rt.market[rt.market["시군구코드"] == gu_code]
    if not rows.empty:
        g = rows.iloc[0]
        try:
            as_of = rt.as_of("market_panel")
        except KeyError:
            as_of = None
        work_ratio = g.get("work_ratio")
        inflow = HourlyInflow(gu_code=gu_code, gu_name=gu_name, as_of=as_of, daily=float(g["일평균_유입"]),
                              by_hour=[float(g[f"h{h:02d}"]) for h in range(24)],
                              work_ratio=None if work_ratio is None or not math.isfinite(float(work_ratio))
                              else float(work_ratio))
    profile = getattr(C, "HOUR_PROFILE", {}).get(biz)
    return InsightsResponse(biz_code=biz, gu_code=gu_code, gu_name=gu_name, engine_version=ENGINE_VERSION, inflow=inflow,
                            hours_profile=[float(x) for x in profile] if profile is not None else None,
                            hours_profile_note=HOURS_PROFILE_NOTE if profile is not None else None)


def station_list(stations_df) -> list[Station]:
    """RuntimeData.stations(etl_location.load_stations 결과: name·lat·lng·가중치·노선수) → 표시용 목록. 이름순."""
    out = []
    for row in stations_df.to_dict("records"):
        lat, lng = float(row["lat"]), float(row["lng"])
        if not (math.isfinite(lat) and math.isfinite(lng)):
            continue
        name = str(row["name"]).strip()
        n_lines = int(row.get("노선수") or 1)
        out.append(Station(name=name if name.endswith("역") else f"{name}역", lat=lat, lng=lng,
                           lines=[], transfer=n_lines > 1, line_count=n_lines))
    out.sort(key=lambda s: s.name)
    return out


# 12-9 분당 제한 대상(POST) — 분석 계열과 AI
LIMITED_PATHS = frozenset({"/analyze", "/nearby-stores", "/rank", "/insights", "/summary", "/ask"})
MESSAGES_RATE_LIMITED = "요청이 너무 많습니다. 잠시 뒤 다시 시도하세요."


def client_ip(request: Request) -> str:
    """Cloud Run 앞단이 X-Forwarded-For 끝에 붙인 값(없으면 연결 주소). 저장·로그하지 않는다 — 제한기의 해시 키로만."""
    fwd = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in fwd.split(",") if p.strip()]
    if parts:
        return parts[-1]
    return request.client.host if request.client else "unknown"


def resolve_radius(radius_m: Optional[int]) -> int:
    """요청 반경 → 쓸 반경. 엔진이 받지 않는 값은 사용자 오류(422 invalid_radius)."""
    radius = C.RADIUS_M if radius_m is None else radius_m
    if radius not in RADIUS_OPTIONS_M:
        raise ApiError(INVALID_RADIUS, f"지원하지 않는 분석 반경입니다(가능: {', '.join(f'{r}m' for r in RADIUS_OPTIONS_M)}).")
    return radius


def warm_tasks(biz_codes: list[str]) -> list[tuple[str, Optional[int]]]:
    """background warm 단위. 반경이 하나(v0.3)면 업종 단위 그대로(반경 None), 여럿(v0.4)이면 (업종, 반경) 단위로
    기본 반경(500)을 먼저 모두 끝낸 뒤 나머지 반경 — 종료 신호 뒤 남은 계산이 build 1개를 넘지 않게 한다."""
    if len(RADIUS_OPTIONS_M) == 1:
        return [(biz, None) for biz in biz_codes]
    radii = [C.RADIUS_M] + [r for r in RADIUS_OPTIONS_M if r != C.RADIUS_M]
    return [(biz, r) for r in radii for biz in biz_codes]


def business_catalog() -> BusinessCatalog:
    """엔진 config.BIZ_GROUP 을 그대로 옮긴다 (그룹·업종 순서 = 정의 순서). 업종 목록을 따로 두지 않는다."""
    groups = [BusinessGroup(code=g, name=g.split("_", 1)[1],
                            businesses=[Business(code=c, name=n, group=g) for c, n in members.items()])
              for g, members in C.BIZ_GROUP.items()]
    return BusinessCatalog(groups=groups, total=sum(len(g.businesses) for g in groups))

WARM_JOIN_TIMEOUT_S = 5.0     # 종료 시 대기 상한. 업종 1개 warm 은 약 2.5s (D-013), thread 는 daemon


class WarmProgress:
    """background warm 진행 상태. warm thread 가 쓰고 /health 가 읽는다."""

    def __init__(self, biz_codes: Iterable[str]):
        self.biz_codes = list(biz_codes)
        self.tasks = warm_tasks(self.biz_codes)
        self._lock = threading.Lock()
        self.completed = 0
        self.failed = False
        self.error: Optional[str] = None
        self.stop = threading.Event()
        self.thread: Optional[threading.Thread] = None

    @property
    def total(self) -> int:
        return len(self.tasks)

    def snapshot(self) -> dict:
        with self._lock:
            return {"completed": self.completed, "total": self.total,
                    "done": self.completed == self.total, "failed": self.failed, "error": self.error}

    def run(self, cache) -> None:
        for biz, radius in self.tasks:
            if self.stop.is_set():
                logger.info("warm 중지 (%d/%d)", self.completed, self.total)
                return
            label = biz if radius is None else f"{biz}@{radius}m"
            try:
                if radius is None:
                    cache.warm([biz])
                else:
                    cache.warm([biz], radii=[radius])
            except Exception as e:                       # noqa: BLE001 — 실패를 기록하고 멈춘다
                logger.exception("reference warm 실패: %s", label)
                with self._lock:
                    self.failed = True
                    self.error = f"{label}: {type(e).__name__}"
                return
            with self._lock:
                self.completed += 1
        logger.info("reference warm 완료 (%d/%d)", self.completed, self.total)

    def start(self, cache) -> None:
        self.thread = threading.Thread(target=self.run, args=(cache,), name="reference-warm", daemon=True)
        self.thread.start()

    def shutdown(self) -> None:
        self.stop.set()
        if self.thread is not None:
            self.thread.join(WARM_JOIN_TIMEOUT_S)
            if self.thread.is_alive():
                logger.warning("warm thread 가 %.0fs 안에 끝나지 않음 (daemon 이라 프로세스 종료는 막지 않는다)",
                               WARM_JOIN_TIMEOUT_S)


def create_app(service: Optional[AnalysisService] = None, warm_biz: Optional[Iterable[str]] = None,
               frontend_dist: Optional[str] = None, places: Optional[PlacesClient] = None,
               ai: Optional[AiService] = None, rate_limit_per_minute: Optional[int] = None) -> FastAPI:
    """service: 주입하면 그대로 쓴다 (RuntimeData 를 다시 읽지 않음). None 이면 lifespan 에서 1회 생성.
    warm_biz: background warm 대상. None 이면 config.CODE_NAME 29개 전체.
    frontend_dist: Vite build(dist/) 경로. 주면 API 뒤에 정적 파일·SPA fallback 을 붙인다 (D-018).
    places: 장소 검색 프록시(12-14). None 이면 환경변수 키로 만든다(키가 없으면 기능 꺼짐).
    ai: AI 요약·질문(13-23~27). None 이면 환경변수 ANTHROPIC_API_KEY 로 만든다(키가 없으면 기능 꺼짐).
    rate_limit_per_minute: 12-9 IP 분당 제한(분석 계열·AI 경로). None 이면 frontend 를 서빙하는 운영 앱에서만
      ANALYZE_PER_MINUTE(환경변수 API_RATE_LIMIT_PER_MINUTE 로 바꿈), 0 이면 끔."""
    biz_codes = list(C.CODE_NAME) if warm_biz is None else list(warm_biz)
    places_client = places if places is not None else PlacesClient.from_env()
    ai_service = ai if ai is not None else AiService.from_env()
    if rate_limit_per_minute is None:
        rate_limit_per_minute = int(os.environ.get("API_RATE_LIMIT_PER_MINUTE", ANALYZE_PER_MINUTE)) if frontend_dist else 0

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service = service if service is not None else AnalysisService()
        app.state.context_builder = None
        app.state.nearby_finder = None
        app.state.rank_cache = OrderedDict()           # 13-16: 프로세스 안 /rank 캐시 — 앱 생성마다 비어 있다
        app.state.stations = None                      # 13-17: 첫 /stations 때 1회 계산
        app.state.warm = WarmProgress(biz_codes)
        app.state.warm.start(app.state.service.cache)
        try:
            yield
        finally:
            app.state.warm.shutdown()

    # production(frontend 서빙)에서는 API 문서를 공개하지 않는다 (D-018). 인증이 아니다 — API 자체는 그대로 public
    docs = {} if not frontend_dist else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="인천 상권분석 API", lifespan=lifespan, **docs)
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MIN_BYTES)
    install_error_handlers(app)
    app.state.ai = ai_service
    minute_limiter = MinuteLimiter(rate_limit_per_minute) if rate_limit_per_minute > 0 else None

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        """12-9: 분석 계열·AI 경로의 IP 분당 제한. IP 는 해시로 메모리에만(로그·저장 없음)."""
        if minute_limiter is not None and request.method == "POST" and request.url.path in LIMITED_PATHS:
            if not minute_limiter.allow(client_ip(request)):
                return error_json(429, ErrorDetail(code=RATE_LIMITED, message=MESSAGES_RATE_LIMITED))
        return await call_next(request)
    app.state.service = None
    app.state.warm = None
    app.state.context_builder = None
    app.state.nearby_finder = None
    app.state.rank_cache = OrderedDict()
    app.state.stations = None
    builder_lock = threading.Lock()
    rank_lock = threading.Lock()
    rank_inflight: dict = {}                       # /rank 키 → [잠금, 참조 수] (단일 계산, 쓰는 요청이 0이 되면 지운다)
    app.state.rank_inflight = rank_inflight

    def context_builder() -> ContextBuilder:
        """앱 수명 동안 1개. 동시 첫 요청이 여러 개 만들지 않도록 lock 으로 한 번만 생성한다."""
        if app.state.context_builder is None:
            with builder_lock:
                if app.state.context_builder is None:
                    app.state.context_builder = ContextBuilder(app.state.service.rt)
        return app.state.context_builder

    def nearby_finder() -> NearbyStoreFinder:
        """앱 수명 동안 1개 (RuntimeData 의 상가 배열을 잡아 둔다). context_builder 와 같은 lock 규칙."""
        if app.state.nearby_finder is None:
            with builder_lock:
                if app.state.nearby_finder is None:
                    app.state.nearby_finder = NearbyStoreFinder(app.state.service.rt)
        return app.state.nearby_finder

    def resolve_context(lat: float, lng: float):
        """/analyze·/nearby-stores 공통 좌표 검증 → SiteContext. 오류 코드는 D-014 계약 그대로."""
        try:
            return context_builder().build(lat, lng)
        except InvalidCoordinate as e:
            raise ApiError(INVALID_COORDINATE) from e
        except LocationOutside as e:
            raise ApiError(LOCATION_OUTSIDE) from e
        except NoDataNearby as e:
            raise ApiError(NO_DATA_NEARBY) from e

    def data_health() -> dict:
        """이 프로세스의 데이터 버전 메타. service 가 RuntimeData 를 들고 있으면 그 버전, 아니면(시작 전·주입된 가짜 service)
        같은 규칙(DATA_VERSION)으로 결정한 버전 — 파일을 읽지 않는다."""
        rt = getattr(app.state.service, "rt", None)
        version = getattr(rt, "version", None)
        return (version or resolve_data_version()).health()

    @app.get("/health")
    def health() -> dict:
        warm = app.state.warm
        return {"status": "ok",
                "service_ready": app.state.service is not None,
                # 8-D2: 이 서버 엔진이 받는 분석 반경. 프런트는 radius_options 가 2개 이상일 때만 반경 선택을 보인다
                "engine": {"version": ENGINE_VERSION, "radius_options": list(RADIUS_OPTIONS_M),
                           "default_radius_m": C.RADIUS_M},
                # 묶음 C: 데이터 버전과 역할별 자료 기준일 (docs/DATA_VERSIONING.md §4)
                "data": data_health(),
                # 12-14: 장소 이름 검색 광고 — 프런트는 enabled 일 때만 "장소 이름" 입력 방법을 보인다
                "places": {"enabled": places_client.enabled},
                # 13-23: AI 요약·질문 광고 — enabled·예산 상태(ok|warn|closed). 금액은 내보내지 않는다
                "ai": ai_service.health(),
                "warm": warm.snapshot() if warm is not None else
                {"completed": 0, "total": len(biz_codes), "done": False, "failed": False, "error": None}}

    @app.get("/businesses", response_model=BusinessCatalog)
    def businesses() -> BusinessCatalog:
        """분석 가능한 업종 (엔진 config). service·warm 상태와 무관하게 즉시 응답한다."""
        return business_catalog()

    def stamp_data_version(response: Response) -> None:
        """성공 응답에 이 프로세스의 데이터 버전 id 를 헤더로 싣는다 (9-C4, D-033). 응답 본문은 그대로다."""
        response.headers[DATA_VERSION_HEADER] = data_health()["version"]

    @app.post("/analyze", response_model=AnalyzeResponse, responses=ERROR_RESPONSES)
    def analyze(req: AnalyzeRequest, response: Response) -> AnalyzeResponse:
        """좌표·업종 분석. warm 되지 않은 업종은 ReferenceCache 가 요청 시 계산한다 (warm 완료를 기다리지 않음)."""
        if req.biz_code not in C.CODE_NAME:
            raise ApiError(INVALID_BUSINESS)
        try:   # 엔진 analyze() 가 처음 하는 일과 같은 호출 (순수 함수). 여기 ValueError 만 사용자 옵션 오류로 본다
            scoring.resolve_weights(C.group_of(req.biz_code), req.user_weights, req.importance)
        except ValueError as e:
            raise ApiError(INVALID_ANALYSIS_OPTIONS, str(e)) from e
        radius = resolve_radius(req.radius_m)
        ctx = resolve_context(req.lat, req.lng)
        # 이후 예외(ContextDataError 포함, analyze 안의 ValueError 도)는 내부 오류 → 500 (errors.install_error_handlers)
        result = app.state.service.analyze(ctx, req.biz_code, user_weights=req.user_weights,
                                           importance=req.importance, user_licenses=req.user_licenses,
                                           radius_m=radius)
        stamp_data_version(response)
        return AnalyzeResponse(
            context=AnalyzeContext(lat=ctx.lat, lng=ctx.lng, gu_code=ctx.gu_code, gu_name=ctx.gu_name,
                                   dong_name=ctx.dong_name, label=ctx.label, rent_area=ctx.rent_area),
            result=result)

    @app.post("/insights", response_model=InsightsResponse, responses=ERROR_RESPONSES)
    def insights(req: InsightsRequest, response: Response) -> InsightsResponse:
        """시간대·인구 카드 설명 자료 (13-15): 좌표의 시군구 24시간 유입(엔진 시장성 패널 원값) + 업종 영업시간 프로파일.
        /analyze 와 같은 순서로 검증한다: 업종 → 좌표. 엔진 analyze 는 부르지 않고 점수와 무관하다(실패는 오류 계약 500)."""
        if req.biz_code not in C.CODE_NAME:
            raise ApiError(INVALID_BUSINESS)
        ctx = resolve_context(req.lat, req.lng)
        out = build_insights(app.state.service.rt, req.biz_code, ctx.gu_code, ctx.gu_name)
        stamp_data_version(response)
        return out

    @app.post("/nearby-stores", response_model=NearbyStoresResponse, responses=ERROR_RESPONSES)
    def nearby_stores(req: NearbyStoresRequest, response: Response) -> NearbyStoresResponse:
        """반경(요청 radius_m, 생략이면 config.RADIUS_M) 안 같은 업종 점포 (표시용). 엔진 경쟁성과 같은 거리·반경·업종 기준 (scoring_engine/nearby.py).
        /analyze 와 같은 순서로 검증한다: 업종 → 반경 → 좌표(ContextBuilder). 엔진 analyze 는 부르지 않는다."""
        if req.biz_code not in C.CODE_NAME:
            raise ApiError(INVALID_BUSINESS)
        radius = resolve_radius(req.radius_m)
        ctx = resolve_context(req.lat, req.lng)
        finder = nearby_finder()
        stores = finder.find(ctx.lat, ctx.lng, req.biz_code, radius_m=radius)
        stamp_data_version(response)
        return NearbyStoresResponse(lat=ctx.lat, lng=ctx.lng, biz_code=req.biz_code, radius_m=radius,
                                    as_of=finder.as_of, count=len(stores),
                                    stores=[NearbyStore(**vars(s)) for s in stores])

    @app.post("/places", response_model=PlacesResponse, responses=ERROR_RESPONSES)
    def places_search(req: PlacesRequest) -> PlacesResponse:
        """장소 이름 검색 프록시 (12-14, D-036). 검색어는 서버 로그(요청 로그 포함)에 남기지 않는다. 결과는 좌표 선택용일 뿐이다."""
        query = req.q.strip()
        if not query or len(query) > MAX_QUERY_CHARS:
            raise ApiError(INVALID_QUERY)
        if not places_client.enabled:
            raise ApiError(PLACES_UNAVAILABLE, status=503)
        try:
            found = places_client.search(query)
        except PlacesUpstreamError as e:
            raise ApiError(PLACES_UPSTREAM, status=502) from e
        return PlacesResponse(count=len(found), places=[PlaceItem(**vars(p)) for p in found])

    def ai_inputs(lat: float, lng: float, biz: str, radius_m: Optional[int]):
        """AI 입력 자료: 엔진 결과(ReferenceCache 재사용)·시간대 자료·이미 계산된 업종 순위 상위 5(없으면 넣지 않는다 — 29업종을 새로 돌리지 않는다)."""
        if biz not in C.CODE_NAME:
            raise ApiError(INVALID_BUSINESS)
        radius = resolve_radius(radius_m)
        ctx = resolve_context(lat, lng)
        result = app.state.service.analyze(ctx, biz, radius_m=radius)
        try:
            ins = build_insights(app.state.service.rt, biz, ctx.gu_code, ctx.gu_name).model_dump()
        except Exception:                                # noqa: BLE001 — 설명 자료가 없어도 요약은 만든다
            ins = None
        with rank_lock:
            hit = app.state.rank_cache.get((round(ctx.lat, 6), round(ctx.lng, 6), radius))
        top = [{"업종": i.name, "종합": i.overall} for i in hit.items[:5]] if hit is not None else None
        context = {"gu_name": ctx.gu_name, "dong_name": ctx.dong_name}
        return ctx, radius, result, context, ins, top

    def require_ai() -> AiService:
        if not ai_service.enabled:
            raise ApiError(AI_UNAVAILABLE, status=503)
        return ai_service

    @app.post("/summary", response_model=SummaryResponse, responses=ERROR_RESPONSES)
    def summary(req: SummaryRequest, request: Request, response: Response) -> SummaryResponse:
        """13-23 AI 요약: 좋은 점·주의할 점·확인할 것(각 근거 키). 같은 조건(좌표 4자리·업종·반경·데이터·엔진·프롬프트 버전)은 캐시 —
        캐시는 하루 횟수·예산과 무관하게 준다. 새로 만들 때만 IP 하루 20회·월 예산을 본다."""
        svc = require_ai()
        ctx, radius, result, context, ins, top = ai_inputs(req.lat, req.lng, req.biz_code, req.radius_m)
        data_version = data_health()["version"]
        key = "|".join(map(str, (round(ctx.lat, 4), round(ctx.lng, 4), req.biz_code, radius, data_version, ENGINE_VERSION,
                                 PROMPT_VERSION)))
        stamp_data_version(response)
        cached = svc.cache.get(key)
        if cached is not None:
            return SummaryResponse(**{**cached, "cached": True})
        if svc.budget.level() == "closed":
            raise ApiError(AI_BUDGET, status=429)
        if not svc.limiter.take("summary", client_ip(request), SUMMARY_NEW_PER_DAY):
            raise ApiError(AI_LIMITED, status=429)
        try:
            out = svc.call(SUMMARY_TASK, context_json(result, context, ins, top, None), [], SUMMARY_SCHEMA, 2000)
        except (AiUpstreamError, AiRefused) as e:
            logging.getLogger("backend.ai").warning("요약 생성 실패: %s", type(e).__name__)
            raise ApiError(AI_UPSTREAM, status=502) from e
        body = {"engine_version": ENGINE_VERSION, "prompt_version": PROMPT_VERSION, "model": out.model,
                "good": clean_items(out.data.get("good"), 3), "bad": clean_items(out.data.get("bad"), 3),
                "check": clean_items(out.data.get("check"), 2)}
        svc.cache.put(key, body)
        svc.store.append_log({"at": svc.clock().isoformat(timespec="seconds"), "kind": "summary", "biz": req.biz_code,
                              "gu": ctx.gu_name, "radius_m": radius, "output": {k: body[k] for k in ("good", "bad", "check")}},
                             svc.clock())
        return SummaryResponse(**{**body, "cached": False})

    @app.post("/ask", response_model=AskResponse, responses=ERROR_RESPONSES)
    def ask(req: AskRequest, request: Request, response: Response) -> AskResponse:
        """13-24 자유 질문: 그 분석 자료 안에서만 답한다(최근 6턴). IP 하루 10회, 월 예산 소진이면 닫힘. 질문·답변 원문은 30일 로그(좌표·IP 없음)."""
        svc = require_ai()
        question = req.question.strip()
        if not question or len(question) > MAX_QUESTION_CHARS:
            raise ApiError(INVALID_QUESTION)
        ctx, radius, result, context, ins, top = ai_inputs(req.lat, req.lng, req.biz_code, req.radius_m)
        if svc.budget.level() == "closed":
            raise ApiError(AI_BUDGET, status=429)
        if not svc.limiter.take("ask", client_ip(request), ASK_PER_DAY):
            raise ApiError(AI_LIMITED, status=429)
        turns = [{"role": t.role, "content": t.content[:MAX_TURN_CHARS]} for t in req.history][-MAX_HISTORY_TURNS:]
        turns.append({"role": "user", "content": question})
        profile = None
        if req.profile is not None:
            profile = {"창업단계": req.profile.stage, "청년": req.profile.youth,
                       "우대": [p for p in (req.profile.preferred or []) if p in PREFERRED] or None}
        stamp_data_version(response)
        try:
            out = svc.call(ASK_TASK, context_json(result, context, ins, top, profile), turns, ASK_SCHEMA, 1500)
            answer = str(out.data.get("answer", "")).strip()[:1500]
            fields = [f for f in out.data.get("fields", []) if isinstance(f, str)][:6]
            oos = bool(out.data.get("out_of_scope"))
            sug = out.data.get("profile_suggestion")
            model = out.model
        except AiRefused:
            answer, fields, oos, sug, model = "이 질문에는 답할 수 없어요. 분석 결과나 이 자리에 관한 질문을 해 주세요.", [], True, None, "refused"
        except AiUpstreamError as e:
            logging.getLogger("backend.ai").warning("질문 답변 실패: %s", e)
            raise ApiError(AI_UPSTREAM, status=502) from e
        suggestion = None
        if isinstance(sug, dict):
            stage = sug.get("stage") if sug.get("stage") in STAGES else None
            youth = sug.get("youth") if isinstance(sug.get("youth"), bool) else None
            pref = [p for p in (sug.get("preferred") or []) if p in PREFERRED] or None
            if stage or youth is not None or pref:
                suggestion = ProfileSuggestion(stage=stage, youth=youth, preferred=pref)
        svc.store.append_log({"at": svc.clock().isoformat(timespec="seconds"), "kind": "ask", "biz": req.biz_code,
                              "gu": ctx.gu_name, "radius_m": radius, "question": question, "answer": answer,
                              "out_of_scope": oos}, svc.clock())
        return AskResponse(engine_version=ENGINE_VERSION, model=model, answer=answer or "답을 만들지 못했어요.",
                           fields=fields, out_of_scope=oos, profile_suggestion=suggestion)

    @app.post("/rank", response_model=RankResponse, responses=ERROR_RESPONSES)
    def rank(req: RankRequest, response: Response) -> RankResponse:
        """한 지점의 29개 업종 종합점수 순위 (13-16). 기본 가중치만(importance·user_weights 없음) — 결과는 '점수가 높은 업종'이지
        추천이 아니다. /analyze 와 같은 순서로 검증한다: 반경 → 좌표. 엔진 analyze 를 업종마다 1회 부르고(점수 변형 없음),
        같은 좌표(소수 6자리)·반경의 재요청은 프로세스 안 LRU 캐시(RANK_CACHE_MAX)에서 돌려준다."""
        radius = resolve_radius(req.radius_m)
        ctx = resolve_context(req.lat, req.lng)
        key = (round(ctx.lat, 6), round(ctx.lng, 6), radius)
        cache: OrderedDict = app.state.rank_cache
        with rank_lock:
            hit = cache.get(key)
            if hit is not None:
                cache.move_to_end(key)
            else:
                # 같은 키의 동시 요청은 한 번만 계산한다(Codex R1 개발자 1). 키별 [잠금, 참조 수] — 이 키를 기다리거나 계산하는
                # 요청이 하나라도 남아 있으면 등록을 지우지 않는다(R1-10: 첫 계산이 실패해도 대기자와 새 요청이 같은 잠금을 쓴다).
                # 마지막 요청이 나가며 지워 잠금이 쌓이지 않고, 다른 키는 서로 기다리지 않는다
                entry = rank_inflight.get(key)
                if entry is None:
                    entry = rank_inflight[key] = [threading.Lock(), 0]
                entry[1] += 1
        if hit is None:
            try:
                with entry[0]:
                    with rank_lock:
                        hit = cache.get(key)
                    if hit is None:      # 앞 요청이 실패했으면 대기자가 이어서 계산한다(예외는 그 요청에만 — 500 오류 계약)
                        results = {biz: app.state.service.analyze(ctx, biz, radius_m=radius) for biz in C.CODE_NAME}
                        items = rank_items(results)
                        hit = RankResponse(lat=ctx.lat, lng=ctx.lng, radius_m=radius, gu_name=ctx.gu_name,
                                           dong_name=ctx.dong_name, count=len(items), items=items,
                                           engine_version=ENGINE_VERSION)
                        with rank_lock:
                            cache[key] = hit
                            cache.move_to_end(key)
                            while len(cache) > RANK_CACHE_MAX:
                                cache.popitem(last=False)
            finally:
                with rank_lock:
                    entry[1] -= 1
                    if entry[1] == 0 and rank_inflight.get(key) is entry:
                        del rank_inflight[key]
        stamp_data_version(response)
        return hit

    @app.get("/stations", response_model=StationsResponse)
    def stations(response: Response) -> StationsResponse:
        """엔진이 이미 읽은 인천권 물리적 역 목록 (13-17). RuntimeData.stations(환승 병합 뒤)를 첫 요청 때 1회 변환해 둔다 —
        xlsx 를 다시 읽지 않고 외부 API 도 부르지 않는다. 노선명은 엔진 구조에 없어 lines 는 비어 있고 line_count 만 있다."""
        if app.state.stations is None:
            with builder_lock:
                if app.state.stations is None:
                    rt = app.state.service.rt
                    as_of = None
                    try:
                        as_of = rt.as_of("stations")
                    except KeyError:
                        pass
                    items = station_list(rt.stations)
                    app.state.stations = StationsResponse(count=len(items), as_of=as_of, stations=items)
        stamp_data_version(response)
        return app.state.stations

    if frontend_dist:   # API route 를 모두 등록한 뒤에 붙인다 — route 순서상 API 가 먼저 매칭된다
        # API 경로는 등록된 route 에서 읽는다 — 손으로 적은 목록은 새 엔드포인트(/insights)를 빠뜨려 GET 이 index.html(200)로
        # 떨어졌다(v0.1.0 무트래픽 smoke). 다른 method 는 405 로 남는다
        mount_frontend(app, frontend_dist, api_paths={r.path for r in app.routes if isinstance(r, APIRoute)},
                       hidden_paths={"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"})
    return app


app = create_app(frontend_dist=os.environ.get("FRONTEND_DIST") or None)
