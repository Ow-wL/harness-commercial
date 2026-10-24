"""
엔진 v0.5 사본 무결성 — 팀 전달 v0.5 엔진 + 분석 반경 최소 diff 만 허용한다 (D-028, D-006).

- sources/team_v0.5 (팀 전달 원본 사본)이 매니페스트(tests/manifests/source_team_v0.5.sha256.json)와 같다
- scoring_engine/v0_5/ 파일 해시 = tests/manifests/engine_v0_5.sha256.json
- 사본 13개 파일 = 팀 엔진 폴더에서 웹 실행에 필요한 것(엔진 7 + 면적 배분 2 + 팀 단위 테스트 4). 분석·ETL 스크립트는 넣지 않는다
- config.py·scoring.py 외 파일은 팀 원본과 바이트 동일
- 그 두 파일의 바뀐 줄은 모두 분석 반경 선택(웹 v0.4 와 같은 방식)에 관한 것이다 (아래 허용 규칙)
- 면적 배분 경계 data/geo/SGIS_행정동경계_2025_2Q_인천.geojson 은 팀 07_가공데이터/경계_인천_행정동.geojson 과 바이트 동일
이 테스트는 파일만 읽으므로 기본(v0.3) 프로세스에서 돈다.
"""
import difflib
import hashlib
import json
import os

from helpers import ROOT

TEAM = os.path.join(ROOT, "sources", "team_v0.5", "04_엔진코드", "engine")
V05 = os.path.join(ROOT, "scoring_engine", "v0_5")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "engine_v0_5.sha256.json")
SOURCE_MANIFEST = os.path.join(ROOT, "tests", "manifests", "source_team_v0.5.sha256.json")
FILES = {"access.py", "config.py", "demo.py", "etl_location.py", "etl_rent.py", "radius_demand.py", "scoring.py",
         "etl_boundary.py", "etl_sgis.py", "test_access.py", "test_weights.py", "test_agglomeration.py", "test_v05.py"}
CHANGED = {"config.py", "scoring.py"}
ALLOWED_MARKERS = ("radius_m", "RADIUS_OPTIONS_M")


def _read(d, f):
    with open(os.path.join(d, f), "rb") as fh:
        return fh.read()


def _sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def test_team_source_copy_matches_manifest():
    import sys
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import source_v0_5
    errs = source_v0_5.verify()
    assert not errs, "sources/team_v0.5 가 전달본과 다르다 (수정 금지):\n" + "\n".join(errs)


def test_v0_5_files_match_manifest():
    with open(MANIFEST, encoding="utf-8") as f:
        want = json.load(f)["files"]
    got = {f: _sha(os.path.join(V05, f)) for f in sorted(os.listdir(V05)) if f.endswith(".py")}
    assert got == want and set(got) == FILES


def test_unchanged_modules_are_byte_identical_to_team():
    for f in sorted(FILES - CHANGED):
        assert _read(V05, f) == _read(TEAM, f), f


def _as_team(line: str) -> str:
    """v0.5 웹 사본 줄을 팀 표기로 되돌린다: 반경 인자 제거, 반경 변수 → C.RADIUS_M, 고객성 인구 기준 문구."""
    line = line.replace('f"반경 {C.RADIUS_M if radius_m is None else radius_m}m 배분"', '"반경 500m 배분"')
    for extra in (", radius_m=None", ", radius_m)"):
        line = line.replace(extra, ")" if extra.endswith(")") else "")
    return line.replace("radius_m", "C.RADIUS_M").strip()


def test_changed_lines_are_only_radius():
    """추가 줄은 반경 표식을 담거나 주석이고, 지운 줄은 모두 어떤 추가 줄을 팀 표기로 되돌린 것과 같다(로직 삭제 없음)."""
    bad = []
    for f in sorted(CHANGED):
        a = _read(TEAM, f).decode("utf-8").splitlines()
        b = _read(V05, f).decode("utf-8").splitlines()
        lines = [x for x in difflib.unified_diff(a, b, lineterm="", n=0) if not x.startswith(("---", "+++", "@@"))]
        added = [x[1:] for x in lines if x.startswith("+")]
        restored = {_as_team(x) for x in added}
        for x in lines:
            body = x[1:].strip()
            if x.startswith("+"):
                ok = not body or body.startswith("#") or any(m in body for m in ALLOWED_MARKERS)
            else:
                ok = body in restored
            if not ok:
                bad.append(f"{f}: {x}")
    assert not bad, "허용 diff 밖 변경:\n" + "\n".join(bad)


def test_engine_version_string_unchanged():
    """반경 선택을 얹어도 엔진 버전 문자열은 팀 v0.5 그대로(mvp-0.5) — 500m 결과가 팀 결과와 같아야 하므로."""
    src = _read(V05, "scoring.py").decode("utf-8")
    assert src.count('"엔진버전": "mvp-0.5"') == 1


def test_population_boundary_is_team_file():
    with open(SOURCE_MANIFEST, encoding="utf-8") as f:
        entry = json.load(f)["bundle"]["07_가공데이터/경계_인천_행정동.geojson"]
    path = os.path.join(ROOT, entry["stored"])
    assert entry["stored"] == "data/geo/SGIS_행정동경계_2025_2Q_인천.geojson"
    assert _sha(path) == entry["sha256"] and os.path.getsize(path) == entry["bytes"]


def test_puzzle_records_not_in_repository():
    """지오비전 퍼즐 원자료·상권별 수치는 저장소·사이트·API·공개 fixture 에 두지 않는다(해시만 매니페스트에)."""
    with open(SOURCE_MANIFEST, encoding="utf-8") as f:
        puzzle = json.load(f)["puzzle"]
    assert puzzle and all(v["stored"] is None for v in puzzle.values())
    names = {os.path.basename(p) for p in puzzle}
    hits = []
    for base in ("sources", "tests", "data", "frontend/src", "frontend/public", "backend", "scoring_engine"):
        for dirpath, dirnames, filenames in os.walk(os.path.join(ROOT, base)):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", "__pycache__")]
            hits += [os.path.join(dirpath, fn) for fn in filenames if fn in names]
    assert not hits, hits


def test_golden_v0_5_500_is_team_result():
    """tests/golden/v0.5 (500m) = 팀 전달 05_분석결과 바이트 사본 — 덮어쓰지 않는다. r300·r1000 은 scripts/golden_v0_5.py 가 만든다."""
    with open(SOURCE_MANIFEST, encoding="utf-8") as f:
        bundle = json.load(f)["bundle"]
    gdir = os.path.join(ROOT, "tests", "golden", "v0.5")
    jsons = sorted(fn for fn in os.listdir(os.path.join(gdir, "json")) if fn.endswith(".json"))
    assert len(jsons) == 29
    for fn in jsons:
        assert _sha(os.path.join(gdir, "json", fn)) == bundle[f"05_분석결과/업종별_상세JSON/{fn}"]["sha256"], fn
    assert _sha(os.path.join(gdir, "부평역_업종별_적합도.csv")) == bundle["05_분석결과/부평역_업종별_적합도.csv"]["sha256"]
    for r in (300, 1000):
        assert sorted(os.listdir(os.path.join(gdir, f"r{r}", "json"))) == jsons
