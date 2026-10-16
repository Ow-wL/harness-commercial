"""
엔진 v0.4 테스트 — SCORING_ENGINE_VERSION=v0_4 프로세스에서만 돈다(한 프로세스에 엔진 하나, D-024).

  SCORING_ENGINE_VERSION=v0_4 python -m pytest -q tests/engine_v0_4      (scripts/check.py 의 "pytest: engine v0_4" 단계)

기본(v0_3) 실행에서는 루트 conftest 가 이 폴더를 모으지 않는다.
"""
import os

import pytest

if os.environ.get("SCORING_ENGINE_VERSION") != "v0_4":
    pytest.exit("tests/engine_v0_4 는 SCORING_ENGINE_VERSION=v0_4 로 실행한다", returncode=4)
