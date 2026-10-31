"""
TASKS 12-10 — 사용 현황 구조화 로그(backend/app/usage.py). 분석 계열·AI·지원사업 POST 마다 JSON 한 줄:
경로·상태·결과 코드·지연·업종·구·반경만 — 좌표·IP 는 없다. GET·다른 경로는 남기지 않는다.
"""
import json
import logging

from fastapi.testclient import TestClient

from backend.app import main as M

BUPYEONG = {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "radius_m": 500}


def records(caplog):
    out = []
    for r in caplog.records:
        if r.name == "backend.usage":
            payload = json.loads(r.getMessage())
            assert payload["severity"] == "INFO" and payload["message"] == "usage"
            out.append(payload["usage"])
    return out


def test_usage_lines_have_only_allowed_fields(real_service, caplog):
    with caplog.at_level(logging.INFO, logger="backend.usage"), TestClient(M.create_app(service=real_service, warm_biz=[])) as c:
        assert c.post("/analyze", json=BUPYEONG).status_code == 200
        assert c.post("/analyze", json={**BUPYEONG, "lat": 37.5665, "lng": 126.978}).status_code == 422     # 서울 → 인천 밖
        assert c.post("/analyze", json={**BUPYEONG, "biz_code": "NOPE"}).status_code == 422
        assert c.post("/analyze", json={"lat": "x"}).status_code == 422
        assert c.post("/insights", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "I21201"}).status_code == 200
        c.get("/health")
    recs = records(caplog)
    assert [r["path"] for r in recs] == ["/analyze"] * 4 + ["/insights"]                                    # GET 은 없음
    ok = recs[0]
    assert (ok["status"], ok["code"], ok["biz"], ok["gu"], ok["radius"]) == (200, "ok", "R10406", "부평구", 500)
    assert isinstance(ok["ms"], int) and ok["ms"] >= 0
    assert recs[1]["code"] == "location_outside" and "gu" not in recs[1]
    assert recs[2]["code"] == "invalid_business"
    assert recs[3]["code"] == "invalid_request"
    assert recs[4]["biz"] == "I21201" and recs[4]["gu"] == "부평구"
    for r in recs:
        assert set(r) <= {"path", "status", "code", "ms", "biz", "gu", "radius", "cached"}
    text = caplog.text
    assert "37.48" not in text and "126.72" not in text and "37.56" not in text                              # 좌표 없음


def test_rate_limited_and_support_unavailable_codes(real_service, caplog, monkeypatch):
    monkeypatch.delenv("BIZINFO_API_KEY", raising=False)
    monkeypatch.delenv("DATA_GO_KR_API_KEY", raising=False)
    with caplog.at_level(logging.INFO, logger="backend.usage"), \
            TestClient(M.create_app(service=real_service, warm_biz=[], rate_limit_per_minute=1)) as c:
        assert c.post("/support/match", json={"biz_code": "I21201", "gu": "부평구"}).status_code == 503
        assert c.post("/support/match", json={"biz_code": "I21201"}).status_code == 429
    recs = records(caplog)
    assert (recs[0]["code"], recs[0]["biz"], recs[0]["gu"], recs[0]["status"]) == ("support_unavailable", "I21201", "부평구", 503)
    assert (recs[1]["code"], recs[1]["status"]) == ("rate_limited", 429) and "biz" not in recs[1]
