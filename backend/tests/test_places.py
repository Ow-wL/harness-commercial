"""
TASKS 12-14 — 장소 이름 검색 프록시 POST /places {q} (D-036).

NAVER 는 부르지 않는다: PlacesClient 에 가짜 fetch 를 주입한다. 계약 = 키 없으면 503 places_unavailable·/health 광고 false,
검색어 검증 422, 상류 오류 502 places_upstream, 응답은 표시 필드만(제목 태그 제거, mapx/mapy → 경도·위도), 로그에 검색어 없음.
"""
import json
import logging
import types

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from backend.app.places import PlacesClient, PlacesUpstreamError, clean_title, parse_places

NAVER_BODY = {
    "lastBuildDate": "Thu, 29 Oct 2026 12:00:00 +0900",
    "total": 2, "start": 1, "display": 2,
    "items": [
        {"title": "<b>부평역</b> 1호선", "link": "", "category": "교통,운수>지하철,전철", "description": "",
         "telephone": "", "address": "인천광역시 부평구 부평동 738", "roadAddress": "인천광역시 부평구 부평대로 1",
         "mapx": "1267240000", "mapy": "374894000"},
        {"title": "A &amp; B 카페", "category": "음식점>카페", "address": "", "roadAddress": "인천광역시 부평구 어디로 2",
         "mapx": "1267000000", "mapy": "374900000"},
        {"title": "좌표 없음", "category": "x", "address": "", "roadAddress": "", "mapx": "", "mapy": ""},
        "not a dict",
    ],
}


def fake_service():
    return types.SimpleNamespace(cache=types.SimpleNamespace(warm=lambda b: None))


def make_client(places):
    app = M.create_app(service=fake_service(), warm_biz=[], places=places)
    return TestClient(app)


def ok_fetch(url, headers):
    ok_fetch.calls.append((url, headers))
    return 200, json.dumps(NAVER_BODY).encode("utf-8")


ok_fetch.calls = []


# ── 순수 함수 ───────────────────────────────────────────
def test_clean_title_strips_tags_and_entities():
    assert clean_title("<b>부평역</b> 1호선") == "부평역 1호선"
    assert clean_title("A &amp; B") == "A & B"


def test_parse_places_maps_fields_and_skips_items_without_coordinates():
    places = parse_places(json.dumps(NAVER_BODY).encode("utf-8"))
    assert [p.name for p in places] == ["부평역 1호선", "A & B 카페"]
    assert places[0].lat == pytest.approx(37.4894) and places[0].lng == pytest.approx(126.724)
    assert places[0].road_address == "인천광역시 부평구 부평대로 1"
    assert places[0].jibun_address == "인천광역시 부평구 부평동 738"
    assert places[1].jibun_address is None


def test_parse_places_rejects_wrong_shape():
    with pytest.raises(PlacesUpstreamError):
        parse_places(b'{"nope": 1}')
    with pytest.raises(PlacesUpstreamError):
        parse_places(b"not json")


# ── 엔드포인트 ──────────────────────────────────────────
def test_disabled_when_no_keys_health_advertises_false():
    with make_client(PlacesClient(None, None)) as c:
        assert c.get("/health").json()["places"] == {"enabled": False}
        r = c.post("/places", json={"q": "부평역"})
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "places_unavailable"


def test_from_env_reads_keys():
    assert PlacesClient.from_env({}).enabled is False
    assert PlacesClient.from_env({"NAVER_SEARCH_CLIENT_ID": "id", "NAVER_SEARCH_CLIENT_SECRET": "s"}).enabled is True
    assert PlacesClient.from_env({"NAVER_SEARCH_CLIENT_ID": "", "NAVER_SEARCH_CLIENT_SECRET": "s"}).enabled is False


def test_search_proxies_and_returns_display_fields_only(caplog):
    ok_fetch.calls.clear()
    with make_client(PlacesClient("id", "secret", fetch=ok_fetch)) as c, caplog.at_level(logging.INFO, logger="backend.places"):
        assert c.get("/health").json()["places"] == {"enabled": True}
        r = c.post("/places", json={"q": "  부평역 "})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    assert body["places"][0] == {"name": "부평역 1호선", "category": "교통,운수>지하철,전철",
                                  "road_address": "인천광역시 부평구 부평대로 1", "jibun_address": "인천광역시 부평구 부평동 738",
                                  "lat": 37.4894, "lng": 126.724}
    assert set(body["places"][1]) == {"name", "category", "road_address", "jibun_address", "lat", "lng"}
    # 상류 호출: 키 헤더, 공백을 다듬은 검색어, display 5
    url, headers = ok_fetch.calls[0]
    assert url.startswith("https://openapi.naver.com/v1/search/local.json?")
    assert "query=%EB%B6%80%ED%8F%89%EC%97%AD" in url and "display=5" in url
    assert headers == {"X-Naver-Client-Id": "id", "X-Naver-Client-Secret": "secret"}
    # 로그에 검색어·주소·키가 없다
    assert "부평" not in caplog.text and "secret" not in caplog.text
    assert "places ok 2 results" in caplog.text


@pytest.mark.parametrize("q", ["", "   ", "x" * 61])
def test_query_validation_422(q):
    with make_client(PlacesClient("id", "secret", fetch=ok_fetch)) as c:
        r = c.post("/places", json={"q": q})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_query"


def test_missing_query_is_invalid_request_and_get_is_405():
    with make_client(PlacesClient("id", "secret", fetch=ok_fetch)) as c:
        r = c.post("/places", json={})
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_request"
        assert c.post("/places", json={"q": 1}).status_code == 422          # 문자열만
        assert c.get("/places", params={"q": "부평역"}).status_code == 405   # GET 쿼리는 받지 않는다(요청 로그에 검색어가 남는다)


@pytest.mark.parametrize("fetch", [
    lambda url, headers: (429, b'{"errorMessage":"limit"}'),
    lambda url, headers: (200, b"<html>"),
    lambda url, headers: (_ for _ in ()).throw(TimeoutError("slow")),
])
def test_upstream_failures_502_without_details(fetch, caplog):
    with make_client(PlacesClient("id", "secret", fetch=fetch)) as c, caplog.at_level(logging.WARNING, logger="backend.places"):
        r = c.post("/places", json={"q": "부평역"})
    assert r.status_code == 502
    assert r.json()["error"] == {"code": "places_upstream", "message": "장소 검색 서비스가 응답하지 않습니다. 잠시 뒤 다시 시도하세요."}
    assert "부평" not in caplog.text


def test_places_is_an_api_path_not_spa_fallback(tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    app = M.create_app(service=fake_service(), warm_biz=[], frontend_dist=str(dist), places=PlacesClient(None, None))
    with TestClient(app) as c:
        assert c.post("/places", json={"q": "x"}).status_code == 503   # SPA index(200) 가 아니라 API 응답
