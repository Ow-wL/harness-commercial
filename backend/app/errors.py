"""
API 오류 계약 (TASKS 3-5, docs/DECISIONS.md D-014).

  사용자 입력·분석 불가 → 422  {"error": {"code", "message"}}
  서버 내부 오류        → 500  {"error": {"code": "internal_error", "message", "request_id"}}
frontend 는 status 로 사용자/서버 오류를 나누고 error.code 로 원인을 나눈다 (message 로 분기하지 않는다).
500 응답에는 traceback·예외 메시지·클래스 이름을 넣지 않는다. traceback 은 request_id 와 함께 server log 에만.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger("backend.errors")

# 안정적인 error.code — 바꾸면 frontend 계약이 깨진다
INVALID_REQUEST = "invalid_request"
INVALID_COORDINATE = "invalid_coordinate"
LOCATION_OUTSIDE = "location_outside"
NO_DATA_NEARBY = "no_data_nearby"
INVALID_BUSINESS = "invalid_business"
INVALID_ANALYSIS_OPTIONS = "invalid_analysis_options"
INTERNAL_ERROR = "internal_error"

MESSAGES = {
    INVALID_REQUEST: "요청 값이 올바르지 않습니다.",
    INVALID_COORDINATE: "좌표 값이 올바르지 않습니다.",
    LOCATION_OUTSIDE: "인천 내 분석 가능한 위치가 아닙니다.",
    NO_DATA_NEARBY: "주변 500m 내 상가 데이터가 없어 분석할 수 없습니다.",
    INVALID_BUSINESS: "지원하지 않는 업종 코드입니다.",
    INVALID_ANALYSIS_OPTIONS: "분석 옵션(중요도·가중치)이 올바르지 않습니다.",
    INTERNAL_ERROR: "서버 내부 오류가 발생했습니다.",
}


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: Optional[str] = None    # 500 에서만 채운다


class ErrorResponse(BaseModel):
    error: ErrorDetail


class ApiError(Exception):
    """사용자가 고칠 수 있는 오류 (422). message 는 사용자에게 보여도 안전한 문구만."""

    def __init__(self, code: str, message: Optional[str] = None):
        super().__init__(code)
        self.code = code
        self.message = message or MESSAGES[code]


def error_json(status: int, detail: ErrorDetail) -> JSONResponse:
    return JSONResponse(status_code=status, content=ErrorResponse(error=detail).model_dump(exclude_none=True))


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_json(422, ErrorDetail(code=exc.code, message=exc.message))

    @app.exception_handler(RequestValidationError)
    async def request_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_json(422, ErrorDetail(code=INVALID_REQUEST, message=MESSAGES[INVALID_REQUEST]))

    @app.exception_handler(Exception)
    async def internal(request: Request, exc: Exception) -> JSONResponse:
        request_id = uuid.uuid4().hex
        logger.error("internal_error request_id=%s %s %s", request_id, request.method, request.url.path,
                     exc_info=(type(exc), exc, exc.__traceback__))
        return error_json(500, ErrorDetail(code=INTERNAL_ERROR, message=MESSAGES[INTERNAL_ERROR],
                                           request_id=request_id))


ERROR_RESPONSES = {422: {"model": ErrorResponse, "description": "사용자 입력 오류 또는 분석 불가 위치"},
                   500: {"model": ErrorResponse, "description": "서버 내부 오류 (request_id 로 server log 추적)"}}
