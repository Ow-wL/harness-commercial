# Decisions

## D-001 원본은 읽기 전용, 해시로 보호 (2026-10-05)
`sources/team_v0.3/` 전체 75개 파일을 하네스 구축 전에 해시했다 (`tests/manifests/source_team_v0.3.sha256.json`, 작업 전 스냅샷과 일치 확인). check가 매번 검증한다. 원본 폴더 Python 실행 시 `PYTHONDONTWRITEBYTECODE=1`.
참고: 작업 지시서의 경로는 `source/team_v0.3/`이지만 실제 폴더는 `sources/team_v0.3/`이다. 실제 경로를 따랐다.

## D-002 canonical 엔진은 바이트 동일 사본 (import 수정 안 함)
엔진 파일의 평면 import(`import config as C`)를 패키지 상대 import로 고치면 원본과 diff가 생기고 "같은 엔진"임을 해시로 증명할 수 없다. 대신 `scoring_engine/__init__.py`가 `v0_3/`를 `sys.path`에 올리고, 같은 모듈 객체를 `scoring_engine.<name>`으로도 등록한다.
복사 대상: 런타임 모듈 6개(scoring, config, access, radius_demand, etl_location, etl_rent) + 원본 테스트 실행에 필요한 demo.py, test_weights.py, test_access.py. ETL 전용 스크립트(etl_shops/pop/sgis/move/stability*, prep)는 원본에만 둔다.

## D-003 run_all.py 로직은 adapter(service.py)로 옮기고, 하드코딩은 SiteContext로 분리
엔진 바깥의 입력 조립·후처리는 `scoring_engine/service.py`가 run_all과 같은 순서로 수행한다. 동일성은 29개 업종 전체 JSON 비교로 검증했다 (29/29 일치).
`SiteContext`는 하드코딩 값을 명시 파라미터로 바꾼 것일 뿐이며 Location Resolver가 아니다. 검증된 컨텍스트는 `BUPYEONG_STATION` 하나.

## D-004 엔진 모듈 이름 예약
평면 import 때문에 `config`, `scoring`, `access`, `radius_demand`, `etl_location`, `etl_rent`, `demo`, `test_weights`, `test_access`는 프로젝트 전역에서 최상위 모듈 이름으로 쓰지 않는다. `scoring_engine` import 시 모듈 경로를 검사해 가로채이면 ImportError.

## D-005 Golden = 원본 05_분석결과 그대로, 비교는 전체 JSON + 순위표
`tests/golden/v0.3/`은 원본 결과의 바이트 동일 사본(해시 검사). 비교는 엔진 출력 전체를 재귀 비교한다 (필수 항목만 따로 한 번 더).
허용오차: 상대·절대 1e-9 — 부동소수점 잡음만 허용. 점수는 0.1 단위로 반올림돼 있으므로 실질 변화는 반드시 실패한다.
변이 검증: 그룹 가중치 ±0.01, 병목 기준 25→35, 타겟 연령 34→35세 모두 golden 실패로 검출됨.

## D-006 Golden 변경은 엔진 버전 변경일 때만
v0.3 golden·매니페스트는 덮어쓰지 않는다 (`scripts/manifest.py create`는 기존 파일이 있으면 거부). 점수 공식·설정·데이터를 바꾸면: 새 엔진 디렉터리(`scoring_engine/v0_4/`), 새 golden(`tests/golden/v0.4/`), 변경 이유를 여기 기록, v0.3 대비 차이 보고서. v0.3 golden 테스트는 v0.3 엔진에 대해 계속 통과해야 한다.

## D-007 비교 모집단은 프로세스 메모리 캐시부터
`ReferenceCache`: 업종별 경쟁성 reference(29), 유인시설 집합별 입지 reference(14). 디스크 캐시는 아직 없다 — 멀티 워커나 콜드 스타트가 문제될 때 `data/cache/`에 도입 (키: 엔진 버전 + 데이터 해시 + 반경 + 업종/유인시설 집합). 최적화(예: 업종 무관 수요 계산 공유)는 golden 동일성 확인 후에만.

## D-008 실행 환경 고정
프로젝트 로컬 `.venv`, `requirements.txt`에 golden을 재현한 버전 고정 (pandas 2.3.3, numpy 2.2.6, scipy 1.15.3, openpyxl 3.1.5, pytest 9.1.1, Python 3.10.11). 전역 Python은 건드리지 않는다. 검증은 `scripts/check.py` 하나로 모으고 PowerShell/bash 래퍼를 둔다. 아직 없는 backend/frontend 단계는 SKIP으로 표시(실패로 숨기지 않음).
