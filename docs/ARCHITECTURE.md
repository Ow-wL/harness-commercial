# Architecture

## 1. 현재 (v0.3 원본) 데이터 흐름

```
08_원본_인허가 ─(etl_stability*.py)─┐
공공데이터 원본(미포함) ─(etl_*.py)──┴─▶ 07_가공데이터 ─▶ run_all.py ─▶ scoring.analyze() ─▶ 05_분석결과
                                                          ▲  (부평역 고정)                     (CSV + JSON 29개)
```

책임 구분 (코드 기준):

| 구성요소 | 책임 | 지점 의존? |
|---|---|---|
| `scoring.analyze()` | **순수 계산**. 전달받은 dict/list로 5대 관점 백분위, 가중 결합, 병목, 경고, 접근성 태그. 파일 I/O 없음 | 아니오 (입력만 본다) |
| `radius_demand.radius_profile/build_reference` | 반경 500m 점포·면적가중 수요, 158개 행정동 중심점 비교 모집단 | profile만 |
| `etl_location.site_profile` | 역세권 강도, 유인시설 종류별 근접도 | 예 |
| `run_all.py` | 데이터 로드, **지점 → 행정동·시군구·임대료 상권 연결(하드코딩)**, analyze 입력 조립, 후처리, 파일 출력 | 예 (전부 하드코딩) |

즉 v0.3에서 "임의 지점 분석"을 막는 것은 엔진이 아니라 `run_all.py`의 입력 조립부다.

## 2. 하드코딩 (run_all.py 기준)

| 위치 | 값 | 의미 | 웹에서 필요한 것 |
|---|---|---|---|
| `LAT, LNG` | 37.4894, 126.7246 | 부평역 좌표 | 요청 좌표 |
| `GU` | `"28237"` | 시장성 패널 행 (부평구) | 좌표 → 시군구코드 |
| `panel[...=="부평구" & =="부평1동"]` | 부평1동 | 고객성 행정동 행 | 좌표 → 행정동 |
| `stab_for`: `t.시군구 == "부평구"` | 부평구 | 안정성 지점 값 | 좌표 → 시군구명 |
| `RENT_AREA` | `"부평"` | 임대료(S4) 상권 | 좌표 → R-ONE 상권(9곳) 또는 없음 |
| `Site.from_query(..., "부평역 근처 {업종}", dong_name="부평구 부평1동")` | 문구 | `meta.query`, `meta.행정동` | 지점 이름 |
| `cc = {"dong_sobun":0, "dong_jung":0, "gugu_sobun":n, ...}` | | 안정성은 항상 시군구 해상도 | 동일 규칙 유지 |
| 결과 후처리 `market.fallback="gugu"`, flag `해상도_시군구` | | 시장성은 시군구 데이터 | 동일 규칙 유지 (adapter가 수행) |
| `stab["업종코드"]="R10406"` | | PC방 안정성 패널에 업종코드 열 없음 | 동일 (runtime loader) |
| `os.chdir(DATA)`, 출력 `05_분석결과` | | 전역 부작용, golden 덮어쓰기 | 웹에서는 사용 안 함 |
| `json.dump(open(path, "w"))` | | 인코딩 미지정 → Windows에서 cp949 | 웹에서는 사용 안 함 |

엔진 내부 상수 (변경 금지, 참고): `scoring.C_BASELINE_SURVIVAL_3Y=0.552`, `meta.엔진버전="mvp-0.3"`,
`etl_location.BBOX`(인천+인접 생활권), `load_schools`의 주소 '인천' 필터, `etl_rent.QUARTERS`(2024Q3~2026Q2 고정, 최신 분기 사용).

## 3. 저장소 구조 (MVP 완료 시점)

```
sources/team_v0.3/      원본 (읽기 전용, 해시 검증)
scoring_engine/
  location.py           LocationResolver(좌표 → 2026 인천 행정동, point-in-polygon, 코드로 panel 연결) + ContextBuilder(좌표 → SiteContext, 반경 500m 점포 0개 거부). 한 모듈 (eng review D3, D-011)
  v0_3/                 canonical 엔진 사본 (원본과 바이트 동일)
  v0_4/                 v0.3 + 분석 반경 300·500·1,000m 최소 diff (D-024, SCORING_ENGINE_VERSION=v0_4)
  v0_5/                 팀 전달 v0.5(sources/team_v0.5) + 같은 반경 최소 diff (D-028, SCORING_ENGINE_VERSION=v0_5)
  v0_5_1/               v0_5 + 분동 인구비 이중 적용 결함 수정 (D-029, SCORING_ENGINE_VERSION=v0_5_1)
  boundary.py           v0.5 인구 면적 배분 경계(data/geo/SGIS_행정동경계_2025_2Q_인천.geojson) UTF-8 로드 + 중심점 면적 가중치 재사용
  runtime.py            RuntimeData — 런타임 데이터 1회 로드
  reference.py          ReferenceCache — 비교 모집단 캐시 (프로세스 메모리)
  context.py            SiteContext — run_all 하드코딩을 명시적 파라미터로. golden fixture BUPYEONG_STATION, 웹 요청은 ContextBuilder가 좌표로 만든다
  service.py            AnalysisService.analyze(ctx, biz) — run_all 업종 루프와 같은 입력 조립 + 후처리
data/runtime/           엔진 입력 데이터 (원본 07_가공데이터 사본)
data/geo/               행정동 경계(2026-07 기준 158개, 구월1·3동은 SGIS 공식 경계로 교정) + SGIS 입력 + 2024→2026 crosswalk. 별도 매니페스트, raw/는 git 제외 (D-009, D-017).
                        backend resolver와 frontend 경계 강조가 같은 파일을 쓴다
data/cache/             (비어 있음) 향후 reference 디스크 캐시
tests/                  무결성, canonical 엔진, 데이터 스키마, golden regression, adapter 계약, location·agreement
scripts/check.*         전체 검증 (python 단계 + `pytest backend` + `npm run check`)
scripts/build_geo.py    data/geo 가공 (재현성 검사). fetch_sgis_boundary.py·verify_guwol_admin_dong.py는 SGIS 유지보수용(루트 .env)
backend/app/
  main.py               create_app(service, warm_biz): lifespan에서 AnalysisService 1회 생성(RuntimeData 로드),
                        29개 업종 warm은 background thread. GET /health · GET /businesses · POST /analyze (TASKS 3-1~3-3) · POST /nearby-stores (4차, D-019)
  errors.py             오류 계약: 422 + error.code / 500 + request_id (D-014)
frontend/src/
  api/schemas.ts        API 응답 Zod schema (source of truth, 타입은 z.infer). client.ts가 모든 응답을 검증 (D-012)
  map/naverMaps.ts      NAVER Maps v3 SDK singleton loader (frontend/.env의 Client ID) + 지도/Geocoder 준비 상태(SdkState, 7차)
  map/geocoder.ts       Geocoder 서브모듈 adapter: 콜백 → 결과 객체(정방향 검색·역방향 참고 주소), Zod 검증·8초 timeout (D-021)
  map/dongBoundary.ts   data/geo/인천_행정동경계_2026.geojson을 ?url asset으로 참조, context의 (gu_code, dong_name)으로 찾아 강조
  map/mapFit.ts         지도 범위 맞춤 순수 계산(8-B1, D-022): 사용 영역 U, 원 사각형(bounds 직접 계산), 맞춤 zoom, panBy 값, GL/래스터 zoom 환산, 점포 정보창 위치 후보
  components/           MapView(지도·마커·500m 원·경계, 단일 범위 맞춤·정보창 배치, 비교 A/B 표시) · ConditionPanel(위치·업종) · AnalysisResult(결과) · ErrorBlock 등 (DESIGN.md)
                        두 위치 비교(5차, D-020): ComparePanel(B 고르기)·CompareResult(비교 요약·위치별 전체 결과)·CoordinateForm
  lib/                  format(표시 형식) · compare(비교 표시 규칙) · compareState(B 상태 타입) · warnings(주의할 점 문장) · useNearbyRequest(점포 조회 1벌)
                        주소(7차, D-021): addressCache(좌표 키 캐시) · useReferenceAddress · addressSearch · keepFocusInView · useSearchFocusRecovery
                        components: AddressSearch(주소로 찾기) · ReferenceAddress(참고 주소 한 줄)
  `npm run check` = tsc + ESLint + Vitest (29개 golden JSON schema 검증 포함), scripts/check가 자동 실행
```

## 4. MVP 요청 흐름 (구현됨)

설계 당시 "목표 구조"였던 아래 흐름이 그대로 구현됐다. 각 계층은 아래 계층만 호출한다 — frontend는 엔진을 직접 호출하지 않는다.

```
Frontend (React+TS, NAVER Maps)  지도 클릭/좌표 입력 → lat,lng. 업종 select. 응답은 Zod 검증, 오류는 error.code로 분기
  │                              dev: vite proxy가 /businesses·/analyze·/nearby-stores·/health를 backend로 (backend에 CORS 없음)
  │                              주소(D-021): 브라우저 → NAVER Maps SDK Geocoder(Client ID만) 직접 호출. 검색 결과는 좌표 선택일 뿐이고
  │                              참고 주소는 표시만 한다 — backend·엔진으로 가는 요청은 여전히 lat,lng(+업종)뿐
  │  GET /businesses (업종 29개·그룹 4개, 엔진 config 그대로)
  │  POST /analyze {lat, lng, biz_code, importance?, user_weights?, user_licenses?}
  │  POST /nearby-stores {lat, lng, biz_code}  분석 성공 뒤 같은 조건으로 — 반경 안 동종 점포(표시용, 엔진 analyze 안 부름)
  │  POST /places {q}                         위치 고르기 단계 — NAVER 검색 프록시(12-14, 키가 있는 서버만), 좌표 후보일 뿐 분석과 무관
  │  (8-D2·8-D3, D-024: 두 요청 모두 선택 필드 radius_m — 엔진이 받는 값만. 프런트는 GET /health 의 engine.radius_options 가 2개 이상일 때만 반경 선택을 보이고 radius_m 을 보낸다. 결과 캐시(lat·lng·업종·반경, LRU 12)·응답 반경 대조·서버 변경 복구 R1/R2 — App.tsx·lib/resultCache.ts)
  ▼
Backend API (FastAPI)            입력 검증, 오류 응답, 응답 스키마. 엔진 결과를 바꾸지 않는다 (pass-through)
                                 입력·분석 불가 → 422 + error.code, 내부 오류 → 500 + request_id (D-014)
  ▼
Location Resolver                lat/lng → 인천 내부 여부, 행정동(코드·이름), 시군구(코드·이름). 2026-07 polygon 직접 사용 (2024 crosswalk는 검증용, D-009)
  ▼
Analysis Context Builder         좌표 → SiteContext (location.ContextBuilder, rent_area=None, 500m 점포 0개 거부) → analyze() 입력 dict (service.py)
  ▼
Scoring Engine (v0_3, 불변)
```

응답 `{context:{lat,lng,gu_code,gu_name,dong_name,label,rent_area}, result:<엔진 dict 그대로>}`. frontend는 `context`의 `(gu_code, dong_name)`으로
`data/geo` 경계 asset에서 같은 행정동 polygon을 찾아 강조만 한다 — 행정동 판정(point-in-polygon)은 backend만 한다.
production: Cloud Run 서비스 1개 — FastAPI(uvicorn 1 process)가 API와 Vite build(`/`, `/assets/*`, SPA fallback)를 같은 origin에서 서빙한다. API route가 먼저 매칭된다 (D-018, `backend/app/frontend.py`, `Dockerfile`).

### Location Resolver / Context Builder (구현됨: `scoring_engine/location.py`, 아래는 설계 당시 요구사항과 현재 상태)
1. **행정동 경계 데이터.** → `data/geo/인천_행정동경계_2026.geojson` (158개, panel 코드와 일치, 1-1·1-2 완료, D-009). 생성: `scripts/build_geo.py` = vuski 2026 원본 156개 + 구월1동·구월3동은 commit된 SGIS 2025 공식 경계로 교정 (D-017). runtime은 이 파일만 읽고 SGIS API를 호출하지 않는다. 아래는 확보 전 기록.
   런타임 데이터에는 경계 폴리곤이 없다. 점포 좌표에 붙은 행정동 라벨만 있다.
   - 데이터의 시군구는 **개편 후 체계**다: 제물포구·영종구·서해구·검단구 (구 중구·동구·서구 아님), 시군구코드 28125/28155/28275/28290.
     경계 데이터도 같은 체계·같은 코드여야 한다. 코드 체계 불일치가 가장 큰 위험.
   - 대안(근사): 상가 점포 최근접 이웃 다수결. 경계 데이터 검증용으로도 쓸 수 있다.
2. **키 규칙** (테스트로 고정됨): `시군구코드 == 행정동코드[:5]`, 패널 158개 행정동 = 상가 데이터 158개 행정동.
3. **임대료 상권 연결 규칙.** R-ONE은 인천 9개 상권만 있고 경계가 이미지뿐. 설계서 11-x의 "상권명 역 중심 500m" 근사는 쓰지 않기로 결정 — MVP는 모든 좌표 `rent_area=None` → S4 제외(엔진이 가중치 재분배) (D-015, TASKS 1-6).
4. **인천 밖 / 바다 / 데이터 공백 좌표 거부** 규칙. Resolver는 어느 행정동 polygon에도 속하지 않는 점을 `LocationOutside`로 거부한다.
   주의: 연안 행정동 polygon은 바다를 일부 포함한다. 이런 점은 Resolver를 통과하고, ContextBuilder가 반경 500m 안 점포 0개면 `NoDataNearby`로 거부한다. 해안에서 500m 안에 점포가 있으면 바다 위 점도 분석된다 (예: 37.45, 126.40 → 영종구 용유동, 반경 내 점포 있음).
5. 부평역 좌표 → Resolver 결과 `부평구 부평1동` = `BUPYEONG_STATION`과 같은 행정동 (TASKS 1-4 완료, 엔진 버전 변경 불필요). 일반 경로의 `rent_area`는 `None`이라 안정성(S4)·종합은 golden과 다를 수 있다 (D-011).

> ✅ **해결된 우려 (TASKS 1-4).** 하드코딩 좌표(37.4894, 126.7246)에서 가장 가까운 점포 50개가 `부평6동` 라벨이라
> Resolver가 부평6동을 낼 수 있다고 봤지만, polygon 기준 이 좌표는 `부평1동`이다 (부평6동 경계까지 17m).
> 그 점포들은 경계 건너편에 있고 라벨과 polygon 모두 부평6동이다. golden 컨텍스트와 같으므로 엔진·golden 변경 없음 (D-010).
>
> ✅ **해결된 데이터 이슈 (TASKS 1-5a).** 남동구 구월1동 서쪽 띠는 2차 가공 경계상 구월1동이었지만 점포 라벨 2,486개는 구월3동이었다.
> SGIS 공식 역지오코딩으로 439/439 좌표가 구월3동임을 확인하고(D-010), SGIS 2025 공식 경계로 구월1/3동 경계를 `build_geo.py`에서 교정했다 (D-017).
> 지금 이 구역 좌표는 `구월3동`으로 판정된다. 점포 라벨·`data/runtime`·엔진은 바꾸지 않았다.

## 5. 성능과 캐시 경계

측정 (2026-10-05, Windows 11, Python 3.10, 이 저장소의 adapter 기준). warm 수치는 TASKS 2-1 재측정 (`scripts/bench_reference.py`, D-013):

| 작업 | 시간 | 지점 의존 | 처리 |
|---|---|---|---|
| 런타임 데이터 로드 (`load_runtime`) | 3.8~4.0s (상가 CSV 0.55s, 역 병합 루프·xlsx 포함) | 아니오 | 앱 시작 시 1회 |
| `build_reference` (업종 1개) | ~1.9s | 아니오 | **업종별 캐시** (29개, 합계 55.7s) |
| 업종 1개 cold warm (competition + location) | 2.4~2.7s | 아니오 | |
| 29개 전체 cold warm | 평균 60.8s (58.1~65.1s, 3회, 표준편차 3.8s) | 아니오 | background warm (TASKS 3-1) |
| 같은 캐시 두 번째 `warm()` | ~0s (재계산 없음, 테스트로 고정) | 아니오 | |
| 입지 reference (유인시설 집합 1개) | ~0.34s | 아니오 | **유인시설 집합별 캐시** (14개, 합계 4.7s) |
| 안정성 기준 분포 | ms | 아니오 | 그때그때 (가벼움) |
| `radius_profile` (지점 1개) | ~14ms | 예 | 요청마다 |
| `analyze` 1건 (캐시 warm) | ~20ms | 예 | 요청마다 |
| 29개 업종 전체 (캐시 warm) | ~0.5s | 예 | 요청마다 |

위험 요소:
- **콜드 스타트 60초+.** `build_reference`를 요청 경로에서 처음 계산하면 첫 요청이 최대 1분 걸린다. → backend는 `RuntimeData` 로드 후 바로 서비스하고 29개 warm은 background에서 진행, 아직 warm되지 않은 업종은 on-demand 계산 (TASKS 3-1, D-012). 디스크 캐시는 현재 미도입(D-016) — 멀티 워커·잦은 재시작으로 콜드가 문제될 때 다시 연다.
- `build_reference`는 호출마다 `dong_total`·중심점을 다시 groupby하고, 158개 중심점마다 13.5만 점포 전체에 haversine을 돈다. 수요(분모) 부분은 업종과 무관한데 업종마다 반복된다. (최적화는 golden으로 동일성 검증한 뒤에만)
- `ReferenceCache` 잠금(8-D2a, D-024): 이미 계산된 키(hit)는 잠금 없이 읽어 다른 키의 build를 기다리지 않는다. miss 계산은 build 실행권 하나로 한 번에 하나씩(같은 키 1회, 실패 시 미저장), background warm은 요청이 실행권을 기다리면 실행권을 얻지 않는다(대기 확인·예약은 `Condition` 하나 안에서 한 번에). → cold 요청 대기는 "진행 중(또는 이미 예약된) build 1개 + 다른 대기 요청들의 build + 자기 build"이며 대기 요청 사이 순서는 보장하지 않는다(측정: `docs/spikes/8-D2a/`). 이전에는 hit도 전역 lock을 기다려 warm 중 응답이 수 초였다.
- 멀티 워커(uvicorn workers N)면 워커마다 데이터·캐시를 따로 가진다 → 메모리 N배, 콜드 N번. 디스크 캐시가 필요해지는 지점.

캐시 경계 (무효화 키):
- 런타임 데이터 + reference: `(엔진 버전, data/runtime 해시, 분석 반경(v0.3은 config.RADIUS_M), 업종코드 | 유인시설 집합)` — 경쟁성 reference 키는 (업종, 반경)(D-024). 데이터나 엔진이 바뀌지 않으면 영구 유효.
- 엔진 v0.5(D-028): 경쟁성 reference (업종, 반경) 하나가 경쟁성·집적도(`agg_ref`)·고객성 반경 비교 분포(`customer_inputs`)를 함께 준다(87개). 입지 reference 키는 (유인시설 집합, 학교구역 적용 여부) 18개 — 학교구역 업종(PC방 등)과 같은 유인시설의 비규제 업종(분식 등)이 캐시를 나눠 쓰지 않는다. 행정동 경계(`RuntimeData.areas`)는 앱 시작 때 1회 로드하고, 158개 중심점의 면적 가중치는 (중심점, 반경)마다 1회 계산해 29개 업종이 재사용한다(요청 지점 가중치는 저장하지 않는다). 엔진·데이터는 프로세스당 하나라 별도 무효화가 필요 없다(새 리비전 = 새 프로세스). 프런트 결과 캐시는 응답 엔진버전이 바뀌면 전부 버린다.
- 지점 결과: `(위 키, lat, lng, biz, 사용자 가중치/중요도/면허)`. 필요해지면 그때 도입 (현재 불필요, 20ms).
- `data/cache/`에 쓸 때는 위 키를 파일명/메타에 넣고, 키가 다르면 버린다. 캐시는 정답이 아니다 — golden이 정답이다.

## 6. 두 위치 비교 (5차, 구현됨 — D-020, `docs/COMPARE_DESIGN.md`)

같은 업종 두 위치를 비교한다. backend·엔진·API 계약은 그대로다. frontend가 기존 `POST /analyze`·`POST /nearby-stores`를 위치마다 한 번씩 더 부른다.

```
A 분석(기존)          POST /analyze {A}        → analysis(success)       ── App의 inflight·seq
                      POST /nearby-stores {A}  → nearbyA                 ── useNearbyRequest #1
"다른 위치와 비교"     compare = picking
B 위치(지도 클릭·좌표) compare = picking(B)     (A는 바뀌지 않는다)
"B 분석하기"          POST /analyze {B, A 업종} → compare = loading → success | error   ── compareInflight·compareSeq
B 성공 뒤             POST /nearby-stores {B}  → nearbyB                 ── useNearbyRequest #2
```

- 요청 수: A 분석 1 + A 점포 1 + B 분석 1 + B 점포 1이 전부다. 비교 요약·A 전체·B 전체 화면 전환과 점포 기준 A/B 전환은 요청을 만들지 않는다(2026-10-12 브라우저 네트워크 기록으로 확인). 다시 시도·다시 고르기만 새 요청을 만든다.
- 상태(App):
  - `analysis`(A)
  - `compare`(off · picking · loading · error · success)
  - `compareView`(summary · detail-A · detail-B, 비교 분석 상태와 별도)
  - `storeSide`(요약의 점포 기준, B 성공 시 B)
  - `compareShowStores`(비교 중 "지도에 표시", A의 `showStores`와 별도)
  - `nearbyA`·`nearbyB`
  - `activeStoreId`
- 보이는 점포 기준 `visibleSide`는 계산한다: 비교 아님 → A, B 고르기·분석 중·실패 → 없음, 요약 → `storeSide`, 전체 결과 → 그 위치. 지도 마커·목록·점포 막대 문구는 모두 이 값으로 만든다.
- 늦은 응답 폐기: 요청 종류마다 AbortController와 요청 번호를 따로 둔다(A 분석·A 점포·B 분석·B 점포). 조건 변경·새 A 분석·비교 종료·B 다시 고르기·새 B 분석 때 해당 요청을 abort하고 상태를 비운다. 응답 처리 첫 줄에서 요청 번호가 다르면 버린다. 응답 조건(좌표·업종)이 요청과 다르면 계약 오류로 다룬다.
- 화면: `AnalysisResult`는 한 번에 하나만 마운트한다(고정 id). 비교 요약은 `CompareResult`가 `lib/compare.ts`·`lib/warnings.ts`로 그린다. 지도는 `MapView`의 `compare` prop으로 A/B 마커·반경·B 행정동 경계를 그린다. 지도 인스턴스는 다시 만들지 않는다. 지도 맞춤은 D-022: 단일 위치는 8-B1 범위 맞춤(`setCenter`→`setZoom`→`panBy`), 비교는 8-B2(B 선택 → A∪B 또는 B 원, "두 위치 모두 보기", 점포 기준 A↔B 전환·비교 종료 → `panTo` 또는 맞춤). `App`은 점포 기준(`focus`)을 `compare` prop으로 넘긴다.
