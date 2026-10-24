"""
엔진 v0.5.1 사본 무결성 — v0.5 웹 사본 + 분동 배분 결함 수정만 허용한다 (D-029, D-006).

- scoring_engine/v0_5_1/ 파일 해시 = tests/manifests/engine_v0_5_1.sha256.json
- etl_boundary.py·scoring.py·test_access.py 외 파일은 v0_5 와 바이트 동일
- 바뀐 줄: 분동 비율 대입 한 줄 → 비율 1.0(모체 면적 비율만), 그 설명 주석·docstring, 엔진버전 문자열 (아래 허용 목록)
- golden v0.5.1 은 golden v0.5 와 고객성·경쟁성(과 그 가중합인 종합·경고)·엔진버전에서만 다르다(시장성·입지성·안정성·접근성 불변)
이 테스트는 파일만 읽으므로 기본(v0.3) 프로세스에서 돈다.
"""
import difflib
import glob
import hashlib
import json
import os

from helpers import ROOT, deep_diff, load_json

V05 = os.path.join(ROOT, "scoring_engine", "v0_5")
V051 = os.path.join(ROOT, "scoring_engine", "v0_5_1")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "engine_v0_5_1.sha256.json")
CHANGED = {"etl_boundary.py", "scoring.py", "test_access.py"}
REMOVED = {  # v0_5 에서 지운 줄 — 이것뿐이어야 한다
    'k, ratio = r["_parent"], r["총인구"] / par_tot[r["_parent"]]',
    '(etl_sgis.py와 같은 규칙). 신설 분동(아라1·2동, 운서1·2동)은 모체 동 경계를 인구 비율로 나눠 쓴다.',
    '"엔진버전": "mvp-0.5",',
    'assert base["meta"]["엔진버전"] == "mvp-0.5"',
}
ADDED = {  # 새로 쓴 줄(주석 # 줄 제외) — 이것뿐이어야 한다
    'k = r["_parent"]  # D-029',
    '"엔진버전": "mvp-0.5.1",',
    'assert base["meta"]["엔진버전"] == "mvp-0.5.1"',
    "(etl_sgis.py와 같은 규칙). 신설 분동(아라1·2동, 운서1·2동)은 모체 동 경계를 그대로 함께 쓴다(웹 v0.5.1, D-029:",
    "분동 값은 이미 분동별이라 모체 면적 비율만 곱한다 — 팀 v0.5 는 인구 비율을 한 번 더 곱해 배분 인구가 줄었다).",
}


def _read(d, f):
    with open(os.path.join(d, f), "rb") as fh:
        return fh.read()


def _py(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".py"))


def test_v0_5_1_files_match_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        want = json.load(f)["files"]
    assert {f: hashlib.sha256(_read(V051, f)).hexdigest() for f in _py(V051)} == want
    assert _py(V051) == _py(V05)


def test_unchanged_modules_are_byte_identical_to_v0_5():
    for f in _py(V05):
        if f not in CHANGED:
            assert _read(V051, f) == _read(V05, f), f


def test_changed_lines_are_only_split_dong_fix_and_version():
    removed, added = set(), set()
    for f in sorted(CHANGED):
        a = _read(V05, f).decode("utf-8").splitlines()
        b = _read(V051, f).decode("utf-8").splitlines()
        for x in difflib.unified_diff(a, b, lineterm="", n=0):
            if x.startswith(("---", "+++", "@@")):
                continue
            (removed if x.startswith("-") else added).add(x[1:].strip())
    assert removed == REMOVED
    assert {x for x in added if x and not x.startswith("#")} == ADDED
    assert any("D-029" in x for x in added if x.startswith("#"))          # 수정 이유 주석


GOLDEN = os.path.join(ROOT, "tests", "golden")
ALLOWED = ("$.지표[1].", "$.지표[2].", "$.종합.", "$.경고", "$.meta.엔진버전")


def _golden(path):
    return {g["meta"]["업종코드"]: g for g in map(load_json, sorted(glob.glob(os.path.join(path, "*.json"))))}


def test_golden_v0_5_1_differs_from_v0_5_only_in_area_weighted_parts():
    outside = []
    for r, old in ((500, "v0.5/json"), (300, "v0.5/r300/json"), (1000, "v0.5/r1000/json")):
        a, b = _golden(os.path.join(GOLDEN, old)), _golden(os.path.join(GOLDEN, "v0.5.1", f"r{r}", "json"))
        assert sorted(a) == sorted(b) and len(b) == 29
        for biz in a:
            assert b[biz]["meta"]["엔진버전"] == "mvp-0.5.1" and b[biz]["meta"]["분석반경_m"] == r
            outside += [f"r{r} {biz}: {d}" for d in deep_diff(b[biz], a[biz]) if not d.startswith(ALLOWED)]
    assert not outside, "\n".join(outside[:20])
