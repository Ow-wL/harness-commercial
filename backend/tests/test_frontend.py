"""
frontend production build 같은 origin 서빙 (TASKS 5-4, D-018, backend/app/frontend.py).

실제 npm build 대신 같은 모양의 임시 dist(index.html + assets/)를 만든다 — 계약은 경로 우선순위·fallback·캐시 헤더다.
실제 build 에 행정동 GeoJSON 이 들어가는지는 Dockerfile 의 build 단계가 sha256 으로 확인한다.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M

INDEX_HTML = '<!doctype html><div id="root"></div>'
GEOJSON = "인천_행정동경계_2026-TEST.geojson"


@pytest.fixture(scope="module")
def dist(tmp_path_factory):
    root = tmp_path_factory.mktemp("frontend")
    d = root / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (d / "favicon.ico").write_bytes(b"ico")
    (d / "assets" / "index-abc.js").write_text("console.log(1)", encoding="utf-8")
    (d / "assets" / "big-abc.js").write_text("x" * 5000, encoding="utf-8")          # gzip 대상(>= GZIP_MIN_BYTES)
    (d / "assets" / GEOJSON).write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")
    (root / "secret.txt").write_text("outside dist", encoding="utf-8")
    return d


@pytest.fixture(scope="module")
def client(real_service, dist):
    app = M.create_app(service=real_service, warm_biz=[], frontend_dist=str(dist))
    with TestClient(app) as c:
        yield c


def is_index(res):
    return res.status_code == 200 and res.text == INDEX_HTML and res.headers["cache-control"] == "no-cache"


def test_root_and_spa_routes_serve_index(client):
    assert is_index(client.get("/"))
    assert is_index(client.get("/result"))
    assert is_index(client.get("/some/deep/route"))


def test_every_api_route_other_method_is_405_not_index(client):
    """등록된 API route 전부: 다른 method 는 405 — SPA index.html(200)로 떨어지지 않는다. 손으로 적은 목록이 /insights 를 빠뜨려
    GET /insights 가 200 이던 결함(v0.1.0 무트래픽 smoke)의 회귀 검사. 새 엔드포인트도 자동으로 포함된다."""
    from fastapi.routing import APIRoute
    routes = [r for r in client.app.routes if isinstance(r, APIRoute) and "{" not in r.path]   # SPA 폴백 route 제외
    paths = {r.path for r in routes}
    assert {"/analyze", "/nearby-stores", "/places", "/rank", "/insights", "/stations", "/health", "/businesses"} <= paths
    for r in routes:
        other = "GET" if "GET" not in r.methods else "POST"
        res = client.request(other, r.path)
        assert res.status_code == 405, (other, r.path, res.status_code)
        assert not is_index(res)


def test_hashed_assets_are_served_with_long_cache(client):
    res = client.get("/assets/index-abc.js")
    assert res.status_code == 200 and res.text == "console.log(1)"
    assert res.headers["cache-control"] == "public, max-age=31536000, immutable"
    # 행정동 경계: Vite 는 한글 파일명을 URL 인코딩해 참조한다
    geo = client.get("/assets/%EC%9D%B8%EC%B2%9C_%ED%96%89%EC%A0%95%EB%8F%99%EA%B2%BD%EA%B3%84_2026-TEST.geojson")
    assert geo.status_code == 200 and geo.json()["type"] == "FeatureCollection"


def test_gzip_for_large_assets_and_json_only_when_accepted(client):
    """12-1: Accept-Encoding: gzip 이면 큰 본문(정적·JSON)은 gzip, 작은 본문·identity 요청은 그대로. 캐시·데이터 버전 헤더 유지."""
    big = client.get("/assets/big-abc.js", headers={"Accept-Encoding": "gzip"})
    assert big.status_code == 200 and big.headers.get("content-encoding") == "gzip"
    assert big.text == "x" * 5000                                   # TestClient(httpx) 가 풀어 준 본문
    assert big.headers["cache-control"] == "public, max-age=31536000, immutable"
    small = client.get("/assets/index-abc.js", headers={"Accept-Encoding": "gzip"})
    assert small.status_code == 200 and "content-encoding" not in small.headers
    plain = client.get("/assets/big-abc.js", headers={"Accept-Encoding": "identity"})
    assert plain.status_code == 200 and "content-encoding" not in plain.headers and plain.text == "x" * 5000
    analyze = client.post("/analyze", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"},
                          headers={"Accept-Encoding": "gzip"})
    assert analyze.status_code == 200 and analyze.headers.get("content-encoding") == "gzip"
    assert analyze.headers["x-data-version"] == client.get("/health").json()["data"]["version"]
    assert analyze.json()["result"]["meta"]["업종코드"] == "R10406"
    err = client.post("/analyze", json={"lat": 37.5665, "lng": 126.978, "biz_code": "R10406"},
                      headers={"Accept-Encoding": "gzip"})
    assert err.status_code == 422 and "content-encoding" not in err.headers   # 작은 오류 본문은 압축하지 않는다


def test_dist_root_files_are_served(client):
    res = client.get("/favicon.ico")
    assert res.status_code == 200 and res.content == b"ico"


@pytest.mark.parametrize("path", ["/assets/missing.js", "/missing.png", "/%2E%2E/secret.txt"])
def test_missing_files_are_404_not_index(client, path):
    res = client.get(path)
    assert res.status_code == 404 and "root" not in res.text


def test_api_routes_win_over_spa_fallback(client):
    health = client.get("/health")
    assert health.status_code == 200 and health.json()["status"] == "ok"
    assert client.get("/businesses").json()["total"] == 29
    res = client.post("/analyze", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "NOPE"})
    assert res.status_code == 422 and res.json()["error"]["code"] == "invalid_business"


@pytest.mark.parametrize("method, path", [("get", "/analyze"), ("get", "/rank"), ("post", "/stations")])
def test_api_path_with_other_method_is_405_not_index(client, method, path):
    res = getattr(client, method)(path)
    assert res.status_code == 405 and "root" not in res.text


def test_rank_and_stations_win_over_spa_fallback(client):
    """13-16·13-17: 새 API 경로도 SPA fallback 보다 먼저 매칭된다."""
    assert client.get("/stations").json()["count"] == 211
    res = client.post("/rank", json={"lat": 37.4894, "lng": 126.7246, "radius_m": 750})
    assert res.status_code == 422 and res.json()["error"]["code"] == "invalid_radius"


def test_unknown_non_get_is_404(client):
    assert client.post("/no-such-route").status_code == 404


def test_without_frontend_dist_api_only(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        assert c.get("/").status_code == 404
        assert c.get("/health").status_code == 200


def test_missing_build_fails_fast(real_service, tmp_path):
    with pytest.raises(RuntimeError, match="frontend build"):
        M.create_app(service=real_service, warm_biz=[], frontend_dist=str(tmp_path))


@pytest.mark.parametrize("path", ["/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"])
def test_production_hides_api_docs_without_spa_fallback(client, path):
    """production(frontend 서빙)에서는 API 문서를 끈다 (D-018). index.html 로 떨어지지 않고 404."""
    res = client.get(path)
    assert res.status_code == 404 and "root" not in res.text


def test_production_api_stays_public(client):
    """문서를 닫는 것은 인증이 아니다 — API 는 그대로 열려 있다."""
    assert client.get("/health").status_code == 200
    assert client.get("/businesses").status_code == 200
    assert client.post("/analyze", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}).status_code == 200


def test_api_only_mode_keeps_docs(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as c:
        assert c.get("/docs").status_code == 200
        assert c.get("/openapi.json").json()["info"]["title"] == "인천 상권분석 API"
