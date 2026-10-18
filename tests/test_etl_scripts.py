"""
scripts/etl — 원본 ETL 실행 사본·진입 순서·버전 생성/검증/차이 보고서 (묶음 C, docs/DATA_VERSIONING.md).

  사본     머리 주석(HEADER_END 까지)을 떼면 원본(sources/team_v0.3/04_엔진코드/engine/*.py)과 바이트 동일 — 원본 매니페스트 해시로 검사
  예약명   scripts/etl 에 D-004 예약 모듈 이름 없음. _bootstrap 뒤 평면 import config 는 엔진 디렉터리에서 온다 (별도 프로세스)
  재현     원본 08_원본_인허가 로 etl_stability·etl_stability_food 사본을 돌리면 data/runtime 의 안정성 패널 2개와 바이트 동일 (읽기만)
  build    승계만으로 만든 버전: 파일 바이트 동일·매니페스트 해시·덮어쓰기 거부. 상가·인구·SGIS·생활이동 ETL 경로는 원본이 없어 여기서 돌리지 않는다
  validate 승계 버전은 7단계 통과. 깨진 입력(컬럼 누락·158 불일치·인코딩 오류·매니페스트 없음·해시 불일치)은 해당 단계에서 거부
  diff     스냅샷 비교: 같은 결과 = pass, 미산출·NaN·오류 증가 = fail, 보고서 렌더
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys

import pandas as pd
import pytest

from helpers import ROOT, RUNTIME_DIR, SOURCE_DIR, manifest_files

ETL_DIR = os.path.join(ROOT, "scripts", "etl")
if ETL_DIR not in sys.path:
    sys.path.insert(0, ETL_DIR)
import _bootstrap  # noqa: E402,F401
import _common as CM  # noqa: E402
import build_version as BV  # noqa: E402
import diff_report as DR  # noqa: E402
import validate_version as VV  # noqa: E402

COPIES = ["etl_shops.py", "etl_pop.py", "etl_sgis.py", "etl_move.py", "etl_stability.py", "etl_stability_food.py", "prep.py"]
HEADER_END = "# ── HEADER_END".encode("utf-8")      # 머리 주석의 마지막 줄 (본문 설명에도 같은 낱말이 있어 줄 머리로 찾는다)
PERMITS = os.path.join(SOURCE_DIR, "08_원본_인허가")
ENV = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1")


def _strip_header(raw: bytes) -> bytes:
    i = raw.index(HEADER_END)
    return raw[raw.index(b"\n", i) + 1:]


# ── 사본 ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("name", COPIES)
def test_copy_is_source_plus_header_only(name):
    raw = open(os.path.join(ETL_DIR, name), "rb").read()
    want = manifest_files()[f"04_엔진코드/engine/{name}"]["sha256"]
    assert hashlib.sha256(_strip_header(raw)).hexdigest() == want
    head = raw[:raw.index(HEADER_END)].decode("utf-8")
    assert want in head and f"engine/{name}" in head        # 머리 주석이 원본 경로·해시를 적는다
    assert all(line.startswith("#") for line in head.splitlines() if line.strip())


def test_no_reserved_module_names_in_scripts_etl():
    names = {f[:-3] for f in os.listdir(ETL_DIR) if f.endswith(".py")}
    assert not names & set(_bootstrap.RESERVED_MODULES)
    assert set(COPIES) <= {f"{n}.py" for n in names}


def test_bootstrap_resolves_config_to_engine_in_fresh_process():
    code = ("import sys, os; sys.path.insert(0, sys.argv[1]); import _bootstrap, config, etl_pop, etl_stability_food;"
            "print(os.path.dirname(os.path.abspath(config.__file__))); print(etl_pop.C is config)")
    r = subprocess.run([sys.executable, "-c", code, ETL_DIR], capture_output=True, text=True, env=ENV, cwd=ROOT,
                       encoding="utf-8")
    assert r.returncode == 0, r.stderr
    lines = r.stdout.strip().splitlines()
    assert os.path.normcase(lines[-2]) == os.path.normcase(_bootstrap.ENGINE_DIR) and lines[-1] == "True"


def test_run_etl_rejects_unknown_name():
    r = subprocess.run([sys.executable, os.path.join(ETL_DIR, "run_etl.py"), "nope"], capture_output=True, text=True,
                       env=ENV, cwd=ROOT, encoding="utf-8")
    assert r.returncode == 2 and "prep" in r.stdout


# ── 재현: 원본 인허가 → 안정성 패널 (원본은 읽기만) ────────────────────
def test_stability_etl_copies_reproduce_runtime_panels(tmp_path):
    if not os.path.isdir(PERMITS):
        pytest.skip("sources/team_v0.3/08_원본_인허가 없음 (원본 미배포 환경)")
    import etl_stability as ES
    import etl_stability_food as EF
    pc = ES.build(ES.load(os.path.join(PERMITS, "문화_인터넷컴퓨터게임시설제공업_전국.csv")))
    CM.write_csv(pc, str(tmp_path / "패널_안정성.csv"))
    food, _ = EF.build_food(os.path.join(PERMITS, "식품_일반음식점_인천.csv"), os.path.join(PERMITS, "식품_휴게음식점_인천.csv"))
    CM.write_csv(food, str(tmp_path / "패널_안정성_음식.csv"))
    for name in ("패널_안정성.csv", "패널_안정성_음식.csv"):
        assert open(tmp_path / name, "rb").read() == open(os.path.join(RUNTIME_DIR, name), "rb").read(), name


# ── build_version ────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def carried(tmp_path_factory):
    base = tmp_path_factory.mktemp("build")
    # 승계 출처 표기 세 가지를 모두 쓴다: 버전 id "2026-06"(= data/runtime), 절대 경로, 저장소 루트 기준 상대 경로
    sources = ["2026-06", RUNTIME_DIR, "data/runtime"]
    spec = {"id": "2026-06t", "note": "test", "roles": {r: {"carry_from": sources[i % 3]} for i, r in enumerate(CM.ROLES)}}
    spec_path = base / "spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    out = BV.build(str(spec_path), str(base / "2026-06t"))
    return out, str(spec_path)


def test_build_carry_all_is_byte_identical_with_manifest(carried):
    out, _ = carried
    m = CM.load_manifest(out)
    assert m["schema"] == 1 and m["id"] == "2026-06t" and set(m["roles"]) == set(CM.ROLES)
    for role, fn in CM.ROLE_FILES.items():
        rec = m["roles"][role]
        assert rec["file"] == fn and rec["carried_from"] == "2026-06" and rec["as_of"] == CM.LEGACY_AS_OF[role]
        assert open(os.path.join(out, fn), "rb").read() == open(os.path.join(RUNTIME_DIR, fn), "rb").read()
        assert rec["sha256"] == CM.sha256_file(os.path.join(RUNTIME_DIR, fn)) and rec["bytes"] == os.path.getsize(os.path.join(RUNTIME_DIR, fn))
    v = CM.resolve_data_version(out)
    assert v.id == "2026-06t" and v.as_of == CM.LEGACY_AS_OF


def test_build_refuses_existing_version(carried):
    out, spec_path = carried
    with pytest.raises(FileExistsError):
        BV.build(spec_path, out)
    assert BV.main([spec_path, "--out", out]) == 1


def test_build_rejects_spec_with_missing_role_and_cleans_up(tmp_path):
    spec = {"id": "2026-07t", "roles": {r: {"carry_from": RUNTIME_DIR} for r in CM.ROLES if r != "rent"}}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec), encoding="utf-8")
    out = tmp_path / "out"
    with pytest.raises(BV.SpecError, match="rent"):
        BV.build(str(p), str(out))
    assert not out.exists()


def test_build_rejects_missing_input_file(tmp_path):
    spec = {"id": "2026-07t", "roles": {**{r: {"carry_from": RUNTIME_DIR} for r in CM.ROLES},
                                        "schools": {"inputs": {"file": "없는파일.csv"}, "as_of": "2026-09"}}}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(BV.SpecError, match="없는파일"):
        BV.build(str(p), str(tmp_path / "out"))


def test_build_copies_and_checks_rent_file(tmp_path):
    """stations/schools/rent 는 원본 그대로 복사. rent 는 분기 열 개수(엔진 상수)를 바로 확인한다."""
    bad = tmp_path / "rent.csv"
    bad.write_bytes(b"a\nb\nc\n1,2,3\n")
    spec = {"id": "2026-07t", "roles": {**{r: {"carry_from": RUNTIME_DIR} for r in CM.ROLES},
                                        "rent": {"inputs": {"file": str(bad)}, "as_of": "2026Q3"}}}
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match="열 개수"):
        BV.build(str(p), str(tmp_path / "out"))
    assert not (tmp_path / "out").exists()


# ── validate_version ─────────────────────────────────────────────────
def _statuses(rep):
    return [(c["name"].split()[0], c["status"]) for c in rep["checks"]]


def test_validate_carried_version_passes_all_stages(carried):
    out, _ = carried
    rep = VV.validate(out, RUNTIME_DIR)
    assert rep["result"] == "pass", rep
    assert [s for _, s in _statuses(rep)] == ["pass"] * 7
    assert "0.98456" in rep["checks"][5]["detail"]


def test_validate_write_records_in_manifest(carried):
    out, _ = carried
    assert VV.main([out, "--baseline", RUNTIME_DIR, "--write"]) == 0
    m = CM.load_manifest(out)
    assert m["validation"]["result"] == "pass" and m["validation"]["version"] == "2026-06t"


def _broken_copy(src: str, dst: str) -> str:
    shutil.copytree(src, dst)
    return dst


def _rehash(d: str, role: str) -> None:
    m = CM.load_manifest(d)
    m["roles"][role].update(CM.file_info(os.path.join(d, m["roles"][role]["file"])))
    CM.save_manifest(d, m)


def test_validate_rejects_missing_manifest():
    rep = VV.validate(RUNTIME_DIR)
    assert rep["result"] == "fail" and _statuses(rep)[0] == ("V1", "fail") and "manifest.json" in rep["checks"][0]["detail"]
    assert all(s == "skipped" for _, s in _statuses(rep)[1:])


def test_validate_rejects_hash_mismatch(carried, tmp_path):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    with open(os.path.join(d, "패널_안정성.csv"), "ab") as f:
        f.write(b"\n")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[0] == ("V1", "fail") and "stability_pc" in rep["checks"][0]["detail"]


def test_validate_rejects_wrong_encoding(carried, tmp_path):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    p = os.path.join(d, "학교_전국.csv")
    text = open(p, encoding="cp949").read()
    open(p, "w", encoding="utf-8", newline="").write(text)      # cp949 로 선언된 파일을 UTF-8 로 저장
    _rehash(d, "schools")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[:2] == [("V1", "pass"), ("V2", "fail")] and "schools" in rep["checks"][1]["detail"]


def test_validate_rejects_missing_column(carried, tmp_path):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    p = os.path.join(d, "패널_안정성.csv")
    df = pd.read_csv(p, encoding="utf-8-sig").drop(columns=["최근3년_폐업률"])
    CM.write_csv(df, p)
    _rehash(d, "stability_pc")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[2] == ("V3", "fail") and "최근3년_폐업률" in rep["checks"][2]["detail"]


def test_validate_rejects_157_dongs(carried, tmp_path):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    p = os.path.join(d, "패널_통합.csv")
    df = pd.read_csv(p, encoding="utf-8-sig")
    CM.write_csv(df.iloc[:-1], p)
    _rehash(d, "panel")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[3] == ("V4", "fail")
    assert "157" in rep["checks"][3]["detail"] and "shops" in rep["checks"][3]["detail"]


def test_validate_rejects_market_code_mismatch(carried, tmp_path):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    p = os.path.join(d, "패널_시장성_202608.csv")
    df = pd.read_csv(p, encoding="utf-8-sig", dtype={"시군구코드": str})
    df.loc[0, "시군구코드"] = "28999"
    CM.write_csv(df, p)
    _rehash(d, "market_panel")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[3] == ("V4", "fail") and "시군구코드" in rep["checks"][3]["detail"]


def test_validate_rejects_change_over_limit(carried, tmp_path, monkeypatch):
    d = _broken_copy(carried[0], str(tmp_path / "v"))
    monkeypatch.setitem(VV.LIMITS, "shops.rows", 0.0)      # 한계 0 → 같은 행 수만 통과. 행 하나를 빼면 실패
    p = os.path.join(d, "인천_상가_정제.csv")
    df = pd.read_csv(p, encoding="utf-8-sig", low_memory=False)
    CM.write_csv(df.iloc[:-1], p)
    _rehash(d, "shops")
    rep = VV.validate(d, RUNTIME_DIR)
    assert _statuses(rep)[6] == ("V7", "fail") and "shops.rows" in rep["checks"][6]["detail"]


# ── diff_report ──────────────────────────────────────────────────────
def test_diff_report_snapshot_and_compare(bupyeong_results, tmp_path):
    from scoring_engine import config as C
    a = DR.snapshot_of(bupyeong_results, "2026-06", C.RADIUS_M)
    assert set(a["businesses"]) == set(C.CODE_NAME) and a["engine"] == "mvp-0.3" and a["errors"] == {}
    pc = a["businesses"]["R10406"]
    assert pc["종합"] == 64.1 and pc["raw"]["competition"]["동종점포수"] == 12
    same = DR.compare(a, json.loads(json.dumps(a)))
    assert same["verdict"] == "pass" and all(r["종합_Δ"] == 0 for r in same["rows"])

    b = json.loads(json.dumps(a))
    b["version"] = "2026-09"
    b["businesses"]["R10406"]["종합"] = 70.0
    b["businesses"]["I21006"]["종합"] = None            # 미산출 증가
    b["errors"]["S20701"] = "KeyError: x"
    rep = DR.compare(a, b)
    assert rep["verdict"] == "fail" and len(rep["problems"]) == 2 and rep["counts"]["none"] == [0, 1]
    row = next(r for r in rep["rows"] if r["code"] == "R10406")
    assert row["종합_Δ"] == pytest.approx(5.9) and row["순위_B"] <= row["순위_A"]
    md = DR.render_md(rep)
    assert "FAIL" in md and "| PC방 |" in md and "2026-06 → 2026-09" in md

    # 스냅샷 쓰기: 매니페스트가 있으면 snapshot 항목을 채운다
    d = tmp_path / "v"
    d.mkdir()
    CM.save_manifest(str(d), {"schema": 1, "id": "2026-09", "roles": {r: {"file": f, "as_of": "x"} for r, f in CM.ROLE_FILES.items()}})
    path = DR.write_snapshot(str(d), b)
    m = CM.load_manifest(str(d))
    assert os.path.isfile(path) and m["snapshot"]["sha256"] == CM.sha256_file(path) and m["snapshot"]["radius_m"] == C.RADIUS_M


def test_diff_report_rejects_unsupported_radius():
    from scoring_engine import RADIUS_OPTIONS_M
    assert DR.main([RUNTIME_DIR, RUNTIME_DIR, "--radius", str(max(RADIUS_OPTIONS_M) + 1)]) == 2
