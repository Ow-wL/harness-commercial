"""
데이터 버전 로더 (묶음 C, docs/DATA_VERSIONING.md §4).

  1) 매니페스트 없는 경로(data/runtime)는 지금과 같다 — 버전 2026-06, ROLE_FILES 기본 파일명, LEGACY_AS_OF (골든은 test_golden_regression)
  2) DATA_VERSION 환경변수: 디렉터리 경로 / 버전 id(data/versions/<id>) / 없는 값
  3) 매니페스트가 있는 임시 디렉터리: 역할 키로 파일을 찾는다 (파일명이 달라도) — 읽은 DataFrame 이 data/runtime 과 같다
  4) 매니페스트 최소 형식 검사 (schema, 역할 누락, 디렉터리 포함 파일명)
"""
import json
import os
import shutil

import pandas as pd
import pytest

from helpers import RUNTIME_DIR
from scoring_engine import runtime as R
from scoring_engine.nearby import SHOPS_AS_OF, NearbyStoreFinder


def _manifest(roles: dict, **extra) -> dict:
    return {"schema": 1, "id": "2026-09", "roles": {r: {"file": f, "as_of": "2026-09-30"} for r, f in roles.items()},
            **extra}


# ── 1) 매니페스트 없는 경로 ──────────────────────────────────────────
def test_role_files_cover_runtime_files_exactly():
    assert set(R.ROLE_FILES.values()) == set(R.RUNTIME_FILES)
    assert set(R.ROLES) == set(R.LEGACY_AS_OF) and len(R.ROLES) == 8


def test_default_resolution_is_runtime_dir_without_manifest(monkeypatch):
    monkeypatch.delenv(R.DATA_VERSION_ENV, raising=False)
    v = R.resolve_data_version()
    assert v.id == R.LEGACY_VERSION_ID == "2026-06" and v.manifest is None
    assert os.path.normcase(v.data_dir) == os.path.normcase(RUNTIME_DIR)
    assert v.files == R.ROLE_FILES and v.as_of == R.LEGACY_AS_OF
    for role in R.ROLES:
        assert os.path.isfile(v.path(role)), role
    assert v.health() == {"version": "2026-06", "as_of": R.LEGACY_AS_OF}


def test_explicit_dir_argument_wins_over_env(monkeypatch, tmp_path):
    monkeypatch.setenv(R.DATA_VERSION_ENV, str(tmp_path))
    assert os.path.normcase(R.resolve_data_version(RUNTIME_DIR).data_dir) == os.path.normcase(RUNTIME_DIR)


def test_loaded_runtime_carries_legacy_version(service):
    rt = service.rt
    assert rt.version is not None and rt.version.id == "2026-06" and rt.version.manifest is None
    assert rt.as_of("shops") == SHOPS_AS_OF == R.LEGACY_AS_OF["shops"] == "2026-06-30"
    assert NearbyStoreFinder(rt).as_of == "2026-06-30"


# ── 2) DATA_VERSION 환경변수 ────────────────────────────────────────
def test_env_directory_path(monkeypatch, tmp_path):
    d = tmp_path / "ver"
    d.mkdir()
    (d / "manifest.json").write_text(json.dumps(_manifest(R.ROLE_FILES), ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv(R.DATA_VERSION_ENV, str(d))
    v = R.resolve_data_version()
    assert v.id == "2026-09" and os.path.normcase(v.data_dir) == os.path.normcase(str(d)) and v.manifest is not None
    assert v.as_of == {r: "2026-09-30" for r in R.ROLES}


def test_env_version_id_under_versions_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "VERSIONS_DIR", str(tmp_path))
    d = tmp_path / "2026-09"
    d.mkdir()
    (d / "manifest.json").write_text(json.dumps(_manifest(R.ROLE_FILES), ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv(R.DATA_VERSION_ENV, "2026-09")
    assert os.path.normcase(R.resolve_data_version().data_dir) == os.path.normcase(str(d))


def test_env_unknown_version_is_error(monkeypatch, tmp_path):
    monkeypatch.setattr(R, "VERSIONS_DIR", str(tmp_path))
    monkeypatch.setenv(R.DATA_VERSION_ENV, "9999-99")
    with pytest.raises(FileNotFoundError):
        R.resolve_data_version()


def test_env_empty_means_runtime(monkeypatch):
    monkeypatch.setenv(R.DATA_VERSION_ENV, "")
    assert R.resolve_data_version().id == "2026-06"


# ── 3) 매니페스트가 있는 디렉터리 — 역할 키로 파일을 찾는다 ───────────
@pytest.fixture(scope="module")
def renamed_version(tmp_path_factory):
    """data/runtime 사본에 파일명을 바꾼 버전: 시장성 패널은 202609, 나머지도 역할 키 접두어를 붙인다."""
    d = tmp_path_factory.mktemp("renamed")
    names = {role: ("패널_시장성_202609.csv" if role == "market_panel" else f"{role}__{fn}")
             for role, fn in R.ROLE_FILES.items()}
    for role, fn in R.ROLE_FILES.items():
        shutil.copyfile(os.path.join(RUNTIME_DIR, fn), os.path.join(d, names[role]))
    m = _manifest(names)
    m["roles"]["shops"]["as_of"] = "2026-09-30"
    m["roles"]["market_panel"]["as_of"] = "2026-09"
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    return str(d), names


def test_manifest_roles_resolve_renamed_files(renamed_version):
    d, names = renamed_version
    v = R.resolve_data_version(d)
    assert v.id == "2026-09" and v.files == names and v.manifest is not None
    assert v.as_of["shops"] == "2026-09-30" and v.as_of["market_panel"] == "2026-09"
    assert os.path.basename(v.path("market_panel")) == "패널_시장성_202609.csv"


def test_load_runtime_follows_role_keys_and_equals_runtime(renamed_version, service):
    d, _ = renamed_version
    rt = R.load_runtime(d)
    base = service.rt
    for attr in ("shops", "panel", "market", "stability", "stations", "schools", "anchors", "centroids", "rent"):
        pd.testing.assert_frame_equal(getattr(rt, attr), getattr(base, attr))
    assert rt.version.id == "2026-09" and rt.as_of("shops") == "2026-09-30"
    assert NearbyStoreFinder(rt).as_of == "2026-09-30"
    assert rt.version.health()["as_of"]["market_panel"] == "2026-09"


def test_manifest_as_of_falls_back_to_legacy_when_missing(tmp_path):
    m = _manifest(R.ROLE_FILES)
    del m["roles"]["rent"]["as_of"]
    (tmp_path / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    assert R.resolve_data_version(str(tmp_path)).as_of["rent"] == R.LEGACY_AS_OF["rent"]


# ── 4) 매니페스트 최소 형식 ──────────────────────────────────────────
@pytest.mark.parametrize("mutate,msg", [
    (lambda m: m.update(schema=2), "schema"),
    (lambda m: m.update(id=""), "id"),
    (lambda m: m["roles"].pop("rent"), "rent"),
    (lambda m: m["roles"].update(extra={"file": "x.csv"}), "extra"),
    (lambda m: m["roles"]["shops"].update(file="sub/인천_상가_정제.csv"), "shops"),
    (lambda m: m["roles"]["panel"].pop("file"), "panel"),
], ids=["schema", "empty-id", "missing-role", "unknown-role", "file-with-dir", "role-without-file"])
def test_manifest_minimum_format_rejected(tmp_path, mutate, msg):
    m = _manifest(R.ROLE_FILES)
    mutate(m)
    (tmp_path / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ValueError, match=msg):
        R.resolve_data_version(str(tmp_path))
