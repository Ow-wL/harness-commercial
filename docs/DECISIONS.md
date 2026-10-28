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

**2026-10-19 개정(사용자 결정, 묶음 C — `docs/DATA_VERSIONING.md`): 데이터 교체는 엔진 버전과 다른 축이다.** 위 "데이터를 바꾸면"은 **점수 공식·설정·입력 계약**이 바뀌는 경우로 좁힌다. 같은 스키마의 새 시점 자료는 `data/versions/<id>/` + `manifest.json`으로 두고 `DATA_VERSION`으로 고른다. 기존 golden(v0.3·v0.4)은 계속 `data/runtime`(데이터 버전 `2026-06`, 원본 바이트 동일 사본)으로 통과시키며 새 데이터 버전에 golden을 만들지 않는다. 대신 (a) `scripts/etl/validate_version.py` 7단계 검증과 (b) 부평역 29업종 스냅샷(`snapshot/`)을 매니페스트에 기록해 이전 버전과 차이 보고서(`diff_report.py`)로 비교한다 — 점수 변화는 정상, 미산출·NaN·오류 증가는 실패. 엔진 상수가 바뀌어야 하는 갱신(임대료 분기 `etl_rent.QUARTERS`)만 엔진 버전으로 다룬다. 적용은 새 이미지·새 리비전(무트래픽 → warm → 전환)이며 실행 중 프로세스의 파일을 바꾸지 않는다. 적용은 반자동(수집·검증·보고서 자동, 전환은 사용자 승인). 프런트 표시·캐시 키 연결은 묶음 A 뒤 별도 단위(TASKS 9-C4).

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
- 8-D2 API(2026-10-17, 구현 완료·**검수 통과**): `/analyze`·`/nearby-stores`의 선택 필드 `radius_m`(JSON 정수, 생략·null = 500). 엔진이 받는 값이 아니면 422 `invalid_radius`(새 오류 코드 — v0.3 서버는 500만 받으므로 300을 보내면 이 오류; 옛 서버처럼 조용히 500으로 계산하지 않는다). 검증 순서 업종 → 분석 옵션 → 반경 → 좌표. `GET /health`에 `engine: {version, radius_options, default_radius_m}` — v0.3 서버는 `[500]`, 이 필드가 없는 옛 서버와 함께 프런트는 "반경 선택 없음"으로 본다(`docs/UX_REDESIGN.md` 4.6 서버 세 종류 표). 서버가 바뀐 뒤 열린 브라우저의 복구는 두 경로 — R1 구버전(300 요청 → 500m 응답 → S5), R2 새 v0.3(300 요청 → 422 `invalid_radius`) — 모두 `/health` 재조회 → 500 복귀·반경 ≠ 500 캐시 폐기·재분석 1회(비교 중이면 A·B 모두 500), 8-D3 구현·테스트 필수. background warm은 반경이 여럿이면 (업종, 반경) 87개 단위로 500m를 먼저 끝낸다(종료 신호 뒤 남는 계산은 build 1개).
  - 검증: `backend/tests/test_radius.py`(v0.3 프로세스 26건 — 광고, 생략·null·500 동일, 300·1,000 등 거절, 정수만, 검증 순서, OpenAPI, warm 단위), `tests/engine_v0_4/test_backend_radius.py`(v0.4 프로세스 19건 — 광고 3개, `/analyze` pass-through 반경별, 점포 수 = 같은 반경 경쟁성 `동종점포수`(부평역·송도), 부평역 PC방 6/12/17, 거절). 기존 OpenAPI 계약 테스트에 선택 필드 `radius_m` 추가.
  - 검수(2026-10-17): Codex 검수 통과(API 기능, 추가 코드 결함 없음) — Codex 직접 검증: backend 133건 + v0.4 API 19건(152건) 통과, 실제 v0.4 uvicorn에서 `/health` 광고·부평역 PC방 반경별 점포 6·12·17곳 확인. Codex는 전체 check 9단계를 재실행하지 않았고 성능 수치도 재측정하지 않았다 — 전체 check 통과(9단계)와 성능 수치는 Claude 로컬 1회 실행 결과다.
  - 성능(Claude 로컬, `docs/UX_REDESIGN.md` 4.7 — 같은 측정 스크립트, 참고값): v0.4 `load_runtime` 5.6s, 업종 1개 cold 2.9~3.1s(반경별), **warm 87개 264.5s**(v0.3 29개 90.4s). warm 중 이미 계산된 키 `/analyze`(hit) 중앙값 2.8s·p95 5.8s·최대 7.1s, warm 중 cold 6.2~7.2s — v0.3도 warm 중 같은 수준(중앙값 2.8s·p95 7.2s, cold 3.5~7.1s)이다. 원인은 `ReferenceCache`가 build 동안 전역 lock을 쥐는 기존 구조(당시 측정 — 이후 8-D2a에서 hit 경로 수정). 반경 추가로 요청당 지연은 늘지 않았지만 **느린 구간이 약 3배(90s → 265s) 길어진다** — v0.4 운영 전환(4.6 ③) 전에 8-D2a 여부를 정해야 한다.
- 8-D2a 캐시 잠금(2026-10-17, 구현 · Codex 검수 수정 2건 반영 · **캐시 동시성·기능 Codex 재검수 통과**): `ReferenceCache` hit는 잠금 없이 읽는다(값은 계산이 끝난 뒤 한 번의 dict 대입으로만 넣는다). miss는 build 실행권 하나로 한 번에 하나씩 계산하고(공유 DataFrame 동시 계산 없음 — 지금과 같은 직렬화), 실행권을 얻은 뒤 다시 확인해 같은 키는 1회만 계산한다. 실패하면 저장하지 않고 실행권을 돌려줘 대기자가 진행한다. background warm은 실행권을 기다리는 요청이 있으면 실행권을 얻지 않는다. 실행 중 여부와 대기 요청 수는 `Condition` 하나가 지켜 warm의 대기 확인과 실행권 예약이 한 번에 일어난다(잠금은 이것 하나, build는 잠금 밖 — 교착 없음). 대기 요청들 사이의 순서(FIFO)는 보장하지 않는다. 점수·엔진 사본·golden 불변.
  - Codex 검수 수정(2026-10-17): ① 1차 구현은 warm의 대기 확인(`Condition`)과 build 잠금 획득이 분리돼, 확인 직후 멈춘 사이 요청이 오면 warm이 먼저 build를 시작할 수 있었다 → 단일 `Condition`으로 확인·예약을 합쳤다. ② 측정 스크립트가 캐시 직접 조회 전에 읽은 build 상태를 뒤이은 API 요청에도 썼다 → v2로 고쳤다(요청마다 시작 시점 상태, 원본에 요청·build 구간, 고정 도착 일정). 1차 결과 파일은 보존하고 한계를 적었다.
  - 검증: `tests/test_reference_cache_lock.py` 8건 — 다른 키 build를 `Event`로 멈춘 채 hit 완료(경쟁성·입지), `Barrier(8)` 같은 키 1회, 실패 시 미저장·잠금 해제, 실패한 build 뒤 대기자 진행·실행권 미잔류, miss 한 번에 하나, warm 양보 순서, **warm 확인·예약 사이 틈 재현**(warm 스레드를 첫 잠금 블록 직후에 멈추고 요청을 끼워 넣음). 틈 재현 테스트는 1차 구현에서 실패·수정본에서 통과(수정본 5회 반복 통과). 처음 hit·warm 양보 2건은 8-D2a 이전 코드에서 실패 확인(1차 보고).
  - 성능 기준(검수 합의안): 캐시 hit 비차단은 구조(hit 경로가 build 잠금을 잡지 않음)와 위 회귀 테스트로 검증한다. 캐시 직접 조회와 API 응답 시간은 따로 재고, API 중앙값·p95·최대는 기록만 한다(50ms 달성·새 상한 주장 없음). warm 비용은 요청 없는 같은 조건에서 순서를 교차해 반복 측정하고, 부하 비교는 요청 수·도착 일정을 같게 한다.
  - 측정(Claude 로컬, 각 1회, `docs/spikes/8-D2a/README.md` v2): v0.4·같은 부하(0~60초, 0.25초 간격 고정, 캐시 121·API 120·cold 3) — 캐시 직접 조회 중앙값 1,981ms → 0.0ms(p95 0.1ms), API hit 중앙값 2,956ms → 82.4ms(p95 110.0ms·최대 226.4ms, 경합 없을 때 35ms). 같은 부하에서 수정본의 cold 요청(4.4~7.4s vs 3.1~5.3s)과 warm 완료(287.7s vs 205.3s)는 더 늦었다(원인 미확인). 요청 없는 warm 교차 3쌍(v0.3 29개): 변경 전 평균 72.7s, 수정본 81.6s, 3쌍 모두 수정본이 느림(+2.9~+19.3s) — 잠금 처리 비용은 호출당 약 1.3µs라 이것만으로 설명되지 않으며 원인 미확인. 1차의 12% 차이도 원인 미확인. 미측정: 실제 서버, 실제 동시 부하, 반복 분산, v0.4 요청 없는 교차 비교. 측정 스크립트 보완(재검수 지적): 저장된 v2 부하 측정의 cold 요청 3건은 예정(10·25·40초)보다 약 0.25초 일찍 시작했다(두 실행 동일). 스크립트는 고쳤고(짧은 실행으로 시작 ≥ 예정 확인), 저장 결과는 다시 재지 않았다.
  - 판정(재검수 2026-10-17): **캐시 동시성·기능 — Codex 재검수 통과**(Codex 직접: 캐시 잠금·기존 캐시·backend 146건 + v0.4 API 19건 = 165건, 전체 check·장시간 성능 측정은 재실행 안 함). **성능 — hit 비차단 확인**(구조 + 회귀 테스트), 실제 API 지연은 측정값만 기록. **warm 시간 증가 — 원인 미확인**, 이 단위는 운영 성능 승인·최적화 완료를 주장하지 않는다. v0.4 운영 전환 전 추적 항목 8-D2b(warm 증가 원인·영향, 실제 서버 성능).
- 8-D2b 성능 확인(2026-10-18, Claude 로컬 측정 · **로컬 측정·분석 검수 통과**, `docs/spikes/8-D2b/README.md`): 검수(2026-10-18): **로컬 측정·분석 검수 통과**(Codex 재검수) — Codex 직접: 관련 테스트 8건 통과, 서버 종료 테스트 추가 3회 연속 통과, 가짜 서버 잔류 0, 보호 경로 변경 없음, `git diff --check` 통과. Codex는 전체 check와 장시간 측정을 재실행하지 않았다 — 전체 check(9단계, 마지막 1회 통과)와 모든 성능 측정값은 Claude 로컬 실행 결과다. 운영 성능 승인·최적화 완료·운영 전환 승인이 아니다. 운영 v0.4 전환 전 필수 조건(vCPU 1·1Gi 조건 측정, 컨테이너 메모리 확인, 시작 직후 cold 지연 수용 판단)은 미완료. v0.3 → v0.4 warm 증가는 build 수 3배(29 → 87) 때문임을 확인했다 — build 단위 분해에서 warm 시간의 97%가 `build_reference` 계산, CPU 시간 ≈ 경과 시간, 동시 build 1, 키당 2.3~3.9초(실행마다 다름), 1,000m가 약 6% 길다. 8-D2a 캐시 변경에 따른 일관된 warm 지연 증가는 이번 측정(같은 조건 교차 반복)에서 관측되지 않았다(v0.4 요청 없음 2쌍: 245.58/245.52초·265.94/263.73초, 키별 비율 중앙값 0.998; 같은 부하 TestClient 4회·로컬 uvicorn 4회 warm 완료 시각 겹침). 8-D2a에서 관측한 차이의 원인은 미확인(같은 계산의 CPU 시간이 실행마다 크게 달라짐 — 기계 상태 추정, 확인 안 함). 로컬 uvicorn(v0.4, worker 1, 별도 프로세스 HTTP): 준비 6.5~9.2초, warm 298~341초(500m 29개 135~146초), warm 중 hit 수정본 중앙값 87~98ms·p95 116~123ms(변경 전 6.7~9.5초), cold 수정본 4.7~10.1초(변경 전 4.9~19.0초), warm 뒤 hit 43~53ms. 메모리(로컬 Windows working set): v0.4 87개 warm 뒤 140~179MiB, 최대 196MiB. Docker 미검증(데몬 미실행). 측정 스크립트 보완(Codex 검수): warm 스레드 예외·캐시 미완성·warm failed·대기 기한·서버 종료·엔진 광고 불일치·HTTP 오류를 실패/무효로 처리(테스트 `tests/test_bench_scripts.py` 8건 — 보완 전 사본 8건 실패·보완 후 8건 통과). 기존 결과는 보완 전 스크립트로 잰 것이며 사후 확인(캐시·build 수, 엔진 광고, warm failed 없음, 측정 요청 244건 모두 200) 결과 무효 사유는 보이지 않았다. uvicorn warm 뒤 30회의 상태 코드는 확인 불가. 지연 상한·성능 개선 완료는 주장하지 않는다. 운영 v0.4 전환 전 남은 조건: Cloud Run 같은 조건(vCPU 1·1Gi) 측정, 시작 직후 약 5분 cold 지연 수용 여부 결정, 컨테이너 메모리 확인.
- 8-D3 프런트(2026-10-17 구현, 검수 수정 3회, **2026-10-18 재검수 통과**): 반경 선택은 `/health`의 `engine.radius_options`가 2개 이상일 때만 보이고 `radius_m`을 보낸다(구버전 서버·새 v0.3 서버·`/health` 실패는 숨김, body 그대로). 결과 캐시(lat·lng·업종·반경, LRU 12, 점포만 실패한 부분 캐시, 응답 엔진버전이 바뀌면 전체 폐기), 분석·점포 응답의 반경 대조, 엔진버전 enum(`mvp-0.3`·`mvp-0.4`, 비교 A·B 버전이 다르면 B 계약 오류). 비교 중 반경 변경은 A·B를 같은 새 반경으로 동시에 다시 분석하고(B 위치 유지), A가 실패하면 비교를 유지한 채 다시 시도가 A·B를 함께 요청한다. 복구 R1(반경을 보낸 요청이 다른 반경 응답)·R2(`invalid_radius`, 분석·점포·B 모두): `/health` 재조회 → 그 반경을 아직 광고하면 오류로 둔다, 아니면 반경 선택 숨김(광고 2개 미만)·반경 500·반경 ≠ 500 캐시 폐기·안내·500m 재분석 1회(비교 중이면 A·B, 500 캐시가 있으면 요청 0). 재분석은 반경을 보내지 않거나 500이라 같은 복구를 반복하지 않는다. 지도 원 반경·범례·맞춤은 선택 반경을 따른다(D-022 순위 3). 설계와 다르게 구현한 점은 `docs/UX_REDESIGN.md` 4.5a.
  - 검증: vitest 503건(App 8-D3 20건 — 서버 세 종류 광고·body, S1·S2·S3·S5·S8·S15·부분 캐시, R1·R2(분석·점포)·복구 반복 없음·광고 유지 시 미복구, 비교 S9·S11·비교 중 R2(캐시 없음/있음)·A·B 버전 불일치; 결과 캐시 5건; MapView 반경 4건; 스키마: golden v0.4 58개 계약 통과·`/health` 세 종류·`invalid_radius`), 타입·lint·build. 실제 브라우저(production build + vite preview, Claude 로컬): v0.4 서버 — 분석 전 1km 선택 시 지도 원만 바뀜·요청 0, 1km 분석(부평역 PC방 종합 69.0·경쟁성 44.8, 4.2 실험값과 같음) → 500m(요청 1) → 1km(캐시, 요청 0); R2 — 페이지를 연 채 서버를 새 v0.3으로 바꾼 뒤 300m → 422 → `/health`([500]) → 안내·선택 숨김·500m 결과(캐시); R1 — 8-D2 이전 백엔드(`9bda13e` worktree)로 바꾼 뒤 300m 분석 → 200(500m 응답) → `/health`(engine 없음) → 안내·선택 숨김·500m 재분석 1회(radius_m 없음). 미검증(1차 보고 당시): 비교 중 반경 변경·복구의 실제 브라우저 확인, mobile 폭, 실제 운영 환경(Cloud Run 리비전 전환).
  - Codex 검수 결함 4건 → 수정(2026-10-17): ① A·B 엔진버전 대조를 응답 순서와 무관하게(B 성공 상태에 B 요청을 두고, 같은 세대(업종·반경 같음)면 A·B 중 나중에 도착한 쪽에서 대조 → 다르면 B 계약 오류 + 캐시 전체 폐기). ② 비교 점포 다시 시도는 원래 요청 그대로(A = A 분석 요청, B = B 분석 요청 — 반경 포함, 구버전 서버면 반경 없음). ③ 반경 복구 때 `/health`가 알린 엔진 버전이 캐시 버전과 다르거나 engine 이 없는 구버전 서버면 500m 캐시까지 전부 버리고 새 서버에서 다시 조회(같은 엔진일 때만 반경 500 재사용). ④ 요청 세대 번호 — 새 분석·B 요청·반경 변경·조건 변경·비교 시작/종료/다시 고르기 때 올리고, 복구용 `/health` 응답은 시작 때 세대와 같을 때만 광고·반경·캐시·안내·요청을 바꾼다. Codex 재현 테스트 4건은 수정 전 4건 실패·수정 후 4건 통과, 정식 테스트로 옮겨 추가(A 먼저/B 먼저 버전 대조, A·B 점포 재시도 300m·1km·구버전 서버, 다른 엔진·구버전 서버 복구 캐시 폐기, 복구 뒤 새 B 정상 비교, 늦은 `/health`) — App 8-D3 28건, vitest 511건. 실제 브라우저(1280): 비교 중 1km 전환(A·B 함께, 상태 줄·범례 1km)·500m 복귀(요청 0)·새 v0.3 서버로 바꾼 뒤 300m → A·B 422 → `/health` → 캐시 폐기 → A·B 500m 재요청 → 비교 요약(엔진 mvp-0.3) → 새 B(송도2동) 정상 비교. 모바일 375×812: 분석 전 반경 버튼(44px, 가로 넘침 없음), 1km 분석 뒤 지도 보기에서 1km 원 맞춤, 패널(지도 숨김)에서 300m 변경 뒤 지도 복귀 시 300m 원 맞춤, 비교 요약 위 반경 버튼·1km 전환·지도 범례 A·B 1km. → 재검수 통과(2026-10-18)
  - Codex 재검수 경합 2건 → 수정(2026-10-18): ① A·B가 같은 React 배치에서 함께 끝나면 두 콜백이 렌더 전 ref를 읽어 버전 대조를 건너뛰던 문제 — 분석·비교·비교 재분석 상태를 바꾸는 setter가 state와 ref를 같은 자리에서 함께 바꾸게 하고(콜백이 서로의 최신 결과를 읽음), 렌더도 보호한다: 화면은 A·B가 같은 업종·반경 요청이고 엔진버전도 같을 때만 비교 성공으로 보며, 아니면 B를 분석 중처럼 다룬다(섞인 결과를 비교표에 그리지 않음). 불일치의 B 계약 오류·캐시 전체 폐기는 그대로. ② 무효가 된 이전 복구가 새 세대 복구를 막던 문제 — 복구 진행 표시를 세대별로(같은 세대의 A·B 중복 복구만 건너뜀), 새 세대 문제는 이전 복구를 기다리지 않고 새로 `/health`를 보며, 이전 복구의 정리는 새 세대 표시를 건드리지 않는다. Codex 재현 2건 수정 전 실패·수정 후 통과, 정식 테스트로 옮김(같은 배치 A→B·B→A, 이전 /health 보류 중 새 세대 복구·재분석 1회) — App 8-D3 31건, vitest 514건. 실제 브라우저(1280) 짧은 확인: 300m 비교 → 1km 전환(A·B 재분석, 비교 요약 유지) → 300m 복귀(요청 0). → 재검수 통과(2026-10-18)
  - Codex 재검수 회귀 1건 → 수정(2026-10-18): 렌더 보호용 표시 상태(B를 분석 중처럼 보임)를 반경 잠금·반경 변경 진입·지도 클릭·B 선택 판단에도 써서, A 실패·B 성공으로 요청이 모두 끝났는데 반경 버튼·"이전 반경으로"가 계속 비활성 — 실제 B 요청 진행(`compareRaw` loading)과 표시 보류를 나눠, 잠금(S15)은 실제 요청 중일 때만. 비교표 표시 보류는 그대로. Codex 재현 1건 수정 전 실패·수정 후 통과, 정식 테스트 2건(A 실패·B 성공 뒤 활성·캐시된 A·B 500m 비교 복귀 요청 0 / A 실패·B 요청 중 비활성 → B 완료 뒤 활성 — 둘 다 수정 전 판단으로 돌리면 실패 확인) — App 8-D3 33건. → 재검수 통과(2026-10-18)
  - **재검수 통과**(Codex 2026-10-18, 추가 결함 없음) — Codex 직접 검증: 경합 재현 2건·S11 복귀 버튼 재현 1건(3건) 통과, 프런트 타입 검사·lint·정식 테스트 516건·production build 통과. Codex는 전체 check 9단계와 브라우저 검수를 이번에 재실행하지 않았다. Claude 로컬: 단일 전체 check 1회 통과(9단계, SKIP 없음 — v0.3 295·v0.4 61·backend 133·frontend 516), 브라우저 확인은 앞 라운드 기록 그대로. 기능 검수 통과이며 운영 배포 승인·성능 검증 완료가 아니다 — v0.4 운영 전환 전 8-D2b(warm 증가 원인·영향, 실제 서버 성능) 필수.
  - 남은 미검증: 실제 운영 환경(Cloud Run 리비전 전환), 실제 모바일 기기, R1(구버전 서버)의 비교 중 복구 브라우저 확인(단위 테스트만), 1280·375 외 폭.
- 범위: 8-D1은 엔진·어댑터·검증까지다. API(`radius_m` 요청·`/health` 반경 광고·점포 반경)는 8-D2, 프런트(반경 chip·결과 캐시·상태표 S1~S15·버전 enum)는 8-D3, 운영 배포 순서는 `docs/UX_REDESIGN.md` 4.6. 운영 서버는 `SCORING_ENGINE_VERSION`을 설정하지 않으면 지금처럼 v0.3이다. 공용 캐시 hit 경로 수정(8-D2a)은 별도 단위(아래).

## D-025 화면 테마 전환과 행정구역 경계: 테마는 의도, 지도 톤은 결과 — 자체 구 라벨 없음 (2026-10-19, 묶음 A, 사용자 결정)
- 배경: 개선 계획(`docs/IMPROVEMENT_PLAN_2026-10.md`) 묶음 A. 사용자 요청은 라이트·다크 직접 전환, 지역명 가독성, 구 경계·인천 외곽선. 스파이크 `docs/spikes/9A-geo-theme/`.
- 결정 1 — 테마와 지도 톤 분리: `data-theme`(light·dark, 사용자 선택 저장 > 시스템 설정 > 다크)은 **의도**, `data-map-tone`은 **실제 렌더 결과**(D-023·§19.3 그대로). 테마가 바뀌면 지도를 그 테마에 맞게 다시 만들고(§19.3.1 세대·복구 경로 재사용, 중심·줌·오버레이·선택 이어받기), 스타일 실패 복구는 테마 선택을 바꾸지 않는다. 라이트 지도는 기본 밝은 지도이며 `VITE_NAVER_MAP_LIGHT_STYLE_ID`가 있을 때만 GL 라이트 스타일(사용자가 발행하면 쓸 수 있게 열어 둔 선택).
- 결정 2 — 첫 방문 기본값은 시스템 설정 따름(사용자 선택 2026-10-19 계획 승인에 포함: 권장안 채택), 한 번 고르면 고정. JS가 없거나 저장이 막혀도 다크(제품 기본).
- 결정 3 — 자체 구 이름 라벨을 만들지 않는다(사용자 결정 2026-10-19): 자체 라벨은 래스터 밝은 지도에서 NAVER 라벨과 같은 이름이 두 번 보이고(래스터 라벨은 SDK로 끌 수 없다), 줌 10 이하에서는 서로 겹친다. 지명은 NAVER 라벨 한 출처만 쓰고, 다크 스타일의 흐린 지명 색(§19.4 `#A7B3CA`/`#8593AE`)은 사용자가 Style Editor에서 밝게 재발행한다(재발행 뒤 §19.4 갱신).
- 결정 4 — 경계 파일: 행정동 158개를 union한 `data/geo/인천_시군구경계_2026.geojson`(구 11 + 외곽선 1, `scripts/build_geo.py`, 매니페스트 보호, 새 다운로드 없음). union 결과는 해안선·섬 윤곽을 따른다(넓은 해역 미포함). 면적 0 구멍 제거·표시용 단순화(구 1e-4°, 외곽 2e-4°, 소수 5자리) 규칙은 스크립트 상수. 위계·줌 단계는 §19.7. 밖 영역 dim은 쓰지 않는다.
- 검수에서 고친 것: 숨겨진 지도(mobile 패널 화면)에서 만든 GL 지도는 SDK가 래스터로 init 해 스타일 실패로 보였다 → 스타일 지도는 보일 때 만든다. SDK가 스타일을 캐시해 세 번째 스타일 지도부터 요청을 내지 않았다 → 이 세대 요청이 없으면 페이지에서 마지막으로 본 결과로 판정(`src/map/styleStatus.ts`).
- 검증: `docs/TASKS.md` 9장. 운영 미배포.

## D-026 점포 레이어: 업종 글리프는 Lucide 1세트 inline, 외부 연결은 검색 링크·네이버는 앱 스킴 기본 (2026-10-19, 묶음 B)
- 배경: 개선 계획(`docs/IMPROVEMENT_PLAN_2026-10.md`) 2-3(업종별 점포 아이콘)·2-4(네이버·구글 연결). 점포 마커가 모두 같은 점이라 업종이 보이지 않고, 점포를 실제 지도 서비스에서 확인할 길이 없었다.
- 결정 1 — 아이콘 세트: **Lucide(ISC) 하나**로 고정하고(§13), 라이브러리 패키지 대신 필요한 글리프의 24 grid path만 `frontend/src/lib/storeIcons.ts`에 inline으로 둔다(번들 의존성 0, 고지 `frontend/THIRD_PARTY_NOTICES.md`). 29업종 → 12글리프 + 폴백 `store`; 표는 그 파일 한 곳이고 테스트가 엔진 29코드 전부를 대조한다. 묶음 초안은 사용자 확인 전 가안이다 — 표만 바꾸면 된다.
- 결정 2 — 표현 전환: 래스터 기준 줌 ≥15 아이콘 24px / 13~14 아이콘 16px / ≤12 점, 같은 줌에서 N ≥ 80이면 점(단순 임계, 클러스터링 없음 — NAVER MarkerClustering 데모 스크립트는 쓰지 않는다). 마커 수는 그대로이고 전환은 `setIcon`만 한다. 선택 점포는 같은 크기 + 바깥 링 + zIndex 최상, A·B 핀은 기존 글자 마커(모양으로 구분).
- 결정 3 — 외부 연결은 **검색 결과 링크**: 데이터에 네이버·구글 장소 ID가 없고 상가업소번호는 그 ID가 아니다(간주 금지). 선택 점포에만(정보창 + 목록 선택 항목) "네이버 지도 · 구글 지도", 문구 "검색 결과로 열립니다(같은 가게가 아닐 수 있음)". 검색어는 상호·주소(좌표 아님), 둘 다 없으면 링크 없음. 구글은 Maps URLs(`api=1&query=`, 2,048자 안).
- 결정 4 — 네이버 기본값은 **공식 앱 URL Scheme** `nmap://search?query=…&appname=<origin>`. 웹 `map.naver.com/p/search/…`는 비공식이라 사용자가 브라우저에서 실측해 통과한 뒤에만 `NAVER_WEB_SEARCH_VERIFIED=true`로 켠다. **사용자 결정(2026-10-19): 앱 스킴 기본값을 이대로 둔다**(계획 §6 질문 5 — 웹 URL은 쓰지 않음, 코드 경로만 남겨 둔다). 앱 내 브라우저는 `map.naver.com`을 열지 못해 이 세션에서 실측하지 않았다. 업종→글리프 12묶음(결정 1)도 같은 날 사용자가 확인했다.
- backend·API 변경 없음(`/nearby-stores` 필드 그대로, 글리프는 응답 `biz_code`로 프런트가 정한다).
- 검증: `docs/TASKS.md` 9-B, `DESIGN.md` §19.8. 운영 미배포.

## D-027 첫 방문 안내: 비모달 인라인 코치마크, 결과 안내 별도 1회, 다시 보기 2곳 (2026-10-19, 묶음 D, 사용자 결정)
- 배경: 계획 묶음 D(`docs/IMPROVEMENT_PLAN_2026-10.md` 2-6). 설계안 `docs/ONBOARDING_DESIGN.md`를 사용자가 승인했다(결정 1 결과 안내 별도 1회, 2 다시 보기 2곳, 3 어미 "~합니다").
- 결정 1 — 진입 모달·전체 화면 튜토리얼을 두지 않는다. 안내는 화면 요소 바로 아래 **인라인 비모달** 말풍선(`role=status`)이며 포커스를 가로채지 않는다. 지도 위에는 두지 않는다. 기본 화면의 글은 늘리지 않는다(늘어난 것은 "사용 방법 다시 보기" 버튼 2개뿐). 기존 설명(조건 부제·지도 안내 칩·반경 안내·"이 점수는?"·P1 면책)과 중복하는 문장은 넣지 않는다.
- 결정 2 — 단계는 ①위치 ②업종 ③분석 + ④결과(반경 변경·비교 안내). ①~③은 첫 방문 1회, ④는 **별도 1회**(①~③을 건너뛴 사용자도 첫 결과에서 본다). 행동(위치 선택·업종 선택·분석 성공)으로 자동 진행하고, "건너뛰기"는 안내 전체 종료, Escape는 지금 말풍선만 숨김(저장하지 않음).
- 결정 3 — 저장은 `localStorage` `onboarding`·`onboarding.result`(테마와 같은 방식). 읽을 수 없으면 안내하지 않는다. 다시 보기는 조건 머리와 결과 머리 2곳에서 지금 화면에 맞는 단계부터.
- 범위 밖: 서버·엔진·지도 변경 없음. 지도 가독성 보류(9-A5)와 현재 발행값은 그대로.
- 검증: `docs/TASKS.md` 9-D. 운영 미배포.

## D-028 엔진 v0.5(`mvp-0.5`): 팀 전달 v0.5 + 반경 선택, 지오비전 퍼즐 수치로 점수를 바꾸지 않음 (2026-10-24, 사용자 지시)
- 결정: 팀 전달 v0.5 엔진(2026-10-23)을 새 엔진 버전 `scoring_engine/v0_5/`로 추가한다(D-006). 내용 = 팀 엔진 13개 파일 사본 + 웹 v0.4(D-024)와 같은 방식의 반경 선택 최소 diff(`config.RADIUS_OPTIONS_M`, `radius_m` 인자, 반경 표기 3곳). 팀 번들의 "v0.4"(집적 효과)는 웹 v0.4(반경)와 다른 변경이며 팀 v0.5가 포함한다. 엔진버전 문자열은 팀과 같은 `mvp-0.5`(500m 결과가 팀 결과와 같아야 하므로). v0.3·v0.4 엔진·golden·원본 매니페스트는 그대로.
- 원본: 전달 번들 135개 파일 해시를 `tests/manifests/source_team_v0.5.sha256.json`에 두고, `sources/team_v0.5/`에는 `04_엔진코드/` 전체와 team_v0.3과 다른 파일만 넣는다(같은 파일은 team_v0.3 경로를 가리킴). 전달 폴더는 읽기만 했다. 퍼즐 폴더는 해시만(저장소에 넣지 않음).
- 경계: 인구 면적 배분용 SGIS 2025년 2분기 경계를 `data/geo/SGIS_행정동경계_2025_2Q_인천.geojson`(geo 매니페스트 항목)으로 둔다. 지도·행정동 판정용 2026 경계와 용도가 달라 서로 대체하지 않는다. 데이터 버전 역할 키(8개)는 바꾸지 않았다 — 이 경계는 엔진 v0.5 입력이다. 이름 연결 158/158, 기하 대조 예외는 검단구 당하동 1곳(한계로 기록, `docs/ENGINE_V0_5.md` 4장).
- 어댑터: 팀 run_all v0.5 반복문과 같은 입력(`DEMAND_COLS`, `extra_cols`, `same_weights`, `areas`, `customer_inputs`, `agg_ref`, `schools`). 입지 reference 키 = (유인시설 집합, 학교구역 적용 여부). 중심점 면적 가중치는 (중심점, 반경)마다 1회 재사용. 엔진 `DongAreas`가 인코딩 없이 `open()`하는 문제는 엔진을 고치지 않고 어댑터가 UTF-8로 읽게 한다. 임대료는 D-015 그대로(일반 좌표 미연결) — 팀 보고서 수치에 맞추려고 붙이지 않는다.
- 반경: 300·500·1,000m 모두 지원하고 `/health`에 광고한다. 반경마다 인구 배분·고객성(값과 비교 분포)·경쟁성·집적도·점포 목록·응답 반경이 같은 반경이다. 입지성·시장성·안정성은 반경과 무관. 팀 검증은 500m뿐이며 300·1,000m는 웹 확장이다.
- 기본 엔진: 코드 기본값은 v0.3 그대로(D-024 규칙). 운영 전환은 새 리비전 환경변수 `SCORING_ENGINE_VERSION=v0_5` + 무트래픽 확인 + 사용자 승인으로 한다. 이번 단위는 운영 배포를 포함하지 않는다.
- 지오비전 퍼즐 조사(43곳 중 38곳): 방향 점검 보조 근거로만 쓴다. 잠재수요 = 거주 + 종사자, 연령 보정 없음, v0.5 계수·구조 유지. 채택하지 않음: 잠재수요에 "점포 수 × 약 18명" 방문 보정, 퍼즐 수치 연령 보정, 점포 밀도만의 광역형/동네형 배지, 개별 지점 방문자 추정치, 대형 시설 추가에 따른 점수 변경. 수치(순위상관·R²·연령 차이·외부 방문자 배수·편상관)는 내부 설계 근거 문서(`docs/ENGINE_V0_5.md` 6장)에만 두고, 사이트에는 수치 없는 한계 문구 하나만 쓴다(전달 README 3장: 퍼즐 숫자 사이트·API 금지). 다음 버전 과제는 `docs/TASKS.md` 10장.
- 화면: 비교 기준(158개 중심점, 상업지 후보지 순위 아님), 고객성·경쟁성의 반경·기준, 정확 일치 동종 수(= 지도 점포 목록)와 실효 동종 수 구분, 경고는 엔진 순서대로 모두·학교구역 경고 강조(영업 가능 여부를 확정하지 않음), 임대료 해석, 집적도 백분위는 우수성·성공 가능성 순위가 아님, 점수 ≠ 성공 확률(사후 생존 점검도 예측력을 보이지 못함). v0.5 응답 필드는 프런트 schema가 엔진 버전과 일치할 때만 받는다.
- 검증: `tests/engine_v0_5/`·`tests/test_engine_v0_5_diff.py`, `scripts/check.py`에 v0.5 단계 6개(import, 원본 무결성, 팀 원본 테스트 4개 파일, pytest engine v0_5). 결과는 `docs/TASKS.md` 10장.

## D-029 엔진 v0.5.1(`mvp-0.5.1`): 분동 인구비 이중 적용 결함 수정 — 팀 v0.5·golden은 보존 (2026-10-24, Codex 검수 지적, 사용자 지시)
- 결함(팀 엔진 유래): `etl_boundary.DongAreas`가 SGIS 2025 경계에 없는 신설 분동(아라1·2동, 운서1·2동)을 모체 경계로 연결하면서 가중치에 "분동 인구 ÷ 형제 합"을 곱한다. 패널 값(총인구·종사자·타겟)은 이미 분동별이라 인구비가 두 번 들어가 같은 경계·같은 총량에서 분동 전보다 배분 인구가 약 절반이 된다. 비율 규칙은 팀 `etl_sgis.attach`(SGIS 모체 통계를 분동에 나눔 — 그곳은 맞다)에서 왔다.
- 결정: 팀 원본(`sources/team_v0.5`)과 웹 v0.5(`scoring_engine/v0_5`, golden v0.5 = 팀 결과)는 고치지 않는다. 새 엔진 버전 `scoring_engine/v0_5_1/` = v0_5 + `DongAreas` 분동 비율 한 줄(1.0) + 엔진버전 `mvp-0.5.1`(D-006). 허용 diff `tests/test_engine_v0_5_1_diff.py`, golden `tests/golden/v0.5.1/r300·r500·r1000`.
- 배분 가정: 분동들은 모체 경계 안에 고르게 산다(엔진의 동 안 균등 거주 가정, 경계 출처 SGIS 2025 하나 유지) → 모체 면적 비율만 곱해 분동 전후 총량을 보존한다. 대안(2026 자식 경계로 따로 배분)과 비교: 아라동은 ±3%, 운서동은 공항·해역 때문에 차이가 크다 — 경계 출처를 섞는 설계 변경이라 다음 과제(`docs/ENGINE_V0_5.md` 9장).
- 검증: 재현 테스트(`tests/split_dong_case.py`) — v0.5는 결함 고정, v0.5.1은 합성·실데이터 보존. 차이(`docs/spikes/v0_5_1-split-dong/`): 비교 분포가 바뀐 중심점은 아라1·2·운서1·2동과 원당동뿐, 158개 중심점 웹 분석 4,176건 중 500m 종합 변경 2,524건(평균 0.28점, 최대 11.5점; 1km 최대 15.2점 — 아라동 지점). 부평역 PC방 500m 종합 60.7 → 60.6.
- 운영: v0.5와 v0.5.1 모두 운영 미배포, 코드 기본 엔진은 v0.3. **운영에 올릴 엔진은 v0.5.1로 확정(2026-10-25, 사용자 결정)** — 배포는 별도 승인 뒤, 리비전 환경변수 `SCORING_ENGINE_VERSION=v0_5_1`. v0.5는 팀 결과 보존용으로 남긴다. 프런트는 `mvp-0.5.1`을 v0.5와 같은 응답 형태로 다룬다(`isAreaWeightedEngine`). 팀에는 결함을 알린다(`docs/ENGINE_V0_5.md` 7장).

## D-030 지도 영역 오류 격리: SDK 실패가 앱 전체를 내리지 않는다 (2026-10-25, 운영 무트래픽 검증 결함, 사용자 지시)
- 배경: NAVER SDK는 인증 실패 때 `window.naver.maps`를 null 로 바꾸고, 그 뒤 이미 만든 지도·리스너·오버레이 정리 호출이 SDK 내부 TypeError 를 던진다. 테마 전환(묶음 A)의 지도 재생성 정리에서 이 예외가 React effect 정리 밖으로 나가 앱 전체가 빈 화면이 됐다(`docs/DEPLOYMENT_2026-10-25_v051_verify.md` 6장).
- 결정: (1) 지도 정리 경로의 SDK 호출은 단계마다 시도하고 실패는 `console.error("[map] …")`로 남긴 뒤 계속한다 — 콘솔 오류를 숨기지 않는다. (2) 로더는 인증 실패를 기억해 같은 페이지의 재생성에서 죽은 SDK를 다시 쓰지 않는다. (3) 지도 실패 안내(설정 제외)에 "지도 다시 불러오기" — 인증·로드 실패는 SDK를 새로 받고, 초기화 실패는 지도만 다시 만든다. (4) App 은 지도를 `MapErrorBoundary`로 감싼다 — 지도 칸만 실패 안내로 바뀌고 분석 폼·결과·비교는 그대로다. 정상 인증 상태의 지도·테마 전환 동작과 엔진·점수·데이터는 바꾸지 않는다.
- 검증: MapView 회귀 4건(수정 전 실패 → 수정 후 통과), MapErrorBoundary 2건, 브라우저(인증 실패·초기화 실패·인증 성공), 전체 check. 새 커밋 이미지로 무트래픽 리비전을 다시 검증한다(운영 전환은 별도 승인).

## D-031 앱 버전·업데이트 내역(패치노트)과 커밋·배포 연결 (2026-10-25, 사용자 지시)
- 배경: 팀원이 홈페이지에서 "무엇이 달라졌는지" 확인할 곳이 없었고, 앱 버전·Git 태그 규칙도 없었다(`package.json` 0.0.0, 태그 0개). 점수 엔진 버전(mvp-0.x)만 있었다.
- 결정: 앱 버전 `vX.Y.Z`를 점수 엔진 버전과 따로 매긴다. 기존 이력은 v0.0.1~v0.0.10으로 정리해 부여했고(실제로 쓰던 번호가 아님을 화면에 밝힌다), 이번 기능이 v0.0.11이다. 기준 파일은 `frontend/src/content/patchNotes.json` 하나 — 화면 "업데이트 내역"(조건 바 버튼 → 모달)이 읽고 최신 항목이 그 빌드의 앱 버전이다. 사용자 요약(추가·개선·수정 1~3줄)과 상세(작업 요약·커밋·배포 기록)를 나눈다. 날짜는 KST, `date`는 구현일이고 운영 반영일은 운영 전환 기록에서 계산한다(그 버전 이상을 담은 첫 `production`·`done`).
- 커밋 연결: 모든 커밋에 트레일러 `Patch-Note: vX.Y.Z`. 해시는 다음 패치노트 수정 때 `scripts/patch_notes.py sync --write`로 목록에 옮긴다(자기 해시를 넣으려는 커밋 반복 없음). 브라우저·공개 GitHub API로 Git을 조회하지 않는다.
- 배포 기록: 추가만(실패·보류·롤백·정정도 새 기록). 무트래픽 검증(`verification`)은 운영 반영이 아니다. 운영 전환 기록은 전환 확인 뒤 문서 커밋으로 더하고, 이미 배포된 화면은 다음 빌드 때 반영한다(기록 때문에 이미지를 다시 빌드하지 않는다).
- 검사: `scripts/patch_notes.py check` — 형식·중복·날짜·필수 필드·종류/결과 값, 커밋이 한 버전에만 속함, HEAD 이력의 모든 커밋 연결, HEAD 대비 기록 삭제·수정 금지. 전체 check `patch-notes` 단계와 `tests/test_patch_notes.py`.
- 공개 범위: 번들에 들어가므로 비밀정보·환경변수 값·서비스 URL·클라우드 프로젝트·리비전 이름·비공개 조사 자료를 넣지 않는다(커밋 해시·엔진 버전은 공개해도 된다).

## D-032 검증 규칙: 작업 중 변경별 검증, 배포 후보에서 전체 check 1회 (2026-10-25, 사용자 지시)
- 배경: "작은 작업마다 전체 `scripts/check`"는 약 17~30분(엔진 pytest 4단계가 약 85%)으로, 같은 소스의 커밋·아카이브·이미지 빌드마다 반복되기도 했다.
- 결정: `CLAUDE.md` Definition of Done을 바꾼다 — 변경 종류별 기본 검증(A 문서·패치노트, B UI·스타일, C API·캐시, D 엔진·데이터, E 의존성·Docker·줄바꿈·패키징), 배포 후보 확정 때 최종 소스로 전체 check 1회(F). 통과한 소스 그대로의 커밋·빌드에는 반복하지 않고, 문서만 바뀌면 기존 결과를 재사용한다고 적는다. 검증한 소스·명령·결과를 기록하고 `--fast`·`--only`를 전체 통과라고 쓰지 않는다.
- 도구: `scripts/check.py --only KEY,…`·`--list`(기존 단계에 키만 붙임). 기본 전체 check는 기존 단계를 모두 유지하고 `patch-notes` 단계 하나를 더했다. 검증을 지우거나 약하게 하지 않았고 golden은 그대로다. 전체 check 시간 개선은 별도 과제(`docs/TASKS.md` 11-6).

## D-033 결과마다 데이터 버전: 응답 헤더 `X-Data-Version` (2026-10-28, TASKS 9-C4, 사용자 지시)
- 배경: 데이터 버전(묶음 C, D-006 개정)은 `/health data`로만 알렸다. `/analyze` 본문 스키마는 프런트 Zod strict 계약이라 바꾸지 않기로 했다(DATA_VERSIONING §4). 그래서 열린 화면이 데이터 버전이 바뀐 리비전으로 전환되면 결과 캐시·A/B 비교가 이전 데이터 결과와 섞일 수 있었다.
- 결정: backend 가 `/analyze`·`/nearby-stores` **성공 응답 헤더** `X-Data-Version`에 그 프로세스의 데이터 버전 id 를 싣는다(오류 응답·본문·엔진 결과는 그대로). 프런트 API 클라이언트는 파싱한 응답 객체에 버전을 붙여 두고(`lib/dataVersion.ts`, WeakMap — 상태 타입을 바꾸지 않는다), 결과 캐시는 엔진버전처럼 데이터 버전이 바뀌면 전체를 버리며, A/B 는 엔진·데이터 버전이 같을 때만 한 비교로 보인다(다르면 계약 오류 — 4.5 엔진 대조와 같은 처리). 헤더가 없는 서버는 버전 null(null 끼리 같다 — 지금 동작 그대로).
- 화면: 결과 머리줄·비교 머리줄에 "데이터 YYYY-MM 기준"(버전 id). 데이터 출처 표와 관점 설명의 데이터 버전 역할 기준일은 `/health data.as_of`로 채우고, 모르거나 결과 버전과 다르면 비워 둔다("—", 설명은 괄호째 생략) — 정적 날짜로 채우지 않는다. 결과 버전이 알고 있는 메타와 다르면 `/health`를 다시 읽는다. 역할이 아닌 날짜(SGIS 2024·경계 2025년 2분기·법령 확인일)는 정적.
- 대안(채택 안 함): `/analyze` 본문에 버전 필드 추가(스키마 계약 변경), 분석마다 `/health` 재조회(요청 증가, 리비전 전환 중 다른 인스턴스를 볼 수 있음).

## D-034 전체 check 병렬 실행 옵션 `--jobs N` (2026-10-28, TASKS 11-6, 사용자 지시)
- 배경: 순차 전체 check 약 17~20분(기계 부하 때 약 35분), 엔진 pytest 4단계가 약 85%.
- 결정: `scripts/check.py --jobs N`은 Python 테스트 단계 core·v0_4·v0_5·v0_5_1·backend 를 최대 N개 동시에 돌린다(각자 별도 프로세스·엔진 환경변수, 파일 쓰기는 테스트 임시 폴더, 서버 포트는 OS 빈 포트 — 점검함). 출력은 단계별로 모았다가 원래 순서대로 붙인다. 원본 무결성·팀 원본 테스트·imports 는 앞에서 순차, frontend(vitest 자체 다중 스레드, 부하 때 시간 초과 이력)와 patch-notes 는 뒤에서 순차. 검사 항목·golden·건수는 같으므로 `--jobs` 실행도 전체 check 로 인정한다. 기본(옵션 없음)은 지금처럼 순차.
- 측정(2026-10-28, 16코어, 시작 CPU 약 33%): `--jobs 5` 657초(약 11분), 순차 대비 약 1.8~3배 빠름. 동시 실행 중 각 단계는 약 1.7~2배 느려진다(경합). 남은 병목은 v0_5 단계(약 9분) — 더 줄이려면 단계 안 병렬(pytest-xdist, 새 의존성) 검토가 별도 과제.

## D-035 자동 E2E smoke: API smoke 스크립트 + Playwright(가짜 NAVER SDK) (2026-10-28, TASKS 5-3, 사용자 결정 "A+B 도입")
- 배경: 배포마다 지도·테마·분석·비교·업데이트 내역·모바일을 사람이 브라우저로 확인했고, 최근 결함 3건(테마 빈 화면, 운영 CSS `:has` 누락, 재시도 script 누적)은 jsdom 단위 테스트로 원리상 잡히지 않는 층에서 나왔다(`docs/E2E_SMOKE_PROPOSAL.md`).
- 결정 A: `scripts/smoke_api.py` — `expected`(같은 소스·엔진으로 48건 기대값, 반경은 서버 광고), `check <주소> <기대값>`(정적·캐시·GeoJSON, health·warm, 48건 일치, X-Data-Version == data.version, 반경별 동종 = 목록, 학교구역 첫 줄(v0.5 계열), 422). 서비스 주소는 인자로만. 헤더 이전 리비전은 `--no-data-header`. 테스트 `backend/tests/test_smoke_api.py`(같은 앱 TestClient).
- 결정 B: Playwright(`@playwright/test` devDependency, Chromium) — `npm run e2e` = e2e build(`dist-e2e`, 실제 `.env`를 읽지 않고 가짜 Client ID) → backend(엔진 v0.5.1, 같은 origin 서빙) → 가짜 NAVER SDK(`frontend/e2e/fakeNaverSdk.ts`: 동작 모드·인증 실패 모드)로 4흐름. `scripts/check.py --only e2e` 선택 단계 — 기본 전체 check 에는 넣지 않고 배포 후보 확정(F) 때 함께. 실제 SDK·네트워크·Client ID 를 쓰지 않으므로 실제 지도 표시는 여전히 등록 주소에서 사람이 본다(C 미도입).
- 확인: 4흐름 통과(약 1.5분). 수정 전 소스(`965849c`) 빌드로 인증 실패 흐름을 돌리면 첫 테마 전환 뒤 빈 화면으로 실패 — 결함을 잡는다. `npm audit`의 high 3건은 기존 `zod` 경로(이번 추가와 무관, 후속).
