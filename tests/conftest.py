import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 엔진은 프로세스당 하나(D-024). 기본(v0_3) 실행은 v0.4·v0.5 폴더를 모으지 않고,
# v0_4·v0_5 실행은 루트의 v0.3 테스트(golden v0.3·사본 무결성 등)와 다른 버전 폴더를 모으지 않는다.
_ENGINE = os.environ.get("SCORING_ENGINE_VERSION", "v0_3") or "v0_3"
_VERSION_DIRS = ("engine_v0_4", "engine_v0_5", "engine_v0_5_1")
if _ENGINE in ("v0_4", "v0_5", "v0_5_1"):
    collect_ignore_glob = ["test_*.py"]
    collect_ignore = [d for d in _VERSION_DIRS if d != f"engine_{_ENGINE}"]
else:
    collect_ignore = list(_VERSION_DIRS)              # 폴더째 제외(그 conftest 도 읽지 않는다)


@pytest.fixture(scope="session")
def service():
    """런타임 데이터 1회 로드 + 참조 캐시를 공유하는 서비스 (세션당 1개)."""
    from scoring_engine.service import AnalysisService
    return AnalysisService()


@pytest.fixture(scope="session")
def bupyeong_results(service):
    """부평역 29개 업종 전체 결과 (최초 1회 약 1분 — build_reference 29회)."""
    from scoring_engine.context import BUPYEONG_STATION
    return service.analyze_all(BUPYEONG_STATION)
