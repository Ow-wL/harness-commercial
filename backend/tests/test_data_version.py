"""
묶음 C — GET /health 의 data 블록과 /nearby-stores 의 as_of 가 데이터 버전 메타에서 온다 (docs/DATA_VERSIONING.md §4).

- 기본(data/runtime): data = {version: "2026-06", as_of: LEGACY_AS_OF}, /nearby-stores as_of == data.as_of.shops == "2026-06-30"
- 다른 데이터 버전의 RuntimeData 를 든 service: /health·/nearby-stores 가 그 매니페스트 값을 낸다 (파일을 다시 읽지 않는다)
- service 가 아직 없거나(가짜 service) rt 가 없어도 /health 는 같은 규칙(DATA_VERSION)으로 결정한 data 를 낸다
- /analyze 응답 키는 그대로 (context, result)
"""
import dataclasses
import types

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from scoring_engine.runtime import LEGACY_AS_OF, ROLES, DataVersion
from scoring_engine.service import AnalysisService

OK = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}


@pytest.fixture(scope="module")
def client(real_service):
    with TestClient(M.create_app(service=real_service, warm_biz=[])) as c:
        yield c


def test_health_data_block_default_runtime(client):
    data = client.get("/health").json()["data"]
    assert data == {"version": "2026-06", "as_of": LEGACY_AS_OF}
    assert list(data["as_of"]) == list(ROLES) and data["as_of"]["shops"] == "2026-06-30"


def test_nearby_as_of_comes_from_data_meta(client):
    health = client.get("/health").json()
    body = client.post("/nearby-stores", json=OK).json()
    assert body["as_of"] == health["data"]["as_of"]["shops"] == "2026-06-30"
    assert set(client.post("/analyze", json=OK).json()) == {"context", "result"}


def test_other_data_version_is_advertised(real_service):
    """매니페스트가 있는 버전을 읽은 것처럼 version 만 바꾼 RuntimeData — DataFrame 은 그대로 공유 (재로드 없음)."""
    v = DataVersion(id="2026-09", data_dir=real_service.rt.data_dir, files=dict(real_service.rt.version.files),
                    as_of={**LEGACY_AS_OF, "shops": "2026-09-30", "market_panel": "2026-09"}, manifest={"schema": 1})
    rt = dataclasses.replace(real_service.rt, version=v)
    svc = AnalysisService(rt=rt, cache=real_service.cache)
    with TestClient(M.create_app(service=svc, warm_biz=[])) as c:
        data = c.get("/health").json()["data"]
        assert data["version"] == "2026-09" and data["as_of"]["shops"] == "2026-09-30" and data["as_of"]["rent"] == "2026Q2"
        body = c.post("/nearby-stores", json=OK).json()
        assert body["as_of"] == "2026-09-30" and body["count"] == 12


def test_health_data_without_runtime_uses_env_rule(monkeypatch):
    monkeypatch.delenv("DATA_VERSION", raising=False)
    fake = types.SimpleNamespace(cache=types.SimpleNamespace(warm=lambda *a, **k: None))
    with TestClient(M.create_app(service=fake, warm_biz=[])) as c:
        assert c.get("/health").json()["data"] == {"version": "2026-06", "as_of": LEGACY_AS_OF}
