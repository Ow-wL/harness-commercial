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

## D-009 행정동 경계: 2026-07 경계를 직접 사용, 2024→2026 crosswalk는 검증용 (2026-10-05)
eng review D4(2024 경계 + crosswalk)를 데이터 비교 결과에 따라 변경했다 (사용자 승인).
- 비교: 2024 최종(ver20241231) 인천 156개 ↔ 2026-07-01(ver20260701) 158개를 면적 겹침으로 비교. 154개는 양방향 겹침 1.0·이름 동일(코드만 변경, 예: 신포동 28110530→28125510으로 뒷자리도 바뀜), 2개는 분동: 중구 운서동 28110628 → 영종구 운서1동 28155540(87.5%)·운서2동 28155550(12.5%), 서구 아라동 28260740 → 검단구 아라1동 28290570(60.4%)·아라2동 28290580(39.6%). 통합·경계 변경·이름 변경은 없음.
- 2024 polygon에는 분동 경계가 없어 crosswalk만으로 4개 동을 판정할 수 없다 → resolver 데이터는 2026 경계. 2024 경계와 crosswalk는 "2026 경계가 2024 경계와 무엇이 같고 다른가"의 기계적 근거로 보존한다.
- 2026 경계 코드 158개 == runtime panel 158개. 이름은 6개 동이 구분자만 다름(경계 '·', panel '.'). 조인은 코드로, 표시 이름은 panel 표기, 원문은 `경계_행정동명`에 보존. runtime은 수정하지 않는다.
- 출처는 통계청 SGIS 경계의 2차 가공본(github.com/vuski/admdongkor, CC BY 4.0). SGIS 공식 shp는 로그인·자료신청이 필요해 사용하지 않았다. 공식 2026 기준 파일을 받을 수 있게 되면 교체한다 (TASKS 보류).
- 위치: `data/geo/` (data/runtime 아님, D-001 무결성 규칙 유지). 원본 `data/geo/raw/`는 git 제외, url·sha256은 `tests/manifests/geo.sha256.json`. 가공은 `scripts/build_geo.py`(결정적 출력, 매니페스트 덮어쓰기 거부, 허용되지 않은 관계가 나오면 오류). 의존성 shapely 2.1.2 추가.

## D-010 행정동 경계 ↔ 점포 라벨 일치율 floor (2026-10-05, eng review D11)
측정: `data/runtime/인천_상가_정제.csv` 전체 135,750개 점포 좌표를 `LocationResolver`로 판정해 점포의 `행정동코드`와 **코드로** 비교했다 (이름 표기 무관). 샘플링 없음 (전수 resolve 약 3.5초 → 테스트도 전수). resolve 실패(경계 밖)는 불일치로 센다.
- 결과: resolve 135,698 / 일치 131,168 / 불일치 4,530 / 실패 52 → 전체 96.62%.
- 알려진 충돌 (사용자 승인으로 등록): 남동구 `구월3동`(28200521) 라벨 점포 3,793개 중 2,486개(65.5%)가 polygon상 `구월1동`(28200510). 구월1동 polygon 서쪽 띠(경도 126.7007~126.7079)에 모여 있고 서로 다른 좌표 439개, 구월3동 polygon에서 중앙값 194m·최대 822m. 같은 구역에 구월1동 라벨 점포도 있다. 2024·2026 polygon이 같아 이번 개편과 무관. 경계(SGIS 가공본)와 점포 라벨 중 어느 쪽이 맞는지는 데이터로 판단할 수 없다 → TASKS 1-5a 팀 확인. 이 쌍은 분모에서 빼고, 건수(2,486)를 넘으면 실패시킨다.
- 충돌 제외 결과 (n=133,264): 전체 98.427%. 구별 — 강화군 99.330, 검단구 98.365, 계양구 99.636, 남동구 98.986, 미추홀구 97.598, 부평구 96.199, 서해구 99.897, 연수구 99.408, 영종구 99.010, 옹진군 99.336, 제물포구 96.410 (%).
- 나머지 불일치 2,044건은 경계 근접: 라벨 polygon까지 중앙값 30m, 78%가 100m 이내, 99.9%가 이웃 동으로 판정. 분동 지역은 운서1·2동·아라2동 100%, 아라1동 356/360. resolve 실패 52건은 영종·옹진 해안선 바로 밖이 대부분(중앙값 45m), 1건은 69.8km 떨어진 좌표 품질 문제.
- 부평역 힌트: golden 좌표는 polygon상 부평1동이며 부평6동 경계까지 17m. 최근접 점포 50개는 라벨·polygon 모두 부평6동 → 경계 근접 유형이지 라벨/경계 충돌이 아니다.
- floor: 측정값 − 2%p를 0.1%p 단위로 내림. 전체 0.964, 구별 강화군 0.973·검단구 0.963·계양구 0.976·남동구 0.969·미추홀구 0.955·부평구 0.941·서해구 0.978·연수구 0.974·영종구 0.970·옹진군 0.973·제물포구 0.944. 2%p는 데이터가 해시로 고정된 상태에서 resolver·경계의 작은 변경(경계선 tie-break 등)은 허용하고, 구 안의 큰 동 하나가 틀리는 것은 잡는 폭이다.
- 동 단위 안전망 (D11에 추가): 구 floor로는 점포가 적은 동 18개가 통째로 틀려도 잡히지 않는다. 각 동 라벨 점포의 과반(≥ 0.5)이 자기 동으로 판정돼야 한다. 측정 최저 0.754 (제물포구 송림1동, n=61).
- 결정성: seed 20261005, 구별 200개(총 2,200개)를 고정 추출해 새 resolver로 다시 판정 → 전수 판정과 동일해야 한다.
- 테스트: `tests/test_location_agreement.py`. floor를 낮추려면 새 측정과 이 항목 갱신이 필요하다.

## D-011 ContextBuilder: 좌표 → SiteContext 필드 규칙 (2026-10-05, TASKS 1-7)
`scoring_engine/location.py`의 `ContextBuilder.build(lat, lng)`. 필드별 엔진 쪽 의미(service.py)와 채우는 값:
| SiteContext | service.py 에서 쓰는 곳 | 값 |
|---|---|---|
| `lat`, `lng` | `radius_profile`, `site_profile`, `Site` 좌표 | 검증된 입력 좌표 (float) |
| `gu_code` | 시장성 패널 `시군구코드` 행 (시장성) | resolve 된 `행정동코드[:5]` (시장성 패널 11개 코드와 일치 확인) |
| `gu_name` | 패널_통합 `시군구명` (고객성), 안정성 패널 `시군구` | runtime panel 시군구명 (안정성 패널 2종의 시군구명과 일치 확인) |
| `dong_name` | 패널_통합 `행정동명` (고객성 행) | runtime panel 행정동명 (코드로 연결, 이름 조인 안 함) |
| `rent_area` | `gugu_rent_per_sqm`, `rent_area` (안정성 S4) | 항상 `None` — 1-6 미결정. 좌표로 특별 처리하지 않는다 |
| `label` | `meta.query` = `"{label} 근처 {업종}"` | `"{시군구명} {행정동명}"`. 158개 동 × 29업종에서 업종 재해석 오류 0건 (eng review probe) |
- `NoDataNearby(LocationError)`: 반경 `config.RADIUS_M`(500m) 안 점포 0개 (eng review D8). 거리·반경·포함 조건(`<=`)은 엔진 `radius_demand.radius_profile`의 `n_all`과 같다 (테스트로 고정). 13.5만 점포 전체 haversine 1회 약 6ms → 추가 인덱스·캐시 없음.
- `ContextDataError(RuntimeError)`: resolver 코드가 runtime panel·시장성 패널에 연결되지 않는 내부 불일치. 입력 오류(`LocationError`, ValueError 계열)와 구분해 backend가 다르게 다룰 수 있게 한다.
- 부평역 좌표 → `부평구 부평1동` (golden과 같은 행정동). `rent_area=None`이라 안정성(S4)·종합은 golden과 다를 수 있고, 나머지 4개 관점은 같다 (테스트).
- 구월1동/3동 알려진 충돌(D-010)은 보정하지 않는다 — polygon 결과 그대로.

## D-012 Backend·Frontend 계획 결정 (2026-10-05, eng review D6·D9·D10·D12·D13)
eng review에서 승인됐지만 이 기록에 없던 결정. 구현 단계에서 세부를 확정하되 아래 경계는 바꾸지 않는다.
- API 테스트 (D6): API 응답의 엔진 부분 == `AnalysisService.analyze(ContextBuilder.build(lat, lng), biz)` (pass-through equality). golden 29/29는 `BUPYEONG_STATION` service regression에 남긴다. 좌표 요청은 golden의 `meta.query`("부평역 근처 …")·`rent_area="부평"`을 재현할 수 없고, 재현용 preset/테스트 전용 필드는 public API에 두지 않는다.
- 오류 계약 (D9): 입력·도메인 오류(요청 검증: 유한한 lat/lng, importance 1..5, weights ≥ 0 / `LocationError` 계열 / 잘못된 업종 / 엔진 가중치 `ValueError`)는 안정적인 4xx와 error code. 내부 오류(`ContextDataError`, `KeyError`, 그 밖의 예외)는 500 + `request_id`, traceback은 server log에만.
- Frontend 타입 (D10): Zod schema가 source of truth, TS 타입은 추론. 29개 golden JSON을 schema 테스트 fixture로 쓴다.
- Backend 테스트 (D12): `create_app(service, warm_biz)` factory로 공유 서비스 주입 + 쓰는 업종만 warm. 디스크 캐시(TASKS 2-2)는 조건부 유지.
- 시작 방식 (D13): `RuntimeData` 로드 후 서비스 시작, 29개 warm은 background, `/health`에 진행도, 미warm 업종은 on-demand.
