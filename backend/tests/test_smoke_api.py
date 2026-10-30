"""scripts/smoke_api.py (TASKS 5-3 A, D-035) — 원격 대신 같은 앱(TestClient)에 붙여 검사 로직을 확인한다."""
import importlib.util
import json
import os

import pytest
from fastapi.testclient import TestClient

from backend.app import main as M

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_spec = importlib.util.spec_from_file_location("smoke_api", os.path.join(ROOT, "scripts", "smoke_api.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)


@pytest.fixture(scope="module")
def client(real_service):
    with TestClient(M.create_app(service=real_service, warm_biz=["R10406"])) as c:
        yield c


def fetch_of(client):
    def fetch(path, body=None, headers=None):
        r = client.get(path, headers=headers) if body is None else client.post(path, json=body, headers=headers)
        return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content, 0.01
    return fetch


def expected_of(client, sites=(("부평역", 37.4894, 126.7246),)):
    cases = []
    radii = client.get("/health").json()["engine"]["radius_options"]
    for name, lat, lng in sites:
        for r in radii:
            body = {"lat": lat, "lng": lng, "biz_code": "R10406", "radius_m": r}
            a, n = client.post("/analyze", json=body), client.post("/nearby-stores", json=body)
            cases.append({"site": name, "body": body, "status": [a.status_code, n.status_code],
                          "analyze": a.json(), "nearby": n.json()})
    return {"engine": client.get("/health").json()["engine"]["version"], "cases": cases,
            "rank": client.post("/rank", json=S.RANK_BODY).json()}


def test_same_tolerates_last_digit_only():
    assert S.same({"a": [1.0, 0.8126628455769709]}, {"a": [1.0, 0.812662845576971]})
    assert not S.same({"a": 1.0}, {"a": 1.001})
    assert not S.same({"a": 1}, {"a": 1, "b": 2})


def test_check_api_passes_against_same_app(client):
    fails, summary = S.check_api(fetch_of(client), expected_of(client), wait_warm=60, sleep=lambda s: None)
    assert fails == [], fails
    assert summary["cases"]["n"] == len(client.get("/health").json()["engine"]["radius_options"])
    assert summary["cases"]["mismatch"] == []
    pc = summary["bupyeong_pc"][500]
    assert pc["same"] == pc["nearby"]
    assert summary["invalid_radius"] == [422, "invalid_radius"]
    if summary["health"]["engine"]["version"].startswith("mvp-0.5"):
        assert "학교" in summary["school_warning"]
    assert summary["rank"]["status"] == 200 and summary["rank"]["count"] == 29 and summary["rank"]["compared"] is True


def test_check_rank_without_expected_section_skips_comparison(client):
    """13-16: 이전 형식 기대값(rank 없음)은 본문 대조만 건너뛴다 — 형태 검사(29개·정렬·PC방)는 그대로."""
    fails, summary = S.check_rank(fetch_of(client), {"engine": "x", "cases": []})
    assert fails == [] and summary["compared"] is False and summary["count"] == 29
    exp = expected_of(client)
    exp["rank"]["items"][0]["overall"] += 1
    fails, _ = S.check_rank(fetch_of(client), exp)
    assert any("/rank 부평역: 기대값과 다르다" in f for f in fails)


def test_check_api_reports_mismatch_engine_and_header(client):
    exp = expected_of(client)
    exp["cases"][0]["analyze"]["result"]["종합"]["점수"] += 1          # 기대값 변조 → 불일치
    fails, _ = S.check_api(fetch_of(client), exp, engine="mvp-9.9", wait_warm=60, sleep=lambda s: None)
    assert any("기대값 불일치 1/" in f for f in fails)
    assert any("/health engine" in f for f in fails)

    def no_header(path, body=None):
        s, h, d, t = fetch_of(client)(path, body)
        h.pop("x-data-version", None)
        return s, h, d, t
    fails, _ = S.check_api(no_header, expected_of(client), wait_warm=60, sleep=lambda s: None)
    assert any("X-Data-Version" in f for f in fails)


def test_main_usage_and_expected_shape(tmp_path):
    assert S.main([]) == 2
    data = json.loads(json.dumps({"engine": "x", "cases": []}))
    assert set(data) == {"engine", "cases"}
