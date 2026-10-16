import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 엔진은 프로세스당 하나(D-024). 기본(v0_3) 실행은 v0.4 폴더를 모으지 않고,
# v0_4 실행은 루트의 v0.3 테스트(golden v0.3·사본 무결성 등)를 모으지 않는다.
if os.environ.get("SCORING_ENGINE_VERSION", "v0_3") == "v0_4":
    collect_ignore_glob = ["test_*.py"]
else:
    collect_ignore = ["engine_v0_4"]          # 폴더째 제외(그 conftest 도 읽지 않는다)


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
