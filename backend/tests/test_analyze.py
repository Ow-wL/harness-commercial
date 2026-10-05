"""
TASKS 3-3 — POST /analyze (happy path). 좌표 → ContextBuilder → AnalysisService, 엔진 결과는 result 에 그대로.
다지점 pass-through equality 는 3-4, 오류 계약은 3-5.

실제 엔진은 세션 공유 real_service 로 업종 2개(R10406, S20701)만 계산한다.
수명 주기(재사용·warm 대기 없음)는 spy 로 빠르게 확인한다.
"""
import json
import threading
import time
import types

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from scoring_engine.location import ContextBuilder

BUPYEONG = {"lat": 37.4894, "lng": 126.7246}
BUPYEONG_CONTEXT = {"lat": 37.4894, "lng": 126.7246, "gu_code": "28237", "gu_name": "부평구",
                    "dong_name": "부평1동", "label": "부평구 부평1동", "rent_area": None}


def jsonish(obj):
    return json.loads(json.dumps(obj, ensure_ascii=False))


@pytest.fixture(scope="module")
def client(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        c.app_ref = app
        yield c


@pytest.fixture(scope="module")
def builder(client):
    client.post("/analyze", json={**BUPYEONG, "biz_code": "R10406"})       # 앱이 만든 ContextBuilder 를 꺼내 쓴다
    return client.app_ref.state.context_builder


def analyze(client, **body):
    r = client.post("/analyze", json={**BUPYEONG, "biz_code": "R10406", **body})
    assert r.status_code == 200, r.text
    return r.json()


# ── happy path ───────────────────────────────────────────
def test_bupyeong_pc_bang(client):
    body = analyze(client)
    assert set(body) == {"context", "result"}
    assert body["context"] == BUPYEONG_CONTEXT                                # 일반 ContextBuilder 경로, rent_area null
    meta = body["result"]["meta"]
    assert meta["업종코드"] == "R10406" and meta["행정동"] == "부평구 부평1동"
    assert meta["query"] == "부평구 부평1동 근처 PC방"                           # API 가 고치지 않는다


def test_context_matches_context_builder(client, builder):
    ctx = builder.build(BUPYEONG["lat"], BUPYEONG["lng"])
    assert analyze(client)["context"] == {k: getattr(ctx, k) for k in BUPYEONG_CONTEXT}


def test_result_is_engine_dict_unchanged(client, builder, real_service):
    """부평역 1곳만 — 다지점 깊은 비교는 3-4."""
    direct = real_service.analyze(builder.build(BUPYEONG["lat"], BUPYEONG["lng"]), "R10406")
    assert analyze(client)["result"] == jsonish(direct)


# ── 선택 입력 전달 ───────────────────────────────────────
def test_importance_is_forwarded(client, builder, real_service):
    imp = {"stability": 5, "competition": 4}
    body = analyze(client, importance=imp)
    direct = real_service.analyze(builder.build(BUPYEONG["lat"], BUPYEONG["lng"]), "R10406", importance=imp)
    assert body["result"]["종합"] == jsonish(direct["종합"])
    assert body["result"]["종합"]["적용_가중치"] != analyze(client)["result"]["종합"]["적용_가중치"]


def test_user_weights_is_forwarded(client, builder, real_service):
    w = {"competition": 0}
    body = analyze(client, user_weights=w)
    direct = real_service.analyze(builder.build(BUPYEONG["lat"], BUPYEONG["lng"]), "R10406", user_weights=w)
    assert body["result"]["종합"] == jsonish(direct["종합"])
    assert body["result"]["종합"]["적용_가중치"] != analyze(client)["result"]["종합"]["적용_가중치"]


def test_user_licenses_is_forwarded(client):
    plain = analyze(client, biz_code="S20701")["result"]["초보자_접근성"]["제도_진입장벽"]
    licensed = analyze(client, biz_code="S20701", user_licenses=["미용사(일반)"])["result"]["초보자_접근성"]
    assert (plain, licensed["제도_진입장벽"]) == ("높음", "낮음")


# ── 수명 주기 ────────────────────────────────────────────
def test_context_builder_created_once_and_runtime_not_reloaded(real_service, monkeypatch):
    created = []

    class CountingBuilder(ContextBuilder):
        def __init__(self, rt, *a, **k):
            created.append(rt)
            super().__init__(rt, *a, **k)

    def boom(*a, **k):
        raise AssertionError("요청 때문에 RuntimeData 를 다시 읽었다")
    monkeypatch.setattr(M, "ContextBuilder", CountingBuilder)
    monkeypatch.setattr("scoring_engine.service.load_runtime", boom)
    monkeypatch.setattr("scoring_engine.runtime.load_runtime", boom)
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        assert app.state.context_builder is None                              # /analyze 전에는 만들지 않는다
        c.get("/health")
        c.get("/businesses")
        assert created == []
        first = c.post("/analyze", json={**BUPYEONG, "biz_code": "R10406"})
        builder = app.state.context_builder
        second = c.post("/analyze", json={"lat": 37.5970, "lng": 126.7102, "biz_code": "R10406"})
        assert first.status_code == second.status_code == 200
        assert len(created) == 1 and created[0] is real_service.rt
        assert app.state.context_builder is builder


def test_concurrent_first_requests_build_one_context_builder(real_service, monkeypatch):
    created = []
    start = threading.Barrier(4)

    class SlowBuilder(ContextBuilder):
        def __init__(self, rt, *a, **k):
            created.append(1)
            time.sleep(0.2)                                    # 생성 중에 다른 첫 요청이 들어오게 한다
            super().__init__(rt, *a, **k)

    monkeypatch.setattr(M, "ContextBuilder", SlowBuilder)
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        codes = []

        def hit():
            start.wait(5)
            codes.append(c.post("/analyze", json={**BUPYEONG, "biz_code": "R10406"}).status_code)
        threads = [threading.Thread(target=hit) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)
    assert codes == [200] * 4 and len(created) == 1


def test_analyze_does_not_wait_for_background_warm(real_service):
    """warm thread 가 첫 업종에서 막혀 있어도(done=false) /analyze 는 응답한다. 계산은 ReferenceCache on-demand."""
    gate = threading.Event()

    class StuckCache:
        def warm(self, biz_codes):
            gate.wait(10)

    service = types.SimpleNamespace(rt=real_service.rt, cache=StuckCache(), analyze=real_service.analyze)
    app = M.create_app(service=service, warm_biz=["R10406", "S20701"])
    with TestClient(app) as c:
        try:
            assert c.get("/health").json()["warm"] == {"completed": 0, "total": 2, "done": False,
                                                       "failed": False, "error": None}
            r = c.post("/analyze", json={**BUPYEONG, "biz_code": "R10406"})
            assert r.status_code == 200 and r.json()["result"]["meta"]["업종코드"] == "R10406"
            assert c.get("/health").json()["warm"]["completed"] == 0
        finally:
            gate.set()


# ── OpenAPI ──────────────────────────────────────────────
def test_openapi_exposes_analyze_schemas(client):
    spec = client.get("/openapi.json").json()
    op = spec["paths"]["/analyze"]["post"]
    assert op["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/AnalyzeRequest")
    assert op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("/AnalyzeResponse")
    s = spec["components"]["schemas"]
    assert set(s["AnalyzeRequest"]["required"]) == {"lat", "lng", "biz_code"}
    assert set(s["AnalyzeRequest"]["properties"]) == {"lat", "lng", "biz_code", "importance", "user_weights",
                                                      "user_licenses"}
    assert set(s["AnalyzeResponse"]["properties"]) == {"context", "result"}
    assert set(s["AnalyzeContext"]["properties"]) == set(BUPYEONG_CONTEXT)
