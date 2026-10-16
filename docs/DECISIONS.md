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
  재배포는 확인된 registry digest로 무트래픽 배포 → API 검증 → 100% 전환 순서로 한다(아래 "7차 재배포").
- 시연 후 비용 절감 옵션: `min-instances=0` + request-based billing(CPU 요청 중에만 할당)으로 바꿀 수 있다. 그 경우 cold start(컨테이너 시작 → `/health` 약 6s)와 background warm 지연(요청이 없으면 warm이 멈춰, 미warm 업종 첫 분석 업종당 약 2.5s·warm 경합 시 최대 약 8s, TASKS 5-2 B4)을 감수한다. 바꿀 때 이 항목에 기록한다.
- API 문서: `FRONTEND_DIST`가 설정된 production mode에서는 FastAPI 공식 설정 `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`으로 `/docs`·`/redoc`·`/openapi.json`을 끈다. 이 경로들은 SPA fallback으로도 index.html을 주지 않고 404 (`mount_frontend(hidden_paths=...)`). API-only 모드(개발·테스트)는 문서 유지. **인증이 아니다** — `/health`·`/businesses`·`/analyze`는 그대로 public. 테스트: `backend/tests/test_frontend.py`.
- 배포·운영 점검 (2026-10-08): 사용자가 Docker 이미지를 Cloud Run(`asia-northeast3`)에 배포하고 NAVER 콘솔 Web 서비스 URL에 서비스 URL을 등록했다(서비스 URL·GCP 프로젝트 ID는 저장소에 기록하지 않는다). 운영 점검 결과:
  - `/health` warm 29/29 완료, `/`·SPA 경로 200(`no-cache`), `/businesses` 200, `/docs`·`/redoc`·`/openapi.json` 404, `GET /analyze` 405, 없는 asset 404, JS·GeoJSON asset 200 + immutable 캐시, GeoJSON 610,826 bytes·sha256 = 매니페스트 값. 응답 약 0.07~0.17s.
  - `/analyze` 8개 시나리오(부평역·구월 교정·아라2동·importance·인천 밖·점포 없음·잘못된 업종·위도 범위)를 같은 코드의 로컬 응답과 비교: 7개 JSON 완전 일치, 아라2동·미용실 1개는 `지표[입지성].raw.유인시설_종류별.초등학교`의 마지막 자리만 다름(0.8126628455769709 vs 0.812662845576971, Linux/Windows 부동소수 1ulp). 점수·화면 표시값은 같고 golden 허용오차(1e-9) 안이다.
  - 브라우저: NAVER 지도 인증 정상, 1280px 좌표 입력 → 구월3동·카페 분석 → GeoJSON 경계 강조·마커 화면 안, 375px 지도 화면·가로 넘침 없음, 콘솔 오류 없음.
- **7차 재배포 (2026-10-13, 커밋 `6f7df52`, Codex 배포 검수 통과)** — 4~7차 기능(`/nearby-stores`, 두 위치 비교, 주소 검색·참고 주소)을 운영에 반영. 서비스 이름·URL·GCP 프로젝트 ID는 위 방침대로 적지 않는다(`<서비스>`로 표기).
  - 이미지: `6f7df52` 깨끗한 작업 트리에서 build(linux/amd64, 663MB, label `org.opencontainers.image.revision` = 커밋). registry digest(OCI index) `sha256:68bb28e6ab86fe651d0e6a1ac99bb762aa7fbe3bf3196f4185fe061ca661382f` — 로컬 이미지 ID와 같다고 전제하지 않고 push 출력·Artifact Registry 조회·`docker buildx imagetools inspect`를 대조한 뒤 이 digest로 배포했다. Cloud Run이 실행하는 linux/amd64 manifest는 `sha256:089a90d09c860640437f6f73229fa17328c2ce88d921b804b574b409427bd0e1`(index 안의 나머지 1개는 attestation).
  - 리비전 `<서비스>-6f7df52` (`--revision-suffix`). 이전 리비전 `<서비스>-00001-872`의 이미지는 `:b3b3897` — index `sha256:0cf51242c1d60934a5c7ff45c73f22ebeb02d6787171cfc6fe9dd5568c5d2cad`, 실제 amd64 `sha256:70b50ebcd92484693c9de32c635af27997a9f9c18cb854b8d680b0e81f3f8c00`. 배포 전 점검 보고에서 `0cf51242…`를 "운영 digest"로 적은 것은 index digest였다.
  - 절차: 이미지 push → `gcloud run deploy … --image <저장소>@<index digest> --no-traffic --tag <검증 태그> --revision-suffix 6f7df52`(D-018 운영 설정 플래그 그대로) → 태그 URL로 API 검증 → `update-traffic --to-revisions <서비스>-6f7df52=100` → NAVER 등록 주소에서 운영 화면 검증 → `update-traffic --remove-tags <검증 태그>`. 이미지 조회·배포·트래픽 전환·태그 제거·복구의 모든 gcloud 명령에 `--project`를 명시했다.
  - 배포 전후 설정 비교: 리비전 spec은 이미지만 다르다(cpu 1, 1Gi, min/max 1/1, concurrency 4, cpu-throttling false, startup-cpu-boost, 서비스 계정, timeout 300, startup probe, 환경변수 없음 모두 동일). 서비스 annotation(ingress all, 서비스 단위 max 3)·IAM(`allUsers` → `roles/run.invoker`) 변경 없음.
  - 태그 URL API 검증(로컬 backend와 `tests/helpers.py` `deep_diff` 기준 — 원시 부동소수 상대·절대 1e-9, 반올림 점수·점포 수·오류 코드·응답 구조 일치): `/health` warm 29/29·실패 없음, `/businesses` 29개·4그룹 동일, `/analyze` 8개 시나리오 모두 일치(정상 4개 65.8·59.4·51.1·70.0, 아라2동은 1e-9 안의 부동소수 잡음만, 오류 4개 `location_outside`·`no_data_nearby`·`invalid_business`·`invalid_request` 본문까지 일치), `/nearby-stores` 3지점 × 29업종 87건 점포 수 = 엔진 `동종점포수`·로컬 응답 일치, 오류 6종 422·`GET` 405, SPA·asset 캐시 헤더·GeoJSON sha256 일치, 숨긴 문서 경로 404. 새 리비전 로그 5xx·ERROR 0건.
  - 운영 화면 검증(NAVER 등록 주소, 1280px → 375px): 새 번들 확인, 지도 인증 정상, Geocoder 로드·"주소로 찾기" 표시. A `부평대로 1` 검색 → `부평대로 3` 선택 → 참고 주소 → PC방 분석(부평구 부평1동 66.9, 점포 12곳). 비교 B `예술로 148` 검색·선택 → B 분석(남동구 구월3동 58.4, 점포 6곳), A·B 참고 주소 섞임 없음. 실제 호출 검색 2·역지오코딩 2, 콘솔 오류 0, 375px 가로 넘침 0. 두 좌표의 운영 `/analyze`·`/nearby-stores` = 로컬(diff 0).
  - **복구 오탐과 재전환**: 100% 전환 뒤 첫 화면 검증을 NAVER에 등록되지 않은 서비스 별칭 URL에서 열어 "지도 인증에 실패했습니다"가 나왔고, 정해 둔 조건(운영 지도 인증 실패)대로 이전 리비전으로 100% 복구했다(`POST /nearby-stores` 404로 이전 코드 확인). 이전 리비전도 같은 별칭 URL에서 똑같이 실패하고 등록 주소에서는 정상이어서 새 리비전 결함이 아닌 확인 주소 오류로 판단, API 검증은 이미 통과했으므로 다시 100% 전환한 뒤 등록 주소에서 위 화면 검증을 통과했다.
    - Cloud Run 서비스에는 URL이 두 형식(프로젝트 번호 형식과 해시 별칭) 있고 NAVER Web 서비스 URL에는 그중 하나만 등록돼 있다. 검증용 태그 URL도 미등록이다. **운영 화면 검증(지도·Geocoder)은 NAVER에 등록된 주소에서만 한다.** 다른 주소의 인증 실패는 배포 결함의 근거가 아니다.
    - 사용자 영향은 **미확인**: 복구 구간(수 분, 정확한 시각 미기록)에 새 화면을 이미 열어 둔 사용자는 이전 리비전에 `POST /nearby-stores`를 보내 404(점포 목록 실패)를 받았을 수 있고, 복구 직후 이전 리비전은 warm 2/29 상태였다(미warm 업종 분석 지연 가능). 그 구간의 요청 로그는 분석하지 않았다.
  - 현재 상태: 트래픽 `<서비스>-6f7df52` 100%, 태그 없음(검증 태그 제거, 태그 URL 404). 이전 리비전 `<서비스>-00001-872`와 이미지 `:b3b3897`은 복구용으로 보존 — 이전 리비전은 트래픽 0%·태그 없음으로 **Retired**(`Active` False), 최소 인스턴스 미배치(`MinInstancesProvisioned` False, `NotProvisioned`). 전체 로그 5xx·ERROR 0건.
  - 복구 절차: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-00001-872=100`. 이전 리비전은 Retired라 복구 시 인스턴스 시작과 warm이 다시 필요할 수 있다 → 복구 완료 확인은 `/health` 200만이 아니라 `service_ready: true`와 `warm` 29/29(`done: true`, `failed: false`)까지, 그리고 `POST /nearby-stores` 404(이전 코드가 서비스 중). 리비전이 없으면 `<저장소>@sha256:0cf51242…`로 같은 플래그를 써서 다시 배포한다.
  - NAVER(사용자, 2026-10-12): Geocoding·Reverse Geocoding 일 1,000회·월 10,000회 한도, 초과 사용 불허, 알림 수신자 설정 완료.
  - 미확정·미확인: 운영 화면에서 첫 `/analyze`가 약 4.5초(브라우저 resource timing)였다. 태그 URL 검증 중 서버 로그의 `/analyze` 평균은 약 45ms(94건)지만, 이것만으로 첫 요청에만 생긴 문제라고 확정하지 않는다 — **원인 미확정**. Geocoder 장애·한도 초과 상황은 운영에서 재현하지 않았다.

## D-019 동종 점포 지도 표시: 별도 API, 엔진 경쟁성과 같은 기준 (2026-10-11, 4차)
- 결정: 반경 안 같은 업종 점포 목록은 `POST /nearby-stores`로 따로 준다. `/analyze` 응답 계약(`{context, result}` pass-through, D-012)은 그대로 둔다.
  - 이유: 분석 결과와 목록의 실패를 분리한다(목록 조회가 실패해도 분석 결과는 보인다). 목록은 표시용이라 엔진 출력에 끼우지 않는다.
- 기준: 엔진 `radius_demand.radius_profile`과 같은 거리 함수(`haversine_m`)·반경(`<= config.RADIUS_M`)·업종(`상권업종소분류코드`)·데이터(`RuntimeData.shops`). 새 모듈 `scoring_engine/nearby.py`(예약 이름 아님, v0.3 엔진 파일 불변).
  - 고정: 조회 수 == `경쟁성.raw.동종점포수` — 부평역 29개 업종(golden과 같은 좌표의 엔진 결과), 4개 지점 × 29개 업종(`radius_profile` n_same), 0곳 지점, API 수준(`backend/tests/test_nearby_stores.py`). 2026-10-11 실행 중인 backend로 3개 지점 × 29개 업종 87건 대조: 불일치 0건.
- 좌표 검증은 `/analyze`와 같은 `ContextBuilder.build`(오류 코드 D-014 그대로). frontend는 분석 성공 뒤 같은 `{lat, lng, biz_code}`로 부르고, 응답 조건이 요청과 다르거나 늦게 온 이전 요청이면 버린다.
- 표시: 상호·도로명주소(없으면 지번주소, 둘 다 없으면 "주소 정보 없음")·직선거리. 상가정보 기준일 `2026-06-30`(원본 `00_README.md`)을 함께 보인다 — 이후 개업·폐업은 반영되지 않는다.
- 범위 밖: 반경 변경, 비교 분석, 주소 검색. 지도 확대 수준은 바꾸지 않는다(초기 zoom 11에서는 점포 마커가 겹쳐 보인다 — 목록·확대로 본다).
  - **2026-10-14 대체(D-022)**: 단일 위치 선택은 반경 원이 지도에 맞게 보이도록 zoom을 바꾼다. 점포 선택은 지금처럼 zoom을 바꾸지 않는다.

## D-020 두 위치 비교: frontend에서 기존 API 재사용, 표시용 차이 (2026-10-12, 5차)
- 결정: 같은 업종 두 위치 비교는 frontend 기능으로 만든다. 새 backend API·엔진 변경 없이 기존 `POST /analyze`·`POST /nearby-stores`를 위치마다 부른다. 설계·구현 기록은 `docs/COMPARE_DESIGN.md`(12장 결정 D1~D10, 13장 단계별 기록).
  - 이유: 엔진 결과·API 계약(D-012 pass-through, D-019)을 건드리지 않는다. 비교 표시 규칙은 엔진 밖(`lib/compare.ts`)에 둔다(CLAUDE.md "UI 요구사항 때문에 scoring logic을 변경하지 않는다").
- 범위: 두 위치 × 같은 업종. A는 비교 동안 고정이고, A를 바꾸려면 비교를 끝낸다(D1). URL 공유·다른 업종 비교·3곳 이상·자동 확대·"두 위치 모두 보기"는 하지 않는다(D3). — 자동 확대·"두 위치 모두 보기"는 **8-B2에서 D-022 순위 1·5·6으로 대체했다**(2026-10-16).
- 점수 차이는 "표시용 차이 (A−B)"로만 보인다. ×10 정수로 빼서 소수 1자리로 표기하고, 중립색을 쓴다. 미산출이면 계산하지 않는다(0으로 보지 않음). 순위·우열 판정으로 표현하지 않는다(관점·종합 점수는 백분위의 가중평균, `SCORE_EXPLANATION_AUDIT.md` 3장). 종합 계산 구성(`적용_가중치` 키·값)이 다르면 종합 차이에 †와 각주를 붙인다.
- 같은 구·동 안내는 context(`gu_code`·`dong_name`)로만 판단한다. 같은 구면 시장성·안정성, 같은 동이면 고객성까지 두 위치가 같은 값을 쓴다(구·행정동 해상도). 미산출 관점은 이 목록에서 뺀다.
- 동종 점포는 한 번에 한 위치만 보인다(D4). B 성공 뒤 기본 기준은 B이고 A/B 전환은 재조회 없이 한다. 전체 결과는 그 위치의 점포를 보이고, 비교를 끝내면 A 점포와 표시 설정이 그대로 돌아온다.
- 상세 결과는 `AnalysisResult`를 한 번에 하나만 마운트하는 화면 전환(요약 / A 전체 / B 전체)으로 보인다. 고정 id를 리팩토링하지 않는다(D6).
- 검증: fixture는 실제 backend 응답이다(다른 구·같은 동·안정성 미산출·경쟁성 미산출 + 점포 6곳·0곳). 단위·컴포넌트·App 흐름 테스트, 규칙을 일부러 깨는 확인, 1280·970·375px 실제 브라우저 확인을 했다(COMPARE_DESIGN.md 13장).

## D-021 주소 표시·검색: NAVER Web SDK Geocoder(Client ID만), 주소는 참고 정보 (2026-10-12, 7차)
- 결정: 주소 검색(정방향)과 참고 주소(역방향)를 브라우저에서 NAVER Maps JS SDK의 Geocoder 서브모듈(`submodules=geocoder`)로 부른다. backend·엔진·API 계약·데이터는 바꾸지 않는다. Client Secret을 쓰는 REST 프록시는 쓰지 않는다(대안으로만 기록, `docs/ADDRESS_DESIGN.md` §4.2).
  - 이유: 지도와 같은 인증(Client ID + Web 서비스 URL)이라 서버에 비밀값이 없고, 주소 장애가 backend·분석 경로와 분리된다.
- 주소는 **참고 정보**다. 분석 입력은 좌표(+업종)뿐이고, 분석 행정동·Context Bar·결과 제목은 backend `context` 그대로다. 검색 결과 문자열이나 NAVER 행정동(admcode)으로 덮어쓰지 않는다. 인천 밖 검색 결과도 고를 수 있고, 분석 가능 여부는 backend `location_outside`가 판정한다(검수 결정, 사전 차단 없음).
- 준비 상태: 지도 준비(`load`)와 Geocoder 준비(`callback` + `Service`)를 나눈다. Geocoder만 실패하면(서브모듈 실패·10초 무응답·`Service` 없음) 주소 기능만 숨기고 지도·좌표 입력·분석은 그대로다. 뒤늦은 인증 실패는 끝 상태(`failed`)라 주소 기능도 꺼지고 다시 켜지지 않는다. SDK는 한 번만 로드한다.
- 호출 규칙:
  - 검색: 제출(버튼·Enter) 때만 1회, 입력 중·공백은 0회. 인천시청 기준 10건을 받아 5건 + "더 보기"(재호출 없음). 요청 번호로 입력 변경·재검색·닫기·화면 이탈·B 다시 고르기(`pickB` 세대) 뒤 늦은 응답을 버린다.
  - 참고 주소: 좌표 키(숫자 그대로) 캐시(LRU 100, 진행 중 공유, ok·none 세션 유지, error 60초 뒤 다음 조회 때만). 자동 재시도·타이머 없음. 화면은 현재 키의 캐시만 읽어 A/B·이전 좌표 응답이 섞이지 않는다. 같은 좌표의 화면 전환(분석 전→후, B 선택→성공, 요약↔전체 결과, 점포 기준 전환, 비교 종료)은 추가 호출이 없다.
- 오류 분류는 SDK가 실제로 준 정보 안에서만 한다(콜백 ERROR + 응답 없음 = `unknown`, 403/429·할당량을 추정하지 않는다). 실패·주소 없음·로딩에서는 참고 주소 줄을 그리지 않고 기존 표시(행정동·최근접역·좌표)가 남는다. 주소 실패는 분석·비교·점포 상태를 바꾸지 않는다.
- 콘솔·비용(2026-10-12 사용자 확인): 신규 Maps 상품, 대표 계정, Geocoding·Reverse Geocoding 선택. 대표 계정 무료 월 3,000,000건, 초과 0.5원/건(VAT 별도). 미선택 상태는 실측 HTTP 403(문서상 429).
- 검증: adapter·캐시·hook·컴포넌트·App 흐름 테스트, 실제 API 정상 흐름 1회(검색 2·역지오코딩 2), mock 장애·경합, production 6개 화면 크기와 dev StrictMode(`docs/ADDRESS_DESIGN.md` §12 "7-B6"). 관련 보완: 숨겨진 지도의 점포 정보창(6-4), 개발 모드 전체 결과 스크롤(6-5).
- 배포 전 남은 항목(사용자) — **완료**: Geocoding·Reverse Geocoding 일·월 사용량 한도와 알림 설정(2026-10-12: 일 1,000·월 10,000, 초과 불허, 알림 수신자), 운영(Cloud Run) URL에서 Geocoder 동작 확인과 운영 배포(2026-10-13, NAVER 등록 주소에서 검색 2·역지오코딩 2 정상, D-018 "7차 재배포").

## D-022 지도 범위 맞춤: 위치가 바뀌면 분석 범위가 사용 가능한 지도 영역에 맞게 보인다 (2026-10-14, 8차 — 8-B1 단일 · 8-B2 비교 구현)
- 결정: 새 위치 선택(지도 클릭·주소·좌표) 때 반경 원이 **사용 영역 U**(지도 사각형 − 우리 오버레이(범례·안내 칩·점포 막대) − SDK 컨트롤) 안에 들어가고, 지름이 U 짧은 변의 절반 이상이 되도록 zoom과 중심을 옮긴다. 사용자가 휠·드래그·± 컨트롤로 직접 바꾸면 잠금이 켜져, 미뤄 둔 자동 맞춤을 하지 않는다. 점포 선택·분석 완료·화면 전환·창 크기 변경은 zoom을 바꾸지 않는다. 범례 마지막 줄 "범위에 맞추기"(ghost small, 키보드 가능)는 무조건 맞춘다.
- 대체하는 문장: D-019 "지도 확대 수준은 바꾸지 않는다(…)"(단일 선택에 한해), `MapView.test.tsx`의 단일 선택 `setZoom` 미호출 단언(정책 테스트로 교체). D-020·`COMPARE_DESIGN.md` D3 "자동 확대·'두 위치 모두 보기' 하지 않음"은 **8-B2에서 아래 순위 1·5·6으로 대체했다**(2026-10-16).
- 우선순위(위가 이긴다):

  | 순위 | 사건 | 동작 | 잠금 | 단계 |
  |---|---|---|---|---|
  | 1 | "범위에 맞추기" / "두 위치 모두 보기" | 무조건 맞춤 | 해제 | 8-B1 / 8-B2 |
  | 2 | 새 위치 선택 | 이미 완료 조건이면 이동 없음, 아니면 맞춤 | 해제 | 8-B1 |
  | 3 | 반경 변경 | 2와 같음 | 해제 | 8-D 뒤 |
  | 4 | 숨김 복귀 | 미뤄 둔 맞춤만 1회(잠금이 켜졌으면 하지 않음) | 유지 | 8-B1 / 8-B2 |
  | 5 | B 선택 | A∪B 맞춤 zoom(래스터 기준) ≥ 13이면 A∪B, 아니면 B 원 + "두 위치 모두 보기" | 해제 | 8-B2 |
  | 6 | A↔B 전환·비교 종료 | 조건을 만족하면 `panTo`, 아니면 맞춤. 잠금 중이면 `panTo`만 | 유지 | 8-B2 |
  | 7 | 사용자 휠·드래그·± | 잠금 | 켬 | 8-B1 |
  | 8 | 점포 선택·분석 완료·화면 전환·resize | zoom 변경 없음(점포 선택은 `panTo`) | 유지 | 8-B1 |

- 완료 조건: 단일 = 원 bbox ⊂ U(±1px) 이고 지름 ≥ 0.5 × min(U.w, U.h). 비교(가까움) = 두 원 ⊂ U(B 선택 때 "이미 완료" 판정은 지금 zoom ≥ A∪B 맞춤 zoom일 때만 — 넓게 본 작은 두 원은 완료가 아님). 비교(멂) = B 원 단일 조건 + 버튼. 점포 선택·Escape·크기 변경 20회 뒤 zoom 불변. 우리 오버레이가 NAVER 로고·축척(켠 경우 저작권 표기)과 겹치지 않음.
- 구현 수단(`frontend/src/map/mapFit.ts`, `MapView.tsx`):
  - zoom 직접 계산: `z = clamp(round(지금 zoom) + floor(log2(min(U.w / w, U.h / h))))`(w·h = 지금 축척의 원 사각형 px, 소수 zoom은 반올림 차이만큼 크기를 고친다) → `setCenter(원 중심)` → `setZoom(z, false)` → `panBy(지도 중심 − U 중심)`. SDK `fitBounds`의 zoom 선택은 쓰지 않는다(8-B0: 비대칭 margin에서 한 단계 낮은 zoom).
  - 원 사각형은 지도 bounds로 직접 계산한다(경도 선형, 위도 Web Mercator). GL 모드는 `Circle.getBounds()`가 오류를 내고 SVG 요소도 없다(A3 NAVER 검수 스파이크).
  - GL·래스터 축척: 같은 축척에서 GL zoom = 래스터 zoom − 1(실측 z15: 래스터 3.791 m/px, GL 1.895 m/px). 맞춤은 px로 재므로 단위와 무관하고, zoom 기준값(비교 13)은 래스터 기준으로 환산해 비교한다(`rasterZoom`).
  - 지도 `init` 이벤트 전에는 맞추지 않고 미룬다(GL은 init 전 `getBounds`가 오류). 대기 시간 초과를 준비로 보지 않는다. 지도가 숨겨졌을 때(크기 0)도 미뤘다가 보이고 `setSize`한 뒤 1회.
  - 잠금 감지는 SDK `zooming`·`dragstart`(우리 `setCenter`·`setZoom`·`panBy`는 내지 않는다, 8-B0). 실제 입력 확인(2026-10-14): 휠 → `mousewheel`·`zooming`, 드래그 → `dragstart`.
  - U: 우리 오버레이 DOM 사각형 + SDK 컨트롤(z-index 100 바깥 요소). SDK 컨트롤을 못 찾으면 실측 크기(확대 SMALL 50×79 오른쪽 위, 로고·축척 158×17 오른쪽 아래)로 대신한다. 장애물마다 면적을 가장 적게 잃는 변 쪽으로 밀고 8px 띄운다.
  - 확대 컨트롤: SDK `zoomControlOptions.style = SMALL`.
  - GL은 검수용 선택(`VITE_NAVER_MAP_GL=1`, 기본 끔). 커스텀 스타일(D-023)은 UI 개편 단위에서 적용한다.
- 점포 정보창 배치: 정보창은 U 안에 있고 분석 핀(`.map-marker`)을 가리지 않는다. 우선순위 U 안 > 핀 가림 없음 > 이동 최소. SDK 정보창은 마커 위에만 열리므로 공식 옵션(`setOptions`: `pixelOffset`·`disableAnchor`·`anchorSkew`, 동기 재배치 실측)으로 기본 → 점포 아래(꼬리 없음) → 옆(꼬리 기울임, 이동이 작은 쪽)을 시험하고, 지도를 그대로 두고 맞는 위치가 없으면 핀을 덮지 않는 위치 중 지도 이동(`panBy`, zoom 불변)이 가장 작은 것을 고른다. 점포 선택의 `panTo`가 끝난 뒤(`idle`, 없으면 1.5초) 잰다. 단일·비교 모두 같은 규칙이다(비교는 A·B 핀, 8-B2).
- 비교(8-B2): 맞춤 요청은 동작 단위(`single`·`union`·`b-select`·`focus`)로 미루고, 실행 때 지금 상태에서 의미가 있는지 다시 본다(단일은 비교 밖, 비교 동작은 비교 중 + B 있음, A로 이동은 A 있음). 비교를 시작하면 미뤄 둔 단일 맞춤을 버리고, 비교를 끝내거나 B를 지우면 미뤄 둔 비교 맞춤을 버린다. 최신 상태는 크기 맞춤 layout effect보다 먼저 반영한다(Codex 검수 2026-10-14 회귀). A∪B는 두 원 사각형의 합을 직접 계산해 그 중심에 맞추고(SDK `fitBounds` 미사용), 기준 zoom 13은 `rasterZoom`으로 환산해 비교한다. 순위 6의 "조건 만족"은 그 원을 지도 중심에 놓았을 때(=`panTo` 뒤) 단일 조건이다. 점포 기준(A/B)은 B 분석 성공 뒤에만 생기며, 처음 생길 때(null → A/B, 분석 완료)는 움직이지 않는다(순위 8). 지도 버튼은 비교 중 B가 있을 때 "두 위치 모두 보기", 단일은 "범위에 맞추기".
- 이유: z11에서 500m 원이 지름 약 16px로 점처럼 보여 선택 위치·범위·점포를 함께 읽을 수 없었다(`docs/UX_REDESIGN.md` P1). 화면이 튀는 문제는 사건별 우선순위 + 사용자 잠금 + resize·점포 선택 불변으로 막는다.
- 검증(8-B1, 2026-10-14): `mapFit.test.ts` 14건(맞춤·U·정보창 후보), `MapView.test.tsx` 단일 맞춤 10건(사건별·숨김·init 전·잠금·20회 불변·SMALL), production build 1280×800·970×800·800×600·375×667·360×740 실측 — 맞춤(원 ⊂ U, 지름/U 짧은 변 0.53~0.92, 원 중심 − U 중심 ≤ 1px, 로고·축척 가림 0), 폭마다 점포 12곳 정보창(⊂ U·핀 가림 0, 수정 전 1280에서 3곳·970에서 9곳 실패), 점포 선택 중 zoom 불변. mobile은 패널(지도 숨김)에서 고른 뒤 지도로 돌아오는 순위 4 경로. GL 빌드 1280×800(핀 = U 중심, 축척 1.887 m/px로 추정한 원 530px·0.89). 실제 입력: 클릭 선택·휠(`zooming`)·드래그(`dragstart`) 뒤 자동 재맞춤 없음, 키보드 Enter로 "범위에 맞추기". 회귀: 주소 검색 선택, 분석·점포 목록, A/B 비교(B 선택 `panTo`·zoom 유지, 비교 종료 뒤 단일 범례 복귀). 미검증: 실제 모바일 기기 터치 pinch·탭(에뮬레이션은 마우스 클릭이라 지도 탭 선택이 되지 않음 — 좌표 입력으로 대신), 창이 가려져 그리기가 멈춘 상태의 GL(init이 오지 않아 맞춤을 미룸 — 설계대로).

- 검증(8-B2, 2026-10-16): `MapView.test.tsx` 비교 맞춤 정책 테스트(가까운 B → A∪B·버튼, 먼 B → B 원 + 버튼 → 누르면 기준 미만이어도 A∪B, 래스터 z12 → B만 / GL z12(래스터 13) → A∪B, A↔B 전환 panTo·맞춤·잠금 중 panTo만, 분석 완료로 기준이 처음 생길 때 이동 없음, 숨김 중 B 선택 1회 실행·숨김 중 비교 종료 시 B 대기 버림, 비교 중 크기 변경·점포 선택 20회 zoom 불변, A 단일 맞춤 없이 넓은 zoom에서 고른 B), production build 1280×800 실측 — 가까운 B(약 1.6km) A∪B·버튼 노출, 송도 B(약 12km) B 원만 → "두 위치 모두 보기"로 두 원 ⊂ U, B 분석 완료 때 이동 없음, A 전환 맞춤 → B 전환 같은 zoom `panTo`, 비교 점포 5곳 정보창 ⊂ U·A/B 핀 가림 0, 비교 종료 → A 맞춤·단일 범례 복귀. 375×812: mobile 패널(지도 숨김)에서 B를 고르고 지도 보기 → A∪B 1회 맞춤, 로고·축척 가림 없음. **브라우저 확인 중 찾은 결함 수정**: mobile에서 지도가 숨은 채 A를 고르고 곧바로 비교하면 A 단일 맞춤이 없어(비교 시작이 대기 맞춤을 버림) 기본 z11에서 작은 두 원이 이미 U 안이라 "완료"로 보고 움직이지 않았다 → 비교(가까움) 완료는 "두 원 ⊂ U이고 지금 zoom ≥ A∪B 맞춤 zoom"으로 판정(회귀 테스트 추가). 미검증: 970·800×600·360 폭의 비교 실측, GL 빌드의 비교 화면(래스터 환산은 단위 테스트만), 실제 모바일 기기 터치.
- 검수 회귀 수정(Codex 2026-10-16): ① 미뤄 둔 B 맞춤이 그 사이 켜진 잠금을 무시하고 지도 복귀 때 zoom을 바꿈 → 미룬 동작 실행 때 잠금이면 맞추지 않는다(기준 전환·비교 종료는 잠금 중 `panTo`만, 순위 4·6). ② 숨김 중 기준 B→A 전환 뒤 B를 다시 고르면 폐기돼야 할 A 이동이 실행됨("A로 이동은 항상 유효" 판정) → 비교 종료(→A)와 기준 전환을 나눠, 기준 전환은 비교 중 + B 있음 + 그 기준이 아직 지금 기준일 때만 유효. 회귀 테스트 3건(수정 전 코드에서 2건 실패 확인). **재검수 통과**(Codex 2026-10-17, 추가 결함 없음).

## D-023 8차 디자인 방향: A3 지도 탐색형 · 블루안, NAVER 지도 다크 스타일과 밝은 대체 (2026-10-14, 사용자 결정)
- 결정: 8차 UI 목표는 **A3 지도 탐색형**(지도 전체 + 떠 있는 결과 패널, mobile은 지도 + 하단 시트) **블루안**(딥 네이비 + 블루 강조 + 민트 보조 + 로즈 경고)이다. `docs/UX_REDESIGN.md`의 계획 기준 "방향 2 「요약 보고서형」"은 레이아웃·색에서 대체하고, 내용 규칙(헤드라인·주의 요약 띠·근거 줄·탭 구성·경고 항상 노출)은 A3 안에서 유지한다. 시각 규칙은 `DESIGN.md` §19. 구현은 단계별 검수(8-B1 지도 맞춤 → UI 개편 단위)이며, 구현 전까지 화면은 `DESIGN.md` §1~§18 그대로다.
- NAVER 지도 표시:
  - 다크 지도는 NAVER Style Editor 새 스타일 `harness-a3-blue-dark`(어두운 테마에서 새로 생성, 기존 스타일 덮어쓰기 없음)를 GL(`gl: true` + `customStyleId`)로만 적용한다. 지도 이미지에 CSS 필터를 씌우지 않는다.
  - **밝은 대체 지도**: GL 미지원(실측: 소프트웨어 렌더러는 래스터로 대체)·스타일 요청 실패·스타일 미적용이면 NAVER 기본 밝은 지도를 쓰고 오버레이를 밝은 팔레트로 바꾼다(검수 통과 2026-10-14). 다크 팔레트는 실제 GL + 스타일 적용이 확인될 때만.
  - 로고·축척·지도 데이터 저작권은 왼쪽 아래(결과 패널이 오른쪽), 저작권 줄 뒤에 배경 띠(SDK 요소는 숨기거나 바꾸지 않음 — 공식 옵션은 위치뿐)로 대비를 확보한다.
- 요금(2026-10-14 공식 요금표 확인): Web·Mobile Dynamic Map 대표 계정 월 6,000,000건 무료, 초과 0.1원/건(VAT 별도). Style Editor 별도 과금 행 없음. 사용자가 콘솔 설정·무료 이용 조건을 확인했다. 미확인: Dynamic Map 1건의 집계 단위, GL·스타일 요청의 별도 집계 여부.
- 상태: 스타일 생성·발행은 콘솔 Style Editor(`style-editor.map.naver.com`)에서 사용자가 한다(이 작업 환경의 브라우저에서 열리지 않음). My Style ID는 저장소에 넣지 않고 `frontend/.env`에만 둔다. 다크 GL 실제 검수 **통과**(2026-10-15, 검수 스파이크): GL + 스타일 요청 200 + 실제 화면 다크, 점포 점 대비 최소 3.53·핀 5.29, 음식점·쇼핑 브랜드 POI 꺼짐(재발행 `20261015001123`, 은행·역·출구·건물 이름은 유지), 로고·저작권·축척·버튼 가림 0, 저작권 띠는 다크에서 옅은 회청색(`DESIGN.md` §19.3). 미확인: 1440 전체 화면 GL의 1:1 대비, 실제 모바일 기기. 재현·기록: `docs/spikes/a3-naver/`.
- 스타일 실패 복구(제품 적용 규칙 — **제품 미구현, 검수 스파이크에서만 검증**): SDK는 스타일 실패(예: 잘못된 ID → `styler/props` 400) 때 기본 지도로 대체하지 않고 `init`도 내지 않는다. 그래서 앱이 실패(스타일 요청 200 아님 또는 보이는 동안 `init` 8초 초과 — 숨겨지면 멈추고 다시 보이면 새로 셈)를 감지해 실패한 지도를 정리하고 `gl: false`·스타일 없이 한 번만 다시 만들며, 밝은 지도도 실패하면 오류로 끝낸다. 세부는 `DESIGN.md` §19.3.1.

## D-024 엔진 v0.4(`mvp-0.4`): 분석 반경 300·500·1,000m (2026-10-16, 8-D1, 사용자 지시로 보류 해제)
- 결정: 반경 선택은 엔진 버전 변경으로 한다(D-006, `docs/UX_REDESIGN.md` 4.1 B안). `scoring_engine/v0_4/` = v0.3 사본 + 최소 diff — `config.RADIUS_OPTIONS_M = (300, 500, 1000)`, `scoring.analyze(..., radius_m=None)`·`score_competition(..., radius_m=None)`이 받은 반경을 경쟁성 raw `반경m`·`meta.분석반경_m`에 기록, 허용하지 않는 반경은 `ValueError`, `엔진버전 = "mvp-0.4"`. 사본의 팀 단위 테스트 `test_access.py`는 엔진버전 단언 한 줄만 `mvp-0.4`. 원본·`v0_3/`·golden v0.3·원본 매니페스트는 그대로.
- 로딩: 엔진은 프로세스당 하나(평면 import라 공존 불가). `SCORING_ENGINE_VERSION = v0_3(기본) | v0_4`로 `scoring_engine/__init__.py`가 디렉터리·`ENGINE_VERSION`·`RADIUS_OPTIONS_M`(v0.3은 `(500,)`)을 정한다.
- 어댑터: `AnalysisService.analyze(..., radius_m=None)`(엔진이 받는 반경만, v0.3에는 `radius_m`을 넘기지 않음), `ReferenceCache.competition(biz, radius_m)` 키 = (업종, 반경)(반경마다 비교 모집단이 다르다), `warm()`은 엔진이 받는 반경 전부(v0.3은 그대로 29개, v0.4는 87개). 입지 reference는 반경과 무관(14개).
- 분석 가능 지점 판정(`ContextBuilder`의 반경 안 점포 0개 → `NoDataNearby`, D-011)은 **500m 기준 그대로**다. 300m 안에 같은 업종이 없으면 엔진의 기존 규칙(경쟁성 미산출 + 경고)으로 처리한다.
- 무결성·검증(`tests/test_engine_v0_4_diff.py`, `tests/engine_v0_4/`, `scripts/check.py` "pytest: engine v0_4" 단계 — `SCORING_ENGINE_VERSION=v0_4` 프로세스):
  - 사본: 파일 해시 = `tests/manifests/engine_v0_4.sha256.json`, 바뀐 파일은 `config.py`·`scoring.py`·`test_access.py`뿐, 추가 줄은 반경·버전 표식을 담고 지운 줄은 모두 추가 줄을 v0.3 표기로 되돌린 것(로직 삭제 없음).
  - V-legacy: v0.4@500(기본·명시) = golden v0.3, 다른 곳은 `meta.엔진버전` 하나(29업종).
  - V-radius: v0.4@300·1,000 = golden v0.4(`tests/golden/v0.4/r300`·`r1000`, `scripts/golden_v0_4.py`로 생성, 덮어쓰기 거부), 500 대비 바뀐 곳 ⊂ {경쟁성 지표, 종합, 경고, `meta.분석반경_m`, `meta.엔진버전}`.
  - V-web500: v0.4@500 = v0.3 웹 경로(`ContextBuilder`, rent=None) 4지점 × 29업종(v0.3은 별도 프로세스), 다른 곳은 `엔진버전`뿐.
- 검수(2026-10-17): Codex 재검수 통과(추가 결함 없음) — v0.3 287건·v0.4 42건·원본 무결성·backend 107·frontend 464. Codex의 전체 check는 샌드박스 대기로 중단, 남은 단계는 단계별로 통과. Claude 로컬 전체 check 1회 통과(그 직전 1회는 무관한 `ScoreGuide.test.tsx` 시간 초과로 FAIL, 원인 미확인).
- 범위: 8-D1은 엔진·어댑터·검증까지다. API(`radius_m` 요청·`/health` 반경 광고·점포 반경)는 8-D2, 프런트(반경 chip·결과 캐시·상태표 S1~S15·버전 enum)는 8-D3, 운영 배포 순서는 `docs/UX_REDESIGN.md` 4.6. 운영 서버는 `SCORING_ENGINE_VERSION`을 설정하지 않으면 지금처럼 v0.3이다. 공용 캐시 hit 경로 수정(8-D2a)은 범위 밖.
