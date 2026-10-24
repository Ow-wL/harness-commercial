"""
엔진 v0.5 프로세스의 API (D-028). 기본(v0.3) 계약은 backend/tests, v0.4 는 tests/engine_v0_4/test_backend_radius.py.

- /health 가 mvp-0.5 와 300·500·1,000 을 광고한다(지원하는 반경만)
- /analyze 의 result 는 AnalysisService.analyze(radius_m=…) 그대로(pass-through) — 반경 표기(meta·경쟁성·고객성)가 요청 반경
- /nearby-stores 의 count == 같은 반경 /analyze 의 경쟁성.raw.동종점포수(정확 일치) — 대체업종을 더한 실효 수가 아니다
- 학교구역 경고는 엔진 순서 그대로 경고[0] 으로 온다
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from helpers import deep_diff, normalize

PC = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
CAFE = {**PC, "biz_code": "I21201"}
SCHOOL_PC = {"lat": 37.502274 + 50 / 110_540, "lng": 126.727619, "biz_code": "R10406"}


@pytest.fixture(scope="module")
def client(service):
    with TestClient(M.create_app(service=service, warm_biz=[])) as c:
        yield c


def test_health_advertises_v0_5_and_three_radii(client):
    assert client.get("/health").json()["engine"] == {"version": "mvp-0.5", "radius_options": [300, 500, 1000],
                                                      "default_radius_m": 500}


@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_analyze_passes_engine_result_through(client, service, radius):
    r = client.post("/analyze", json={**PC, "radius_m": radius})
    assert r.status_code == 200, r.text
    result = r.json()["result"]
    assert result["meta"]["분석반경_m"] == radius and result["meta"]["엔진버전"] == "mvp-0.5"
    assert result["지표"][2]["raw"]["반경m"] == radius
    assert result["지표"][1]["raw"]["인구_기준"] == f"반경 {radius}m 배분"
    from scoring_engine.location import ContextBuilder
    direct = service.analyze(ContextBuilder(service.rt).build(PC["lat"], PC["lng"]), "R10406", radius_m=radius)
    assert not deep_diff(result, normalize(direct))


@pytest.mark.parametrize("body", [PC, CAFE], ids=["PC방", "카페"])
@pytest.mark.parametrize("radius", [300, 500, 1000])
def test_nearby_count_is_exact_same_business_count(client, body, radius):
    a = client.post("/analyze", json={**body, "radius_m": radius})
    n = client.post("/nearby-stores", json={**body, "radius_m": radius})
    assert a.status_code == 200 and n.status_code == 200, (a.text, n.text)
    raw = a.json()["result"]["지표"][2]["raw"]
    nb = n.json()
    assert nb["radius_m"] == radius
    assert nb["count"] == len(nb["stores"]) == raw["동종점포수"] == raw["동종점포수_정확일치"]
    assert raw["동종점포수_실효(대체업종_포함)"] > raw["동종점포수"]      # 대체업종 포함 실효 수는 목록 수와 다르다
    assert all(s["distance_m"] <= radius for s in nb["stores"])


def test_bupyeong_pc_bang_counts_by_radius(client):
    """정확 일치 동종 점포 수는 v0.4 와 같다(6 / 12 / 17) — v0.5 는 이 수를 바꾸지 않고 실효 수를 따로 낸다."""
    counts = [client.post("/nearby-stores", json={**PC, "radius_m": r}).json()["count"] for r in (300, 500, 1000)]
    assert counts == [6, 12, 17]


def test_school_zone_warning_first_via_api(client):
    r = client.post("/analyze", json=SCHOOL_PC)
    assert r.status_code == 200, r.text
    warnings = r.json()["result"]["경고"]
    assert warnings[0].startswith("⚠ PC방은(는) 학교 주변 영업 규제 업종인데")


@pytest.mark.parametrize("radius", [250, 750, 2000])
def test_unsupported_radius(client, radius):
    r = client.post("/analyze", json={**PC, "radius_m": radius})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_radius"


def test_warm_tasks_cover_every_business_and_radius():
    from scoring_engine import config as C
    tasks = M.warm_tasks(list(C.CODE_NAME))
    assert len(tasks) == 29 * 3 and [r for _, r in tasks[:29]] == [500] * 29
