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
    assert set(body) == {"context", "result"}            # v0.0.16 형태 그대로 — 열린 이전 화면의 strict 스키마(Codex R1-3)
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
        def warm(self, biz_codes, radii=None):           # 반경이 여럿인 엔진(v0.4 이후)은 radii 를 넘긴다
            gate.wait(10)

    service = types.SimpleNamespace(rt=real_service.rt, cache=StuckCache(), analyze=real_service.analyze)
    app = M.create_app(service=service, warm_biz=["R10406", "S20701"])
    with TestClient(app) as c:
        try:
            total = len(M.warm_tasks(["R10406", "S20701"]))          # v0.3: 2, 반경 3개 엔진: 6
            assert c.get("/health").json()["warm"] == {"completed": 0, "total": total, "done": False,
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
                                                      "user_licenses", "radius_m"}       # radius_m: 8-D2 선택 필드
    assert set(s["AnalyzeResponse"]["properties"]) == {"context", "result"}
    assert set(s["AnalyzeContext"]["properties"]) == set(BUPYEONG_CONTEXT)


# ── 13-15 /insights (시간대·인구 설명 자료 — /analyze 와 분리, 점수에 쓰이지 않음) ───────────
def test_insights_bupyeong_inflow_matches_market_panel(client):
    from scoring_engine import config as C
    r = client.post("/insights", json={**BUPYEONG, "biz_code": "R10406"})
    assert r.status_code == 200, r.text
    ins = r.json()
    assert set(ins) == {"biz_code", "gu_code", "gu_name", "engine_version", "inflow", "hours_profile", "hours_profile_note"}
    assert ins["engine_version"] == analyze(client)["result"]["meta"]["엔진버전"]          # R1-9: 화면이 분석과 같은 엔진인지 대조
    assert (ins["biz_code"], ins["gu_code"], ins["gu_name"]) == ("R10406", "28237", "부평구")
    inflow = ins["inflow"]
    assert set(inflow) == {"gu_code", "gu_name", "as_of", "daily", "by_hour", "work_ratio"}
    assert (inflow["gu_code"], inflow["gu_name"]) == ("28237", "부평구")
    assert inflow["as_of"] == client.get("/health").json()["data"]["as_of"]["market_panel"]
    assert inflow["daily"] > 0 and len(inflow["by_hour"]) == 24 and all(v >= 0 for v in inflow["by_hour"])
    rt = client.app_ref.state.service.rt
    row = rt.market[rt.market["시군구코드"] == "28237"].iloc[0]
    assert inflow["daily"] == float(row["일평균_유입"])
    assert inflow["by_hour"] == [float(row[f"h{h:02d}"]) for h in range(24)]          # 원값 그대로(정규화 없음)
    assert inflow["work_ratio"] == float(row["work_ratio"])
    assert len(ins["hours_profile"]) == 24 and abs(sum(ins["hours_profile"]) - 1) < 1e-9
    assert ins["hours_profile"] == [float(x) for x in C.HOUR_PROFILE["R10406"]]
    assert ins["hours_profile_note"] == M.HOURS_PROFILE_NOTE
    assert "추정치" in ins["hours_profile_note"]
    assert r.headers.get("X-Data-Version")


@pytest.mark.parametrize("body, code", [
    ({**BUPYEONG, "biz_code": "XXXXX"}, "invalid_business"),
    ({"lat": 37.0, "lng": 127.5, "biz_code": "R10406"}, "location_outside"),
    ({**BUPYEONG}, "invalid_request"),
])
def test_insights_error_contract_same_as_analyze(client, body, code):
    r = client.post("/insights", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == code
    a = client.post("/analyze", json=body)
    assert a.status_code == 422 and a.json()["error"]["code"] == code


def test_insights_failure_is_error_contract_and_analyze_unaffected(real_service, monkeypatch):
    """설명 자료가 깨지면 /insights 만 오류 계약 500 — /analyze 는 그대로 성공한다(카드만 빠진다)."""
    monkeypatch.setattr(M, "build_insights", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with TestClient(M.create_app(service=real_service, warm_biz=[]), raise_server_exceptions=False) as c:
        r = c.post("/insights", json={**BUPYEONG, "biz_code": "R10406"})
        assert r.status_code == 500 and r.json()["error"]["code"]
        a = c.post("/analyze", json={**BUPYEONG, "biz_code": "R10406"})
        assert a.status_code == 200 and set(a.json()) == {"context", "result"}
