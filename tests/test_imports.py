"""Python import 확인 — 패키지와 엔진 평면 모듈이 올바른 파일에서 로드되는지."""
import os
import sys

import scoring_engine
from scoring_engine import ENGINE_DIR, ENGINE_MODULES, ENGINE_VERSION


def test_engine_modules_resolve_to_canonical_copy():
    for name in ENGINE_MODULES:
        path = os.path.abspath(sys.modules[name].__file__)
        assert os.path.dirname(path) == ENGINE_DIR, (name, path)


def test_dotted_and_flat_imports_share_module_objects():
    import config
    import scoring_engine.config as dotted
    assert dotted is config is scoring_engine.config


def test_service_layer_imports():
    from scoring_engine import context, reference, runtime, service  # noqa: F401
    assert hasattr(service, "AnalysisService")


def test_engine_version_constant_matches_engine_output():
    import inspect
    assert ENGINE_VERSION == "mvp-0.3"
    assert f'"엔진버전": "{ENGINE_VERSION}"' in inspect.getsource(scoring_engine.scoring.analyze)


def test_dependencies_importable():
    import numpy, openpyxl, pandas, scipy  # noqa: F401,E401
