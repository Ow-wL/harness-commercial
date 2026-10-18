"""
원본 ETL 실행 사본을 원본 `__main__` 그대로 실행한다 (평면 import config 를 엔진 디렉터리에서 찾도록 _bootstrap 을 먼저 거친다).

  python scripts/etl/run_etl.py prep <받은 파일.csv> [--incheon]       공공데이터 CSV 첫 진단 / 인천 추출
  python scripts/etl/run_etl.py etl_shops <상가_인천.csv> --out-dir <dir>
  python scripts/etl/run_etl.py etl_stability <인허가_PC방_전국.csv>     (출력은 현재 디렉터리)
  ...

원본 스크립트는 출력 파일을 현재 디렉터리(또는 자기 인자)에 쓴다 — 저장소 안(data/runtime 등)에서 실행하지 않는다.
버전 생성은 build_version.py 가 같은 함수를 import 해서 한 번에 한다 (docs/DATA_VERSIONING.md).
"""
from __future__ import annotations

import os
import runpy
import sys

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ETL_DIR)
import _bootstrap  # noqa: E402,F401

NAMES = ("prep", "etl_shops", "etl_pop", "etl_sgis", "etl_move", "etl_stability", "etl_stability_food")


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in NAMES:
        print(__doc__)
        print("이름:", ", ".join(NAMES))
        return 2
    path = os.path.join(ETL_DIR, argv[1] + ".py")
    sys.argv = [path] + argv[2:]
    runpy.run_path(path, run_name="__main__")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
