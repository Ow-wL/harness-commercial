# CLAUDE.md

## Project Goal
인천 지역에서 사용자가 지도상의 위치와 업종을 선택하면 버전 선택형 scoring engine으로 상권을 분석하는 웹 애플리케이션이다. 현재 운영은 v0.4(300·500·1,000m)다.
현재 운영 상태(2026-10-19): 사용자 승인으로 `1020200`의 A3 다크·UI 간소화·v0.4 반경 선택을 배포했다. 무트래픽 검증과 warm 87/87 완료 후 100% 전환했고, 이전 리비전은 복구용으로 보존했다. 배포 검증 범위와 미완료 항목은 `docs/DEPLOYMENT_2026-10-19.md`. 아래 기존 단위의 운영 미배포 표기는 배포 전 기록이다. 모바일 지도 시트 참고 주소 한 줄의 production CSS 차이가 후속으로 남아 있다.
구현·검수 이력: A3 지도 탐색형·블루안(`DESIGN.md` §19, D-023), 8-B1 단일·8-B2 비교 지도 맞춤, 8-DK·8-L·8-C1a~d·8-P 및 추가 UI 간소화, 8-D1~8-D3 반경 선택을 저장소에 반영했고 이번 배포에 포함했다.
2026-10-19 개선 계획(`docs/IMPROVEMENT_PLAN_2026-10.md`) 승인 뒤 묶음 A(테마 전환·구 경계·외곽선, D-025), 묶음 C(데이터 버전 구조, D-006 개정), 묶음 B(업종 글리프·외부 검색 링크, D-026), 묶음 D(첫 방문 안내 코치마크, D-027)를 master에 커밋했다(`docs/TASKS.md` 9장, Codex 검수 지적 수정 뒤 재검수 통과 9-R1·9-R2) — **운영 미배포**. 다크 스타일 지명 색 재발행은 사용자 작업으로 남아 있다.
2026-10-24 팀 전달 엔진 v0.5와 지오비전 퍼즐 조사 의견을 반영했다(D-028, `docs/ENGINE_V0_5.md`, `docs/TASKS.md` 10장) — 저장소 반영, **운영 미배포**(코드 기본 엔진은 v0.3 그대로). 운영 엔진은 v0.5.1로 확정(2026-10-25), 사전 검증·배포/복구 절차 `docs/DEPLOYMENT_PLAN_v0_5_1.md`.
후속 작업은 `docs/TASKS.md` 현재 운영 상태와 8·9·10장 참고. 8-D2c의 정식 반복·동시 부하 성능 연구는 미완료이며, 이번 배포 전에는 사용자 승인에 따라 1 CPU·1Gi Linux 컨테이너 및 무트래픽 Cloud Run 실측을 각 1회 진행했다. 각 새 단위는 사용자 지시에 따라 진행한다.

## Source of Truth
- `sources/team_v0.3/`는 팀원이 전달한 원본이며 **절대 수정하지 않는다** (수정·삭제·파일 추가·`__pycache__` 생성 포함).
  - 무결성: `tests/manifests/source_team_v0.3.sha256.json` (하네스 구축 시점 해시). `python scripts/manifest.py verify`
  - 원본 폴더에서 Python을 돌릴 때는 `PYTHONDONTWRITEBYTECODE=1` (check 스크립트가 설정한다).
  - **원본 `run_all.py`를 실행하지 않는다** — `05_분석결과`(golden 원본)를 덮어쓴다.
- 점수 계산의 기준은 엔진 v0.3(`mvp-0.3`). 웹 실행용 사본은 `scoring_engine/v0_3/` (원본과 바이트 동일, 수정 금지).
- 엔진 v0.4(`mvp-0.4`, D-024)는 v0.3 + 분석 반경(300·500·1,000m) 최소 diff 사본 `scoring_engine/v0_4/`. 허용 diff 밖으로 고치지 않는다(`tests/test_engine_v0_4_diff.py`). 엔진은 프로세스당 하나 — `SCORING_ENGINE_VERSION=v0_3(기본)|v0_4|v0_5`.
- 엔진 v0.5(`mvp-0.5`, D-028)는 팀 전달 v0.5(`sources/team_v0.5/`, **수정 금지** — `python scripts/source_v0_5.py verify`) 사본 + 같은 반경 최소 diff `scoring_engine/v0_5/`(`tests/test_engine_v0_5_diff.py`). 인구 면적 배분 경계 `data/geo/SGIS_행정동경계_2025_2Q_인천.geojson`(지도 경계와 별개). 지오비전 퍼즐 수치로 점수·계수를 바꾸지 않고, 퍼즐 원자료·수치를 사이트·API·공개 fixture에 넣지 않는다(`docs/ENGINE_V0_5.md`). 팀 원본 `run_all.py`도 실행하지 않는다(재현은 별도 작업 사본에서).
- 엔진 v0.5.1(`mvp-0.5.1`, D-029) = `v0_5` + 분동 인구비 이중 적용 결함 수정(팀 엔진 유래) `scoring_engine/v0_5_1/`(`tests/test_engine_v0_5_1_diff.py`). v0.5와 golden v0.5(팀 결과)는 결함째 보존한다. `SCORING_ENGINE_VERSION=v0_3(기본)|v0_4|v0_5|v0_5_1`.

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
- 엔진 모듈은 평면 import(`import config as C`)를 쓴다. 최상위 모듈 이름 `config`, `scoring`, `access`, `radius_demand`, `etl_location`, `etl_rent`, `demo`, `etl_boundary`, `etl_sgis`, `test_weights`, `test_access`, `test_agglomeration`, `test_v05`를 새로 만들지 않는다.
- 엔진은 `scoring_engine` 패키지를 통해서만 import한다: `from scoring_engine.service import AnalysisService`.
- 요청마다 CSV를 다시 읽거나 비교 모집단(`build_reference`, 입지 reference)을 다시 계산하지 않는다. `RuntimeData` 1회 로드 + `ReferenceCache` 재사용 (`docs/ARCHITECTURE.md` 캐시 경계).
- `config.AGE_PROFILE`을 바꿔도 점수는 안 바뀐다 — 타겟 인구는 `패널_통합.csv`에 ETL로 미리 계산돼 있다 (`docs/ENGINE.md`).
- Windows: 파일은 항상 `encoding=` 명시 (CSV `utf-8-sig`, 학교·임대료 원본 `cp949`, JSON `utf-8`).

## Development Loop
Explore → Plan → Implement → Test → Verify → Report

## Definition of Done
코드 작성만으로 완료로 판단하지 않는다. 관련 테스트와 전체 check가 성공해야 완료다.

```powershell
.\scripts\check.ps1          # Windows (전체, 약 10분 — engine v0_4 단계 약 5분 포함)
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
- `docs/reports/` 주간 보고 (예: `2026-W41.md`)

## gstack
gstack(v1.91.25.0)이 전역 설치되어 있다: `~/.claude/skills/gstack` (Windows: Git Bash + Bun + Node, 번들 브라우저 사용).
- 웹 브라우징은 gstack의 `/browse` skill을 사용한다. `mcp__claude-in-chrome__*` 도구는 쓰지 않는다 (gstack 공식 설치 지침).
- 사용 가능한 skill: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /design-shotgun, /design-html, /review, /deslop-shared-libs, /test-audit, /ship, /land-and-deploy, /canary, /benchmark, /browse, /connect-chrome, /qa, /qa-only, /design-review, /scrape, /setup-browser-cookies, /setup-deploy, /setup-gbrain, /retro, /investigate, /document-release, /document-generate, /codex, /cso, /autoplan, /plan-devex-review, /devex-review, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn
- **이 프로젝트의 규칙이 gstack skill보다 우선한다.** gstack skill을 쓰더라도 위 Source of Truth / Critical Rules / Definition of Done을 따른다.
  `sources/`, `scoring_engine/v0_3/`, `data/runtime/`, `tests/golden/`은 어떤 skill로도 수정하지 않으며, 완료 판정은 `scripts/check` 통과다(v0.4·v0.5 사본은 허용 diff 테스트 범위 안에서만).
- Windows 설치는 파일 복사 방식이다. gstack을 `git pull`한 뒤에는 `cd ~/.claude/skills/gstack && ./setup`을 다시 실행한다 (또는 `/gstack-upgrade`).

## Communication

- 사용자에게 보내는 설명, 질문, 진행상황, 최종 보고는 기본적으로 한국어로 작성한다.
- 코드, 명령어, 파일명, API 필드명, 라이브러리/제품명, 원문 오류 메시지는 필요하면 원문을 유지한다.
- 영어 문서나 도구 출력을 참고했더라도 사용자용 요약과 최종 보고는 한국어로 작성한다.
- 사용자가 명시적으로 다른 언어를 요청한 경우에만 그 언어를 사용한다.
