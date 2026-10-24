"""
패치노트 기준 파일(frontend/src/content/patchNotes.json) 검사·커밋 연결 (D-031, CLAUDE.md "패치노트·배포 기록").

  python scripts/patch_notes.py check          형식 검사 + (git 이 있으면) 커밋 연결·기록 보존 검사
  python scripts/patch_notes.py check --no-git 형식만 (git 없는 환경)
  python scripts/patch_notes.py sync           `Patch-Note: vX.Y.Z` 트레일러가 있는데 아직 목록에 없는 커밋을 보여 준다
  python scripts/patch_notes.py sync --write   그 커밋들을 해당 버전의 commits 끝에 넣는다(파일만 바꾼다, 커밋하지 않는다)

커밋은 자기 해시를 담을 수 없다. 그래서 새 커밋은 메시지 트레일러 `Patch-Note: v0.0.12`로 버전에 연결하고, 다음에
패치노트를 고칠 때(다음 기능·배포 기록 커밋) sync --write 로 해시를 목록에 옮긴다. 해시를 넣으려고 커밋을 반복하지 않는다.

git 검사(오류):
  - 목록의 해시가 HEAD 이력에 있는 커밋을 하나로 가리킨다. 한 커밋은 한 버전에만 속한다.
  - HEAD 이력의 모든 커밋은 목록에 있거나 존재하는 버전을 가리키는 트레일러가 있다(연결 안 된 커밋 0).
  - 트레일러 버전과 목록 버전이 다르면 오류.
  - HEAD 의 기준 파일과 비교해 버전·커밋 연결·배포 기록을 지우거나 배포 기록을 고치지 않았다(추가만).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL_PATH = "frontend/src/content/patchNotes.json"
PATH = os.path.join(ROOT, *REL_PATH.split("/"))

VERSION = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
DATE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")
HASH = re.compile(r"^[0-9a-f]{7,40}$")
CHANGE_TYPES = {"added", "improved", "fixed"}
# 배포 종류별로 가능한 결과. production = 운영 트래픽 전환, verification = 무트래픽 검증, rollback = 이전 리비전으로 복구 전환
KIND_RESULTS = {
    "production": {"done", "failed", "held"},
    "verification": {"passed", "issue-found", "failed"},
    "rollback": {"done", "failed"},
}
MAX_CHANGES = 3
MAX_TITLE = 30
MAX_TEXT = 90


def vkey(v: str) -> tuple[int, int, int]:
    m = VERSION.match(v)
    return (int(m[1]), int(m[2]), int(m[3])) if m else (-1, -1, -1)


def load(text: str | None = None) -> dict:
    if text is None:
        with open(PATH, encoding="utf-8") as f:
            text = f.read()
    return json.loads(text)


def check_format(data: dict) -> list[str]:
    errs: list[str] = []
    releases = data.get("releases")
    deployments = data.get("deployments")
    if not isinstance(releases, list) or not releases:
        return ["releases 가 비어 있거나 목록이 아니다"]
    if not isinstance(deployments, list):
        errs.append("deployments 가 목록이 아니다")
        deployments = []
    if not VERSION.match(str(data.get("renumbered_until", ""))):
        errs.append("renumbered_until 은 vX.Y.Z 형식이어야 한다")

    seen_versions: set[str] = set()
    seen_commits: dict[str, str] = {}
    prev = None
    for i, r in enumerate(releases):
        where = f"releases[{i}] {r.get('version', '?')}"
        for key in ("version", "date", "title", "changes", "commits"):
            if key not in r:
                errs.append(f"{where}: 필수 필드 {key} 없음")
        v = str(r.get("version", ""))
        if not VERSION.match(v):
            errs.append(f"{where}: version 형식(vX.Y.Z) 아님")
        if v in seen_versions:
            errs.append(f"{where}: version 중복")
        seen_versions.add(v)
        if prev is not None and vkey(v) >= vkey(prev["version"]):
            errs.append(f"{where}: 최신순(버전 내림차순)이 아니다")
        for key in ("date", "date_from"):
            if key in r and not DATE.match(str(r[key])):
                errs.append(f"{where}: {key} 형식(YYYY-MM-DD) 아님")
        if "date_from" in r and str(r["date_from"]) > str(r.get("date", "")):
            errs.append(f"{where}: date_from 이 date 보다 늦다")
        if prev is not None and str(r.get("date", "")) > str(prev.get("date", "")):
            errs.append(f"{where}: 날짜가 더 최신 버전보다 늦다")
        title = str(r.get("title", "")).strip()
        if not title or len(title) > MAX_TITLE:
            errs.append(f"{where}: title 은 1~{MAX_TITLE}자")
        changes = r.get("changes", [])
        if not isinstance(changes, list) or not 1 <= len(changes) <= MAX_CHANGES:
            errs.append(f"{where}: changes 는 1~{MAX_CHANGES}개")
            changes = changes if isinstance(changes, list) else []
        for c in changes:
            if c.get("type") not in CHANGE_TYPES:
                errs.append(f"{where}: change type 은 {sorted(CHANGE_TYPES)} 중 하나")
            text = str(c.get("text", "")).strip()
            if not text or len(text) > MAX_TEXT:
                errs.append(f"{where}: change text 는 1~{MAX_TEXT}자")
        for w in r.get("work", []):
            if not str(w).strip():
                errs.append(f"{where}: 빈 work 줄")
        commits = r.get("commits", [])
        if not isinstance(commits, list):
            errs.append(f"{where}: commits 는 목록")
            commits = []
        for h in commits:
            if not HASH.match(str(h)):
                errs.append(f"{where}: 커밋 해시 형식 아님 {h!r}")
            elif h in seen_commits:
                errs.append(f"{where}: 커밋 {h} 가 {seen_commits[h]} 에도 있다")
            else:
                seen_commits[h] = v
        prev = r

    seen_ids: set[str] = set()
    prev_date = ""
    for i, d in enumerate(deployments):
        where = f"deployments[{i}] {d.get('id', '?')}"
        for key in ("id", "date", "kind", "result", "app_version", "source_commit", "note"):
            if not str(d.get(key, "")).strip():
                errs.append(f"{where}: 필수 필드 {key} 없음")
        if d.get("id") in seen_ids:
            errs.append(f"{where}: id 중복")
        seen_ids.add(d.get("id"))
        if not DATE.match(str(d.get("date", ""))):
            errs.append(f"{where}: date 형식(YYYY-MM-DD) 아님")
        elif str(d["date"]) < prev_date:
            errs.append(f"{where}: 배포 기록은 날짜 오름차순으로 끝에 추가한다")
        else:
            prev_date = str(d["date"])
        kind = d.get("kind")
        if kind not in KIND_RESULTS:
            errs.append(f"{where}: kind 는 {sorted(KIND_RESULTS)} 중 하나")
        elif d.get("result") not in KIND_RESULTS[kind]:
            errs.append(f"{where}: {kind} 의 result 는 {sorted(KIND_RESULTS[kind])} 중 하나")
        if d.get("app_version") not in seen_versions:
            errs.append(f"{where}: app_version {d.get('app_version')} 이 releases 에 없다")
        h = str(d.get("source_commit", ""))
        if not HASH.match(h):
            errs.append(f"{where}: source_commit 형식 아님")
        elif h in seen_commits and seen_commits[h] != d.get("app_version"):
            errs.append(f"{where}: source_commit {h} 는 {seen_commits[h]} 에 속한다(app_version 과 다름)")
    return errs


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                          check=True).stdout


def history() -> list[tuple[str, list[str]]]:
    """HEAD 이력의 (전체 해시, Patch-Note 트레일러 버전들)"""
    out = git("log", "--format=%H%x1f%(trailers:key=Patch-Note,valueonly,separator=%x2c)%x1e")
    rows = []
    for rec in out.split("\x1e"):
        rec = rec.strip()
        if not rec:
            continue
        full, _, trailers = rec.partition("\x1f")
        rows.append((full.strip(), [t.strip() for t in trailers.split(",") if t.strip()]))
    return rows


def check_git(data: dict) -> tuple[list[str], list[str]]:
    """(오류, 아직 목록에 옮기지 않은 트레일러 커밋 안내)"""
    errs: list[str] = []
    rows = history()
    fulls = [full for full, _ in rows]
    listed: dict[str, str] = {}   # 전체 해시 → 버전
    for r in data["releases"]:
        for h in r["commits"]:
            hits = [f for f in fulls if f.startswith(h)]
            if len(hits) != 1:
                errs.append(f"{r['version']}: 커밋 {h} 가 HEAD 이력의 커밋 하나를 가리키지 않는다({len(hits)}개)")
            else:
                listed[hits[0]] = r["version"]
    versions = {r["version"] for r in data["releases"]}
    pending = []
    for full, tags in rows:
        bad = [t for t in tags if t not in versions]
        if bad:
            errs.append(f"{full[:7]}: Patch-Note 트레일러 버전 {bad} 이 releases 에 없다")
        if full in listed:
            if tags and listed[full] not in tags:
                errs.append(f"{full[:7]}: 목록은 {listed[full]}, 트레일러는 {tags}")
        elif tags and not bad:
            pending.append(f"{full[:7]} → {', '.join(tags)}")
        elif not tags:
            errs.append(f"{full[:7]}: 어느 버전에도 연결되지 않은 커밋(목록에도 트레일러에도 없음)")
    for d in data["deployments"]:
        if not any(f.startswith(d["source_commit"]) for f in fulls):
            errs.append(f"배포 {d['id']}: source_commit {d['source_commit']} 이 HEAD 이력에 없다")

    # HEAD 기준 파일과 비교 — 기록은 추가만 한다
    try:
        head = load(git("show", f"HEAD:{REL_PATH}"))
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        head = None   # 아직 커밋된 기준 파일이 없다
    if head:
        now_rel = {r["version"]: r for r in data["releases"]}
        for r in head.get("releases", []):
            if r["version"] not in now_rel:
                errs.append(f"{r['version']}: HEAD 에 있던 버전을 지웠다")
                continue
            gone = [h for h in r.get("commits", []) if h not in now_rel[r["version"]]["commits"]]
            if gone:
                errs.append(f"{r['version']}: HEAD 에 있던 커밋 연결을 지웠다 {gone}")
        now_dep = {d["id"]: d for d in data["deployments"]}
        for d in head.get("deployments", []):
            if d["id"] not in now_dep:
                errs.append(f"배포 {d['id']}: HEAD 에 있던 기록을 지웠다(실패·롤백도 지우지 않고 새 기록을 추가한다)")
            elif now_dep[d["id"]] != d:
                errs.append(f"배포 {d['id']}: HEAD 에 있던 기록을 고쳤다(정정은 새 기록으로 추가한다)")
    return errs, pending


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    cmd = argv[0] if argv else "check"
    data = load()
    errs = check_format(data)
    if errs:
        print("\n".join("오류: " + e for e in errs))
        return 1
    if cmd == "check":
        if "--no-git" in argv:
            print(f"패치노트 형식 OK — 버전 {len(data['releases'])}개, 배포 기록 {len(data['deployments'])}개 (git 검사 안 함)")
            return 0
        gerrs, pending = check_git(data)
        for p in pending:
            print("안내: 트레일러로만 연결된 커밋(다음 패치노트 수정 때 sync --write) " + p)
        if gerrs:
            print("\n".join("오류: " + e for e in gerrs))
            return 1
        linked = sum(len(r["commits"]) for r in data["releases"])
        print(f"패치노트 OK — 버전 {len(data['releases'])}개, 커밋 연결 {linked}개 + 트레일러 {len(pending)}개, "
              f"배포 기록 {len(data['deployments'])}개")
        return 0
    if cmd == "sync":
        listed = {h for r in data["releases"] for h in r["commits"]}
        moves = []
        for full, tags in history():
            if tags and not any(full.startswith(h) for h in listed) and len(tags) == 1:
                moves.append((full[:7], tags[0]))
        if not moves:
            print("옮길 커밋 없음")
            return 0
        for h, v in reversed(moves):   # 오래된 커밋부터
            print(f"{h} → {v}")
        if "--write" in argv:
            by_version = {r["version"]: r for r in data["releases"]}
            for h, v in reversed(moves):
                by_version[v]["commits"].append(h)
            with open(PATH, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(f"{REL_PATH} 에 {len(moves)}개를 넣었다 — 커밋은 직접 한다")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
