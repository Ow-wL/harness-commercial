"""
TASKS 3-2 — GET /businesses. 기대값은 엔진 config 에서 직접 만든다 (테스트에도 업종 목록을 따로 두지 않는다).
"""
import threading
import types

from fastapi.testclient import TestClient

from backend.app import main as M
from scoring_engine import config as C


class BlockingCache:
    """warm 이 끝나지 않는 cache — /businesses 가 warm 과 무관한지 확인용."""

    def __init__(self):
        self.gate = threading.Event()
        self.calls = 0

    def warm(self, biz_codes):
        self.calls += 1
        self.gate.wait(5)


def get_catalog(service=None, warm_biz=()):
    svc = service or types.SimpleNamespace(cache=types.SimpleNamespace(warm=lambda b: None))
    with TestClient(M.create_app(service=svc, warm_biz=list(warm_biz))) as client:
        r = client.get("/businesses")
    return r


def test_status_and_totals():
    r = get_catalog()
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == len(C.CODE_NAME) == 29
    assert len(body["groups"]) == len(C.BIZ_GROUP) == 4


def test_matches_engine_config_in_definition_order():
    body = get_catalog().json()
    assert [g["code"] for g in body["groups"]] == list(C.BIZ_GROUP)
    for g in body["groups"]:
        assert g["name"] == g["code"].split("_", 1)[1]                         # A_고객밀착형 → 고객밀착형
        assert [(b["code"], b["name"]) for b in g["businesses"]] == list(C.BIZ_GROUP[g["code"]].items())
        assert all(b["group"] == g["code"] for b in g["businesses"])
    flat = [b for g in body["groups"] for b in g["businesses"]]
    assert [b["code"] for b in flat] == list(C.CODE_NAME)                      # 정의 순서 그대로, 정렬 안 함
    assert {b["code"]: (b["name"], b["group"]) for b in flat} == \
        {c: (C.CODE_NAME[c], C.CODE_GROUP[c]) for c in C.CODE_NAME}


def test_each_code_exactly_once():
    codes = [b["code"] for g in get_catalog().json()["groups"] for b in g["businesses"]]
    assert len(codes) == len(set(codes)) == 29


def test_group_display_names():
    names = [g["name"] for g in get_catalog().json()["groups"]]
    assert names == ["고객밀착형", "유동인구형", "목적방문형", "체류소비형"]


def test_does_not_use_service_or_runtime(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("/businesses 가 RuntimeData 를 읽었다")
    monkeypatch.setattr("scoring_engine.service.load_runtime", boom)
    service = types.SimpleNamespace(cache=types.SimpleNamespace(warm=boom))   # 건드리면 warm 실패로 드러난다
    app = M.create_app(service=service, warm_biz=[])
    with TestClient(app) as client:
        assert client.get("/businesses").json()["total"] == 29
        assert client.get("/health").json()["warm"]["failed"] is False


def test_responds_while_warm_in_progress():
    cache = BlockingCache()
    app = M.create_app(service=types.SimpleNamespace(cache=cache), warm_biz=["R10406", "I21201"])
    with TestClient(app) as client:
        assert client.get("/health").json()["warm"]["done"] is False
        r = client.get("/businesses")
        assert r.status_code == 200 and r.json()["total"] == 29
        assert client.get("/health").json()["warm"]["completed"] == 0          # 여전히 warm 중
        cache.gate.set()


def test_openapi_exposes_response_schema():
    with TestClient(M.create_app(service=types.SimpleNamespace(cache=None), warm_biz=[])) as client:
        spec = client.get("/openapi.json").json()
    ref = spec["paths"]["/businesses"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/BusinessCatalog")
    schemas = spec["components"]["schemas"]
    assert set(schemas["BusinessCatalog"]["properties"]) == {"groups", "total"}
    assert set(schemas["BusinessGroup"]["properties"]) == {"code", "name", "businesses"}
    assert set(schemas["Business"]["properties"]) == {"code", "name", "group"}
