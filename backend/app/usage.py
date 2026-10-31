"""
사용 현황 구조화 로그 (TASKS 12-10) — 분석 계열·AI·지원사업 POST 요청마다 JSON 한 줄.

남기는 것: 경로·HTTP 상태·결과 코드(ok 또는 오류 계약 code)·지연(ms)·업종 코드·구 이름·반경. **좌표·IP·질문 원문·개인정보는 넣지 않는다**
(note() 가 FIELDS 밖 키를 버린다). 클라이언트 분석 도구는 쓰지 않는다.
Cloud Run 은 표준출력의 JSON 한 줄을 구조화 로그(jsonPayload)로 읽는다 — severity·message 를 함께 쓴다.

요청마다 미들웨어가 USAGE 에 새 dict 를 두고(start), 좌표 판정·처리 함수·오류 처리기가 note() 로 채운 뒤 응답 때 emit() 한다.
dict 를 바꾸는 방식이라 동기 처리 함수(스레드)·하위 task 에서 적어도 미들웨어가 읽는다(contextvar 는 복사되지만 같은 dict 를 가리킨다).
"""
from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any, Optional

FIELDS = ("biz", "gu", "radius", "code", "cached")
USAGE: ContextVar[Optional[dict]] = ContextVar("usage", default=None)

logger = logging.getLogger("backend.usage")
if not any(getattr(h, "_usage_handler", False) for h in logger.handlers):
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(logging.Formatter("%(message)s"))
    _h._usage_handler = True                          # type: ignore[attr-defined]
    logger.addHandler(_h)
logger.setLevel(logging.INFO)


def start() -> dict:
    d: dict = {}
    USAGE.set(d)
    return d


def note(**kw: Any) -> None:
    """지금 요청의 사용 기록에 값을 더한다(FIELDS 밖 키·None 은 버린다). 기록 중이 아니면 아무것도 안 한다."""
    d = USAGE.get()
    if d is None:
        return
    for k, v in kw.items():
        if k in FIELDS and v is not None and k not in d:     # 먼저 적힌 값(첫 오류 코드 등)을 지키지 않고 덮지 않는다
            d[k] = v


def emit(path: str, status: int, ms: float, d: dict) -> dict:
    record = {"path": path, "status": status, "code": d.get("code") or ("ok" if status < 400 else f"http_{status}"),
              "ms": round(ms), **{k: d[k] for k in ("biz", "gu", "radius", "cached") if k in d}}
    logger.info(json.dumps({"severity": "INFO", "message": "usage", "usage": record}, ensure_ascii=False))
    return record
