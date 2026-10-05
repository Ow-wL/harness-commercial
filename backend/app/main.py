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
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Iterable, Optional

from fastapi import FastAPI

from scoring_engine import config as C
from scoring_engine.service import AnalysisService

logger = logging.getLogger("backend.warm")

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
        app.state.warm = WarmProgress(biz_codes)
        app.state.warm.start(app.state.service.cache)
        try:
            yield
        finally:
            app.state.warm.shutdown()

    app = FastAPI(title="인천 상권분석 API", lifespan=lifespan)
    app.state.service = None
    app.state.warm = None

    @app.get("/health")
    def health() -> dict:
        warm = app.state.warm
        return {"status": "ok",
                "service_ready": app.state.service is not None,
                "warm": warm.snapshot() if warm is not None else
                {"completed": 0, "total": len(biz_codes), "done": False, "failed": False, "error": None}}

    return app


app = create_app()
