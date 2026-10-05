"""
원본(sources/team_v0.3) 무결성 매니페스트.

  python scripts/manifest.py verify            원본 트리가 매니페스트와 같은지 검사 (기본)
  python scripts/manifest.py create            매니페스트가 없을 때만 새로 만든다

매니페스트는 하네스 구축 시점(2026-10-05)에 원본 전체를 해시한 기준값이다.
canonical 엔진 사본, data/runtime, tests/golden 의 무결성도 이 해시와 대조한다.
이미 있는 매니페스트는 덮어쓰지 않는다 — 원본이 바뀌었다면 그건 새 엔진 버전이다 (docs/DECISIONS.md D-006).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(ROOT, "sources", "team_v0.3")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "source_team_v0.3.sha256.json")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scan(base: str) -> dict:
    out = {}
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames.sort()
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, base).replace(os.sep, "/")
            out[rel] = {"sha256": sha256(full), "bytes": os.path.getsize(full)}
    return out


def load_manifest() -> dict:
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def verify() -> list[str]:
    """차이 목록 (빈 리스트 = 동일)."""
    if not os.path.isdir(SOURCE_DIR):
        return [f"원본 폴더 없음: {SOURCE_DIR}"]
    want = load_manifest()["files"]
    got = scan(SOURCE_DIR)
    errs = [f"삭제됨: {p}" for p in sorted(set(want) - set(got))]
    errs += [f"추가됨: {p}" for p in sorted(set(got) - set(want))]
    errs += [f"변경됨: {p}" for p in sorted(set(want) & set(got)) if want[p]["sha256"] != got[p]["sha256"]]
    return errs


def create() -> None:
    if os.path.exists(MANIFEST):
        sys.exit(f"이미 있음: {MANIFEST} — 덮어쓰지 않는다.")
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    data = {"source": "sources/team_v0.3", "engine_version": "mvp-0.3",
            "created": date.today().isoformat(), "files": scan(SOURCE_DIR)}
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"created {MANIFEST} ({len(data['files'])} files)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cmd =sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "create":
        create()
    elif cmd == "verify":
        errs = verify()
        for e in errs:
            print("  ", e)
        print("source integrity:", "OK" if not errs else f"FAIL ({len(errs)})")
        sys.exit(1 if errs else 0)
    else:
        sys.exit(__doc__)
