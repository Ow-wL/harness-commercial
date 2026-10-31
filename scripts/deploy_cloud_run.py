"""
Cloud Run 배포 명령 (비용 설정을 명령에 고정 — 2026-10-31 비용 점검, docs/COST_2026-10-31.md).

  python scripts/deploy_cloud_run.py candidate <이미지 태그> [--suffix S] [--ai] [--apply]
      무트래픽 후보 리비전 + `preview` 태그. **리비전 최소 인스턴스는 항상 0** — 태그가 남아 있어도 쉬는 동안 과금되지 않는다
      (예전에는 리비전마다 min 1 이라 verify-* 태그가 남은 리비전 2개가 상시 인스턴스로 계속 과금됐다).
      CPU·메모리·동시성·타임아웃·최대 인스턴스·과금 방식(PROFILE)을 매번 명시한다 — 서비스 템플릿에 남은 값(예: 실험 배포)을 물려받지 않게.
      --ai: ANTHROPIC_API_KEY 를 Secret(anthropic-api-key:latest)에서 연결한다(값은 명령·로그에 나오지 않는다).
  python scripts/deploy_cloud_run.py switch <리비전> [--apply]
      트래픽 100% 전환 + **서비스 단위 최소 인스턴스**(PROFILE.service_min — 트래픽을 받는 리비전에만 적용, 리비전을 새로 만들지 않음).
  python scripts/deploy_cloud_run.py rollback <리비전> [--apply]      (= switch, 기록용 이름)
  python scripts/deploy_cloud_run.py tags [--remove-except preview] [--apply]
      태그 목록. 지정한 것 외 태그를 지운다(리비전은 지우지 않는다 — 복구용으로 남는다).

--apply 가 없으면 실행할 gcloud 명령만 출력한다(dry run). 프로젝트·리전·서비스는 아래 상수 — 저장소 문서에는 서비스 주소를 적지 않는다(D-031).
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys

PROJECT = "harness-commercial"
REGION = "asia-northeast3"
SERVICE = "harness-commercial"
IMAGE = f"{REGION}-docker.pkg.dev/{PROJECT}/{PROJECT}/{PROJECT}"
ENGINE_ENV = "SCORING_ENGINE_VERSION=v0_5_1"
AI_SECRET = "ANTHROPIC_API_KEY=anthropic-api-key:latest"

# 운영 비용 프로필. 바꿀 때는 docs/COST_2026-10-31.md 의 실측·요금과 함께 사용자 승인 뒤에 고친다.
#   billing: "instance"(CPU 상시 할당 — 시작 뒤 엔진 warm 이 백그라운드에서 끝까지 돈다) | "request"(요청 처리 중에만 CPU — 쉬는 동안 warm 멈춤)
#   service_min: 트래픽을 받는 리비전에 유지할 인스턴스 수(0 이면 쉬는 동안 0 으로 줄고 첫 요청에 cold start 약 12초 + 첫 분석 약 7초)
PROFILE = {"billing": "instance", "service_min": 1, "max": 1, "cpu": "1", "memory": "1Gi", "concurrency": 4, "timeout": 300}


def candidate_cmd(tag: str, suffix: str, ai: bool, profile: dict = PROFILE) -> list[str]:
    cmd = ["gcloud", "run", "deploy", SERVICE, "--project", PROJECT, "--region", REGION, "--image", f"{IMAGE}:{tag}",
           "--no-traffic", "--revision-suffix", suffix, "--tag", "preview",
           "--min-instances", "0",                                  # 후보·복구 리비전은 쉬는 동안 0 (운영 최소는 서비스 단위)
           "--max-instances", str(profile["max"]),
           "--cpu", profile["cpu"], "--memory", profile["memory"],
           "--concurrency", str(profile["concurrency"]), "--timeout", str(profile["timeout"]),
           "--cpu-throttling" if profile["billing"] == "request" else "--no-cpu-throttling",
           "--cpu-boost", "--update-env-vars", ENGINE_ENV]
    if ai:
        cmd += ["--update-secrets", AI_SECRET]
    return cmd


def switch_cmds(revision: str, profile: dict = PROFILE) -> list[list[str]]:
    base = ["--project", PROJECT, "--region", REGION]
    return [["gcloud", "run", "services", "update-traffic", SERVICE, *base, "--to-revisions", f"{revision}=100"],
            ["gcloud", "run", "services", "update", SERVICE, *base, "--min", str(profile["service_min"])]]


def tags_cmd(remove: list[str]) -> list[str]:
    return ["gcloud", "run", "services", "update-traffic", SERVICE, "--project", PROJECT, "--region", REGION,
            "--remove-tags", ",".join(remove)]


def exe(cmd: list[str]) -> list[str]:
    """Windows 의 gcloud 는 .cmd 라 이름만으로는 실행되지 않는다 — 실제 경로로 바꿔 실행(출력하는 명령은 그대로 gcloud)."""
    return [shutil.which(cmd[0]) or cmd[0], *cmd[1:]]


def current_tags() -> list[str]:
    out = subprocess.run(exe(["gcloud", "run", "services", "describe", SERVICE, "--project", PROJECT, "--region", REGION,
                          "--format", "value(status.traffic[].tag)"]), capture_output=True, text=True, check=True).stdout
    return [t for t in out.replace(";", ",").replace("\n", ",").split(",") if t.strip()]


def run(cmds: list[list[str]], apply: bool) -> int:
    for c in cmds:
        print("$ " + " ".join(c))
        if apply:
            r = subprocess.run(exe(c))
            if r.returncode:
                return r.returncode
    if not apply:
        print("(dry run — 실행하려면 --apply)")
    return 0


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("candidate")
    c.add_argument("tag")
    c.add_argument("--suffix")
    c.add_argument("--ai", action="store_true")
    c.add_argument("--apply", action="store_true")
    for name in ("switch", "rollback"):
        s = sub.add_parser(name)
        s.add_argument("revision")
        s.add_argument("--apply", action="store_true")
    t = sub.add_parser("tags")
    t.add_argument("--remove-except", nargs="*")
    t.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "candidate":
        return run([candidate_cmd(a.tag, a.suffix or f"{a.tag}-v051", a.ai)], a.apply)
    if a.cmd in ("switch", "rollback"):
        return run(switch_cmds(a.revision), a.apply)
    tags = current_tags()
    print("태그:", ", ".join(tags) or "(없음)")
    if a.remove_except is None:
        return 0
    remove = [x for x in tags if x not in a.remove_except]
    return run([tags_cmd(remove)], a.apply) if remove else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
