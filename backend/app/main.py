"""
FastAPI backend (TASKS 3-1, docs/DECISIONS.md D-012).

  python -m uvicorn backend.app.main:app --reload

수명 주기
  import 시점에는 아무것도 읽지 않는다 (module-level app 은 create_app() 결과일 뿐).
  lifespan 시작: AnalysisService 1회 생성(RuntimeData 로드, 약 4s) → 요청 수신 시작
                 → ReferenceCache warm 을 background thread 에서 업종 하나씩 진행 (29개 약 60s)
  lifespan 종료: warm thread 에 중지 신호 → 진행 중인 업종 1개가 끝나면 멈춘다 (최대 WARM_JOIN_TIMEOUT_S 대기)
  warm 되지 않은 업종은 ReferenceCache 가 요청 시 계산한다 (기존 lock·caching 그대로).

테스트: create_app(service=공유 서비스, warm_biz=[...]) — RuntimeData 를 다시 읽지 않고 지정 업종만 warm.

엔드포인트: GET /health (3-1), GET /businesses (3-2, 엔진 config.BIZ_GROUP 그대로),
            POST /analyze (3-3, ContextBuilder → AnalysisService, 엔진 결과는 변형 없이 result 에)
오류 계약: backend/app/errors.py (3-5) — 사용자 입력·분석 불가 422, 내부 오류 500 + request_id
ContextBuilder 는 첫 /analyze 때 1회 만들어 app.state 에 둔다 (lazy — /health·/businesses 만 쓰는 앱은 만들지 않는다).
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Annotated, Any, Iterable, Literal, Optional

from fastapi import FastAPI
from pydantic import BaseModel, Field, StrictFloat, StrictInt, StrictStr

from scoring_engine import config as C, scoring
from scoring_engine.location import ContextBuilder, InvalidCoordinate, LocationOutside, NoDataNearby

from .errors import (ERROR_RESPONSES, INVALID_ANALYSIS_OPTIONS, INVALID_BUSINESS, INVALID_COORDINATE,
                     LOCATION_OUTSIDE, NO_DATA_NEARBY, ApiError, install_error_handlers)
from scoring_engine.service import AnalysisService

logger = logging.getLogger("backend.warm")


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


class AnalyzeRequest(BaseModel):
    lat: Latitude
    lng: Longitude
    biz_code: StrictStr                                   # config.CODE_NAME 여부는 엔드포인트에서 (invalid_business)
    importance: Optional[dict[Perspective, ImportanceLevel]] = None
    user_weights: Optional[dict[Perspective, Weight]] = None
    user_licenses: Optional[list[StrictStr]] = None


class AnalyzeContext(BaseModel):
    """ContextBuilder 가 만든 SiteContext 중 응답에 내보내는 필드."""
    lat: float
    lng: float
    gu_code: str
    gu_name: str
    dong_name: str
    label: str
    rent_area: Optional[str]     # 일반 좌표는 항상 null (TASKS 1-6 미결정)


class AnalyzeResponse(BaseModel):
    context: AnalyzeContext
    result: dict[str, Any]       # AnalysisService.analyze 반환 dict 그대로 (엔진 JSON 계약: docs/ENGINE.md)


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
        self._lock = threading.Lock()
        self.completed = 0
        self.failed = False
        self.error: Optional[str] = None
        self.stop = threading.Event()
        self.thread: Optional[threading.Thread] = None

    @property
    def total(self) -> int:
        return len(self.biz_codes)

    def snapshot(self) -> dict:
        with self._lock:
            return {"completed": self.completed, "total": self.total,
                    "done": self.completed == self.total, "failed": self.failed, "error": self.error}

    def run(self, cache) -> None:
        for biz in self.biz_codes:
            if self.stop.is_set():
                logger.info("warm 중지 (%d/%d)", self.completed, self.total)
                return
            try:
                cache.warm([biz])
            except Exception as e:                       # noqa: BLE001 — 실패를 기록하고 멈춘다
                logger.exception("reference warm 실패: %s", biz)
                with self._lock:
                    self.failed = True
                    self.error = f"{biz}: {type(e).__name__}"
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


def create_app(service: Optional[AnalysisService] = None, warm_biz: Optional[Iterable[str]] = None) -> FastAPI:
    """service: 주입하면 그대로 쓴다 (RuntimeData 를 다시 읽지 않음). None 이면 lifespan 에서 1회 생성.
    warm_biz: background warm 대상. None 이면 config.CODE_NAME 29개 전체."""
    biz_codes = list(C.CODE_NAME) if warm_biz is None else list(warm_biz)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service = service if service is not None else AnalysisService()
        app.state.context_builder = None
        app.state.warm = WarmProgress(biz_codes)
        app.state.warm.start(app.state.service.cache)
        try:
            yield
        finally:
            app.state.warm.shutdown()

    app = FastAPI(title="인천 상권분석 API", lifespan=lifespan)
    install_error_handlers(app)
    app.state.service = None
    app.state.warm = None
    app.state.context_builder = None
    builder_lock = threading.Lock()

    def context_builder() -> ContextBuilder:
        """앱 수명 동안 1개. 동시 첫 요청이 여러 개 만들지 않도록 lock 으로 한 번만 생성한다."""
        if app.state.context_builder is None:
            with builder_lock:
                if app.state.context_builder is None:
                    app.state.context_builder = ContextBuilder(app.state.service.rt)
        return app.state.context_builder

    @app.get("/health")
    def health() -> dict:
        warm = app.state.warm
        return {"status": "ok",
                "service_ready": app.state.service is not None,
                "warm": warm.snapshot() if warm is not None else
                {"completed": 0, "total": len(biz_codes), "done": False, "failed": False, "error": None}}

    @app.get("/businesses", response_model=BusinessCatalog)
    def businesses() -> BusinessCatalog:
        """분석 가능한 업종 (엔진 config). service·warm 상태와 무관하게 즉시 응답한다."""
        return business_catalog()

    @app.post("/analyze", response_model=AnalyzeResponse, responses=ERROR_RESPONSES)
    def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
        """좌표·업종 분석. warm 되지 않은 업종은 ReferenceCache 가 요청 시 계산한다 (warm 완료를 기다리지 않음)."""
        if req.biz_code not in C.CODE_NAME:
            raise ApiError(INVALID_BUSINESS)
        try:   # 엔진 analyze() 가 처음 하는 일과 같은 호출 (순수 함수). 여기 ValueError 만 사용자 옵션 오류로 본다
            scoring.resolve_weights(C.group_of(req.biz_code), req.user_weights, req.importance)
        except ValueError as e:
            raise ApiError(INVALID_ANALYSIS_OPTIONS, str(e)) from e
        try:
            ctx = context_builder().build(req.lat, req.lng)
        except InvalidCoordinate as e:
            raise ApiError(INVALID_COORDINATE) from e
        except LocationOutside as e:
            raise ApiError(LOCATION_OUTSIDE) from e
        except NoDataNearby as e:
            raise ApiError(NO_DATA_NEARBY) from e
        # 이후 예외(ContextDataError 포함, analyze 안의 ValueError 도)는 내부 오류 → 500 (errors.install_error_handlers)
        result = app.state.service.analyze(ctx, req.biz_code, user_weights=req.user_weights,
                                           importance=req.importance, user_licenses=req.user_licenses)
        return AnalyzeResponse(
            context=AnalyzeContext(lat=ctx.lat, lng=ctx.lng, gu_code=ctx.gu_code, gu_name=ctx.gu_name,
                                   dong_name=ctx.dong_name, label=ctx.label, rent_area=ctx.rent_area),
            result=result)

    return app


app = create_app()
