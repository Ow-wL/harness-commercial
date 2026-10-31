"""
로컬 확인용 backend 실행 (TASKS 12-12) — `.claude/launch.json` 이 세션 임시 폴더 대신 이 파일을 가리킨다.

  python scripts/run_local_backend.py [--engine v0_5_1] [--port 8000] [--secrets]

--engine: SCORING_ENGINE_VERSION (v0_3 | v0_4 | v0_5 | v0_5_1, 기본 v0_5_1 = 운영과 같음)
--secrets: Secret Manager 의 AI·지원사업 키를 이 프로세스 환경변수로만 읽는다(gcloud 로그인 필요). 값은 출력·저장하지 않는다.
           지원사업 캐시는 저장소 밖 임시 폴더(SUPPORT_STATE_DIR 이 없으면 OS 임시 폴더 아래 harness-support-local).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS = {"ANTHROPIC_API_KEY": "anthropic-api-key", "BIZINFO_API_KEY": "bizinfo-api-key", "DATA_GO_KR_API_KEY": "data-go-kr-api-key"}


def load_secrets() -> None:
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        print("gcloud 가 없어 Secret 을 읽지 않는다", file=sys.stderr)
        return
    for env, name in SECRETS.items():
        r = subprocess.run([gcloud, "secrets", "versions", "access", "latest", "--secret", name, "--project", "harness-commercial"],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            os.environ[env] = r.stdout.strip()
        else:
            print(f"Secret {name} 를 읽지 못했다 — 그 기능은 꺼진 채로 뜬다", file=sys.stderr)
    os.environ.setdefault("SUPPORT_STATE_DIR", str(Path(tempfile.gettempdir()) / "harness-support-local"))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="v0_5_1", choices=["v0_3", "v0_4", "v0_5", "v0_5_1"])
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--secrets", action="store_true")
    a = ap.parse_args(argv)
    os.environ["SCORING_ENGINE_VERSION"] = a.engine
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    if a.secrets:
        load_secrets()
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    import uvicorn

    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=a.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
