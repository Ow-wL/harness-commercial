import time

import pytest


@pytest.fixture(scope="session")
def real_service():
    """세션 공유 실제 AnalysisService (RuntimeData 1회 로드, 약 4s). 이후 API 테스트(3-3·3-4)도 이것을 주입한다."""
    from scoring_engine.service import AnalysisService
    return AnalysisService()


def wait_for(predicate, timeout=10.0, interval=0.01):
    """background warm 처럼 다른 thread 의 진행을 기다린다. 시간 안에 안 되면 마지막 값을 돌려준다."""
    end = time.perf_counter() + timeout
    while time.perf_counter() < end:
        value = predicate()
        if value:
            return value
        time.sleep(interval)
    return predicate()
