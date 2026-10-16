"""
8-D2 — 엔진 v0.4 프로세스의 분석 반경 API (D-024). 기본(v0.3) 계약은 backend/tests/test_radius.py.

- /health 가 300·500·1,000 을 광고한다
- /analyze 의 result 는 AnalysisService.analyze(radius_m=…) 그대로(pass-through), meta·경쟁성 raw 에 반경
- /nearby-stores 의 count == 같은 반경 /analyze 의 경쟁성.raw.동종점포수 (D-019 불변식을 반경마다), 거리 ≤ 반경
- 생략은 500, 엔진이 받지 않는 값은 422 invalid_radius
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from helpers import deep_diff, normalize

OK = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
SONGDO = {"lat": 37.392512, "lng": 126.639034, "biz_code": "R10406"}


@pytest.fixture(scope="module")
def client(service):
    with TestClient(M.create_app(service=service, warm_biz=[])) as c:
        yield c


def competition(result):
    return next(i for i in result["지표"] if i["key"] == "competition")


def test_health_advertises_three_radii(client):
    assert client.get("/health").json()["engine"] == {"version": "mvp-0.4", "radius_options": [300, 500, 1000],
                                                      "default_radius_m": 500}


@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_analyze_passes_engine_result_through(client, service, radius):
    r = client.post("/analyze", json={**OK, "radius_m": radius})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result["meta"]["분석반경_m"] == radius and result["meta"]["엔진버전"] == "mvp-0.4"
    assert competition(result)["raw"]["반경m"] == radius
    from scoring_engine.location import ContextBuilder
    direct = service.analyze(ContextBuilder(service.rt).build(OK["lat"], OK["lng"]), "R10406", radius_m=radius)
    assert not deep_diff(result, normalize(direct))


@pytest.mark.parametrize("body", [OK, SONGDO], ids=["부평역", "송도"])
@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_nearby_count_matches_competition_per_radius(client, body, radius):
    a = client.post("/analyze", json={**body, "radius_m": radius})
    n = client.post("/nearby-stores", json={**body, "radius_m": radius})
    assert a.status_code == 200 and n.status_code == 200, (a.text, n.text)
    nb = n.json()
    assert nb["radius_m"] == radius
    assert nb["count"] == len(nb["stores"]) == competition(a.json()["result"])["raw"]["동종점포수"]
    assert all(s["distance_m"] <= radius for s in nb["stores"])


def test_bupyeong_pc_bang_counts_by_radius(client):
    """docs/UX_REDESIGN.md 4.2 실험값(부평역 PC방 같은 업종 6 / 12 / 17)과 같다."""
    counts = [client.post("/nearby-stores", json={**OK, "radius_m": r}).json()["count"] for r in (300, 500, 1000)]
    assert counts == [6, 12, 17]


def test_omitted_radius_is_default_500(client):
    a = client.post("/analyze", json=OK).json()["result"]
    assert a["meta"]["분석반경_m"] == 500
    assert client.post("/nearby-stores", json=OK).json()["radius_m"] == 500


@pytest.mark.parametrize("path", ["/analyze", "/nearby-stores"])
@pytest.mark.parametrize("radius", [250, 750, 2000])
def test_unsupported_radius(client, path, radius):
    r = client.post(path, json={**OK, "radius_m": radius})
    assert r.status_code == 422
    assert r.json()["error"] == {"code": "invalid_radius", "message": "지원하지 않는 분석 반경입니다(가능: 300m, 500m, 1000m)."}


def test_warm_tasks_cover_every_business_and_radius():
    from scoring_engine import config as C
    tasks = M.warm_tasks(list(C.CODE_NAME))
    assert len(tasks) == 87 and len(set(tasks)) == 87
    assert [r for _, r in tasks[:29]] == [500] * 29          # 기본 반경을 먼저 모두
