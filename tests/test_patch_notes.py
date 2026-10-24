"""패치노트 기준 파일 검사(scripts/patch_notes.py, D-031) — 실제 파일 통과 + 규칙 위반을 잡는지."""
import copy
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("patch_notes_script", os.path.join(ROOT, "scripts", "patch_notes.py"))
pn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pn)


def _ok():
    return {
        "renumbered_until": "v0.0.1",
        "releases": [
            {"version": "v0.0.2", "date": "2026-10-11", "title": "둘", "changes": [{"type": "fixed", "text": "고쳤습니다."}],
             "commits": ["bbbbbbb"]},
            {"version": "v0.0.1", "date_from": "2026-10-05", "date": "2026-10-08", "title": "하나",
             "changes": [{"type": "added", "text": "추가했습니다."}], "commits": ["aaaaaaa"]},
        ],
        "deployments": [
            {"id": "d1", "date": "2026-10-08", "kind": "production", "result": "done", "app_version": "v0.0.1",
             "source_commit": "aaaaaaa", "note": "첫 배포"},
            {"id": "d2", "date": "2026-10-12", "kind": "verification", "result": "issue-found", "app_version": "v0.0.2",
             "source_commit": "bbbbbbb", "note": "검증"},
        ],
    }


def _errs(mutate):
    data = _ok()
    mutate(data)
    return pn.check_format(data)


def test_real_file_passes_format():
    assert pn.check_format(pn.load()) == []


def test_sample_passes():
    assert pn.check_format(_ok()) == []


def test_duplicate_version_and_order():
    def dup(d):
        d["releases"][1]["version"] = "v0.0.2"
    errs = _errs(dup)
    assert any("version 중복" in e for e in errs)
    assert any("최신순" in e for e in errs)


def test_date_format_and_range():
    assert any("date 형식" in e for e in _errs(lambda d: d["releases"][0].update(date="2026-10-1")))
    assert any("date_from" in e for e in _errs(lambda d: d["releases"][1].update(date_from="2026-10-09")))
    assert any("배포" not in e and "더 최신" in e for e in _errs(lambda d: d["releases"][1].update(date="2026-10-20")))


def test_required_fields_and_change_rules():
    assert any("필수 필드 title" in e for e in _errs(lambda d: d["releases"][0].pop("title")))
    assert any("changes 는" in e for e in _errs(lambda d: d["releases"][0].update(changes=[])))
    four = [{"type": "added", "text": "x"}] * 4
    assert any("changes 는" in e for e in _errs(lambda d: d["releases"][0].update(changes=four)))
    assert any("change type" in e for e in _errs(lambda d: d["releases"][0]["changes"][0].update(type="new")))


def test_commit_in_two_versions():
    assert any("에도 있다" in e for e in _errs(lambda d: d["releases"][0]["commits"].append("aaaaaaa")))


def test_deployment_rules():
    assert any("id 중복" in e for e in _errs(lambda d: d["deployments"][1].update(id="d1")))
    assert any("오름차순" in e for e in _errs(lambda d: d["deployments"][1].update(date="2026-10-01")))
    assert any("result" in e for e in _errs(lambda d: d["deployments"][1].update(result="done")))
    assert any("releases 에 없다" in e for e in _errs(lambda d: d["deployments"][0].update(app_version="v9.9.9")))
    assert any("속한다" in e for e in _errs(lambda d: d["deployments"][0].update(source_commit="bbbbbbb")))
    assert any("필수 필드 note" in e for e in _errs(lambda d: d["deployments"][0].update(note="")))


def test_check_format_does_not_mutate():
    data = _ok()
    before = copy.deepcopy(data)
    pn.check_format(data)
    assert data == before


# ── git 연결 검사(check_git): 실제 저장소 대신 가짜 이력으로 ──
FULL_A = "a" * 7 + "1" * 33
FULL_B = "b" * 7 + "2" * 33


def _fake_git(monkeypatch, rows):
    import subprocess
    monkeypatch.setattr(pn, "history", lambda: rows)

    def no_head(*args):   # HEAD 기준 파일 없음 → 기록 보존 비교는 건너뛴다
        raise subprocess.CalledProcessError(128, ["git", *args])
    monkeypatch.setattr(pn, "git", no_head)


def test_check_git_passes_normal_links(monkeypatch):
    _fake_git(monkeypatch, [(FULL_B, []), (FULL_A, [])])
    errs, pending = pn.check_git(_ok())
    assert errs == [] and pending == []


def test_same_commit_with_short_and_full_hash_in_two_versions_is_rejected(monkeypatch):
    # 같은 커밋을 v0.0.2 에는 전체 해시로, v0.0.1 에는 짧은 해시로 넣으면 한 커밋이 두 버전에 속한다
    data = _ok()
    data["releases"][0]["commits"].append(FULL_A)
    _fake_git(monkeypatch, [(FULL_B, []), (FULL_A, [])])
    errs, _ = pn.check_git(data)
    assert any("aaaaaaa" in e and "두 버전" in e for e in errs), errs
    # 형식 검사(git 없이)도 길이만 다른 같은 해시를 잡는다
    assert any("에도 있다" in e for e in pn.check_format(data))


def test_same_commit_twice_in_one_version_with_different_lengths_is_rejected(monkeypatch):
    data = _ok()
    data["releases"][1]["commits"].append(FULL_A[:10])
    _fake_git(monkeypatch, [(FULL_B, []), (FULL_A, [])])
    errs, _ = pn.check_git(data)
    assert any("aaaaaaa" in e and "두 번" in e for e in errs), errs


def test_trailer_only_commit_is_pending_not_error(monkeypatch):
    full_c = "c" * 40
    _fake_git(monkeypatch, [(full_c, ["v0.0.2"]), (FULL_B, []), (FULL_A, [])])
    errs, pending = pn.check_git(_ok())
    assert errs == [] and pending == ["ccccccc → v0.0.2"]


def test_sync_write_moves_trailer_commit_once(monkeypatch, tmp_path):
    import json as _json
    full_c = "c" * 40
    data = _ok()
    path = tmp_path / "patchNotes.json"
    path.write_text(_json.dumps(data, ensure_ascii=False), encoding="utf-8")
    _fake_git(monkeypatch, [(full_c, ["v0.0.2"]), (FULL_B, []), (FULL_A, [])])
    monkeypatch.setattr(pn, "PATH", str(path))
    assert pn.main(["sync", "--write"]) == 0
    written = _json.loads(path.read_text(encoding="utf-8"))
    assert written["releases"][0]["commits"] == ["bbbbbbb", "ccccccc"]
    assert pn.main(["sync", "--write"]) == 0            # 두 번째는 옮길 것 없음
    assert _json.loads(path.read_text(encoding="utf-8")) == written
