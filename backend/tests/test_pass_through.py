"""
TASKS 3-4 — API pass-through equality (docs/DECISIONS.md D-012).

  POST /analyze 의 result == AnalysisService.analyze(ContextBuilder.build(lat, lng), biz, ...) 의 JSON  (전체 비교)
  POST /analyze 의 context == 같은 SiteContext 의 공개 필드

보장하는 것: API 계층이 엔진 결과를 바꾸지 않는다 (키 추가·삭제·반올림·이름 변경 모두 실패).
legacy golden(BUPYEONG_STATION, rent_area="부평") 과는 비교하지 않는다 — 그건 tests/test_golden_regression.py 의 책임.
좌표는 tests/test_context_builder.py 에서 이미 분석이 검증된 것만 쓴다.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import main as M
from tests.helpers import deep_diff, normalize

CONTEXT_FIELDS = ("lat", "lng", "gu_code", "gu_name", "dong_name", "label", "rent_area")

CASES = [
    # (id, lat, lng, biz, optional inputs, 기대 (gu_name, dong_name))
    ("부평역-PC방", 37.4894, 126.7246, "R10406", {}, ("부평구", "부평1동")),
    ("구월교정구역-카페", 37.4482, 126.7035, "I21201", {}, ("남동구", "구월3동")),     # SGIS 공식 경계 교정 (D-017)
    ("아라-미용실", 37.5970, 126.7102, "S20701", {}, ("검단구", "아라2동")),
    ("부평역-PC방-importance", 37.4894, 126.7246, "R10406",
     {"importance": {"stability": 5, "competition": 4}}, ("부평구", "부평1동")),
]


@pytest.fixture(scope="module")
def app_client(real_service):
    app = M.create_app(service=real_service, warm_biz=[])
    with TestClient(app) as client:
        yield app, client


@pytest.mark.parametrize("case", CASES, ids=[c[0] for c in CASES])
def test_api_result_equals_direct_service_call(app_client, real_service, case):
    _, lat, lng, biz, extra, (gu_name, dong_name) = case
    app, client = app_client

    r = client.post("/analyze", json={"lat": lat, "lng": lng, "biz_code": biz, **extra})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"context", "result"}

    builder = app.state.context_builder                       # API 가 쓰는 바로 그 ContextBuilder
    ctx = builder.build(lat, lng)
    direct = normalize(real_service.analyze(ctx, biz, **extra))

    # context: SiteContext 의 공개 필드와 정확히 같다
    assert body["context"] == {k: getattr(ctx, k) for k in CONTEXT_FIELDS}
    assert (body["context"]["gu_name"], body["context"]["dong_name"]) == (gu_name, dong_name)
    assert body["context"]["rent_area"] is None

    # result: 엔진 JSON 전체가 같다 (meta·종합·지표[raw·breakdown·flags·note]·초보자_접근성·경고·면책)
    diffs = deep_diff(body["result"], direct)
    assert not diffs, f"API result 가 엔진 결과와 다름 ({len(diffs)}건):\n" + "\n".join(diffs[:20])
    assert body["result"] == direct                           # deep_diff 의 부동소수 허용오차 없이도 같다
    assert body["result"]["meta"]["업종코드"] == biz


def test_optional_input_changes_result_consistently(app_client, real_service):
    """importance 를 넣은 결과가 넣지 않은 결과와 실제로 다르다 — 위 equality 가 '무시된 입력'을 놓치지 않도록."""
    _, client = app_client
    base = client.post("/analyze", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}).json()["result"]
    imp = client.post("/analyze", json={"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406",
                                        "importance": {"stability": 5, "competition": 4}}).json()["result"]
    assert imp["종합"]["적용_가중치"] != base["종합"]["적용_가중치"]
    assert imp["종합"]["가중치_출처"] != base["종합"]["가중치_출처"]
    assert {i["key"]: i["score"] for i in imp["지표"]} == {i["key"]: i["score"] for i in base["지표"]}
