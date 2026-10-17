"""
8-D2b 측정 스크립트 실패 처리 (Codex 검수 보완 2026-10-18). 실제 엔진·데이터는 쓰지 않는다.

  bench_warm_builds.py  background warm 예외 → 결과 저장 없이 종료 코드 1, 캐시 미완성 → 종료 코드 1
  bench_uvicorn.py      가짜 서버(bench_fixtures/fake_app.py)로: 정상 → valid, warm failed·HTTP 503·첫 키 대기 초과·
                        엔진 광고 불일치·서버 종료 → valid=false + 사유 + 종료 코드 1, 오류 요청은 지연 통계에서 뺀다

BENCH_SCRIPT_DIR 로 다른 경로의 스크립트(예: 보완 전 사본)를 같은 테스트로 돌릴 수 있다.
"""
import importlib.util
import json
import os
import socket
import subprocess
import sys

import pytest

from helpers import ROOT

SCRIPT_DIR = os.environ.get("BENCH_SCRIPT_DIR") or os.path.join(ROOT, "scripts")
FIXTURES = os.path.join(ROOT, "tests", "bench_fixtures")


# ── bench_warm_builds.py ─────────────────────────────────
class _FakeCacheBase:
    def __init__(self, rt):
        self.rt = rt

    @staticmethod
    def anchor_key(biz):
        return (biz,)

    def competition(self, biz, radius_m=None):
        return None

    def location(self, biz):
        return None

    def stats(self):
        return {"competition_entries": 0, "location_entries": 0}


class FailingWarmCache(_FakeCacheBase):
    def warm(self, biz_codes=None, radii=None):
        raise RuntimeError("warm 실패 (테스트)")


class EmptyWarmCache(_FakeCacheBase):
    def warm(self, biz_codes=None, radii=None):
        return None                                              # 아무것도 계산하지 않음 = 캐시 미완성


def _run_warm_builds(monkeypatch, tmp_path, cache_cls):
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import ref_impl
    import scoring_engine.runtime as runtime
    monkeypatch.setattr(ref_impl, "load_cache_class", lambda rev: cache_cls)
    monkeypatch.setattr(runtime, "load_runtime", lambda *a, **k: object())
    spec = importlib.util.spec_from_file_location("bench_warm_builds_under_test", os.path.join(SCRIPT_DIR, "bench_warm_builds.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    out = tmp_path / "out.json"
    monkeypatch.setattr(sys, "argv", ["bench_warm_builds", "--a", "A", "--b", "B", "--pairs", "1", "--limit", "2",
                                      "--out", str(out)])
    try:
        rc = mod.main()
    except SystemExit as e:
        rc = e.code
    except Exception:                                            # noqa: BLE001 — 예외로 끝나도 "성공 아님"
        rc = "exception"
    return rc, out


@pytest.mark.parametrize("cache_cls", [FailingWarmCache, EmptyWarmCache], ids=["warm-thread-exception", "cache-incomplete"])
def test_warm_builds_failure_is_not_saved_and_exits_nonzero(monkeypatch, tmp_path, cache_cls):
    rc, out = _run_warm_builds(monkeypatch, tmp_path, cache_cls)
    assert rc not in (0, None), "실패한 측정이 종료 코드 0 으로 끝났다"
    assert not out.exists(), "실패한 측정 결과를 정상 결과 파일로 저장했다"


# ── bench_uvicorn.py ─────────────────────────────────────
def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _run_uvicorn(tmp_path, mode):
    out = tmp_path / f"uv_{mode}.json"
    env = dict(os.environ, FAKE_BENCH_MODE=mode, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    try:
        proc = subprocess.run([sys.executable, os.path.join(FIXTURES, "run_uvicorn_bench.py"),
                               os.path.join(SCRIPT_DIR, "bench_uvicorn.py"), str(out), str(_free_port())],
                              env=env, capture_output=True, timeout=90)
    finally:
        _kill_fake_server(out)                                   # 측정 스크립트가 멈춰 시간 초과돼도 서버를 남기지 않는다
    data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return proc.returncode, data, proc.stderr.decode("utf-8", "replace")


def _kill_fake_server(out):
    pid_file = out.parent / (out.name + ".pid")
    if not pid_file.exists():
        return
    pid = int(pid_file.read_text(encoding="utf-8"))
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def test_uvicorn_normal_run_is_valid(tmp_path):
    rc, data, err = _run_uvicorn(tmp_path, "ok")
    assert rc == 0, err[-1500:]
    assert data["valid"] is True and data["invalid_reasons"] == []
    assert data["hit"]["n"] > 0 and data["errors"] == []
    assert data["engine_advertised"]["version"] == "mvp-0.4"
    assert data["hit_idle_after_warm"]["n"] == 30
    assert all(x["status"] == 200 for x in data["raw"]["idle"])


@pytest.mark.parametrize("mode, reason", [
    ("warm_failed", "warm_failed"),
    ("http503", "http_errors"),
    ("stuck", "timeout_first_key"),
    ("engine_mismatch", "engine_mismatch"),
    ("exit", "server_exited"),
])
def test_uvicorn_invalid_runs_are_marked(tmp_path, mode, reason):
    rc, data, err = _run_uvicorn(tmp_path, mode)
    assert rc == 1, f"무효 측정이 종료 코드 {rc} 로 끝났다\n{err[-1500:]}"
    assert data is not None and data["valid"] is False
    assert any(r.startswith(reason) for r in data["invalid_reasons"]), data["invalid_reasons"]
    if mode == "exit":                                           # 상태 전이로 고정한 경로: 측정 요청은 모두 정상, warm 대기 중 종료
        assert data["invalid_reasons"] == [data["invalid_reasons"][0]] and data["errors"] == []
        assert data["hit"]["n"] == 5 and all(c["status"] == 200 for c in data["cold"])
    if mode == "http503":
        assert data["hit"] == {"n": 0}                           # 오류 응답은 지연 통계에 넣지 않는다
        assert data["errors"] and all(e["status"] == 503 for e in data["errors"])
