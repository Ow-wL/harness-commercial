"""
전체 검증 — 이 명령이 성공해야 작업 완료다 (CLAUDE.md "Definition of Done").

  python scripts/check.py           전체
  python scripts/check.py --fast    golden regression(약 1분) 제외 — 작업 중 빠른 확인용. 완료 판정에는 쓰지 않는다

단계를 추가할 때는 STEPS 에 한 줄을 넣는다. 대상 폴더가 아직 없으면 SKIP(사유 표시)이며 실패로 숨기지 않는다.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
ORIGINAL_ENGINE = os.path.join(ROOT, "sources", "team_v0.3", "04_엔진코드", "engine")

ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1",
           PYTHONDONTWRITEBYTECODE="1")   # 원본 폴더에 __pycache__ 를 만들지 않는다


def step(name, cmd, cwd=ROOT, when=True, why_skip=""):
    return {"name": name, "cmd": cmd, "cwd": cwd, "when": when, "why_skip": why_skip}


def steps(fast: bool):
    has_src = os.path.isdir(ORIGINAL_ENGINE)
    has_backend = os.path.isfile(os.path.join(ROOT, "backend", "pyproject.toml")) or \
        os.path.isdir(os.path.join(ROOT, "backend", "app"))
    has_frontend = os.path.isfile(os.path.join(ROOT, "frontend", "package.json"))
    pytest_args = [PY, "-m", "pytest", "-q"] + (["-m", "not golden"] if fast else [])
    return [
        step("python imports", [PY, "-c", "import scoring_engine, scoring_engine.service; print('ok', scoring_engine.ENGINE_VERSION)"]),
        step("source integrity (sources/team_v0.3 unchanged)", [PY, "scripts/manifest.py", "verify"],
             when=has_src, why_skip="sources/team_v0.3 없음"),
        step("original v0.3 tests: test_weights.py", [PY, "test_weights.py"], cwd=ORIGINAL_ENGINE,
             when=has_src, why_skip="sources/team_v0.3 없음"),
        step("original v0.3 tests: test_access.py", [PY, "test_access.py"], cwd=ORIGINAL_ENGINE,
             when=has_src, why_skip="sources/team_v0.3 없음"),
        step("pytest: imports, integrity, canonical engine, data schema" + ("" if fast else ", golden regression"),
             pytest_args),
        # ── 향후 단계 (폴더가 생기면 자동 실행) ──
        step("backend tests", [PY, "-m", "pytest", "-q", "backend"], when=has_backend,
             why_skip="backend 미구현"),
        step("frontend check", ["npm", "--prefix", "frontend", "run", "check"], when=has_frontend,
             why_skip="frontend 미구현"),
    ]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):   # Windows 콘솔(cp949)에서도 요약 출력이 깨지지 않게
        stream.reconfigure(encoding="utf-8", errors="replace")
    fast = "--fast" in sys.argv
    results = []
    for s in steps(fast):
        if not s["when"]:
            results.append((s["name"], "SKIP", s["why_skip"], 0.0))
            continue
        print(f"\n━━ {s['name']}", flush=True)
        t = time.perf_counter()
        rc = subprocess.call(s["cmd"], cwd=s["cwd"], env=ENV, shell=(os.name == "nt" and s["cmd"][0] == "npm"))
        results.append((s["name"], "PASS" if rc == 0 else "FAIL", f"exit {rc}" if rc else "",
                        time.perf_counter() - t))
    print("\n" + "═" * 72)
    for name, status, note, dt in results:
        print(f"  {status:4s}  {name}  {note}  ({dt:.1f}s)")
    failed = [r for r in results if r[1] == "FAIL"]
    print("═" * 72)
    print("CHECK", "FAILED" if failed else ("PASSED (fast — golden 제외, 완료 판정 아님)" if fast else "PASSED"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
