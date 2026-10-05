"""
TASKS 3-5 — API 오류 계약 (docs/DECISIONS.md D-014).

  422 {"error": {"code", "message"}}                  사용자 입력·분석 불가
  500 {"error": {"code": "internal_error", "message", "request_id"}}   내부 오류, traceback 은 server log 에만
status·code·schema 를 고정한다. message 는 frontend 분기 기준이 아니므로 대표 문구만 확인한다.
실제 reference 계산은 하지 않는다 (요청 검증·위치 오류는 analyze 전에 끝나고, 500 은 가짜 service 로 만든다).
"""
import logging
import types

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from scoring_engine.location import ContextDataError, InvalidCoordinate

OK = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
SEOUL = {"lat": 37.5663, "lng": 126.9779}
EMPTY_LAND = {"lat": 37.3669, "lng": 126.4157}       # tests/test_context_builder.py 에서 전제 확인된 좌표


class NoAnalyze:
    """analyze 가 불리면 실패 — 오류 경로가 엔진 계산 전에 끝나는지 확인."""

    def __init__(self, rt):
        self.rt = rt
        self.cache = types.SimpleNamespace(warm=lambda b: None)

    def analyze(self, *a, **k):
        raise AssertionError("검증 실패 요청이 엔진까지 갔다")


@pytest.fixture(scope="module")
def client(real_service):
    with TestClient(M.create_app(service=NoAnalyze(real_service.rt), warm_biz=[])) as c:
        yield c


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code and isinstance(body["error"]["message"], str) and body["error"]["message"]
    if status == 422:
        assert set(body["error"]) == {"code", "message"}
    return body["error"]


# ── 요청 검증 → 422 invalid_request ───────────────────────
@pytest.mark.parametrize("body", [
    {"lng": 126.7246, "biz_code": "R10406"},                               # lat 누락
    {"lat": 37.4894, "biz_code": "R10406"},                                # lng 누락
    {"lat": 37.4894, "lng": 126.7246},                                     # biz_code 누락
    {**OK, "lat": "37.5"},                                                 # 문자열 숫자
    {**OK, "lng": "126.7"},
    {**OK, "lat": True},                                                   # bool
    {**OK, "lng": False},
    {**OK, "lat": None},
    {**OK, "lat": 90.0001}, {**OK, "lat": -91}, {**OK, "lng": 180.5}, {**OK, "lng": -181},
    {**OK, "biz_code": 10406},                                             # 업종 코드가 문자열 아님
    {**OK, "importance": {"market": 0}}, {**OK, "importance": {"market": 6}},
    {**OK, "importance": {"market": 4.0}}, {**OK, "importance": {"market": 4.5}},
    {**OK, "importance": {"market": "4"}}, {**OK, "importance": {"market": True}},
    {**OK, "importance": {"price": 3}},                                    # 알 수 없는 관점
    {**OK, "importance": [5]},
    {**OK, "user_weights": {"market": -0.1}},
    {**OK, "user_weights": {"market": "0.5"}}, {**OK, "user_weights": {"market": True}},
    {**OK, "user_weights": {"price": 1}},
    {**OK, "user_licenses": "미용사(일반)"}, {**OK, "user_licenses": [1]},
], ids=lambda b: str(b)[:60])
def test_invalid_request(client, body):
    assert_error(client.post("/analyze", json=body), 422, "invalid_request")


@pytest.mark.parametrize("raw", [
    '{"lat": NaN, "lng": 126.7246, "biz_code": "R10406"}',
    '{"lat": 37.4894, "lng": Infinity, "biz_code": "R10406"}',
    '{"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "user_weights": {"market": NaN}}',
    '{"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "user_weights": {"market": -Infinity}}',
    '{"lat": 37.4894, "lng": 126.7246, ',                                  # 깨진 JSON
    'not json',
], ids=["lat-NaN", "lng-Infinity", "weight-NaN", "weight-minus-Infinity", "truncated", "not-json"])
def test_non_finite_and_malformed_json(client, raw):
    r = client.post("/analyze", content=raw, headers={"content-type": "application/json"})
    assert_error(r, 422, "invalid_request")


def test_validation_body_has_no_fastapi_detail(client):
    body = client.post("/analyze", json={"lat": "x"}).json()
    assert "detail" not in body and body == {"error": {"code": "invalid_request", "message": "요청 값이 올바르지 않습니다."}}


# ── domain → 422 ─────────────────────────────────────────
def test_invalid_business(client):
    err = assert_error(client.post("/analyze", json={**OK, "biz_code": "Z99999"}), 422, "invalid_business")
    assert err["message"] == "지원하지 않는 업종 코드입니다."


def test_location_outside(client):
    err = assert_error(client.post("/analyze", json={**SEOUL, "biz_code": "R10406"}), 422, "location_outside")
    assert "126.9779" not in err["message"]                                # 좌표·내부 문구를 그대로 내보내지 않는다


def test_no_data_nearby(client):
    err = assert_error(client.post("/analyze", json={**EMPTY_LAND, "biz_code": "R10406"}), 422, "no_data_nearby")
    assert "500m" in err["message"]


def test_invalid_coordinate_from_location_layer(real_service):
    """요청 검증을 통과한 뒤 location 계층이 InvalidCoordinate 를 내는 경우 (정상 경로에서는 거의 없음)."""
    app = M.create_app(service=NoAnalyze(real_service.rt), warm_biz=[])
    with TestClient(app) as c:
        app.state.context_builder = types.SimpleNamespace(build=lambda lat, lng: (_ for _ in ()).throw(
            InvalidCoordinate("lat 범위 밖")))
        assert_error(c.post("/analyze", json=OK), 422, "invalid_coordinate")


@pytest.mark.parametrize("extra", [
    {"importance": {"market": 5}, "user_weights": {"market": 1}},          # 동시 사용
    {"user_weights": {k: 0 for k in ("market", "customer", "competition", "location", "stability")}},  # 합 0
], ids=["weights+importance", "all-zero-weights"])
def test_invalid_analysis_options(client, extra):
    err = assert_error(client.post("/analyze", json={**OK, **extra}), 422, "invalid_analysis_options")
    assert "Traceback" not in err["message"] and "File " not in err["message"]


# ── 내부 오류 → 500 + request_id ─────────────────────────
@pytest.fixture
def broken(real_service):
    """analyze 가 지정한 예외를 내는 서비스. 500 은 서버가 다시 raise 하므로 raise_server_exceptions=False."""
    def make(exc):
        svc = NoAnalyze(real_service.rt)
        svc.analyze = lambda *a, **k: (_ for _ in ()).throw(exc)
        app = M.create_app(service=svc, warm_biz=[])
        return app, TestClient(app, raise_server_exceptions=False)
    return make


SECRET = "C:\\secret\\path\\data.csv 내부 메시지"


@pytest.mark.parametrize("exc", [KeyError(SECRET), AssertionError(SECRET), RuntimeError(SECRET),
                                 ValueError(SECRET), ContextDataError(SECRET)],
                         ids=["KeyError", "AssertionError", "RuntimeError", "ValueError-in-analyze", "ContextDataError"])
def test_internal_errors_hide_details_and_log_request_id(broken, caplog, exc):
    app, c = broken(exc)
    with c, caplog.at_level(logging.ERROR, logger="backend.errors"):
        if isinstance(exc, ContextDataError):                                # build 단계에서 나는 내부 오류
            app.state.context_builder = types.SimpleNamespace(build=lambda lat, lng: (_ for _ in ()).throw(exc))
        r = c.post("/analyze", json=OK)
    err = assert_error(r, 500, "internal_error")
    assert set(err) == {"code", "message", "request_id"} and len(err["request_id"]) == 32
    for leak in ("Traceback", "secret", "내부 메시지", type(exc).__name__, "File "):
        assert leak not in r.text
    records = [rec for rec in caplog.records if err["request_id"] in rec.getMessage()]
    assert len(records) == 1 and records[0].exc_info and records[0].exc_info[1] is exc   # 같은 id 로 traceback 기록


def test_request_ids_are_unique(broken):
    _, c = broken(RuntimeError("x"))
    with c:
        ids = {c.post("/analyze", json=OK).json()["error"]["request_id"] for _ in range(5)}
    assert len(ids) == 5


# ── OpenAPI ──────────────────────────────────────────────
def test_openapi_error_schemas(client):
    spec = client.get("/openapi.json").json()
    res = spec["paths"]["/analyze"]["post"]["responses"]
    assert res["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AnalyzeResponse")
    for status in ("422", "500"):
        assert res[status]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    s = spec["components"]["schemas"]
    assert set(s["ErrorResponse"]["properties"]) == {"error"}
    assert set(s["ErrorDetail"]["properties"]) == {"code", "message", "request_id"}
    assert set(s["ErrorDetail"]["required"]) == {"code", "message"}


# ── 기존 엔드포인트 ──────────────────────────────────────
def test_health_and_businesses_unchanged(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/businesses").json()["total"] == 29
    assert client.get("/no-such-route").status_code == 404
