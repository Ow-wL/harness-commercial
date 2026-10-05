"""
v0.3 Golden Regression — 같은 부평역 입력이면 v0.3 결과(05_분석결과)와 같아야 한다.

기준 fixture: tests/golden/v0.3/  (원본과 바이트 동일, test_integrity.py 가 해시 검사)
실패했을 때 fixture 를 새 출력으로 덮어써서 통과시키지 않는다.
fixture 교체는 엔진 버전이 바뀔 때만 (tests/golden/README.md).
"""
import csv
import glob
import os

import pytest

import scoring_engine.config as C
from helpers import GOLDEN_CSV, GOLDEN_JSON_DIR, deep_diff, load_json, normalize
from scoring_engine.service import SUMMARY_COLUMNS, ranking

pytestmark = pytest.mark.golden

GOLDEN = {g["meta"]["업종코드"]: g for g in map(load_json, sorted(glob.glob(os.path.join(GOLDEN_JSON_DIR, "*.json"))))}
with open(GOLDEN_CSV, encoding="utf-8-sig", newline="") as _f:
    GOLDEN_ROWS = list(csv.DictReader(_f))
BIZ = list(C.CODE_NAME)


def test_golden_covers_all_29_businesses():
    assert sorted(GOLDEN) == sorted(BIZ) and len(BIZ) == 29
    assert [r["업종코드"] for r in GOLDEN_ROWS] and len(GOLDEN_ROWS) == 29


@pytest.mark.parametrize("biz", BIZ, ids=[C.CODE_NAME[b] for b in BIZ])
def test_full_json_matches_golden(bupyeong_results, biz):
    """엔진 출력 전체 (meta·종합·지표[raw·breakdown·flags]·접근성·경고·면책) 비교."""
    diffs = deep_diff(normalize(bupyeong_results[biz]), GOLDEN[biz])
    assert not diffs, f"{C.CODE_NAME[biz]} v0.3 와 다름 ({len(diffs)}건):\n" + "\n".join(diffs[:30])


@pytest.mark.parametrize("biz", BIZ, ids=[C.CODE_NAME[b] for b in BIZ])
def test_key_fields_match_golden(bupyeong_results, biz):
    """필수 검증 항목만 따로 — 실패 메시지를 읽기 쉽게."""
    got, want = normalize(bupyeong_results[biz]), GOLDEN[biz]
    pick = lambda r: {  # noqa: E731
        "업종": r["meta"]["업종"], "업종코드": r["meta"]["업종코드"],
        "종합점수": r["종합"]["점수"], "병목지표": r["종합"]["병목_지표"],
        "적용가중치": r["종합"]["적용_가중치"],
        "관점점수": {i["key"]: i["score"] for i in r["지표"]},
        "raw": {i["key"]: i["raw"] for i in r["지표"]},
        "접근성": r["초보자_접근성"],
    }
    diffs = deep_diff(pick(got), pick(want))
    assert not diffs, "\n".join(diffs)


def test_ranking_csv_matches_golden(bupyeong_results):
    rows = ranking(bupyeong_results)
    assert list(GOLDEN_ROWS[0].keys()) == SUMMARY_COLUMNS
    assert [r["업종코드"] for r in rows] == [g["업종코드"] for g in GOLDEN_ROWS], "순위가 다르다"
    diffs = []
    for got, want in zip(rows, GOLDEN_ROWS):
        for col in SUMMARY_COLUMNS:
            g, w = got[col], want[col]
            if w == "":
                ok = g is None or g == ""
            elif isinstance(g, (int, float)) and not isinstance(g, bool):
                ok = abs(float(g) - float(w)) <= 1e-9 * max(1.0, abs(float(w)))
            else:
                ok = str(g) == w
            if not ok:
                diffs.append(f"{want['업종명']}.{col}: {g!r} != {w!r}")
    assert not diffs, "\n".join(diffs)


def test_cached_recomputation_is_identical(service, bupyeong_results):
    """캐시된 reference 로 다시 계산해도 같은 결과 (캐시가 상태를 오염시키지 않는다)."""
    from scoring_engine.context import BUPYEONG_STATION
    for biz in ("R10406", "I21006", "S20701"):
        assert not deep_diff(normalize(service.analyze(BUPYEONG_STATION, biz)), GOLDEN[biz])
    assert service.cache.stats() == {"competition_entries": 29, "location_entries": 14}
