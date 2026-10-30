"""
4차 — POST /nearby-stores (D-019). /analyze 계약은 그대로 두고 별도 경로로 반경 안 동종 점포를 돌려준다.

- 같은 요청의 /analyze 경쟁성.raw.동종점포수 == count == len(stores)
- 좌표 검증·오류 코드는 /analyze 와 같다 (D-014)
- /analyze 응답 키는 바뀌지 않는다
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M

OK = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
SONGDO = {"lat": 37.392512, "lng": 126.639034}          # 반경 안 PC방 0곳 (tests/test_nearby.py)
SEOUL = {"lat": 37.5663, "lng": 126.9779}
EMPTY_LAND = {"lat": 37.3669, "lng": 126.4157}           # 반경 안 점포 0개 (test_errors.py 와 같은 좌표)


@pytest.fixture(scope="module")
def client(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        yield c


def competition_count(client, body):
    r = client.post("/analyze", json=body)
    assert r.status_code == 200, r.text
    return next(i for i in r.json()["result"]["지표"] if i["key"] == "competition")["raw"]["동종점포수"]


def test_bupyeong_pc_bang_matches_analyze(client):
    r = client.post("/nearby-stores", json=OK)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"lat", "lng", "biz_code", "radius_m", "as_of", "count", "stores"}
    assert (body["lat"], body["lng"], body["biz_code"]) == (37.4894, 126.7246, "R10406")
    assert body["radius_m"] == 500 and body["as_of"] == "2026-06-30"
    assert body["count"] == len(body["stores"]) == competition_count(client, OK) == 12
    first = body["stores"][0]
    assert set(first) == {"id", "name", "road_address", "jibun_address", "lat", "lng", "distance_m"}
    assert first["distance_m"] == 115
    dists = [s["distance_m"] for s in body["stores"]]
    assert dists == sorted(dists) and dists[-1] <= 500


def test_zero_stores(client):
    body = {**SONGDO, "biz_code": "R10406"}
    r = client.post("/nearby-stores", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 0 and r.json()["stores"] == []
    assert competition_count(client, body) == 0


@pytest.mark.parametrize("body, code", [
    ({**OK, "biz_code": "X00000"}, "invalid_business"),
    ({**SEOUL, "biz_code": "R10406"}, "location_outside"),
    ({**EMPTY_LAND, "biz_code": "R10406"}, "no_data_nearby"),
    ({**OK, "lat": "37.4894"}, "invalid_request"),
    ({"lat": 37.4894, "lng": 126.7246}, "invalid_request"),
])
def test_error_contract_same_as_analyze(client, body, code):
    r = client.post("/nearby-stores", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == code
    a = client.post("/analyze", json=body)
    assert a.status_code == 422 and a.json()["error"]["code"] == code


def test_analyze_contract_unchanged(client):
    r = client.post("/analyze", json=OK)
    assert set(r.json()) == {"context", "result", "insights"}


def test_get_is_not_allowed(client):
    assert client.get("/nearby-stores").status_code == 405
