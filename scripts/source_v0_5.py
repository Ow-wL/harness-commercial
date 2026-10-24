"""
팀 전달 v0.5(2026-10-23) 원본 무결성 매니페스트 — sources/team_v0.5 (docs/DECISIONS.md D-028).

  python scripts/source_v0_5.py verify                       저장소 사본이 매니페스트와 같은지 검사 (기본)
  python scripts/source_v0_5.py create <전달 폴더>            매니페스트가 없을 때만 새로 만든다

전달 폴더(예: C:/work/AICapstone/점수엔진_v0.5)는 읽기만 한다. 저장 규칙:
  - 엔진 번들(상권분석매니저_점수기준_엔진_v0.5/) 135개 파일 전부를 해시한다.
  - 04_엔진코드/ 는 전부 sources/team_v0.5 에 둔다(웹 엔진 사본 scoring_engine/v0_5 의 대조 기준).
  - 그 밖의 파일은 sources/team_v0.3 의 같은 경로와 바이트가 같으면 다시 넣지 않는다(stored = sources/team_v0.3).
  - 07_가공데이터/경계_인천_행정동.geojson 은 data/geo/SGIS_행정동경계_2025_2Q_인천.geojson 한 곳에만 둔다(인구 면적 배분용).
  - 지오비전 퍼즐 폴더는 해시만 남기고 저장소에 넣지 않는다(stored = null — SKT 이용약관상 원자료 재배포 금지, 전달 README 3장).
이미 있는 매니페스트는 덮어쓰지 않는다 — 전달본이 바뀌면 새 버전이다 (D-006).
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from manifest import scan, sha256  # noqa: E402

SOURCE_DIR = os.path.join(ROOT, "sources", "team_v0.5")
V03_DIR = os.path.join(ROOT, "sources", "team_v0.3")
MANIFEST = os.path.join(ROOT, "tests", "manifests", "source_team_v0.5.sha256.json")
BUNDLE = "상권분석매니저_점수기준_엔진_v0.5"
PUZZLE = "지오비전퍼즐_상권기록_43곳"
BOUNDARY_SRC = "07_가공데이터/경계_인천_행정동.geojson"
BOUNDARY_DST = "data/geo/SGIS_행정동경계_2025_2Q_인천.geojson"


def load_manifest() -> dict:
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def stored_path(rel: str, stored: str) -> str:
    """매니페스트 stored 값 → 저장소 안 실제 경로."""
    if stored == "sources/team_v0.5":
        return os.path.join(SOURCE_DIR, rel)
    if stored == "sources/team_v0.3":
        return os.path.join(V03_DIR, rel)
    return os.path.join(ROOT, stored)


def verify() -> list[str]:
    """차이 목록 (빈 리스트 = 동일). 저장소에 두지 않는 파일(stored = null)은 검사하지 않는다."""
    if not os.path.isdir(SOURCE_DIR):
        return [f"원본 폴더 없음: {SOURCE_DIR}"]
    files = load_manifest()["bundle"]
    errs = []
    for rel, v in files.items():
        path = stored_path(rel, v["stored"])
        if not os.path.isfile(path):
            errs.append(f"없음: {rel} ({v['stored']})")
        elif sha256(path) != v["sha256"]:
            errs.append(f"변경됨: {rel} ({v['stored']})")
    want = {rel for rel, v in files.items() if v["stored"] == "sources/team_v0.5"}
    errs += [f"추가됨: {p}" for p in sorted(set(scan(SOURCE_DIR)) - want)]
    return errs


def create(delivered: str) -> None:
    if os.path.exists(MANIFEST):
        sys.exit(f"이미 있음: {MANIFEST} — 덮어쓰지 않는다.")
    bundle_dir = os.path.join(delivered, BUNDLE)
    bundle = {}
    for rel, v in scan(bundle_dir).items():
        same_v03 = os.path.isfile(os.path.join(V03_DIR, rel)) and sha256(os.path.join(V03_DIR, rel)) == v["sha256"]
        if rel == BOUNDARY_SRC:
            stored = BOUNDARY_DST
        elif not rel.startswith("04_엔진코드/") and same_v03:
            stored = "sources/team_v0.3"
        else:
            stored = "sources/team_v0.5"
        bundle[rel] = {**v, "stored": stored}
    outer = {fn: {"sha256": sha256(os.path.join(delivered, fn)), "same_as": f"{BUNDLE}/{fn}"}
             for fn in sorted(os.listdir(delivered)) if fn.endswith(".md")}
    puzzle = {rel: {**v, "stored": None} for rel, v in scan(os.path.join(delivered, PUZZLE)).items()}
    data = {"source": "sources/team_v0.5", "engine_version": "mvp-0.5", "delivered": "2026-10-23 (퍼즐 기록 2026-10-24)",
            "created": date.today().isoformat(),
            "note": "bundle = 엔진 번들 전체. stored 는 저장소 안 위치(team_v0.3 과 같은 파일은 그쪽을 가리킨다). "
                    "puzzle 은 해시만 — 저장소·사이트·API·공개 fixture 에 넣지 않는다.",
            "outer": outer, "bundle": bundle, "puzzle": puzzle}
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"created {MANIFEST} (bundle {len(bundle)}, puzzle {len(puzzle)})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "create" and len(sys.argv) == 3:
        create(sys.argv[2])
    elif cmd == "verify":
        errs = verify()
        for e in errs:
            print("  ", e)
        print("source v0.5 integrity:", "OK" if not errs else f"FAIL ({len(errs)})")
        sys.exit(1 if errs else 0)
    else:
        sys.exit(__doc__)
