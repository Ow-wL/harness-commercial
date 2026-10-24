"""
엔진 v0.5·v0.5.1 golden fixture 생성 (부평역 legacy 지점, 29개 업종, D-028·D-029).

  SCORING_ENGINE_VERSION=v0_5 python scripts/golden_v0_5.py      → tests/golden/v0.5/r300·r1000 (500m 는 팀 결과 사본)
  SCORING_ENGINE_VERSION=v0_5_1 python scripts/golden_v0_5.py    → tests/golden/v0.5.1/r500·r300·r1000 (팀 결과 없음 — 웹 수정판)

- 500m 기준은 팀 전달 v0.5 결과(tests/golden/v0.5/json = sources/team_v0.5/05_분석결과 사본)를 그대로 쓴다.
  팀 run_all 에는 반경 선택이 없으므로 300·1,000m 는 웹 사본(scoring_engine/v0_5 = 팀 엔진 + 반경 최소 diff)이 만든다.
- 이미 있는 파일은 덮어쓰지 않는다 (tests/golden/README.md 규칙 1). 다시 만들려면 사람이 디렉터리를 지우고
  이유를 docs/DECISIONS.md 에 남긴다.
- 출력: tests/golden/v0.5/r{반경}/json/full_{업종명}.json (UTF-8, indent 2, 파일명은 팀 run_all 규칙).
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
# 엔진 키 → (golden 디렉터리, 만들 반경)
TARGETS = {"v0_5": ("v0.5", (300, 1000)), "v0_5_1": ("v0.5.1", (500, 300, 1000))}


def safe_name(biz_name: str) -> str:
    """팀 run_all.py 의 JSON 파일명 규칙."""
    return re.sub(r'[/\:*?"<>|]', "_", biz_name).replace(" ", "")


def golden_path(version_dir: str, radius: int, biz_name: str) -> str:
    return os.path.join(ROOT, "tests", "golden", version_dir, f"r{radius}", "json", f"full_{safe_name(biz_name)}.json")


def main() -> int:
    import scoring_engine
    if scoring_engine.ENGINE_KEY not in TARGETS:
        print(f"SCORING_ENGINE_VERSION={'|'.join(TARGETS)} 로 실행해야 한다", file=sys.stderr)
        return 2
    version_dir, radii = TARGETS[scoring_engine.ENGINE_KEY]
    from scoring_engine import config as C
    from scoring_engine.context import BUPYEONG_STATION
    from scoring_engine.service import AnalysisService

    paths = {(r, b): golden_path(version_dir, r, C.CODE_NAME[b]) for r in radii for b in C.CODE_NAME}
    existing = [p for p in paths.values() if os.path.exists(p)]
    if existing:
        print(f"이미 있는 golden {len(existing)}개 — 덮어쓰지 않는다 (예: {existing[0]})", file=sys.stderr)
        return 1
    svc = AnalysisService()
    for (r, biz), path in paths.items():
        res = svc.analyze(BUPYEONG_STATION, biz, radius_m=r)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(res, f, ensure_ascii=False, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
            f.write("\n")
    print(f"ok {len(paths)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
