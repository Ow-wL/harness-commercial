"""
엔진 v0.4(`mvp-0.4`) — 분석 반경 300·500·1,000m (D-024). docs/UX_REDESIGN.md 4.2의 세 검증을 나눈다.

  V-legacy  v0.4@500 == golden v0.3 (부평역 legacy 지점, rent="부평"). 다른 곳은 meta.엔진버전 하나뿐
  V-radius  v0.4@300·1,000 == golden v0.4 이고, 500 대비 바뀐 곳 ⊂ {경쟁성 지표, 종합, 경고, meta.분석반경_m, meta.엔진버전}
  V-web500  v0.4@500 == v0.3 웹 경로(ContextBuilder, rent=None) — 4지점 × 29업종, v0.3 는 별도 프로세스

fixture 를 새 출력으로 덮어써서 통과시키지 않는다 (tests/golden/README.md).
"""
import glob
import importlib
import json
import os
import subprocess
import sys

import pytest

import scoring_engine
import scoring_engine.config as C
from helpers import GOLDEN_JSON_DIR, ROOT, deep_diff, load_json, normalize
from scoring_engine.context import BUPYEONG_STATION

BIZ = list(C.CODE_NAME)
GOLDEN_V03 = {g["meta"]["업종코드"]: g for g in map(load_json, sorted(glob.glob(os.path.join(GOLDEN_JSON_DIR, "*.json"))))}
GOLDEN_V04_DIR = os.path.join(ROOT, "tests", "golden", "v0.4")


def golden_v04(radius: int) -> dict:
    files = sorted(glob.glob(os.path.join(GOLDEN_V04_DIR, f"r{radius}", "json", "*.json")))
    return {g["meta"]["업종코드"]: g for g in map(load_json, files)}


def only_version_differs(diffs: list[str]) -> bool:
    return diffs == ["$.meta.엔진버전: 'mvp-0.4' != 'mvp-0.3'"]


# ── 버전·입력 검사 ───────────────────────────────────────
def test_engine_is_v0_4():
    assert scoring_engine.ENGINE_KEY == "v0_4" and scoring_engine.ENGINE_VERSION == "mvp-0.4"
    assert os.path.basename(scoring_engine.ENGINE_DIR) == "v0_4"
    assert scoring_engine.RADIUS_OPTIONS_M == (300, 500, 1000) and C.RADIUS_M == 500


def test_v0_4_copy_of_team_unit_tests():
    """v0.3 팀 단위 테스트 14건이 v0.4 사본에서도 통과한다(사본 test_access.py 는 엔진버전 단언 한 줄만 mvp-0.4)."""
    mods = [importlib.import_module("test_weights"), importlib.import_module("test_access")]
    cases = [getattr(m, n) for m in mods for n in sorted(dir(m)) if n.startswith("test_")]
    assert len(cases) == 14 and all(os.path.dirname(m.__file__) == scoring_engine.ENGINE_DIR for m in mods)
    for fn in cases:
        fn()


@pytest.mark.parametrize("bad", [0, 250, 499, 750, 2000])
def test_unsupported_radius_rejected(service, bad):
    with pytest.raises(ValueError, match="분석 반경"):
        service.analyze(BUPYEONG_STATION, "R10406", radius_m=bad)


# ── V-legacy ─────────────────────────────────────────────
@pytest.mark.golden
@pytest.mark.parametrize("biz", BIZ, ids=[C.CODE_NAME[b] for b in BIZ])
def test_v_legacy_500_equals_golden_v0_3_except_version(bupyeong_results, service, biz):
    assert only_version_differs(deep_diff(normalize(bupyeong_results[biz]), GOLDEN_V03[biz]))
    explicit = service.analyze(BUPYEONG_STATION, biz, radius_m=500)          # 기본값과 명시 500 이 같다
    assert not deep_diff(normalize(explicit), normalize(bupyeong_results[biz]))


# ── V-radius ─────────────────────────────────────────────
ALLOWED_PREFIXES = ("$.지표[2].", "$.종합.", "$.경고", "$.meta.분석반경_m", "$.meta.엔진버전")


@pytest.mark.golden
@pytest.mark.parametrize("radius", [300, 1000])
def test_v_radius_matches_golden_v0_4(service, radius):
    golden = golden_v04(radius)
    assert sorted(golden) == sorted(BIZ)
    bad = []
    for biz in BIZ:
        got = normalize(service.analyze(BUPYEONG_STATION, biz, radius_m=radius))
        assert got["meta"]["분석반경_m"] == radius and got["지표"][2]["key"] == "competition"
        assert got["지표"][2]["raw"]["반경m"] == radius
        diffs = deep_diff(got, golden[biz])
        if diffs:
            bad.append(f"{C.CODE_NAME[biz]}: " + "; ".join(diffs[:5]))
    assert not bad, f"golden v0.4 r{radius} 와 다름:\n" + "\n".join(bad)


@pytest.mark.parametrize("radius", [300, 1000])
def test_v_radius_changes_only_competition_total_warnings(radius):
    """반경은 경쟁성(과 그 가중합인 종합·경고)만 바꾼다. 시장성·고객성·입지성·안정성·초보자 접근성은 그대로."""
    golden = golden_v04(radius)
    outside = []
    for biz in BIZ:
        for d in deep_diff(golden[biz], GOLDEN_V03[biz]):
            if not d.startswith(ALLOWED_PREFIXES):
                outside.append(f"{C.CODE_NAME[biz]}: {d}")
    assert not outside, "\n".join(outside[:30])


@pytest.mark.golden
def test_reference_cache_keys_per_radius(service):
    service.cache.warm()                                       # 앞 테스트가 대부분 채웠다 — 빠진 키만 계산
    stats = service.cache.stats()
    assert stats["location_entries"] == 14                     # 입지 reference 는 반경과 무관
    assert stats["competition_entries"] == 29 * 3              # (업종, 반경) 29 × 3


# ── V-web500 ─────────────────────────────────────────────
WEB_SITES = [(37.4894, 126.7246), (37.4475, 126.7015), (37.392512, 126.639034), (37.7466, 126.4880)]

_WEB_SCRIPT = """
import json, sys
out_path = sys.argv[2]
from scoring_engine.location import ContextBuilder
from scoring_engine.service import AnalysisService
import scoring_engine.config as C
svc = AnalysisService()
cb = ContextBuilder(svc.rt)
out = {}
for lat, lng in json.loads(sys.argv[1]):
    ctx = cb.build(lat, lng)
    out[f"{lat},{lng}"] = {biz: svc.analyze(ctx, biz) for biz in C.CODE_NAME}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
"""


@pytest.fixture(scope="module", autouse=True)
def v03_web(tmp_path_factory, request):
    """v0.3 웹 경로 결과를 별도 프로세스로 **모듈 시작 때** 계산을 시작한다(다른 golden 테스트와 겹쳐 돈다).
    엔진 로드 로그가 stdout 에 찍히므로 결과는 파일로 받는다. golden 을 뺀 실행(-m "not golden")에서는 시작하지 않는다."""
    if "not golden" in (request.config.getoption("-m") or ""):
        yield None
        return
    out = tmp_path_factory.mktemp("web") / "web_v0_3.json"
    env = dict(os.environ, SCORING_ENGINE_VERSION="v0_3", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    proc = subprocess.Popen([sys.executable, "-c", _WEB_SCRIPT, json.dumps(WEB_SITES), str(out)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    def result() -> dict:
        _, err = proc.communicate(timeout=900)
        assert proc.returncode == 0, err.decode("utf-8", "replace")[-2000:]
        with open(out, encoding="utf-8") as f:
            return json.load(f)

    yield result
    if proc.poll() is None:
        proc.kill()


@pytest.mark.golden
def test_v_web500_equals_v0_3_web_path_except_version(service, v03_web):
    from scoring_engine.location import ContextBuilder
    v03 = v03_web()                                            # v0.3 는 별도 프로세스(엔진은 프로세스당 하나)
    cb = ContextBuilder(service.rt)
    v04 = {f"{lat},{lng}": {biz: normalize(service.analyze(cb.build(lat, lng), biz)) for biz in BIZ}
           for lat, lng in WEB_SITES}
    assert sorted(v03) == sorted(v04) and len(v03) == len(WEB_SITES)
    bad = []
    for site in v03:
        assert len(v03[site]) == 29
        for biz in BIZ:
            assert v03[site][biz]["meta"]["엔진버전"] == "mvp-0.3"
            diffs = deep_diff(v04[site][biz], v03[site][biz])
            if not only_version_differs(diffs):
                bad.append(f"{site} {C.CODE_NAME[biz]}: " + "; ".join(diffs[:5]))
    assert not bad, "\n".join(bad[:20])
