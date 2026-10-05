"""
canonical 엔진(scoring_engine/v0_3) 단위 테스트 — v0.3 팀 테스트 14건을 canonical 사본에 대해 그대로 실행한다.
테스트 함수는 원본 test_weights.py / test_access.py 사본에서 가져온다 (다시 쓰지 않는다).
"""
import importlib

import pytest

import scoring_engine  # noqa: F401  (v0_3 를 sys.path 에 올린다)

_MODULES = [importlib.import_module("test_weights"), importlib.import_module("test_access")]
_CASES = [pytest.param(getattr(m, n), id=f"{m.__name__}::{n}")
          for m in _MODULES for n in sorted(dir(m)) if n.startswith("test_")]


def test_v03_test_count():
    assert len(_CASES) == 14     # test_weights 8 + test_access 6 — 줄면 누가 테스트를 지운 것이다


@pytest.mark.parametrize("fn", _CASES)
def test_v03_unit(fn):
    fn()
