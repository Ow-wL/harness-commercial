"""
TASKS 3-1 — app factory, lifespan, background warm, /health (docs/DECISIONS.md D-012).

수명 주기 검증은 가짜 cache(호출 기록·대기 제어)로 빠르게 하고, 실제 계산은 세션 공유 서비스로 업종 1개만 warm 한다.
ReferenceCache 의 실제 성능은 tests/test_reference_cache.py 담당.
"""
import threading
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app import main as M
from backend.tests.conftest import wait_for
from scoring_engine import config as C


class FakeCache:
    """warm([biz]) 호출을 기록. gate 가 있으면 열릴 때까지 기다리고, fail_on 업종에서는 예외."""

    def __init__(self, gate=None, fail_on=None):
        self.calls = []
        self.gate = gate
        self.fail_on = fail_on

    def warm(self, biz_codes):
        if self.gate is not None:
            self.gate.wait(5)
        for biz in biz_codes:
            if biz == self.fail_on:
                raise RuntimeError("계산 실패 (테스트)")
            self.calls.append(biz)


def fake_service(cache=None):
    return types.SimpleNamespace(cache=cache or FakeCache())


def warm_state(client):
    return client.get("/health").json()["warm"]


# ── factory / 주입 ───────────────────────────────────────
def test_create_app_returns_fastapi_with_health():
    app = M.create_app(service=fake_service(), warm_biz=[])
    assert isinstance(app, FastAPI)
    assert "/health" in {r.path for r in app.routes}


def test_module_app_import_does_not_load_runtime():
    assert isinstance(M.app, FastAPI) and M.app.state.service is None


def test_injected_service_is_reused_and_runtime_not_loaded(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("주입된 service 가 있으면 load_runtime 을 부르면 안 된다")
    monkeypatch.setattr("scoring_engine.service.load_runtime", boom)
    svc = fake_service()
    app = M.create_app(service=svc, warm_biz=["R10406"])
    with TestClient(app) as client:
        assert app.state.service is svc
        assert client.get("/health").json()["service_ready"] is True
        assert app.state.service is svc


def test_production_path_creates_service_once(monkeypatch):
    created = []

    class CountingService:
        def __init__(self):
            created.append(self)
            self.cache = FakeCache()
    monkeypatch.setattr(M, "AnalysisService", CountingService)
    app = M.create_app(warm_biz=["R10406", "I21201"])
    assert created == []                                       # 생성 시점에는 아무것도 만들지 않는다
    with TestClient(app) as client:
        for _ in range(3):
            client.get("/health")
        assert len(created) == 1 and app.state.service is created[0]
        wait_for(lambda: warm_state(client)["done"])
    assert len(created) == 1


def test_default_warm_targets_all_29_businesses():
    cache = FakeCache()
    app = M.create_app(service=fake_service(cache))
    with TestClient(app) as client:
        state = wait_for(lambda: (s := warm_state(client))["done"] and s)
        assert state == {"completed": 29, "total": 29, "done": True, "failed": False, "error": None}
    assert cache.calls == list(C.CODE_NAME)


def test_scoped_warm_only_requested_businesses():
    cache = FakeCache()
    app = M.create_app(service=fake_service(cache), warm_biz=["R10406", "S20701"])
    with TestClient(app) as client:
        wait_for(lambda: warm_state(client)["done"])
        assert warm_state(client)["total"] == 2
    assert cache.calls == ["R10406", "S20701"]


def test_empty_warm_is_done_immediately():
    with TestClient(M.create_app(service=fake_service(), warm_biz=[])) as client:
        assert warm_state(client) == {"completed": 0, "total": 0, "done": True, "failed": False, "error": None}


# ── background: startup 은 warm 을 기다리지 않는다 ─────────
def test_startup_does_not_wait_for_warm_and_progress_increases():
    gate = threading.Event()
    cache = FakeCache(gate=gate)
    app = M.create_app(service=fake_service(cache), warm_biz=["R10406", "I21201", "S20701"])
    with TestClient(app) as client:                            # lifespan 시작이 gate 를 기다리면 여기서 멈춘다
        first = warm_state(client)
        assert first == {"completed": 0, "total": 3, "done": False, "failed": False, "error": None}
        gate.set()
        seen = {first["completed"]}
        final = wait_for(lambda: (s := warm_state(client)) and seen.add(s["completed"]) is None and s["done"] and s)
        assert final["completed"] == 3 and final["done"] is True
        assert seen <= {0, 1, 2, 3} and max(seen) == 3


def test_warm_failure_reported_without_traceback(caplog):
    cache = FakeCache(fail_on="I21201")
    app = M.create_app(service=fake_service(cache), warm_biz=["R10406", "I21201", "S20701"])
    with caplog.at_level("ERROR", logger="backend.warm"):
        with TestClient(app) as client:
            state = wait_for(lambda: (s := warm_state(client))["failed"] and s)
            assert state == {"completed": 1, "total": 3, "done": False, "failed": True, "error": "I21201: RuntimeError"}
            body = client.get("/health").text
            assert "Traceback" not in body and "계산 실패" not in body
    assert cache.calls == ["R10406"]                          # 실패 뒤 업종은 진행하지 않는다
    assert any("I21201" in r.getMessage() and r.exc_info for r in caplog.records)


def test_shutdown_stops_warm_without_waiting_for_all():
    gate = threading.Event()
    cache = FakeCache(gate=gate)
    app = M.create_app(service=fake_service(cache), warm_biz=list(C.CODE_NAME))
    opener = threading.Timer(0.2, gate.set)                   # 종료 대기 중에 첫 업종 계산이 끝나게 한다
    with TestClient(app):
        opener.start()                                         # 첫 업종이 gate 에서 대기 중일 때 종료 시작
    opener.join()
    assert not app.state.warm.thread.is_alive()
    assert len(cache.calls) <= 1                               # 중지 신호 뒤 다음 업종으로 가지 않는다


# ── 실제 서비스 (업종 1개) ───────────────────────────────
def test_real_service_scoped_warm(real_service):
    before = real_service.cache.stats()["competition_entries"]
    app = M.create_app(service=real_service, warm_biz=["R10406"])
    with TestClient(app) as client:
        state = wait_for(lambda: (s := warm_state(client))["done"] and s, timeout=60)
        assert state["completed"] == 1 and state["total"] == 1 and not state["failed"]
        assert app.state.service is real_service
    stats = real_service.cache.stats()
    assert stats["competition_entries"] == max(before, 1) and stats["location_entries"] >= 1
    assert "R10406" in real_service.cache._competition
