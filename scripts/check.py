"""
검증 (CLAUDE.md "검증 규칙"). 전체 check 는 배포 후보 소스가 확정됐을 때 1회 실행하는 완료 판정이다.

  python scripts/check.py                      전체 — 모든 단계(기존 검증을 줄이지 않는다)
  python scripts/check.py --fast               golden regression 제외 — 작업 중 확인용, 완료 판정 아님
  python scripts/check.py --only KEY[,KEY...]  고른 단계만 — 작업 중 영향 범위 확인용, 전체 check 통과가 아니다
  python scripts/check.py --list               단계 키 목록
  python scripts/check.py --jobs N             Python 테스트 단계(core·v0_4·v0_5·v0_5_1·backend)를 최대 N개 동시에 —
                                               검사 내용은 같고 실행 순서만 겹친다(11-6). 기본 1 = 순차(지금과 같다)

단계 키: imports · integrity · team-tests · core(엔진 v0.3·데이터·golden·스크립트) · v0_4 · v0_5 · v0_5_1 · backend ·
frontend · patch-notes · e2e(선택 단계 — 기본 전체 check 에 없고 --only e2e 로, D-035). 단계를 추가할 때는 steps() 에 한 줄(키 포함)을 넣는다. 대상 폴더가 아직 없으면 SKIP(사유 표시)이며
실패로 숨기지 않는다. 소요(2026-10 로그 기준): core·v0_4·v0_5·v0_5_1 pytest 가 각 약 3~6분으로 전체의 약 85%다.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
ORIGINAL_ENGINE = os.path.join(ROOT, "sources", "team_v0.3", "04_엔진코드", "engine")
ORIGINAL_ENGINE_V05 = os.path.join(ROOT, "sources", "team_v0.5", "04_엔진코드", "engine")   # 팀 전달 v0.5 (D-028)
TEAM_V05_TESTS = ("test_weights.py", "test_access.py", "test_agglomeration.py", "test_v05.py")   # 4개 파일 29건

ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1",
           PYTHONDONTWRITEBYTECODE="1",   # 원본 폴더에 __pycache__ 를 만들지 않는다
           SCORING_ENGINE_VERSION="v0_3")  # 기본 단계는 v0.3 으로 고정(셸 환경과 무관). 엔진은 프로세스당 하나(D-024)
ENV_V04 = dict(ENV, SCORING_ENGINE_VERSION="v0_4")
ENV_V05 = dict(ENV, SCORING_ENGINE_VERSION="v0_5")
ENV_V051 = dict(ENV, SCORING_ENGINE_VERSION="v0_5_1")


# --jobs 로 동시에 돌려도 되는 단계: 각자 별도 프로세스·별도 엔진 환경변수이고, 파일 쓰기는 테스트 임시 폴더, 서버 포트는 OS가
# 고른 빈 포트라 서로 겹치지 않는다(11-6 점검). frontend(vitest 자체가 다중 스레드, 부하 때 시간 초과 이력)는 순차로 둔다
PARALLEL_KEYS = {"core", "v0_4", "v0_5", "v0_5_1", "backend"}


def step(name, cmd, cwd=ROOT, when=True, why_skip="", env=None, key="", opt_in=False):
    """opt_in: 기본 전체 check 에서 빼고 --only 로 고를 때만 돈다(e2e — 브라우저·backend 를 띄운다, D-035)"""
    return {"name": name, "cmd": cmd, "cwd": cwd, "when": when, "why_skip": why_skip, "env": env or ENV, "key": key,
            "opt_in": opt_in}


def _shell(s) -> bool:
    return os.name == "nt" and s["cmd"][0] == "npm"


def run_step(s) -> tuple:
    """한 단계를 지금 출력 흐름에 그대로 실행한다 (순차)."""
    print(f"\n━━ {s['name']}", flush=True)
    t = time.perf_counter()
    rc = subprocess.call(s["cmd"], cwd=s["cwd"], env=s["env"], shell=_shell(s))
    return (s["name"], "PASS" if rc == 0 else "FAIL", f"exit {rc}" if rc else "", time.perf_counter() - t)


def run_parallel(batch, jobs: int) -> list:
    """여러 단계를 최대 jobs 개 동시에 실행한다. 출력은 단계별 임시 파일에 모았다가 모두 끝난 뒤 원래 순서대로 이어 붙인다
    (로그가 섞이지 않게). 결과(단계·PASS/FAIL·종료 코드·소요)는 순차 실행과 같은 형식이다."""
    import tempfile
    from concurrent.futures import ThreadPoolExecutor

    def one(s):
        with tempfile.TemporaryFile(mode="w+b") as out:
            t = time.perf_counter()
            rc = subprocess.call(s["cmd"], cwd=s["cwd"], env=s["env"], stdout=out, stderr=subprocess.STDOUT, shell=_shell(s))
            dt = time.perf_counter() - t
            out.seek(0)
            log = out.read().decode("utf-8", errors="replace")
        return log, (s["name"], "PASS" if rc == 0 else "FAIL", f"exit {rc}" if rc else "", dt)

    print(f"\n━━ 동시 실행 {len(batch)}단계 (--jobs {jobs}): " + ", ".join(s["key"] for s in batch), flush=True)
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        done = list(pool.map(one, batch))
    results = []
    for s, (log, result) in zip(batch, done):
        print(f"\n━━ {s['name']}  ({result[3]:.1f}s, 동시 실행)", flush=True)
        print(log, end="" if log.endswith("\n") else "\n", flush=True)
        results.append(result)
    return results


def steps(fast: bool):
    has_src = os.path.isdir(ORIGINAL_ENGINE)
    has_src_v05 = os.path.isdir(ORIGINAL_ENGINE_V05)
    has_backend = os.path.isfile(os.path.join(ROOT, "backend", "pyproject.toml")) or \
        os.path.isdir(os.path.join(ROOT, "backend", "app"))
    has_frontend = os.path.isfile(os.path.join(ROOT, "frontend", "package.json"))
    has_git = os.path.exists(os.path.join(ROOT, ".git"))
    pytest_args = [PY, "-m", "pytest", "-q"] + (["-m", "not golden"] if fast else [])
    return [
        step("python imports", [PY, "-c", "import scoring_engine, scoring_engine.service; print('ok', scoring_engine.ENGINE_VERSION)"],
             key="imports"),
        step("python imports (engine v0_4)",
             [PY, "-c", "import scoring_engine, scoring_engine.service; print('ok', scoring_engine.ENGINE_VERSION)"],
             env=ENV_V04, key="imports"),
        step("python imports (engine v0_5)",
             [PY, "-c", "import scoring_engine, scoring_engine.service; print('ok', scoring_engine.ENGINE_VERSION)"],
             env=ENV_V05, key="imports"),
        step("python imports (engine v0_5_1)",
             [PY, "-c", "import scoring_engine, scoring_engine.service; print('ok', scoring_engine.ENGINE_VERSION)"],
             env=ENV_V051, key="imports"),
        step("source integrity (sources/team_v0.3 unchanged)", [PY, "scripts/manifest.py", "verify"],
             when=has_src, why_skip="sources/team_v0.3 없음", key="integrity"),
        step("source integrity (sources/team_v0.5 unchanged)", [PY, "scripts/source_v0_5.py", "verify"],
             when=has_src_v05, why_skip="sources/team_v0.5 없음", key="integrity"),
        step("original v0.3 tests: test_weights.py", [PY, "test_weights.py"], cwd=ORIGINAL_ENGINE,
             when=has_src, why_skip="sources/team_v0.3 없음", key="team-tests"),
        step("original v0.3 tests: test_access.py", [PY, "test_access.py"], cwd=ORIGINAL_ENGINE,
             when=has_src, why_skip="sources/team_v0.3 없음", key="team-tests"),
        # 팀 전달 v0.5 원본 테스트 4개 파일(29건)을 원본 폴더에서 그대로 (PYTHONDONTWRITEBYTECODE — __pycache__ 를 만들지 않는다)
        *[step(f"original v0.5 tests: {t}", [PY, t], cwd=ORIGINAL_ENGINE_V05, when=has_src_v05,
               why_skip="sources/team_v0.5 없음", key="team-tests") for t in TEAM_V05_TESTS],
        step("pytest: imports, integrity, canonical engine, data schema" + ("" if fast else ", golden regression"),
             pytest_args, key="core"),
        # v0.4(분석 반경 300·500·1,000m): golden v0.3 대비 버전만 다름·golden v0.4·v0.3 웹 경로 대조 (약 3~5분)
        step("pytest: engine v0_4 (radius 300/500/1000)",
             [PY, "-m", "pytest", "-q", "tests/engine_v0_4"] + (["-m", "not golden"] if fast else []), env=ENV_V04, key="v0_4"),
        # v0.5(팀 전달 + 반경): 팀 테스트 29건 사본·golden v0.5(팀 결과)·반경 300/1,000 golden·웹 경로·API·학교구역·경계 (약 7분)
        step("pytest: engine v0_5 (team v0.5 + radius)",
             [PY, "-m", "pytest", "-q", "tests/engine_v0_5"] + (["-m", "not golden"] if fast else []), env=ENV_V05, key="v0_5"),
        # v0.5.1(v0.5 + 분동 배분 결함 수정, D-029): 분동 보존 재현·golden v0.5.1·v0.5 대비 차이 범위·API (약 7분)
        step("pytest: engine v0_5_1 (v0.5 + split-dong fix)",
             [PY, "-m", "pytest", "-q", "tests/engine_v0_5_1"] + (["-m", "not golden"] if fast else []), env=ENV_V051, key="v0_5_1"),
        # ── 향후 단계 (폴더가 생기면 자동 실행) ──
        step("backend tests", [PY, "-m", "pytest", "-q", "backend"], when=has_backend,
             why_skip="backend 미구현", key="backend"),
        step("frontend check", ["npm", "--prefix", "frontend", "run", "check"], when=has_frontend,
             why_skip="frontend 미구현", key="frontend"),
        # 패치노트 기준 파일 형식·커밋 연결·기록 보존(D-031). git 저장소가 아니면 형식만
        step("patch notes (format, commit links)",
             [PY, "scripts/patch_notes.py", "check"] + ([] if has_git else ["--no-git"]), key="patch-notes"),
        # 자동 E2E smoke(5-3 B, D-035): e2e build → backend(v0.5.1) → Playwright(가짜 NAVER SDK). 기본 전체 check 에는
        # 넣지 않는다 — 배포 후보 확정 때 `--only e2e` 로 함께 돌린다(약 1.5분 + 첫 Chromium 설치)
        step("e2e smoke (Playwright, fake NAVER SDK)", ["npm", "--prefix", "frontend", "run", "e2e"], when=has_frontend,
             why_skip="frontend 미구현", key="e2e", opt_in=True),
    ]


def main() -> int:
    for stream in (sys.stdout, sys.stderr):   # Windows 콘솔(cp949)에서도 요약 출력이 깨지지 않게
        stream.reconfigure(encoding="utf-8", errors="replace")
    fast = "--fast" in sys.argv
    all_steps = steps(fast)
    keys = sorted({s["key"] for s in all_steps})
    if "--list" in sys.argv:
        for s in all_steps:
            print(f"  {s['key']:12s} {s['name']}" + ("   (선택 단계 — --only 로만)" if s["opt_in"] else ""))
        return 0
    only = None
    if "--only" in sys.argv:
        i = sys.argv.index("--only")
        only = {k.strip() for k in (sys.argv[i + 1] if i + 1 < len(sys.argv) else "").split(",") if k.strip()}
        unknown = only - set(keys)
        if not only or unknown:
            print(f"--only 키가 없거나 모른다: {sorted(unknown) or '(빈 값)'} — 가능한 키: {', '.join(keys)}", file=sys.stderr)
            return 2
        all_steps = [s for s in all_steps if s["key"] in only]
    else:
        all_steps = [s for s in all_steps if not s["opt_in"]]
    jobs = 1
    if "--jobs" in sys.argv:
        i = sys.argv.index("--jobs")
        value = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
        jobs = int(value) if value.isdigit() else 0
        if jobs < 1:
            print("--jobs 는 1 이상의 정수", file=sys.stderr)
            return 2
    results = []
    started = time.perf_counter()
    batch = []

    def flush_batch():
        if batch:
            results.extend(run_parallel(list(batch), jobs) if len(batch) > 1 else [run_step(batch[0])])
            batch.clear()

    for s in all_steps:
        if not s["when"]:
            flush_batch()
            results.append((s["name"], "SKIP", s["why_skip"], 0.0))
            continue
        if jobs > 1 and s["key"] in PARALLEL_KEYS:
            batch.append(s)            # 이어지는 동시 실행 가능 단계를 모은다(단계 순서는 그대로)
            continue
        flush_batch()
        results.append(run_step(s))
    flush_batch()
    print("\n" + "═" * 72)
    for name, status, note, dt in results:
        print(f"  {status:4s}  {name}  {note}  ({dt:.1f}s)")
    failed = [r for r in results if r[1] == "FAIL"]
    print("═" * 72)
    print(f"  총 {time.perf_counter() - started:.1f}s" + (f" (--jobs {jobs})" if jobs > 1 else ""))
    partial = []
    if fast:
        partial.append("fast — golden 제외")
    if only:
        partial.append("선택 단계만: " + ", ".join(sorted(only)))
    print("CHECK", "FAILED" if failed else (f"PASSED ({' · '.join(partial)} — 전체 check 아님, 완료 판정 아님)" if partial
                                            else "PASSED"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
