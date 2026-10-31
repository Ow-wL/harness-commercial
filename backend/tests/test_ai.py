"""
13-23~13-27 AI 요약·질문 — 가짜 Completer(모델을 부르지 않음)로 계약·캐시·예산·하루 제한·로그·키 없음·분당 제한을 고정한다.
실제 모델 품질은 scripts/eval_ai.py(키가 있을 때만)로 본다.
"""
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from backend.app import ai as A
from backend.app import main as M
from scoring_engine import ENGINE_VERSION

BUPYEONG = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "radius_m": 500}
SUMMARY_OUT = {
    "good": [{"text": "주요 손님층이 많이 사는 편이에요.", "fields": ["지표.customer.score"]},
             {"text": "역이 가까워요.", "fields": ["지표.location.raw.최근접역_거리m"]}],
    "bad": [{"text": "같은 업종이 반경 안에 12곳 있어요.", "fields": ["지표.competition.raw.동종점포수"]}],
    "check": [{"text": "저녁 시간대 실제 유동을 확인하세요.", "fields": ["insights.inflow"]},
              {"text": "임대 조건을 확인하세요.", "fields": []}],
}


class FakeCompleter:
    def __init__(self, data=None, usage=None, raise_=None):
        self.data = data or SUMMARY_OUT
        self.usage = usage or {"input": 3000, "output": 400, "cache_read": 0, "cache_write": 0}
        self.raise_ = raise_
        self.calls = []

    def __call__(self, system, messages, schema, max_tokens):
        self.calls.append({"system": system, "messages": messages, "schema": schema})
        if self.raise_:
            raise self.raise_
        return A.AiResult(data=self.data, usage=self.usage, model=A.MODEL)


class Clock:
    def __init__(self, t="2026-11-02T10:00:00"):
        self.t = datetime.fromisoformat(t).replace(tzinfo=A.KST)

    def __call__(self):
        return self.t


def ai_service(tmp_path, completer, limit=30.0, clock=None):
    clock = clock or Clock()
    store = A.StateStore(tmp_path)
    return A.AiService(complete=completer, store=store, budget=A.Budget(store, limit, clock), limiter=A.DailyLimiter(clock),
                       clock=clock)


@pytest.fixture()
def make_client(real_service):
    clients = []

    def make(svc, **kw):
        c = TestClient(M.create_app(service=real_service, warm_biz=[], ai=svc, **kw))
        c.__enter__()
        clients.append(c)
        return c

    yield make
    for c in clients:
        c.__exit__(None, None, None)


def test_without_key_ai_is_off_and_endpoints_503(tmp_path, monkeypatch, make_client):
    monkeypatch.delenv(A.API_KEY_ENV, raising=False)
    c = make_client(A.AiService.from_env(state_dir=str(tmp_path)))
    assert c.get("/health").json()["ai"] == {"enabled": False, "model": None, "budget": None}
    for path, body in (("/summary", BUPYEONG), ("/ask", {**BUPYEONG, "question": "왜 이 점수인가요?"})):
        r = c.post(path, json=body)
        assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"


def test_summary_contract_cache_cost_and_log(tmp_path, make_client):
    fake = FakeCompleter()
    svc = ai_service(tmp_path, fake)
    c = make_client(svc)
    assert c.get("/health").json()["ai"] == {"enabled": True, "model": "claude-sonnet-5-5", "budget": "ok"}
    r = c.post("/summary", json=BUPYEONG)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cached"] is False and body["engine_version"] == ENGINE_VERSION and body["prompt_version"] == A.PROMPT_VERSION
    assert [i["text"] for i in body["good"]] == ["주요 손님층이 많이 사는 편이에요.", "역이 가까워요."]
    assert len(body["check"]) == 2 and r.headers.get("X-Data-Version")
    # 모델 입력: 시스템 프롬프트의 금지 규칙, 엔진 자료(좌표 없음), 스키마
    call = fake.calls[0]
    assert "성공 확률" in call["system"] and "추천" in call["system"]
    content = call["messages"][0]["content"]
    assert "부평구" in content and "37.4894" not in content and "126.7246" not in content
    assert call["schema"] == A.SUMMARY_SCHEMA
    # 같은 조건은 캐시 — 모델을 다시 부르지 않는다, 디스크에도 남는다
    again = c.post("/summary", json=BUPYEONG).json()
    assert again["cached"] is True and again["good"] == body["good"] and len(fake.calls) == 1
    assert (tmp_path / "summary-cache.json").exists()
    # 비용 집계: 3000 입력 × $2 + 400 출력 × $10 (/100만)
    assert json.loads((tmp_path / "budget.json").read_text(encoding="utf-8"))["usd"] == pytest.approx(0.01)
    # 로그: 업종·구·반경·출력, 좌표·IP 없음
    log = (tmp_path / "ai-log-2026-11-02.jsonl").read_text(encoding="utf-8")
    rec = json.loads(log.splitlines()[0])
    assert rec["kind"] == "summary" and rec["gu"] == "부평구" and rec["radius_m"] == 500
    assert "37.4894" not in log and "testclient" not in log and "lat" not in rec


def test_ask_answers_within_data_profile_suggestion_and_history(tmp_path, make_client):
    fake = FakeCompleter(data={"answer": "경쟁성은 31.9점이에요.", "fields": ["지표.competition.score"], "out_of_scope": False,
                               "profile_suggestion": {"stage": "예비", "youth": True, "preferred": ["여성", "모르는값"]}})
    c = make_client(ai_service(tmp_path, fake))
    history = [{"role": "user", "content": f"질문{i}"} if i % 2 == 0 else {"role": "assistant", "content": f"답{i}"} for i in range(10)]
    r = c.post("/ask", json={**BUPYEONG, "question": "경쟁성이 왜 낮아요?", "history": history,
                             "profile": {"stage": "1년 미만", "youth": None, "preferred": ["재창업"]}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "경쟁성은 31.9점이에요." and body["out_of_scope"] is False
    assert body["profile_suggestion"] == {"stage": "예비", "youth": True, "preferred": ["여성"]}       # 목록 밖 값은 버린다
    sent = fake.calls[0]["messages"][0]["content"]
    assert "질문2" not in sent and "질문4" in sent and sent.rstrip().endswith("사용자: 경쟁성이 왜 낮아요?")   # 최근 6턴 + 이번 질문
    assert '"창업단계": "1년 미만"' in sent and "재창업" in sent
    log = json.loads((tmp_path / "ai-log-2026-11-02.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert log["question"] == "경쟁성이 왜 낮아요?" and log["answer"] == body["answer"] and "lat" not in log


@pytest.mark.parametrize("q", ["", "   ", "가" * 301])
def test_ask_rejects_empty_or_long_question(tmp_path, make_client, q):
    c = make_client(ai_service(tmp_path, FakeCompleter()))
    r = c.post("/ask", json={**BUPYEONG, "question": q})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_question"


def test_daily_ip_limits_ask_10_and_new_summary_20_cache_not_counted(tmp_path, make_client):
    fake = FakeCompleter(data={"answer": "네.", "fields": [], "out_of_scope": False, "profile_suggestion": None})
    c = make_client(ai_service(tmp_path, fake))
    for _ in range(A.ASK_PER_DAY):
        assert c.post("/ask", json={**BUPYEONG, "question": "?"}).status_code == 200
    r = c.post("/ask", json={**BUPYEONG, "question": "?"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "ai_limited"
    other = c.post("/ask", json={**BUPYEONG, "question": "?"}, headers={"X-Forwarded-For": "1.2.3.4, 203.0.113.9"})
    assert other.status_code == 200                                                    # 다른 IP 는 따로 센다


def test_summary_new_limit_and_cache_hits_still_served(tmp_path, make_client):
    svc = ai_service(tmp_path, FakeCompleter())
    c = make_client(svc)
    assert c.post("/summary", json=BUPYEONG).status_code == 200
    svc.limiter.counts = {k: A.SUMMARY_NEW_PER_DAY for k in svc.limiter.counts}            # 오늘 새 생성 한도를 다 쓴 상태
    assert c.post("/summary", json=BUPYEONG).json()["cached"] is True                     # 캐시는 계속 준다
    r = c.post("/summary", json={**BUPYEONG, "biz_code": "I21201"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "ai_limited"


def test_budget_warn_and_close(tmp_path, make_client, caplog):
    fake = FakeCompleter(usage={"input": 0, "output": 850_000, "cache_read": 0, "cache_write": 0})   # $8.5 / 호출
    svc = ai_service(tmp_path, fake, limit=10.0)
    c = make_client(svc)
    with caplog.at_level("WARNING", logger="backend.ai"):
        assert c.post("/ask", json={**BUPYEONG, "question": "?"}).status_code == 200      # $8.5 → 85% 경고
    assert any("예산" in m for m in caplog.messages)
    assert c.get("/health").json()["ai"]["budget"] == "warn"
    assert c.post("/ask", json={**BUPYEONG, "question": "?"}).status_code == 200          # $17 → 초과
    assert c.get("/health").json()["ai"]["budget"] == "closed"
    r = c.post("/ask", json={**BUPYEONG, "question": "?"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "ai_budget"
    assert c.post("/summary", json=BUPYEONG).json()["error"]["code"] == "ai_budget"       # 캐시 없음 → 닫힘


def test_budget_resets_on_kst_month_boundary(tmp_path):
    clock = Clock("2026-11-30T23:59:00")
    store = A.StateStore(tmp_path)
    b = A.Budget(store, 1.0, clock)
    b.add(2.0)
    assert b.level() == "closed"
    clock.t = datetime.fromisoformat("2026-12-01T00:00:01").replace(tzinfo=A.KST)
    assert b.level() == "ok"


def test_upstream_error_502_and_refusal(tmp_path, make_client):
    c = make_client(ai_service(tmp_path, FakeCompleter(raise_=A.AiUpstreamError("status_500"))))
    r = c.post("/summary", json=BUPYEONG)
    assert r.status_code == 502 and r.json()["error"]["code"] == "ai_upstream"
    c2 = make_client(ai_service(tmp_path / "b", FakeCompleter(raise_=A.AiRefused())))
    r2 = c2.post("/ask", json={**BUPYEONG, "question": "?"})
    assert r2.status_code == 200 and r2.json()["out_of_scope"] is True and "답할 수 없어요" in r2.json()["answer"]


def test_log_files_older_than_30_days_are_removed(tmp_path):
    store = A.StateStore(tmp_path)
    (tmp_path / "ai-log-2026-09-01.jsonl").write_text("{}\n", encoding="utf-8")
    (tmp_path / "ai-log-2026-10-20.jsonl").write_text("{}\n", encoding="utf-8")
    store.append_log({"kind": "ask"}, datetime.fromisoformat("2026-11-02T10:00:00").replace(tzinfo=A.KST))
    names = sorted(p.name for p in tmp_path.glob("ai-log-*.jsonl"))
    assert names == ["ai-log-2026-10-20.jsonl", "ai-log-2026-11-02.jsonl"]


def test_minute_rate_limit_on_analysis_paths_only_when_enabled(tmp_path, make_client):
    c = make_client(ai_service(tmp_path, None), rate_limit_per_minute=2)
    assert [c.post("/analyze", json=BUPYEONG).status_code for _ in range(3)] == [200, 200, 429]
    assert c.post("/analyze", json=BUPYEONG).json()["error"]["code"] == "rate_limited"
    assert c.get("/health").status_code == 200                                           # GET·다른 경로는 제한 없음
    off = make_client(ai_service(tmp_path / "x", None))                                    # 기본(frontend 없음) = 끔
    assert all(off.post("/analyze", json=BUPYEONG).status_code == 200 for _ in range(4))


def test_anthropic_completer_request_shape_and_refusal(monkeypatch):
    """실제 SDK 경로: Sonnet 5.5, 서버측 거절 fallback("default" + 2026-07-01 beta), JSON 스키마 출력, 시스템 프롬프트 캐시.
    stop_reason refusal 이면 AiRefused, 텍스트 JSON 은 파싱하고 usage 를 옮긴다. (SDK 클라이언트만 가짜 — 네트워크 없음)"""
    import anthropic
    from types import SimpleNamespace as NS

    sent = {}
    replies = []

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)
            return replies.pop(0)

    class FakeClient:
        def __init__(self, **kw):
            self.beta = NS(messages=FakeMessages())

    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    complete = A.anthropic_completer("sk-test")
    usage = NS(input_tokens=10, output_tokens=5, cache_read_input_tokens=3, cache_creation_input_tokens=0)
    replies.append(NS(stop_reason="end_turn", content=[NS(type="text", text='{"good": [], "bad": [], "check": []}')],
                      usage=usage, model="claude-sonnet-5-5"))
    out = complete("SYS", [{"role": "user", "content": "x"}], A.SUMMARY_SCHEMA, 2000)
    assert out.data == {"good": [], "bad": [], "check": []}
    assert out.usage == {"input": 10, "output": 5, "cache_read": 3, "cache_write": 0}
    assert sent["model"] == "claude-sonnet-5-5" and sent["betas"] == ["server-side-fallback-2026-07-01"]
    assert sent["fallbacks"] == "default" and sent["max_tokens"] == 2000
    assert sent["output_config"]["format"] == {"type": "json_schema", "schema": A.SUMMARY_SCHEMA}
    assert sent["system"][0]["cache_control"] == {"type": "ephemeral"} and "thinking" not in sent
    replies.append(NS(stop_reason="refusal", content=[], usage=usage, model="claude-sonnet-5-5"))
    with pytest.raises(A.AiRefused):
        complete("SYS", [{"role": "user", "content": "x"}], A.SUMMARY_SCHEMA, 2000)
    replies.append(NS(stop_reason="end_turn", content=[NS(type="text", text="not json")], usage=usage, model="m"))
    with pytest.raises(A.AiUpstreamError):
        complete("SYS", [{"role": "user", "content": "x"}], A.SUMMARY_SCHEMA, 2000)


def test_eval_script_runs_end_to_end_with_fake_model(tmp_path, monkeypatch):
    """scripts/eval_ai.py(13-28): 키가 있을 때의 경로를 가짜 모델로 끝까지 — 10사례 표·합계 줄·자료 밖 질문 판정을 쓴다."""
    import importlib.util
    import os

    monkeypatch.setenv(A.API_KEY_ENV, "sk-fake")
    calls = {"n": 0}

    def fake_factory(key):
        def complete(system, messages, schema, max_tokens):
            calls["n"] += 1
            if "answer" in schema["properties"]:
                return A.AiResult(data={"answer": "이 자료로는 답할 수 없어요.", "fields": [], "out_of_scope": True,
                                        "profile_suggestion": None}, usage={"input": 100, "output": 10}, model=A.MODEL)
            return A.AiResult(data=SUMMARY_OUT, usage={"input": 100, "output": 10}, model=A.MODEL)
        return complete

    monkeypatch.setattr(A, "anthropic_completer", fake_factory)
    spec = importlib.util.spec_from_file_location("eval_ai", os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "eval_ai.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = tmp_path / "eval.md"
    assert mod.main(["--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert sum(1 for line in text.splitlines() if line.startswith("| ")) == 11 and "합계: 수치 일치" in text
    assert "금지 표현 0건" in text
    assert calls["n"] >= 2 * 8                                                          # 분석 가능한 사례마다 요약 + 질문
