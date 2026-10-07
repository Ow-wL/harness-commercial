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
- **현재 생성 source (2026-10-06 갱신, D-017):** `data/geo/인천_행정동경계_2026.geojson` = vuski ver20260701 인천 158개 중 156개는 원본 좌표 그대로 + 구월1동(28200510)·구월3동(28200521)은 SGIS OpenAPI 행정경계 2025(`data/geo/SGIS_행정동경계_2025_남동구_구월.geojson`, commit)로 교정. 각 feature의 `경계_출처`에 기록. crosswalk는 교정 전 vuski 2024·2026 원본끼리. SGIS OpenAPI 경계의 최신 제공 연도는 2025(2026 요청은 `errCd=-200`)라 2026-07 개편 체계 전체 교체에는 아직 쓸 수 없다.
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
- ↓ 위 측정·known conflict 등록은 교정 전(2026-10-05) 기록이다. 구월 충돌은 아래 "1-5a 공식 확인 결과"와 D-017 교정으로 해소됐고, 현재 floor는 "교정 후 재측정"을 따른다.

### 1-5a 공식 확인 계획 (2026-10-06, 사용자 결정)
위 구월1동/구월3동 알려진 충돌을 **공식 현재 행정동** 기준으로 확인한다. 확인 전까지 production 보정은 하지 않는다.
- 확인 근거 (사용자 제공): ① 남동구 공식 연혁상 2015-07-31 구월1동 일부 구역이 구월3동으로 편입됐다. ② 문제 구간 인근 현재 주소 데이터에서도 구월3동 표기가 확인된다. 점포 라벨(구월3동) 쪽이 현재 행정동과 맞을 가능성을 시사하지만, 이것만으로 2차 가공 경계(vuski/admdongkor, D-009)가 틀렸다고 확정하지 않는다.
- 보류: 2차 가공 경계와 점포 라벨 중 어느 쪽을 고칠지는 공식 현재 행정동 확인 전까지 결정하지 않는다. 그동안 `ContextBuilder`는 polygon 결과(구월1동)를 그대로 쓰고, `tests/test_location_agreement.py`의 known conflict 등록과 건수 상한(2,486)을 유지한다.
- 절차:
  1. 대상: 충돌 점포 2,486개(서로 다른 좌표 439개)의 소재지 주소·좌표. `data/runtime/인천_상가_정제.csv`에서 읽기만 한다.
  2. 공식 기준: 2차 가공 경계·점포 라벨과 독립된 공식 자료로 현재 행정동을 판정한다 — 예: 행정안전부 도로명주소 건물 DB의 건물별 행정동코드, 또는 SGIS 공식 행정구역 경계(2026 기준, 자료신청).
  3. 기록: 사용한 자료명·기준일, 판정 분포(구월1동/구월3동/기타)와 건수를 이 항목에 남긴다.
  4. 결과별 후속 (각각 별도 결정·사용자 승인 후 진행):
     - 공식 = 구월3동 → 경계 쪽 문제. 공식 경계 확보 후 `data/geo` 교체(`scripts/build_geo.py` 재검증) 또는 보정 방식을 결정하고, D-010 floor·`ContextBuilder` 결과·구월 구역 관련 테스트 기대값을 다시 측정한다.
     - 공식 = 구월1동 → 라벨 쪽 문제. `data/runtime`은 원본 사본이라 수정하지 않으므로 known conflict를 유지하고 사유를 기록한다.
     - 혼재 → 구역을 나눠 다시 판단한다.
- 영향 범위: golden(`BUPYEONG_STATION`, 부평1동)과 엔진 v0.3은 이 확인과 무관하다.

### 1-5a 공식 확인 결과 (2026-10-06)
- 자료: 통계청 SGIS OpenAPI 역지오코딩 `/OpenAPI3/addr/rgeocode.json` `addr_type=20`(행정동). 좌표는 SGIS `transcoord`로 WGS84 → UTM-K(EPSG:5179). 재현: `python scripts/verify_guwol_admin_dong.py` (인증값·token·raw 응답은 출력·저장하지 않는다).
- 파이프라인 확인: 좌표변환 왕복 오차 ~0. 충돌과 무관한 컨트롤 polygon 내부점(구월2·구월4·간석1·부평1·연수1동)은 SGIS 판정 = polygon.
- 대상: 충돌 점포 2,486개 / 서로 다른 좌표 439개 (교정 전 경계의 구월1동 polygon 안 구월3동 라벨 점포).
- 결과: SGIS 조회 성공 439 / 실패 0. 좌표 439/439, 점포 2,486/2,486 = **남동구 구월3동**. 점포 라벨과 일치 100%, 교정 전 polygon(구월1동)과 일치 0%.
- 판단: 라벨이 맞고, 2차 가공 경계가 2015-07-31 구월1동 일부 → 구월3동 편입을 반영하지 않았다. → 위 계획의 "공식 = 구월3동 → 경계 쪽 문제" 경로. 경계 교정은 D-017.

### 교정 후 재측정 (2026-10-06, D-017 이후, floor 갱신)
- 측정 방법은 위와 같다(전수 135,750개, 코드 비교, resolve 실패는 불일치). known conflict 제외 없음.
- 결과: resolve 135,698 / 일치 133,654 / 불일치 2,044 / 실패 52 → 전체 **98.456%** (교정 전 96.625%, 충돌 제외 98.427%). 바뀐 판정은 2,487개 = 구월3동 라벨 2,486개(구월1동 → 구월3동, 전부 라벨과 일치하게 됨) + 구월2동 라벨 1개(구월1동 → 구월3동, 전후 모두 불일치). 나머지 133,263개는 판정이 같다.
- 구별: 남동구만 바뀜 — 22,794개 0.99096 (교정 전 충돌 제외 20,308개 0.98986). 다른 10개 구는 위 값과 같다. 남동구 동별: 구월3동 0.3414 → 0.9968 (3,793개 중 남은 불일치 12개 = 주안4동 9·간석1동 3, 경계 근접), 구월1동 1.0 유지, 남동구 다른 동 변화 없음.
- floor (같은 규칙: 측정 − 2%p, 0.1%p 내림): 전체 0.964 (0.98456, 변화 없음), 남동구 0.969 → **0.970** (0.99096), 다른 구 변화 없음. 동 단위 과반 안전망 최저값은 그대로 0.754 (송림1동).
- known conflict: `KNOWN_CONFLICTS`(분모 제외 + 상한 2,486)를 없애고, 해소 상태를 고정하는 `RESOLVED_CONFLICTS` = (구월3동 라벨 → 구월1동) 0건·(구월1동 라벨 → 구월3동) 0건으로 바꿨다. 구월3동 라벨 불일치 상한 12건(측정값) 테스트를 추가했다. 분모에서 빼는 구역은 더 이상 없다.

## D-011 ContextBuilder: 좌표 → SiteContext 필드 규칙 (2026-10-05, TASKS 1-7)
`scoring_engine/location.py`의 `ContextBuilder.build(lat, lng)`. 필드별 엔진 쪽 의미(service.py)와 채우는 값:
| SiteContext | service.py 에서 쓰는 곳 | 값 |
|---|---|---|
| `lat`, `lng` | `radius_profile`, `site_profile`, `Site` 좌표 | 검증된 입력 좌표 (float) |
| `gu_code` | 시장성 패널 `시군구코드` 행 (시장성) | resolve 된 `행정동코드[:5]` (시장성 패널 11개 코드와 일치 확인) |
| `gu_name` | 패널_통합 `시군구명` (고객성), 안정성 패널 `시군구` | runtime panel 시군구명 (안정성 패널 2종의 시군구명과 일치 확인) |
| `dong_name` | 패널_통합 `행정동명` (고객성 행) | runtime panel 행정동명 (코드로 연결, 이름 조인 안 함) |
| `rent_area` | `gugu_rent_per_sqm`, `rent_area` (안정성 S4) | 항상 `None` — MVP 정책으로 확정(D-015). 좌표로 특별 처리하지 않는다 |
| `label` | `meta.query` = `"{label} 근처 {업종}"` | `"{시군구명} {행정동명}"`. 158개 동 × 29업종에서 업종 재해석 오류 0건 (eng review probe) |
- `NoDataNearby(LocationError)`: 반경 `config.RADIUS_M`(500m) 안 점포 0개 (eng review D8). 거리·반경·포함 조건(`<=`)은 엔진 `radius_demand.radius_profile`의 `n_all`과 같다 (테스트로 고정). 13.5만 점포 전체 haversine 1회 약 6ms → 추가 인덱스·캐시 없음.
- `ContextDataError(RuntimeError)`: resolver 코드가 runtime panel·시장성 패널에 연결되지 않는 내부 불일치. 입력 오류(`LocationError`, ValueError 계열)와 구분해 backend가 다르게 다룰 수 있게 한다.
- 부평역 좌표 → `부평구 부평1동` (golden과 같은 행정동). `rent_area=None`이라 안정성(S4)·종합은 golden과 다를 수 있고, 나머지 4개 관점은 같다 (테스트).
- 구월1동/3동은 경계 데이터에서 SGIS 공식 경계로 교정됐다(D-017). `ContextBuilder`는 좌표별 예외 없이 polygon 결과를 그대로 쓴다 — 교정 구역 좌표(예: 37.4482, 126.7035)는 `남동구 구월3동`.

## D-012 Backend·Frontend 계획 결정 (2026-10-05, eng review D6·D9·D10·D12·D13)
eng review에서 승인됐지만 이 기록에 없던 결정. 구현 단계에서 세부를 확정하되 아래 경계는 바꾸지 않는다.
- API 테스트 (D6): API 응답의 엔진 부분 == `AnalysisService.analyze(ContextBuilder.build(lat, lng), biz)` (pass-through equality). golden 29/29는 `BUPYEONG_STATION` service regression에 남긴다. 좌표 요청은 golden의 `meta.query`("부평역 근처 …")·`rent_area="부평"`을 재현할 수 없고, 재현용 preset/테스트 전용 필드는 public API에 두지 않는다.
- 오류 계약 (D9): 입력·도메인 오류(요청 검증: 유한한 lat/lng, importance 1..5, weights ≥ 0 / `LocationError` 계열 / 잘못된 업종 / 엔진 가중치 `ValueError`)는 안정적인 4xx와 error code. 내부 오류(`ContextDataError`, `KeyError`, 그 밖의 예외)는 500 + `request_id`, traceback은 server log에만.
- Frontend 타입 (D10): Zod schema가 source of truth, TS 타입은 추론. 29개 golden JSON을 schema 테스트 fixture로 쓴다.
- Backend 테스트 (D12): `create_app(service, warm_biz)` factory로 공유 서비스 주입 + 쓰는 업종만 warm. 디스크 캐시(TASKS 2-2)는 조건부 유지.
- 시작 방식 (D13): `RuntimeData` 로드 후 서비스 시작, 29개 warm은 background, `/health`에 진행도, 미warm 업종은 on-demand.

## D-013 ReferenceCache warm-up 성능 기준 (2026-10-05, TASKS 2-1)
측정: `time.perf_counter()`, 같은 `RuntimeData`를 재사용해 I/O를 분리, 측정마다 새 `ReferenceCache(rt)`. Windows 11, Python 3.10.11, 이 저장소 `.venv`.
- `load_runtime` 3.81~3.95s. 업종 1개 cold warm 2.36~2.69s (R10406·I21201·G20405). 29개 전체 cold warm 65.08 / 59.12 / 58.05s (평균 60.75s, 표준편차 3.79s), 추가 1회 59.78s. 구성: competition 55.7s + location 4.7s. 같은 캐시 두 번째 `warm()` 0.0000s. entry: competition 29, location 14 = 업종의 unique anchor key 14.
- check 안 (`tests/test_reference_cache.py`, 약 2.5s 추가): 업종 1개 cold warm ≤ **15s** (측정의 약 6배 — 느린 PC·CI에서 정상 구현이 실패하지 않고, 업종당 비용이 몇 배로 늘어나는 퇴행은 잡는다). 두 번째 warm은 `build_reference`를 다시 부르지 않고 ≤ 0.5s. entry 수·anchor 공유 규칙은 계산 함수를 가짜로 바꿔 ms 단위로 검사 (29개 → `build_reference` 29회, `site_profile` 14 × 158회).
- check 밖 (`scripts/bench_reference.py`): 전체 29개 cold warm ≤ **180s** (평균의 약 3배), `load_runtime` ≤ 15s. 전체 warm을 check에 넣으면 매번 약 60s가 늘어 check(약 80s)가 거의 두 배가 된다. 전체 시간은 업종당 비용 × 29가 지배하므로 check는 업종당 비용을 직접 감시하고, 전체 실측은 엔진 계산·캐시 구현을 바꿀 때(2-2 판단 포함) 이 스크립트로 한다.
- 2-2 디스크 캐시: 현재 불필요. background warm(D-012) 기준 서버는 약 4s 뒤 응답하고, 미warm 업종 첫 요청은 약 2.5s. 다중 worker 운영이나 재시작이 잦아 콜드 비용이 문제될 때 다시 판단한다. → 현재 미도입으로 판단 완료 (D-016).

## D-014 API 오류 계약 확정 (2026-10-06, TASKS 3-5, D-012 후속)
- 형태: `{"error": {"code", "message"}}`, 500만 `request_id` 추가. frontend는 status로 사용자/서버 오류를, `error.code`로 원인을 나눈다. `message`는 표시용이며 분기 기준이 아니다.
- status: 사용자 입력과 분석 불가는 모두 **422**, 내부 오류는 **500**. 404는 없는 route에만 쓴다(FastAPI 기본).
- code: `invalid_request`(요청 검증, 깨진 JSON — FastAPI 기본 `{"detail": [...]}` 대신) · `invalid_business` · `invalid_analysis_options` · `invalid_coordinate` · `location_outside` · `no_data_nearby` · `internal_error`.
- 요청 검증: Pydantic strict 타입이라 coercion이 없다. lat/lng는 JSON 숫자·유한·범위, importance 값은 정수 1..5(1.0·"4"·bool 거부), user_weights 값은 유한 ≥ 0, 관점 키는 `config.PERSPECTIVES`. 모두 엔진 `resolve_weights` 규칙과 같은 의미다.
- ValueError 경계: API가 analyze 전에 엔진 `scoring.resolve_weights(C.group_of(biz), user_weights, importance)`(엔진 analyze가 처음 하는 순수 호출)를 먼저 불러, 거기서 난 `ValueError`만 `invalid_analysis_options`로 본다. location 오류는 `InvalidCoordinate`/`LocationOutside`/`NoDataNearby` 타입으로 잡는다. `service.analyze` 안의 예외는 `ValueError`를 포함해 모두 500 — 내부 버그를 사용자 오류로 숨기지 않는다.
- 500: `uuid4().hex` request_id를 응답과 server log(`backend.errors`, traceback 포함)에 함께 남긴다. 응답에는 예외 메시지·클래스명·경로를 넣지 않는다. Starlette는 500 handler 뒤 예외를 다시 raise하므로 uvicorn 로그에도 traceback이 한 번 더 남는다(응답은 위 계약 그대로).

## D-015 임대료 상권: MVP에서 일반 좌표에 연결하지 않음 (2026-10-06, TASKS 1-6, 사용자 결정)
- 결정: R-ONE 소규모상가 임대료 상권(인천 9개)을 일반 좌표에 연결하지 않는다. `ContextBuilder`의 `rent_area=None` 정책(D-011)을 공식 정책으로 확정한다. 설계서 11-x의 역 중심 500m 근사는 MVP에서 쓰지 않는다.
- 결과: 모든 좌표에서 안정성 S4(상권 임대료)는 `제외(데이터 없음)`이고, 엔진 규칙대로 나머지 세부지표로 재정규화된다. 기존 동작 그대로라 코드·데이터·golden 변경은 없다.
- `"부평"` rent_area는 golden fixture `BUPYEONG_STATION`에만 남는다. 좌표 API의 부평역 결과는 golden과 안정성·종합 점수가 다를 수 있다(의도된 동작, D-012). frontend는 `rent_area=null`일 때 S4 제외를 안내한다(TASKS 4-3).
- 다시 열 때: 연결 규칙을 도입하면 `ContextBuilder` 정책 변경 + `tests/test_context_builder.py`·pass-through 테스트 갱신, 바뀌는 결과를 기록한다.

## D-016 reference 디스크 캐시: 현재 미도입 (2026-10-06, TASKS 2-2, 사용자 결정)
- 판단: 도입하지 않는다. 현재 성능으로 충분하다 — 서버는 `RuntimeData` 로드 약 4s 뒤 응답하고, 29개 warm은 background(약 60s), 미warm 업종 첫 요청은 약 2.5s (D-013).
- 다시 여는 조건: 멀티 워커 운영(워커마다 데이터·캐시를 따로 가져 메모리 N배·콜드 N번) 또는 잦은 재시작으로 cold start가 문제될 때.
- 그때 요구사항: `data/cache/`, 캐시 키에 엔진 버전·데이터 해시·반경·업종/유인시설 집합(D-007), 캐시 경로 결과 == 비캐시 결과 테스트, `scripts/bench_reference.py` 재측정.

## D-017 구월1동/구월3동 경계: SGIS 공식 경계로 교정 (2026-10-06, TASKS 1-5a, D-010 후속)
- 근거: D-010 "1-5a 공식 확인 결과" — 충돌 439좌표·2,486점포가 SGIS 공식 판정 100% 구월3동. 점포 라벨·`data/runtime`은 맞으므로 바꾸지 않고, 2차 가공 경계를 고친다.
- 공식 경계: SGIS OpenAPI `/OpenAPI3/boundary/hadmarea.geojson`. 2026-10-06 기준 최신 제공 연도는 **2025** (2026·2027 요청은 `errCd=-200 경계데이터 년도 정보를 확인해주세요`, 2019~2025는 응답). 2024와 2025의 남동구 20개 geometry는 같다.
- 호환성 확인: SGIS 2025 남동구 하위 행정동 20개의 이름 집합 = `data/geo`·runtime panel 남동구 20개 (남동구는 2026-07 인천 개편 대상 아님). SGIS `adm_cd`(23050xxx)는 통계용 코드라 이름으로만 연결한다. SGIS 구월3동 polygon은 충돌 439좌표를 모두 포함하고, 교정 전 구월3동 영역은 SGIS 구월1동과 겹치지 않는다(한 방향 이동 — 2015-07-31 구월1동 일부 → 구월3동 편입과 같은 방향).
- 범위 판단: 남동구 전체를 SGIS로 바꾸지 않는다. SGIS 2025 남동구는 다른 동에서 점포 라벨 일치율이 오히려 낮고(간석2동 0.999 → 0.905, 구월4동 0.995 → 0.916, 만수2동 0.968 → 0.934), 구 외곽선이 2차 가공본과 약 1.35km² 달라 이웃 구와 겹침·틈이 생긴다. 공식 확인된 구월1/3동 쌍만 교정한다.
- 교정 방식 (`scripts/build_geo.py` `SGIS_CORRECTIONS`, 재현 가능): `새 구월1동 = 구월1동 − SGIS 구월3동`, `새 구월3동 = 구월3동 ∪ (구월1동 ∩ SGIS 구월3동)`. 공식 polygon geometry 자체를 쓰고, 좌표별 예외·bbox·점 기반 polygon은 없다. 두 동 합집합(이웃 동과의 바깥 경계)은 그대로라 다른 156개 동과 인천 전체 외곽선은 바뀌지 않는다. 반대 방향 영역이 있거나, 옮길 영역이 없거나, SGIS 이름이 panel과 다르면 build가 오류로 멈춘다.
- 저장: `data/geo/SGIS_행정동경계_2025_남동구_구월.geojson` (commit, 5,299 bytes) — 구월1동·구월3동 feature(`adm_cd`, `adm_nm`, UTM-K geometry 응답 그대로) + `provenance`(API·연도·요청 인자·CRS). 인증값·token·응답 메타 없음. SGIS는 인증이 필요해 url로 다시 받을 수 없으므로 raw/와 달리 commit한다. 받기 `python scripts/fetch_sgis_boundary.py` (최신 연도 == 2025, 남동구 이름 집합, 로컬 좌표 변환 == SGIS transcoord를 확인하고, 기존 파일과는 바이트 비교만 — 두 번 받아 동일 확인). runtime은 SGIS를 호출하지 않는다.
- 좌표 변환: EPSG:5179(GRS80, 38°N·127.5°E, k0 0.9996, FE 1,000,000·FN 2,000,000) → WGS84를 `build_geo.utmk_to_wgs84`(Karney Krüger 6차 급수, 의존성 추가 없음)로 한다. SGIS transcoord(5179→4326)와 최대 차이 1.99e-13° (경계 꼭짓점 10개). 테스트에 SGIS 응답 5개를 고정.
- 결과: 구월1동 2,832,122 → 1,777,033m², 구월3동 742,926 → 1,798,015m² (약 1,055,089m² 이동). SGIS와의 IoU 구월1동 0.589 → 0.939, 구월3동 0.407 → 0.989 (남은 차이는 바깥 경계 일반화 차이). 교정 후 구월1동 ∩ SGIS 구월3동 = 0, 구월3동 ∩ SGIS 구월1동 = 0. 158개 polygon 유효·서로 겹치지 않음(새 겹침은 관교동 접점의 ~1e-7m² 부동소수 잡음뿐 — 교정 전에도 같은 수준의 잡음 쌍 3개). 구월1∪3 합집합·인천 합집합 차이 ~1e-7m².
- 남은 모양: 구월1동은 본체 1,734,114m² + 떨어진 조각 39,050m²·3,869m² (점포 0). 둘 다 SGIS 구월3동이 아니어서(큰 조각은 SGIS상 간석1동 90%·구월2동 10%, 작은 조각은 SGIS 남동구 밖) 규칙대로 구월1동에 남겼다. 이웃 동 경계는 교정 범위가 아니다.
- 판정 영향: 2,487개 점포 판정 변경(구월3동 라벨 2,486개 구월1동 → 구월3동, 구월2동 라벨 1개 구월1동 → 구월3동). 전수 일치율 96.625% → 98.456%, floor는 D-010 "교정 후 재측정". 부평역 → 부평1동, 운서·아라 분동 판정은 그대로. 엔진 v0.3·golden 29/29·`data/runtime` 변경 없음. 이 구역 좌표의 API context는 `구월1동` → `구월3동`(고객성 행이 구월3동 패널로 바뀜 — 의도된 변화, backend pass-through·ContextBuilder 테스트 기대값 갱신).
- 매니페스트: `tests/manifests/geo.sha256.json`의 `인천_행정동경계_2026.geojson` 해시와 SGIS 입력 항목을 이 결정과 함께 갱신했다(`build_geo.manifest_entries()` 결과, raw 항목은 그대로). `python scripts/build_geo.py` → "매니페스트와 일치 (재현됨)".
- 다시 열 때: SGIS가 2026 경계를 제공하면 연도를 올려 다시 받고, 인천 전체 교체(TASKS 보류 항목) 여부를 함께 판단한다.

## D-018 배포 구조: Cloud Run 서비스 1개, FastAPI가 frontend build까지 같은 origin에서 서빙 (2026-10-08, TASKS 5-4, 사용자 결정)
- 구조: Google Cloud Run 서비스 1개 = Docker 이미지 1개 = runtime process 1개(uvicorn, worker 1). Firebase Hosting은 쓰지 않는다. Node/Vite는 Docker build 단계에서만 쓰고 runtime에 Node 서버는 없다.
  - `/health` `/businesses` `/analyze` → FastAPI (기존 그대로)
  - `/assets/*` → Vite build의 해시된 파일 (`Cache-Control: public, max-age=31536000, immutable`)
  - 그 밖의 확장자 없는 GET → `index.html` (SPA fallback, `no-cache`)
- 같은 origin이라 frontend의 상대 API 경로(`/businesses`, `/analyze`)를 그대로 쓰고 CORS는 추가하지 않는다. dev는 지금처럼 vite dev proxy.
- 구현: `backend/app/frontend.py` `mount_frontend`를 `create_app(frontend_dist=...)`가 **API route 등록 뒤에** 붙인다 → API가 항상 먼저 매칭된다. module-level `app`은 환경변수 `FRONTEND_DIST`가 있을 때만 켠다(없으면 API만 — dev·기존 테스트 동작 그대로, 없는 route 404 계약 유지).
  - API 경로에 다른 method(`GET /analyze`)는 405 (index.html로 떨어지지 않음). `/assets/` 안의 없는 파일, 확장자 있는 없는 파일, GET/HEAD가 아닌 그 밖의 요청은 404. dist 밖 경로(`..`)는 서빙하지 않는다. build가 없으면 시작 시 RuntimeError.
  - 테스트: `backend/tests/test_frontend.py` (임시 dist로 경로 우선순위·fallback·캐시 헤더·405/404 계약, 11개).
- 이미지 (`Dockerfile`, `.dockerignore`): `node:22-slim`에서 `npm ci` + `vite build` → `python:3.10-slim`에 `requirements.txt`, `scoring_engine/`, `backend/app/`, `data/runtime/`, `data/geo/인천_행정동경계_2026.geojson`, `frontend/dist/`만 복사. `sources/`·`tests/`·`docs/`·`scripts/`·`data/geo/raw`·`.env` 류는 build context에서도 제외. 비root 사용자, `PORT`(Cloud Run 주입, 기본 8080).
  - 타입 검사(`tsc -b`)는 테스트 파일과 `tests/golden`까지 보므로 이미지에서는 `vite build`만 하고, 타입 검사는 `scripts/check`(`npm run check`)가 맡는다.
  - 행정동 GeoJSON: build 단계가 `dist/assets/*.geojson`이 정확히 1개이고 `data/geo` 원본과 sha256이 같은지 확인하고, 다르면 build 실패. 확인값: `인천_행정동경계_2026-<hash>.geojson` 610,826 bytes, sha256 = 매니페스트 값(`7c64c376…`).
- NAVER Maps Client ID: build arg `VITE_NAVER_MAP_CLIENT_ID`로만 받아 번들에 넣는다(공개 값, Client Secret 아님). 없으면 build 실패. commit하지 않는다. 이미지 메타데이터(`docker history`)에도 build arg가 남으므로 공개 값만 넘긴다. Cloud Run 서비스 URL을 NAVER 콘솔 Web 서비스 URL에 등록해야 지도가 뜬다.
- 로컬 검증 (2026-10-08, Docker 29.5.2): 이미지 663MB. 컨테이너 시작 → `/health` 응답 약 5.9s, 29개 warm 완료 후 메모리 197MiB(최대 220MiB), `/analyze` 약 0.03s. 같은 이미지에 `tests/`·`scripts/`·`sources/`를 읽기 전용으로 붙여 golden regression·location agreement·ContextBuilder·service 계약 122개 PASS (Linux, Python 3.10.22) → Windows 3.10.11 golden과 같다. 브라우저로 SPA 깊은 경로 진입 → 분석 → GeoJSON asset(200) → 경계 강조 확인.
- **Cloud Run 운영 설정 (확정, 2026-10-08 사용자 결정 — 시연·초기 운영용)**:

  | 항목 | 값 | 이유 |
  |---|---|---|
  | region | `asia-northeast3` (서울) | 사용자·데이터가 인천 |
  | CPU / memory | 1 / `1Gi` | 측정 최대 220MiB의 여유. pandas 데이터 1벌 |
  | min / max instances | 1 / 1 | cold start(약 6s)·warm 반복 없음. 인스턴스 1개 = RuntimeData·ReferenceCache 1벌 (D-016 디스크 캐시 계속 미도입) |
  | concurrency | 4 | worker 1개의 thread pool에서 분석(약 0.03s)은 짧지만 콜드 업종은 `ReferenceCache` lock으로 직렬화된다 — 적은 동시 요청만 받아 대기 시간을 제한 |
  | uvicorn worker | 1 | 워커마다 데이터·캐시를 따로 가지면 메모리·warm이 N배 |
  | CPU 할당 | instance-based billing, `--no-cpu-throttling` | background warm thread가 요청 밖에서도 돌아야 한다 |
  | startup CPU boost | 사용 (`--cpu-boost`) | RuntimeData 로드(약 4s)·초기 warm 단축 |

  배포 명령 예 (이미지 push 후): `gcloud run deploy <서비스> --image <이미지> --region asia-northeast3 --cpu 1 --memory 1Gi --min-instances 1 --max-instances 1 --concurrency 4 --no-cpu-throttling --cpu-boost --allow-unauthenticated`
- 시연 후 비용 절감 옵션: `min-instances=0` + request-based billing(CPU 요청 중에만 할당)으로 바꿀 수 있다. 그 경우 cold start(컨테이너 시작 → `/health` 약 6s)와 background warm 지연(요청이 없으면 warm이 멈춰, 미warm 업종 첫 분석 업종당 약 2.5s·warm 경합 시 최대 약 8s, TASKS 5-2 B4)을 감수한다. 바꿀 때 이 항목에 기록한다.
- API 문서: `FRONTEND_DIST`가 설정된 production mode에서는 FastAPI 공식 설정 `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`으로 `/docs`·`/redoc`·`/openapi.json`을 끈다. 이 경로들은 SPA fallback으로도 index.html을 주지 않고 404 (`mount_frontend(hidden_paths=...)`). API-only 모드(개발·테스트)는 문서 유지. **인증이 아니다** — `/health`·`/businesses`·`/analyze`는 그대로 public. 테스트: `backend/tests/test_frontend.py`.
- 아직 하지 않은 것: 실제 GCP 배포(프로젝트·Artifact Registry·서비스 계정), NAVER 콘솔에 Cloud Run URL 등록.
