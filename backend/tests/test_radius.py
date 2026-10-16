"""
8-D2 — 분석 반경 API (D-024). 기본 실행은 엔진 v0.3 프로세스: 반경은 500 하나.

- /analyze·/nearby-stores 의 선택 필드 radius_m: 생략·null·500 은 지금과 같은 결과, 그 밖은 422 invalid_radius
- 타입은 JSON 정수만(문자열·실수·bool → invalid_request), 검증 순서 업종 → (분석 옵션) → 반경 → 좌표
- GET /health 의 engine 광고: {version, radius_options, default_radius_m}
- background warm 단위: 반경이 하나면 업종 단위 그대로, 여럿이면 (업종, 반경) — 기본 반경 먼저
v0.4(300·1,000m) 실제 계산·pass-through 는 tests/engine_v0_4/test_backend_radius.py.
"""
import types

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from backend.tests.conftest import wait_for
from scoring_engine import config as C

OK = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
SEOUL = {"lat": 37.5663, "lng": 126.9779}


@pytest.fixture(scope="module")
def client(real_service):
    with TestClient(M.create_app(service=real_service, warm_biz=[])) as c:
        yield c


def test_health_advertises_engine_radius(client):
    assert client.get("/health").json()["engine"] == {"version": "mvp-0.3", "radius_options": [500],
                                                      "default_radius_m": 500}


@pytest.mark.parametrize("path", ["/analyze", "/nearby-stores"])
def test_omitted_null_and_500_are_the_same(client, path):
    base = client.post(path, json=OK)
    assert base.status_code == 200, base.text
    for extra in ({"radius_m": None}, {"radius_m": 500}):
        r = client.post(path, json={**OK, **extra})
        assert r.status_code == 200 and r.json() == base.json()
    if path == "/nearby-stores":
        assert base.json()["radius_m"] == 500
    else:
        assert base.json()["result"]["meta"]["분석반경_m"] == 500


@pytest.mark.parametrize("path", ["/analyze", "/nearby-stores"])
@pytest.mark.parametrize("radius", [300, 1000, 250, 0, -500])
def test_unsupported_radius_is_invalid_radius(client, path, radius):
    r = client.post(path, json={**OK, "radius_m": radius})
    assert r.status_code == 422
    assert r.json() == {"error": {"code": "invalid_radius", "message": "지원하지 않는 분석 반경입니다(가능: 500m)."}}


@pytest.mark.parametrize("path", ["/analyze", "/nearby-stores"])
@pytest.mark.parametrize("radius", ["500", 500.0, True, [500]])
def test_radius_type_is_strict_int(client, path, radius):
    r = client.post(path, json={**OK, "radius_m": radius})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize("path", ["/analyze", "/nearby-stores"])
def test_validation_order_business_then_radius_then_location(client, path):
    bad_both = client.post(path, json={**OK, "biz_code": "X00000", "radius_m": 300})
    assert bad_both.json()["error"]["code"] == "invalid_business"
    outside = client.post(path, json={**SEOUL, "biz_code": "R10406", "radius_m": 300})
    assert outside.json()["error"]["code"] == "invalid_radius"


def test_openapi_documents_radius(client):
    s = client.get("/openapi.json").json()["components"]["schemas"]
    for name in ("AnalyzeRequest", "NearbyStoresRequest"):
        assert "radius_m" in s[name]["properties"] and "radius_m" not in s[name].get("required", [])


# ── background warm 단위 ─────────────────────────────────
class RadiusCache:
    def __init__(self):
        self.calls = []

    def warm(self, biz_codes, radii=None):
        self.calls.append((tuple(biz_codes), None if radii is None else tuple(radii)))


def test_warm_tasks_single_radius_keep_business_units():
    assert M.warm_tasks(["R10406", "S20701"]) == [("R10406", None), ("S20701", None)]


def test_warm_tasks_multi_radius_default_first(monkeypatch):
    monkeypatch.setattr(M, "RADIUS_OPTIONS_M", (300, 500, 1000))
    assert M.warm_tasks(["R10406", "S20701"]) == [
        ("R10406", 500), ("S20701", 500), ("R10406", 300), ("S20701", 300), ("R10406", 1000), ("S20701", 1000)]
    cache = RadiusCache()
    app = M.create_app(service=types.SimpleNamespace(cache=cache), warm_biz=["R10406", "S20701"])
    with TestClient(app) as c:
        state = wait_for(lambda: (s := c.get("/health").json()["warm"])["done"] and s)
        assert state == {"completed": 6, "total": 6, "done": True, "failed": False, "error": None}
    assert cache.calls == [(("R10406",), (500,)), (("S20701",), (500,)), (("R10406",), (300,)),
                           (("S20701",), (300,)), (("R10406",), (1000,)), (("S20701",), (1000,))]
    assert C.RADIUS_M == 500
