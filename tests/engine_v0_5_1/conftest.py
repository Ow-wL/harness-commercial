"""
엔진 v0.5.1 테스트 — SCORING_ENGINE_VERSION=v0_5_1 프로세스에서만 돈다(한 프로세스에 엔진 하나, D-024·D-029).

  SCORING_ENGINE_VERSION=v0_5_1 python -m pytest -q tests/engine_v0_5_1      (scripts/check.py 의 "pytest: engine v0_5_1" 단계)
"""
import os

import pytest

if os.environ.get("SCORING_ENGINE_VERSION") != "v0_5_1":
    pytest.exit("tests/engine_v0_5_1 는 SCORING_ENGINE_VERSION=v0_5_1 로 실행한다", returncode=4)
