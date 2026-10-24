"""
v0.5 패키징 — Docker 이미지 runtime 단계에 v0.5 가 동작할 파일·의존성이 들어가는지 (D-028).

Docker 빌드 자체는 여기서 하지 않는다(데몬이 없는 환경에서도 돈다). 대신
  - requirements.txt 에 matplotlib 고정 버전, Dockerfile runtime 단계 ENV MPLCONFIGDIR
  - Dockerfile runtime 단계 COPY 목록만 임시 디렉터리에 복사하고(.dockerignore 반영), 그 안에서 v0.5 로 부평역 PC방을 분석
    → 이 프로세스 결과와 같다 (sources/·tests/·scripts/ 없이 동작, 면적 배분 경계 포함)
실제 이미지 빌드·컨테이너 실행 확인은 별도(docs/TASKS.md 10장).
"""
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys

from helpers import ROOT, deep_diff, normalize


def _runtime_copies() -> list[tuple[list[str], str]]:
    with open(os.path.join(ROOT, "Dockerfile"), encoding="utf-8") as f:
        text = f.read()
    stage = text.split("\nFROM python", 1)[1]
    out = []
    for line in stage.splitlines():
        if not line.startswith("COPY ") or "--from=" in line:
            continue
        rest = line[5:].strip()
        parts = json.loads(rest) if rest.startswith("[") else rest.split()
        out.append((parts[:-1], parts[-1]))
    return out


def _ignored(rel: str, patterns: list[str]) -> bool:
    """.dockerignore 규칙 중 이 저장소가 쓰는 형태만: `**/이름`(어느 깊이든), 경로 접두, glob."""
    rel = rel.replace(os.sep, "/")
    for p in patterns:
        if p.startswith("**/"):
            if any(fnmatch.fnmatch(part, p[3:]) for part in rel.split("/")):
                return True
        elif rel == p or rel.startswith(p + "/") or fnmatch.fnmatch(rel, p):
            return True
    return False


def test_requirements_and_env():
    with open(os.path.join(ROOT, "requirements.txt"), encoding="utf-8") as f:
        assert re.search(r"^matplotlib==\d+\.\d+\.\d+$", f.read(), re.M)
    with open(os.path.join(ROOT, "Dockerfile"), encoding="utf-8") as f:
        runtime = f.read().split("\nFROM python", 1)[1]
    assert "MPLCONFIGDIR=/tmp/matplotlib" in runtime
    assert ["data/geo/SGIS_행정동경계_2025_2Q_인천.geojson"] in [src for src, _ in _runtime_copies()]


def test_runtime_stage_files_are_enough_for_v0_5(tmp_path, service):
    with open(os.path.join(ROOT, ".dockerignore"), encoding="utf-8") as f:
        patterns = [x.strip() for x in f if x.strip() and not x.startswith("#")]
    app = tmp_path / "app"
    for srcs, dest in _runtime_copies():
        if srcs == ["requirements.txt"]:
            continue
        for src in srcs:
            full = os.path.join(ROOT, src)
            if os.path.isdir(full):                        # COPY dir/ dest/ — 내용을 dest 아래로
                target = os.path.join(app, dest)
            else:                                          # COPY file dest/ — dest/file
                target = os.path.join(app, dest, os.path.basename(src))
            if os.path.isdir(full):
                for dirpath, _, files in os.walk(full):
                    for fn in files:
                        rel = os.path.relpath(os.path.join(dirpath, fn), ROOT)
                        if _ignored(rel, patterns):
                            continue
                        out = os.path.join(target, os.path.relpath(os.path.join(dirpath, fn), full))
                        os.makedirs(os.path.dirname(out), exist_ok=True)
                        shutil.copy2(os.path.join(dirpath, fn), out)
            else:
                os.makedirs(os.path.dirname(target), exist_ok=True)
                shutil.copy2(full, target)
    assert (app / "data" / "geo" / "SGIS_행정동경계_2025_2Q_인천.geojson").is_file()
    assert not (app / "sources").exists() and not (app / "tests").exists()
    code = ("import json, sys\n"
            "from scoring_engine.service import AnalysisService\n"
            "from scoring_engine.location import ContextBuilder\n"
            "svc = AnalysisService()\n"
            "ctx = ContextBuilder(svc.rt).build(37.4894, 126.7246)\n"
            "res = svc.analyze(ctx, 'R10406', radius_m=1000)\n"
            "open(sys.argv[1], 'w', encoding='utf-8').write(json.dumps(res, ensure_ascii=False))\n")
    out = tmp_path / "res.json"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PYTHONPATH", "DATA_VERSION"))}
    env.update(SCORING_ENGINE_VERSION="v0_5", PYTHONDONTWRITEBYTECODE="1", MPLCONFIGDIR=str(tmp_path / "mpl"))
    run = subprocess.run([sys.executable, "-c", code, str(out)], cwd=app, env=env, capture_output=True)
    assert run.returncode == 0, run.stderr.decode("utf-8", "replace")[-1500:]
    from scoring_engine.location import ContextBuilder
    want = service.analyze(ContextBuilder(service.rt).build(37.4894, 126.7246), "R10406", radius_m=1000)
    with open(out, encoding="utf-8") as f:
        assert not deep_diff(json.load(f), normalize(want))
