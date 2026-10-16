"""
엔진 v0.4 사본 무결성 — v0.3 사본 + 분석 반경 최소 diff 만 허용한다 (D-024, D-006).

- scoring_engine/v0_4/ 파일 해시 = tests/manifests/engine_v0_4.sha256.json
- config.py·scoring.py·test_access.py 외 파일은 v0.3 사본과 바이트 동일
- 그 세 파일의 바뀐 줄은 모두 반경 선택·버전 문자열에 관한 것이다 (아래 허용 목록)
이 테스트는 파일만 읽으므로 기본(v0.3) 프로세스에서 돈다.
"""
import difflib
import hashlib
import json
import os

from helpers import ROOT

V03 = os.path.join(ROOT, "scoring_engine", "v0_3")
V04 = os.path.join(ROOT, "scoring_engine", "v0_4")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "engine_v0_4.sha256.json")
CHANGED = {"config.py", "scoring.py", "test_access.py"}   # test_access: 엔진버전 단언 한 줄

# 바뀐 줄(추가·삭제)이 하나라도 담아야 하는 표식 — 반경 인자·선택지·버전 문자열
ALLOWED_MARKERS = ("radius_m", "RADIUS_OPTIONS_M", "mvp-0.4", "mvp-0.3")


def _read(d, f):
    with open(os.path.join(d, f), "rb") as fh:
        return fh.read()


def _py_files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".py"))


def test_v0_4_files_match_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        want = json.load(f)["files"]
    got = {f: hashlib.sha256(_read(V04, f)).hexdigest() for f in _py_files(V04)}
    assert got == want


def test_v0_4_has_same_modules_as_v0_3():
    assert _py_files(V04) == _py_files(V03)


def test_unchanged_modules_are_byte_identical():
    for f in _py_files(V03):
        if f not in CHANGED:
            assert _read(V04, f) == _read(V03, f), f


def _as_v03(line: str) -> str:
    """v0.4 줄을 v0.3 표기로 되돌린다: 반경 인자 제거, 반경 변수 → C.RADIUS_M, 버전 문자열."""
    for extra in (", radius_m=None", ", radius_m)"):
        line = line.replace(extra, ")" if extra.endswith(")") else "")
    return line.replace("radius_m", "C.RADIUS_M").replace("mvp-0.4", "mvp-0.3").strip()


def test_changed_lines_are_only_radius_and_version():
    """추가 줄은 반경·버전 표식을 담고, 지운 줄은 모두 어떤 추가 줄을 v0.3 표기로 되돌린 것과 같다(로직 삭제 없음)."""
    bad = []
    for f in sorted(CHANGED):
        a = _read(V03, f).decode("utf-8").splitlines()
        b = _read(V04, f).decode("utf-8").splitlines()
        lines = [x for x in difflib.unified_diff(a, b, lineterm="", n=0) if not x.startswith(("---", "+++", "@@"))]
        added = [x[1:] for x in lines if x.startswith("+")]
        restored = {_as_v03(x) for x in added}
        for x in lines:
            body = x[1:].strip()
            if x.startswith("+"):
                ok = not body or body.startswith("#") or any(m in body for m in ALLOWED_MARKERS)
            else:
                ok = body in restored
            if not ok:
                bad.append(f"{f}: {x}")
    assert not bad, "허용 diff 밖 변경:\n" + "\n".join(bad)
