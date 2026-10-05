import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


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
