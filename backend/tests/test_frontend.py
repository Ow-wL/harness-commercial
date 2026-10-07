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


def test_hashed_assets_are_served_with_long_cache(client):
    res = client.get("/assets/index-abc.js")
    assert res.status_code == 200 and res.text == "console.log(1)"
    assert res.headers["cache-control"] == "public, max-age=31536000, immutable"
    # 행정동 경계: Vite 는 한글 파일명을 URL 인코딩해 참조한다
    geo = client.get("/assets/%EC%9D%B8%EC%B2%9C_%ED%96%89%EC%A0%95%EB%8F%99%EA%B2%BD%EA%B3%84_2026-TEST.geojson")
    assert geo.status_code == 200 and geo.json()["type"] == "FeatureCollection"


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


def test_api_path_with_other_method_is_405_not_index(client):
    res = client.get("/analyze")
    assert res.status_code == 405 and "root" not in res.text


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
