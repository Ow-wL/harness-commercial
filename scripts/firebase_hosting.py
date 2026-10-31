"""
Firebase Hosting 앞단 (짧은 주소·사용자 도메인, 2026-11-01) — 서울 리전 Cloud Run 은 자체 도메인 연결을 지원하지 않아
Firebase Hosting 이 모든 경로(`**`)를 Cloud Run 서비스로 넘긴다. 정적 파일은 Firebase 에 올리지 않는다(화면·API 모두 Cloud Run 그대로).

  python scripts/firebase_hosting.py show
  python scripts/firebase_hosting.py release [--apply]           새 버전(설정만, 파일 0개) → 확정 → 배포
  python scripts/firebase_hosting.py domain-add <도메인> [--apply] 사용자 도메인 추가 → 넣을 DNS 레코드 출력
  python scripts/firebase_hosting.py domain-status <도메인>        DNS·인증서 상태

- firebase CLI 없이 Hosting REST API 를 gcloud 사용자 토큰으로 부른다(토큰은 출력하지 않는다).
- rewrite 는 서비스의 트래픽 설정을 따른다(`pinTag` 없음) — Cloud Run 전환·복구(`deploy_cloud_run.py`)만으로 이 주소도 같이 바뀐다.
- Firebase → Cloud Run 요청은 60초 제한(Firebase Hosting 한도). 앱 응답은 그보다 짧다(AI 요약 포함).
- --apply 가 없으면 보낼 요청만 출력한다(dry run).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "harness-commercial"
SITE = "harness-commercial"           # 기본 사이트(프로젝트 id 와 같다)
REGION = "asia-northeast3"
SERVICE = "harness-commercial"
API = "https://firebasehosting.googleapis.com/v1beta1"

CONFIG = {"rewrites": [{"glob": "**", "run": {"serviceId": SERVICE, "region": REGION}}]}


def token() -> str:
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"
    return subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, text=True, check=True).stdout.strip()


def call(method: str, path: str, body: dict | None = None, tok: str | None = None) -> dict:
    req = urllib.request.Request(f"{API}/{path}", method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {tok or token()}", "x-goog-user-project": PROJECT,
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code}: {e.read().decode(errors='replace')[:500]}")
    return json.loads(raw or b"{}")


def release_requests() -> list[tuple[str, str, dict | None]]:
    """(메서드, 경로, 본문) — 버전 이름은 첫 요청 응답에서 정해지므로 {version} 자리표시."""
    site = f"sites/{SITE}"
    return [("POST", f"{site}/versions", {"config": CONFIG}),
            ("PATCH", "{version}?update_mask=status", {"status": "FINALIZED"}),
            ("POST", f"{site}/releases?versionName={{version}}", None)]


def cmd_release(apply: bool) -> int:
    reqs = release_requests()
    if not apply:
        for m, p, b in reqs:
            print(m, p, json.dumps(b, ensure_ascii=False) if b else "")
        print("(dry run — 실행하려면 --apply)")
        return 0
    tok = token()
    m, p, b = reqs[0]
    version = call(m, p, b, tok)["name"]
    for m, p, b in reqs[1:]:
        out = call(m, p.replace("{version}", version), b, tok)
    print(f"released {version} — {out.get('name')}")
    return 0


def cmd_show() -> int:
    tok = token()
    for s in call("GET", f"projects/{PROJECT}/sites", tok=tok).get("sites", []):
        print("site", s["name"].rsplit("/", 1)[-1], s.get("defaultUrl"))
    rel = call("GET", f"sites/{SITE}/releases?pageSize=1", tok=tok).get("releases", [])
    if rel:
        r = rel[0]
        print("release", r.get("releaseTime"), json.dumps(r.get("version", {}).get("config"), ensure_ascii=False))
    for d in call("GET", f"projects/{PROJECT}/sites/{SITE}/customDomains", tok=tok).get("customDomains", []):
        print("domain", d["name"].rsplit("/", 1)[-1], d.get("hostState"), d.get("ownershipState"), d.get("certState"))
    return 0


def dns_records(domain: dict) -> list[str]:
    out = []
    for upd in (domain.get("requiredDnsUpdates") or {}).get("desired", []):
        for rec in upd.get("records", []):
            out.append(f"{upd.get('domainName')}  {rec.get('type')}  {rec.get('rdata')}  ({rec.get('requiredAction', '')})")
    return out


def cmd_domain_add(host: str, apply: bool) -> int:
    path = f"projects/{PROJECT}/sites/{SITE}/customDomains?customDomainId={host}"
    if not apply:
        print("POST", path, "{}")
        print("(dry run — 실행하려면 --apply)")
        return 0
    call("POST", path, {})
    print(f"{host} 추가 요청됨 — 잠시 뒤 domain-status 로 넣을 DNS 레코드를 본다")
    return 0


def cmd_domain_status(host: str) -> int:
    d = call("GET", f"projects/{PROJECT}/sites/{SITE}/customDomains/{host}")
    print("host", d.get("hostState"), "ownership", d.get("ownershipState"), "cert", (d.get("cert") or {}).get("state"))
    for line in dns_records(d):
        print("  DNS", line)
    for issue in d.get("issues", []):
        print("  issue", issue.get("message"))
    return 0


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    r = sub.add_parser("release")
    r.add_argument("--apply", action="store_true")
    a = sub.add_parser("domain-add")
    a.add_argument("host")
    a.add_argument("--apply", action="store_true")
    s = sub.add_parser("domain-status")
    s.add_argument("host")
    args = ap.parse_args(argv)
    if args.cmd == "show":
        return cmd_show()
    if args.cmd == "release":
        return cmd_release(args.apply)
    if args.cmd == "domain-add":
        return cmd_domain_add(args.host, args.apply)
    return cmd_domain_status(args.host)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
