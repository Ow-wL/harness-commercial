"""
12-24 사후검증 재현 — 팀 busy_bias_check.py·survival_validation.py 를 **별도 작업 사본**에서 실행한다.

  python scripts/survival_repro.py run v0_5      대조군: 팀 v0.5 결과가 그대로 나오는지
  python scripts/survival_repro.py run v0_5_1    운영 엔진

작업 사본 = .gstack/validation-12-24/<엔진>/ (git 제외). 팀 스크립트는 바이트 그대로 복사해 고치지 않고,
engine/ 만 저장소 엔진 사본 + 팀 ETL 보조 모듈(인허가 읽기·좌표 변환)로 채운다.
원본 폴더(sources/)·golden·data/runtime 에는 쓰지 않는다. 팀 run_all.py 는 복사하지도 실행하지도 않는다.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEAM = os.path.join(ROOT, "sources", "team_v0.5", "04_엔진코드")
PERMITS = os.path.join(ROOT, "sources", "team_v0.3", "08_원본_인허가")
RUNTIME = os.path.join(ROOT, "data", "runtime")
BOUNDARY = os.path.join(ROOT, "data", "geo", "SGIS_행정동경계_2025_2Q_인천.geojson")
WORK = os.path.join(ROOT, ".gstack", "validation-12-24")
LABEL = {"v0_5": "v0.5", "v0_5_1": "v0.5.1"}
TEAM_SCRIPTS = ("busy_bias_check.py", "survival_validation.py")
TEAM_HELPERS = ("coord5174.py", "etl_stability.py", "etl_stability_food.py")
PERMIT_FILES = ("식품_일반음식점_인천.csv", "식품_휴게음식점_인천.csv")


def sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def prepare(engine: str) -> str:
    base = os.path.join(WORK, engine)
    if os.path.exists(base):
        shutil.rmtree(base)
    code = os.path.join(base, "04_엔진코드")
    for d in ("05_분석결과", "07_가공데이터", "08_원본_인허가"):
        os.makedirs(os.path.join(base, d))
    shutil.copytree(os.path.join(ROOT, "scoring_engine", engine), os.path.join(code, "engine"),
                    ignore=shutil.ignore_patterns("__pycache__", "test_*.py"))
    for name in TEAM_SCRIPTS:
        shutil.copy2(os.path.join(TEAM, name), os.path.join(code, name))
        assert sha256(os.path.join(TEAM, name)) == sha256(os.path.join(code, name))
    for name in TEAM_HELPERS:
        shutil.copy2(os.path.join(TEAM, "engine", name), os.path.join(code, "engine", name))
    for name in os.listdir(RUNTIME):
        shutil.copy2(os.path.join(RUNTIME, name), os.path.join(base, "07_가공데이터", name))
    shutil.copy2(BOUNDARY, os.path.join(base, "07_가공데이터", "경계_인천_행정동.geojson"))
    for name in PERMIT_FILES:
        shutil.copy2(os.path.join(PERMITS, name), os.path.join(base, "08_원본_인허가", name))
    return code


def run(engine: str) -> int:
    code = prepare(engine)
    ver = LABEL[engine]
    # PYTHONUTF8: 팀 DongAreas 의 open() 에 인코딩이 없다(docs/ENGINE_V0_5.md). pandas 읽기는 인코딩을 명시한다.
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1", "VER": ver}
    for script, args in (("busy_bias_check.py", []), ("survival_validation.py", [ver])):
        print(f"== {engine}: {script} {' '.join(args)}", flush=True)
        rc = subprocess.call([sys.executable, script, *args], cwd=code, env=env)
        if rc:
            return rc
    print("결과:", os.path.join(WORK, engine, "05_분석결과"))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "run" or sys.argv[2] not in LABEL:
        print(__doc__)
        sys.exit(2)
    sys.exit(run(sys.argv[2]))
