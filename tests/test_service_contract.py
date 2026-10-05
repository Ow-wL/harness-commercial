"""
어댑터(scoring_engine.service) 계약 — 사용자 조건 전달과 입력 오류 처리.
기대값은 v0.3 설계서 10-4 (부평역 PC방, 관점 점수 고정) 에서 가져왔다.
"""
import pytest

from scoring_engine.context import BUPYEONG_STATION, SiteContext


def _scores(r):
    return {i["key"]: i["score"] for i in r["지표"]}


@pytest.mark.parametrize("kw,total", [
    (dict(importance={"stability": 5, "competition": 4}), 61.7),
    (dict(importance={"competition": 5}), 59.0),
    (dict(importance={"market": 5, "customer": 5}), 66.9),
    (dict(importance={"competition": 1}), 69.3),
    (dict(user_weights={"competition": 0}), 71.5),
])
def test_user_weights_match_design_doc(service, bupyeong_results, kw, total):
    base = bupyeong_results["R10406"]
    r = service.analyze(BUPYEONG_STATION, "R10406", **kw)
    assert r["종합"]["점수"] == total
    assert _scores(r) == _scores(base)                       # 관점 점수는 가중치와 무관
    assert r["종합"]["기본가중치_종합점수"] == base["종합"]["점수"] == 64.1


def test_licenses_change_tag_not_score(service, bupyeong_results):
    r = service.analyze(BUPYEONG_STATION, "S20701", user_licenses=["미용사(일반)"])
    assert r["초보자_접근성"]["제도_진입장벽"] == "낮음"
    assert bupyeong_results["S20701"]["초보자_접근성"]["제도_진입장벽"] == "높음"
    assert r["종합"]["점수"] == bupyeong_results["S20701"]["종합"]["점수"]


def test_unknown_biz_rejected(service):
    with pytest.raises(ValueError):
        service.analyze(BUPYEONG_STATION, "Z99999")


def test_unknown_dong_rejected(service):
    bad = SiteContext(label="x", lat=37.0, lng=126.0, gu_code="28237", gu_name="부평구",
                      dong_name="없는동", rent_area=None)
    with pytest.raises(KeyError):
        service.analyze(bad, "R10406")


def test_unknown_rent_area_rejected(service):
    bad = SiteContext(label="x", lat=BUPYEONG_STATION.lat, lng=BUPYEONG_STATION.lng, gu_code="28237",
                      gu_name="부평구", dong_name="부평1동", rent_area="없는상권")
    with pytest.raises(KeyError):
        service.analyze(bad, "R10406")
