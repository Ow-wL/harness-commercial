# CLAUDE.md

## Project Goal
인천 지역에서 사용자가 지도상의 위치와 업종을 선택하면 기존 v0.3 scoring engine을 사용하여 상권을 분석하는 웹 애플리케이션이다.
현재 단계: Harness 구축 완료, 웹 기능 없음. 다음 작업은 `docs/TASKS.md` 참고.

## Source of Truth
- `sources/team_v0.3/`는 팀원이 전달한 원본이며 **절대 수정하지 않는다** (수정·삭제·파일 추가·`__pycache__` 생성 포함).
  - 무결성: `tests/manifests/source_team_v0.3.sha256.json` (하네스 구축 시점 해시). `python scripts/manifest.py verify`
  - 원본 폴더에서 Python을 돌릴 때는 `PYTHONDONTWRITEBYTECODE=1` (check 스크립트가 설정한다).
  - **원본 `run_all.py`를 실행하지 않는다** — `05_분석결과`(golden 원본)를 덮어쓴다.
- 점수 계산의 기준은 엔진 v0.3(`mvp-0.3`). 웹 실행용 사본은 `scoring_engine/v0_3/` (원본과 바이트 동일, 수정 금지).

## Critical Rules
- 기존 scoring 결과를 임의로 변경하지 않는다.
- scoring logic 변경에는 regression test가 반드시 필요하다. 변경은 엔진 버전 변경으로만 한다 (`docs/DECISIONS.md` D-006).
- UI 요구사항 때문에 scoring logic을 변경하지 않는다. 필요한 변환은 엔진 밖(adapter/service)에서 한다.
- Frontend는 scoring engine을 직접 호출하지 않는다.
- Frontend → Backend → Analysis Context Builder → Scoring Engine 구조를 사용한다.
- secret/API key를 commit하지 않는다 (`.env`는 `.gitignore`. 지도 API 키 포함).
- raw/processed 데이터 컬럼을 임의로 변경하지 않는다 (`data/runtime/`은 원본 `07_가공데이터`와 바이트 동일해야 한다).
- 테스트 실패를 skip/delete하여 해결하지 않는다. golden fixture를 새 출력으로 덮어써서 통과시키지 않는다.
- 작업 전에 관련 코드를 먼저 탐색한다.
- 큰 리팩토링보다 작은 변경을 우선한다.

### 이 저장소에서 특히 주의할 것
- 엔진 모듈은 평면 import(`import config as C`)를 쓴다. 최상위 모듈 이름 `config`, `scoring`, `access`, `radius_demand`, `etl_location`, `etl_rent`, `demo`, `test_weights`, `test_access`를 새로 만들지 않는다.
- 엔진은 `scoring_engine` 패키지를 통해서만 import한다: `from scoring_engine.service import AnalysisService`.
- 요청마다 CSV를 다시 읽거나 비교 모집단(`build_reference`, 입지 reference)을 다시 계산하지 않는다. `RuntimeData` 1회 로드 + `ReferenceCache` 재사용 (`docs/ARCHITECTURE.md` 캐시 경계).
- `config.AGE_PROFILE`을 바꿔도 점수는 안 바뀐다 — 타겟 인구는 `패널_통합.csv`에 ETL로 미리 계산돼 있다 (`docs/ENGINE.md`).
- Windows: 파일은 항상 `encoding=` 명시 (CSV `utf-8-sig`, 학교·임대료 원본 `cp949`, JSON `utf-8`).

## Development Loop
Explore → Plan → Implement → Test → Verify → Report

## Definition of Done
코드 작성만으로 완료로 판단하지 않는다. 관련 테스트와 전체 check가 성공해야 완료다.

```powershell
.\scripts\check.ps1          # Windows (전체, 약 1분 20초)
```
```bash
scripts/check.sh             # bash
```
`--fast`는 golden regression을 뺀 작업 중 확인용이며 완료 판정에 쓰지 않는다.
보고 시 실패·SKIP 단계를 숨기지 않는다.

## 문서
- `docs/ARCHITECTURE.md` 데이터 흐름, 목표 구조, 캐시 경계, 하드코딩 목록
- `docs/ENGINE.md` 엔진 진입점·입출력·변경 금지 영역
- `docs/DATA.md` 런타임 데이터 파일과 컬럼
- `docs/TASKS.md` 다음 작업 (작은 단위)
- `docs/DECISIONS.md` 기술 결정 기록
