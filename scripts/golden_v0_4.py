"""
엔진 v0.4 golden fixture 생성 — 반경 300·1,000m (부평역 legacy 지점, 29개 업종).

  SCORING_ENGINE_VERSION=v0_4 python scripts/golden_v0_4.py

- 500m 기준은 v0.3 golden(tests/golden/v0.3)을 그대로 쓴다 (v0.4@500 은 `엔진버전`만 다르다 — tests/engine_v0_4).
- 이미 있는 파일은 덮어쓰지 않는다 (tests/golden/README.md 규칙 1). 다시 만들려면 사람이 디렉터리를 지우고
  이유를 docs/DECISIONS.md 에 남긴다.
- 출력 형식은 v0.3 golden 과 같다: tests/golden/v0.4/r{반경}/json/full_{업종명}.json (UTF-8, indent 2).
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
RADII = (300, 1000)


def golden_path(radius: int, biz_name: str) -> str:
    safe = biz_name.replace("/", "_")
    return os.path.join(ROOT, "tests", "golden", "v0.4", f"r{radius}", "json", f"full_{safe}.json")


def main() -> int:
    import scoring_engine
    if scoring_engine.ENGINE_KEY != "v0_4":
        print("SCORING_ENGINE_VERSION=v0_4 로 실행해야 한다", file=sys.stderr)
        return 2
    from scoring_engine import config as C
    from scoring_engine.context import BUPYEONG_STATION
    from scoring_engine.service import AnalysisService

    paths = {(r, b): golden_path(r, C.CODE_NAME[b]) for r in RADII for b in C.CODE_NAME}
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
