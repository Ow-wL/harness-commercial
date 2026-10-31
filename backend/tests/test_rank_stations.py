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
    assert set(body) == {"lat", "lng", "radius_m", "gu_name", "dong_name", "count", "items", "engine_version"}
    assert body["engine_version"] == ENGINE_VERSION                      # R1-9: /analyze meta.엔진버전과 같은 값
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


class _GatedService:
    """/rank 잠금 경합 재현용 가짜 서비스(Codex 재검수 R1-10 스크립트와 같은 방식) — 스레드 이름별로 첫 업종에서 멈추거나 실패한다.
    엔진을 부르지 않고 analyze 호출 수·최대 동시 실행 수만 센다."""

    def __init__(self, fail_first=False):
        self.calls = self.active = self.max_active = 0
        self.mutex = threading.Lock()
        self.fail_first = fail_first
        self.started = {n: threading.Event() for n in ("first", "second", "third")}
        self.release = {n: threading.Event() for n in ("first", "second", "third")}

    def analyze(self, ctx, biz, **kwargs):
        with self.mutex:
            self.calls += 1
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            name = threading.current_thread().name
            if biz == next(iter(C.CODE_NAME)) and name in self.started:
                self.started[name].set()
                assert self.release[name].wait(5)
                if name == "first" and self.fail_first:
                    raise RuntimeError("injected compute failure")
            time.sleep(0.001)
            return {"종합": {"점수": 50, "병목_지표": None, "데이터_충족률": 1}, "지표": [],
                    "meta": {"업종": C.CODE_NAME[biz], "업종그룹": C.group_of(biz)}, "경고": []}
        finally:
            with self.mutex:
                self.active -= 1


def _rank_endpoint(service, ctx_for):
    from types import SimpleNamespace
    from fastapi import Response
    app = M.create_app(warm_biz=[])
    app.state.service = service
    app.state.context_builder = SimpleNamespace(build=lambda lat, lng: ctx_for(lat, lng))
    ep = next(r.endpoint for r in app.routes if getattr(r, "path", "") == "/rank")
    return app, lambda lat, lng: ep(M.RankRequest(lat=lat, lng=lng, radius_m=500), Response())


def _ctx(lat, lng):
    from types import SimpleNamespace
    return SimpleNamespace(lat=lat, lng=lng, gu_code="28237", gu_name="부평구", dong_name="부평1동")


def test_rank_failed_compute_waiter_and_new_request_share_one_lock():
    """R1-10: 첫 계산이 실패해도 그 키를 기다리던 요청이 남아 있으면 잠금 등록을 지우지 않는다 — 대기자가 다시 계산하는 동안
    새 요청은 같은 잠금 뒤에서 기다렸다가 캐시를 읽는다(동시 계산 1, analyze = 실패 1 + 29). 끝나면 등록이 비어 있다."""
    svc = _GatedService(fail_first=True)
    app, call = _rank_endpoint(svc, _ctx)
    status = {}

    def run():
        name = threading.current_thread().name
        try:
            call(37.4894, 126.7246)
            status[name] = "ok"
        except RuntimeError:
            status[name] = "error"

    first = threading.Thread(target=run, name="first")
    second = threading.Thread(target=run, name="second")
    third = threading.Thread(target=run, name="third")
    first.start()
    assert svc.started["first"].wait(5)
    second.start()
    time.sleep(0.2)                                                         # second 가 같은 키 잠금 앞에서 기다리게
    assert second.is_alive()
    svc.release["first"].set()                                              # first 실패 → second 가 이어서 계산
    assert svc.started["second"].wait(5)
    assert app.state.rank_inflight                                          # 대기자가 계산 중인 동안 등록 유지
    third.start()
    assert not svc.started["third"].wait(0.3)                               # third 는 analyze 에 들어가지 못하고 기다린다
    svc.release["second"].set()
    for t in (first, second, third):
        t.join(5)
    assert status == {"first": "error", "second": "ok", "third": "ok"}
    assert svc.max_active == 1
    assert svc.calls == 1 + len(C.CODE_NAME)
    assert app.state.rank_inflight == {}


def test_rank_different_keys_are_not_serialized():
    """다른 좌표는 서로의 잠금을 기다리지 않는다(키별 잠금) — 두 계산이 동시에 진행되고 끝나면 등록이 비어 있다."""
    svc = _GatedService()
    app, call = _rank_endpoint(svc, _ctx)
    a = threading.Thread(target=lambda: call(37.4894, 126.7246), name="first")
    b = threading.Thread(target=lambda: call(37.4900, 126.7250), name="second")
    a.start()
    assert svc.started["first"].wait(5)
    b.start()
    assert svc.started["second"].wait(2)                                    # first 가 멈춘 동안 second 도 계산에 들어간다
    assert svc.max_active == 2
    svc.release["first"].set()
    svc.release["second"].set()
    a.join(5)
    b.join(5)
    assert svc.calls == 2 * len(C.CODE_NAME) and app.state.rank_inflight == {}
    assert len(app.state.rank_cache) == 2


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
