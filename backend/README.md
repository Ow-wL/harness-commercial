# backend (예정: FastAPI)

아직 구현하지 않았다. 순서와 범위는 `docs/TASKS.md` 3장.

원칙
- 엔진은 `scoring_engine.service.AnalysisService`로만 호출한다. 엔진 결과(JSON)를 바꾸지 않는다.
- 시작 시 `RuntimeData` 1회 로드 + `ReferenceCache.warm()`. 요청마다 CSV 로드·reference 재계산 금지.
- 테스트는 `backend/` 아래에 두면 `scripts/check.py`가 `backend/app` 또는 `backend/pyproject.toml`이 생기는 순간 자동 실행한다.
