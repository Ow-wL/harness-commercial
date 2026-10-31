"""
13-16 POST /rank · 13-17 GET /stations (docs/IMPROVEMENT_PLAN_2026-10-30.md §4.2).

- /rank: 29개 업종 기본 가중치 종합점수 순위 — '점수가 높은 업종'일 뿐 추천이 아니다. 정렬은 종합 내림차순·null 끝,
  오류 계약은 /analyze 와 같다(invalid_radius·location_outside·no_data_nearby·invalid_request). 같은 요청은 캐시에서 같은 본문.
- /stations: 엔진이 이미 읽은 인천권 물리적 역 211개(RuntimeData.stations) — xlsx 를 다시 읽지 않는다.
학교구역 규제(regulated)는 엔진 v0.5 계열 기능이라 그 엔진 프로세스(SCORING_ENGINE_VERSION=v0_5_1)에서만 검사한다.
"""
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from scoring_engine import ENGINE_VERSION, config as C

BUPYEONG = {"lat": 37.4894, "lng": 126.7246}
SCHOOL_50M = {"lat": 37.502274 + 50 / 110_540, "lng": 126.727619}      # scripts/smoke_api.py 와 같은 지점
SEOUL = {"lat": 37.5663, "lng": 126.9779}
EMPTY_LAND = {"lat": 37.3669, "lng": 126.4157}
ITEM_KEYS = {"biz_code", "name", "group", "overall", "weakest", "coverage", "regulated", "warnings"}


@pytest.fixture(scope="module")
def client(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def bupyeong(client):
    r = client.post("/rank", json={**BUPYEONG, "radius_m": 500})
    assert r.status_code == 200, r.text
    return r


def test_rank_shape_and_order(bupyeong):
    body = bupyeong.json()
    assert set(body) == {"lat", "lng", "radius_m", "gu_name", "dong_name", "count", "items"}
    assert (body["lat"], body["lng"], body["radius_m"]) == (37.4894, 126.7246, 500)
    assert (body["gu_name"], body["dong_name"]) == ("부평구", "부평1동")
    assert body["count"] == len(body["items"]) == len(C.CODE_NAME) == 29
    assert {i["biz_code"] for i in body["items"]} == set(C.CODE_NAME)
    assert all(set(i) == ITEM_KEYS for i in body["items"])
    scores = [i["overall"] for i in body["items"]]
    present = [s for s in scores if s is not None]
    assert present == sorted(present, reverse=True)
    assert scores[len(present):] == [None] * (len(scores) - len(present))      # null 은 끝
    pc = next(i for i in body["items"] if i["biz_code"] == "R10406")
    assert pc["name"] == "PC방" and pc["group"] == C.group_of("R10406")
    assert pc["weakest"] is not None and set(pc["weakest"]) == {"key", "label", "score"}
    assert 0 <= pc["coverage"] <= 1 and pc["warnings"] >= 0 and isinstance(pc["regulated"], bool)
    assert bupyeong.headers["x-data-version"]


def test_rank_matches_analyze_default_weights(client, bupyeong):
    """항목 값은 같은 조건 /analyze(기본 가중치) 결과 그대로 — 점수를 변형하지 않는다."""
    a = client.post("/analyze", json={**BUPYEONG, "biz_code": "R10406", "radius_m": 500}).json()["result"]
    pc = next(i for i in bupyeong.json()["items"] if i["biz_code"] == "R10406")
    assert pc["overall"] == a["종합"]["점수"] and pc["coverage"] == a["종합"]["데이터_충족률"]
    assert pc["weakest"]["key"] == a["종합"]["병목_지표"] and pc["warnings"] == len(a["경고"])


def test_rank_ties_keep_code_name_order(client, bupyeong):
    items = bupyeong.json()["items"]
    order = {c: n for n, c in enumerate(C.CODE_NAME)}
    for prev, cur in zip(items, items[1:]):
        if prev["overall"] is not None and prev["overall"] == cur["overall"]:
            assert order[prev["biz_code"]] < order[cur["biz_code"]]


def test_rank_cache_hit_returns_identical_body(client, bupyeong):
    again = client.post("/rank", json={**BUPYEONG, "radius_m": 500})
    assert again.status_code == 200 and again.json() == bupyeong.json()
    omitted = client.post("/rank", json=BUPYEONG)                      # 생략 = 기본 반경(500) → 같은 캐시 키
    assert omitted.status_code == 200 and omitted.json() == bupyeong.json()
    assert (round(37.4894, 6), round(126.7246, 6), 500) in client.app.state.rank_cache


def test_rank_cache_is_bounded(client, bupyeong):
    cache = client.app.state.rank_cache
    key = (round(37.4894, 6), round(126.7246, 6), 500)
    cache.pop(key, None)
    for k in range(M.RANK_CACHE_MAX + 5):                               # 가짜 항목으로 상한을 넘겨 둔다
        cache[(0.0, float(k), 500)] = bupyeong.json()
    r = client.post("/rank", json={**BUPYEONG, "radius_m": 500})      # 미스 → 계산 → 오래된 것부터 정리 (LRU)
    assert r.status_code == 200 and r.json() == bupyeong.json()
    assert len(cache) == M.RANK_CACHE_MAX and key in cache and (0.0, 0.0, 500) not in cache


def test_rank_cache_is_per_app(real_service, bupyeong):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        assert len(c.app.state.rank_cache) == 0
        assert c.post("/rank", json={**BUPYEONG, "radius_m": 500}).json() == bupyeong.json()


class _CountingService:
    """실제 서비스에 위임하되 analyze 호출 수를 세고 조금 늦춘다(동시 요청이 겹치게)."""

    def __init__(self, real):
        self._real = real
        self.calls = 0
        self._lock = threading.Lock()

    def __getattr__(self, name):
        return getattr(self._real, name)

    def analyze(self, *a, **k):
        with self._lock:
            self.calls += 1
        time.sleep(0.005)
        return self._real.analyze(*a, **k)


def test_rank_same_key_concurrent_requests_compute_once(real_service, bupyeong):
    """캐시가 빈 같은 키의 동시 요청은 29업종을 한 번만 계산한다(Codex R1 개발자 1 — 단일 계산)."""
    svc = _CountingService(real_service)
    app = M.create_app(service=svc, warm_biz=[])
    with TestClient(app) as c:
        svc.calls = 0
        out: list = []
        threads = [threading.Thread(target=lambda: out.append(c.post("/rank", json={**BUPYEONG, "radius_m": 500})))
                   for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert [r.status_code for r in out] == [200, 200, 200]
        assert all(r.json() == bupyeong.json() for r in out)
        assert svc.calls == len(C.CODE_NAME)                            # 3 × 29 가 아니다
        assert c.app.state.rank_cache and c.app.state.rank_inflight == {}


@pytest.mark.skipif(not ENGINE_VERSION.startswith("mvp-0.5"), reason="학교구역 규제 경고는 엔진 v0.5 계열(D-028)")
def test_rank_regulated_near_school(client):
    r = client.post("/rank", json={**SCHOOL_50M, "radius_m": 500})
    assert r.status_code == 200, r.text
    regulated = {i["biz_code"] for i in r.json()["items"] if i["regulated"]}
    assert "R10406" in regulated                                       # PC방 — 학교 50m 안
    a = client.post("/analyze", json={**SCHOOL_50M, "biz_code": "R10406", "radius_m": 500}).json()["result"]
    assert a["경고"][0].startswith("⚠") and "학교 주변 영업 규제 업종" in a["경고"][0]


def test_rank_not_regulated_at_bupyeong(bupyeong):
    assert not any(i["regulated"] for i in bupyeong.json()["items"])


@pytest.mark.parametrize("body, code", [
    ({**BUPYEONG, "radius_m": 750}, "invalid_radius"),
    ({**SEOUL, "radius_m": 500}, "location_outside"),
    ({**EMPTY_LAND, "radius_m": 500}, "no_data_nearby"),
    ({**BUPYEONG, "lat": "37.4894"}, "invalid_request"),
    ({"lat": 37.4894}, "invalid_request"),
])
def test_rank_error_contract_same_as_analyze(client, body, code):
    r = client.post("/rank", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == code
    a = client.post("/analyze", json={**body, "biz_code": "R10406"})
    assert a.status_code == 422 and a.json()["error"]["code"] == code


def test_rank_get_is_not_allowed(client):
    assert client.get("/rank").status_code == 405


def test_stations_list(client):
    r = client.get("/stations")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"count", "as_of", "stations"}
    assert body["count"] == len(body["stations"]) == 211 == len(client.app.state.service.rt.stations)
    assert body["as_of"] == client.get("/health").json()["data"]["as_of"]["stations"]
    names = [s["name"] for s in body["stations"]]
    assert "부평역" in names and names == sorted(names) and len(set(names)) == len(names)
    bupyeong = next(s for s in body["stations"] if s["name"] == "부평역")
    assert set(bupyeong) == {"name", "lat", "lng", "lines", "transfer", "line_count"}
    assert abs(bupyeong["lat"] - 37.49) < 0.01 and abs(bupyeong["lng"] - 126.724) < 0.01
    assert bupyeong["transfer"] is True and bupyeong["line_count"] == 2 and bupyeong["lines"] == []
    for s in body["stations"]:
        assert 37.0 < s["lat"] < 38.0 and 126.0 < s["lng"] < 127.5 and s["name"].endswith("역")
        assert s["transfer"] == (s["line_count"] > 1)
    assert client.get("/stations").json() == body                         # 1회 계산 뒤 재사용
    assert r.headers["x-data-version"]


def test_stations_post_is_not_allowed(client):
    assert client.post("/stations", json={}).status_code == 405
