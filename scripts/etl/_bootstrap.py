"""
scripts/etl 공용 진입 — import 순서를 고정한다 (docs/DECISIONS.md D-004, docs/DATA_VERSIONING.md).

  1) 저장소 루트를 sys.path 에 넣고 `scoring_engine` 을 먼저 import 한다
     → 고른 엔진 디렉터리(scoring_engine/v0_3 | v0_4)가 sys.path 앞에 들어가고, 평면 import `config` 가 그 엔진의 config 로 해석된다.
  2) 그 다음 scripts/etl 을 sys.path 에 넣는다 — 원본 ETL 사본끼리의 평면 import (`from etl_shops import PANEL_CODES`,
     `import etl_stability as ES`) 용. 이 디렉터리에는 예약된 이름(config, scoring, access, radius_demand, etl_location, etl_rent,
     demo, test_weights, test_access)의 모듈을 두지 않는다 (tests/test_etl_scripts.py 가 검사).
  3) 콘솔 출력은 UTF-8 (원본 ETL 이 '⚠' 같은 문자를 print 한다 — Windows cp949 콘솔에서 UnicodeEncodeError 방지).

사용: 각 스크립트 첫 줄에서 `import _bootstrap` (같은 디렉터리라 스크립트로 실행하면 바로 찾는다), 또는
      run_etl.py 처럼 경로로 import.
"""
from __future__ import annotations

import os
import sys

ETL_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(ETL_DIR))
RESERVED_MODULES = ("config", "scoring", "access", "radius_demand", "etl_location", "etl_rent", "demo",
                    "test_weights", "test_access")

if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
import scoring_engine  # noqa: E402,F401  — 엔진 디렉터리를 sys.path 에 올린다 (평면 import config 의 출처)

# 엔진 다음에 넣는다. 예약 이름은 어차피 이 디렉터리에 없지만, 있더라도 엔진 모듈이 먼저 잡히지 않게 순서를 둔다.
if ETL_DIR not in sys.path:
    sys.path.insert(1, ETL_DIR)

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

ENGINE_DIR = scoring_engine.ENGINE_DIR
ENGINE_VERSION = scoring_engine.ENGINE_VERSION


def assert_config_is_engine() -> None:
    """평면 import config 가 고른 엔진 디렉터리의 파일인지 (가로채이면 ImportError)."""
    import config  # noqa: F401
    path = os.path.dirname(os.path.abspath(config.__file__))
    if path != ENGINE_DIR:
        raise ImportError(f"config 가 엔진이 아닌 곳에서 왔다: {path} (기대 {ENGINE_DIR})")


assert_config_is_engine()
