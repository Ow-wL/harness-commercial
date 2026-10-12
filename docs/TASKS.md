# Tasks

각 작업은 끝날 때 `scripts/check` 전체 통과가 조건이다. 위에서부터 순서대로.

## 완료
- [x] H-0 하네스: 원본 보호(해시), canonical 엔진, 런타임 데이터 분리, adapter, golden regression(29/29), check 스크립트, 문서

## 1. Analysis Context Builder (완료)
- [x] 1-1 행정동 경계 데이터 확보: `data/geo/` (runtime 아님). 2026-07-01 경계 158개 + 2024→2026 crosswalk(검증용), 별도 매니페스트 `tests/manifests/geo.sha256.json`. 출처·한계는 `docs/DATA.md`, 결정은 `docs/DECISIONS.md` D-009
- [x] 1-2 경계 ↔ 패널 키 검증 테스트: 경계·crosswalk의 행정동코드 집합 == 패널 158개 (`tests/test_geo_data.py`)
- [x] 1-3 `LocationResolver.resolve(lat, lng)` → 행정동코드·행정동명·시군구코드·시군구명, 인천 밖이면 오류 (`scoring_engine/location.py`, `tests/test_location.py`). 경계 밖·바다 → `LocationOutside`, 잘못된 좌표 → `InvalidCoordinate`. SiteContext 생성과 주변 상가 0개(no_data_nearby) 검사는 1-7에서
- [x] 1-4 부평역 좌표의 실제 행정동: polygon 기준 **부평1동** (부평6동 경계까지 17m) = golden `BUPYEONG_STATION`과 같은 행정동 → 엔진 버전 변경·새 golden 불필요. 최근접 점포가 부평6동 라벨인 것은 경계 건너편 점포라서이며 좌표의 행정동으로 쓰지 않는다 (D-010)
- [x] 1-5 검증 테스트: 상가 점포 좌표 → 점포 행정동 라벨 일치율 (전수 135,750개). 교정 전 전체 96.6% / 알려진 충돌 제외 98.4% → 1-5a 교정 후 전체 98.46% (제외 없음). floor·근거는 D-010, `tests/test_location_agreement.py`
- [x] 1-5a (공식 확인 + 경계 교정) 남동구 구월1동 서쪽 띠(경도 126.7007~126.7079): 2차 가공 경계는 구월1동, 점포 라벨 2,486개는 구월3동이던 충돌. SGIS 공식 역지오코딩(addr_type=20)으로 439/439 좌표 = 구월3동 확인 (D-010 "1-5a 공식 확인 결과", `scripts/verify_guwol_admin_dong.py`). SGIS 행정경계 2025(최신 제공 연도)의 구월3동 polygon으로 `scripts/build_geo.py`에서 구월1/3동 경계를 교정 (D-017, 공식 입력 `data/geo/SGIS_행정동경계_2025_남동구_구월.geojson`, 받기 `scripts/fetch_sgis_boundary.py`). 점포 라벨·`data/runtime`·엔진·golden 변경 없음. 이 구역 좌표는 이제 `구월3동`. known conflict 예외는 해소 상태 고정 테스트(0건)로 바꾸고 floor 재측정 (남동구 0.969 → 0.970)
- [x] 1-6 임대료 상권 연결 규칙 결정: **MVP에서는 R-ONE 임대료 상권을 일반 좌표에 연결하지 않는다** (D-015). `ContextBuilder`는 모든 좌표에 `rent_area=None`(S4 제외), 부평역 근처도 특별 처리 없음 — 기존 동작이 곧 결정이라 코드 변경 없음. `"부평"`은 golden fixture `BUPYEONG_STATION`에만 있다
- [x] 1-7 `ContextBuilder.build(lat, lng) -> SiteContext` (`scoring_engine/location.py`) + 테스트 (`tests/test_context_builder.py`). 반경 500m 점포 0개 → `NoDataNearby`, runtime 연결 실패 → `ContextDataError`. golden 테스트는 계속 `BUPYEONG_STATION`으로 통과 (D-011)

## 2. 성능 준비
- [x] 2-1 `ReferenceCache.warm()` 시작 시간 측정·상한 (D-013). check: `tests/test_reference_cache.py` (업종 1개 cold warm ≤ 15s, 두 번째 warm 재계산 없음, entry 29/14). 전체 29개 cold warm(약 60s)은 `python scripts/bench_reference.py` (≤ 180s)
- [x] 2-2 reference 디스크 캐시 — **도입 여부 판단 완료, 현재 미도입** (D-016). 현재 성능으로 충분하다(D-013). 멀티 워커 운영 또는 잦은 재시작으로 cold start가 문제될 때 다시 연다. 그때 조건: `data/cache/`, 키에 엔진 버전·데이터 해시 포함, 캐시 경로 결과 == 비캐시 결과 테스트

## 3. Backend (FastAPI) — 3-1 ~ 3-6 완료
- [x] 3-1 `backend/app` skeleton (`backend/app/main.py`, `backend/tests/test_app.py`). app factory `create_app(service=None, warm_biz=None)`. production: lifespan 에서 `AnalysisService` 1회 생성(RuntimeData 로드) 후 바로 요청 수신, `ReferenceCache` 29개 업종 warm은 background thread에서 진행. `/health`가 warm 진행도(`warm.completed`/`warm.total`/`done`/`failed`/`error`)를 보여 준다. 아직 warm되지 않은 업종 요청은 on-demand 계산(캐시 lock 대기 ≤ 약 2s) 허용. 테스트: 세션 공유 `AnalysisService`(`real_service`)를 주입하고 테스트가 쓰는 업종만 warm(scoped warm) — 테스트마다 29개 전체 warm을 반복하지 않는다 (D-012)
- [x] 3-2 `GET /businesses` (29개 업종·4개 그룹). 엔진 `config.BIZ_GROUP`을 정의 순서 그대로 반환, 별도 목록 없음. 응답 `{groups:[{code,name,businesses:[{code,name,group}]}], total}` (`backend/tests/test_businesses.py`)
- [x] 3-3 `POST /analyze {lat,lng,biz_code,importance?,user_weights?,user_licenses?}` → `location.ContextBuilder`(앱당 1개, 첫 요청 때 생성) → `AnalysisService`. 응답 `{context:{lat,lng,gu_code,gu_name,dong_name,label,rent_area}, result:<엔진 dict 그대로>}`. 일반 좌표의 `rent_area`는 `None` (D-015, 부평역 근접 특별 처리 없음). happy path 테스트 `backend/tests/test_analyze.py`
- [x] 3-4 API 테스트 = pass-through equality (`backend/tests/test_pass_through.py`): 부평역·PC방, 구월 교정 구역·카페(1-5a 교정 후 구월3동), 아라2동·미용실, 부평역·PC방+importance 에 대해 API `result` 전체 == `AnalysisService.analyze(ContextBuilder.build(lat, lng), biz, ...)` JSON, `context` == SiteContext 공개 필드. golden 29/29는 `BUPYEONG_STATION`을 쓰는 service/engine regression에 그대로 둔다. public API에 golden 재현용 preset·테스트 전용 필드를 추가하지 않는다 (D-012)
- [x] 3-5 오류 계약 (D-014, `backend/app/errors.py`, `backend/tests/test_errors.py`). 사용자 입력·분석 불가 → 422 `{error:{code,message}}`: `invalid_request`(요청 검증: JSON 숫자·유한한 lat/lng·범위, importance 정수 1..5, user_weights 유한 ≥ 0, 알 수 없는 관점, 깨진 JSON) · `invalid_coordinate` · `location_outside` · `no_data_nearby` · `invalid_business` · `invalid_analysis_options`(엔진 `resolve_weights` 규칙). 내부 오류(`ContextDataError`, `KeyError`, analyze 안의 예외) → 500 `{error:{code:internal_error,message,request_id}}`, traceback은 request_id와 함께 server log에만
- [x] 3-6 check에 backend 단계 연결: `scripts/check.py`가 `backend/app`이 있으면 `python -m pytest -q backend`를 실행하고, 실패하면 CHECK FAILED (코드 변경 없이 기존 단계로 확인, backend 81개 PASS 약 15s). backend 테스트는 3-1의 scoped warm으로 check 시간 증가를 최소화

## 4. Frontend (React + TypeScript) — 4-0 ~ 4-4 완료
- [x] 4-0 프로젝트 `DESIGN.md` 확정 — frontend 구현 전 디자인 시스템(원칙·색·타이포·레이아웃·결과 위계·컴포넌트·오류 상태·반응형·접근성·토큰·agent 규칙). 이후 4-x UI는 이 문서를 따른다
- [x] 4-1 Vite + TS skeleton, `npm run check`(tsc + lint + test) → check에 자동 연결
- [x] 4-2 API 응답 Zod schema를 source of truth로 두고 TypeScript 타입은 schema에서 추론 (손으로 쓴 interface 대신). `npm run check`에서 29개 golden JSON(`tests/golden/v0.3/json`)이 모두 schema를 통과하는 테스트. 개발 환경에서 live API 응답도 같은 schema로 검증할 수 있게 설계 (D-012)
- [x] 4-3 결과 화면 (원본 `06_MVP화면` 시안 기준) — 지도 없이 부평역 고정 응답으로
- [x] 4-4 지도 + 위치 선택 (API 키는 `.env`, commit 금지) — NAVER Maps v3(Client ID만, singleton loader) + GET /businesses·POST /analyze(vite dev proxy, 응답 Zod 검증, error.code 분기) + 분석 후 backend context 행정동 경계 강조(data/geo 원본 재사용)

## 5. MVP Closeout
- [x] 5-1 문서 정합성 정리: README·ARCHITECTURE·CLAUDE.md·frontend README의 현재 단계·구조·실행 방법·환경변수 구분을 MVP 완료 상태에 맞춘다 (코드 변경 없음)
- [x] 5-2 실제 브라우저 수동 QA 및 버그 목록 작성: backend + frontend dev 실행 상태에서 대표 시나리오(부평역, 구월 교정 구역, 아라2동, 인천 밖·바다, 주변 점포 없음, 업종·중요도 변경, 모바일 폭, error.code별 화면)를 확인하고 재현 절차가 있는 버그 목록을 남긴다. 수정은 별도 작업
  - 결과 (2026-10-07): 실제 브라우저 QA 완료, 핵심 흐름(위치 선택 → 업종 → 분석 → 결과 → 행정동 경계 강조) 정상, 화면 값 = API 응답. 확인: 부평역·PC방, 구월 교정 구역(구월3동 context·경계), 인천 밖·바다(`location_outside`), 점포 없음(`no_data_nearby`), 좌표 범위 오류, 업종 변경 재분석, backend 중단 → 다시 시도, 새로고침 후 재분석, 1280·970·375px. 아라2동은 브라우저에서 따로 보지 않음(pass-through 테스트로 확인). 중요도 변경은 UI 없음(API만). 최종 판정: 시연 가능
  - 수정한 major: B1 선택 위치로 지도 이동(`panTo`, zoom 유지), B2 반응형 지도 canvas 크기 동기화(바깥 `.map` 관찰 → `setSize`). `frontend/src/components/MapView.test.tsx` 계약 테스트 4개 추가
  - 남은 known minor (blocker/major 아님, 수정하지 않음):
    - B3 태블릿 결과 지도 접기(DESIGN §14) 없음. 970px 확대/축소 컨트롤 잘림은 B2 수정으로 해소
    - B4 backend cold start 직후 background warm 중 미warm 업종 첫 분석 약 8s (warm 완료 후 약 0.3s). 시연은 `/health`의 `warm.done=true` 확인 후 시작
    - B5 모바일 첫 화면 sheet의 "좌표 직접 입력"이 입력란을 바로 펼치지 않음 (조건 패널에서 한 번 더 눌러야 함)
    - B6 인천 밖 dim overlay(DESIGN §5.D) 미구현, 모바일 초기 지도 안내 문구 중복, 모바일 업종 선택이 bottom sheet(§14) 대신 native select
- [ ] 5-3 자동 E2E smoke 테스트 도입 여부 결정: 도구·NAVER 지도 대체 방식·check 포함 여부와 추가 시간을 비교해 DECISIONS에 기록한다 (결정만, dependency 추가는 결정 후)
- [x] 5-4 production 배포 구조 결정: 서빙 방식(같은 origin reverse proxy 등)·워커 수·환경변수 관리·build asset(행정동 경계) 포함을 DECISIONS에 기록하고, 워커 수에 따라 디스크 캐시 재검토 조건(D-016)을 판단한다 (구현은 결정 후)
  - 결과 (2026-10-08): Cloud Run 서비스 1개에서 FastAPI가 frontend build까지 같은 origin으로 서빙(D-018). `Dockerfile`·`backend/app/frontend.py`·테스트, 로컬 Docker 실행·golden 검증. **Cloud Run(`asia-northeast3`) 배포 완료**, NAVER 콘솔에 서비스 URL 등록, 운영 사이트 점검 통과 (D-018 "배포·운영 점검")

## 6. 두 위치 비교 (5차) — 구현 완료·검수 승인 (D-020)
설계: `docs/COMPARE_DESIGN.md` (두 위치 × 같은 업종, 기존 `/analyze`·`/nearby-stores` 재사용, 엔진·API 계약 불변). 12장 결정은 추천안으로 확정(자동 확대·"두 위치 모두 보기" 제외).
- [x] 5-A 설계 문서 (현재 코드 확인, 상태 전이·늦은 응답·지도 A/B·점포 기준·비교 항목·DOM id·모바일·키보드·테스트)
- [x] 5-B1 순수 함수(`lib/compare.ts`)·비교 fixture 4개·`displayWarnings`/`dataLimits`를 `lib/warnings.ts`로 export (동작 그대로)
- [x] 5-B2 App 비교 상태 기계 (A 보존, B 로딩·실패·재시도·다시 고르기·종료, 늦은 응답 폐기) + 최소 조작 화면(`ComparePanel`·`CompareSheet`), 좌표 입력 재사용(`CoordinateForm`)
- [x] 5-B3 비교 화면 (점수 표·표시용 차이 A−B·같은 구·동 안내·미산출·경고·원시값, id 유일성) + 요약 / A·B 전체 결과 전환(`CompareResult`·`CompareDetail`). 비교 중 점포 목록·마커는 숨김(B5에서 기준 전환)
- [x] 5-B4 지도 A/B 마커·반경·경계 (zoom 불변) — 글자 마커 A/B, B 점선 반경, 성공한 B 행정동 경계(같은 동 중복 없음), 분석 불가 B 회색, `panTo(B)`/종료 시 `panTo(A)`, 비교 안내·범례
- [x] 5-B5 동종 점포 기준 위치 전환 — B 점포 조회(별도 요청 번호·늦은 응답 폐기·실패 시 점포만 다시 시도), 요약 A/B 전환(기본 B, 재조회 없음), 전체 결과 위치별 점포·복귀 시 기준 복원, 막대·제목에 A/B와 위치, mobile 안내·범례 겹침 정리
- [x] 5-B6 통합 검증·모바일·문서 마무리 — 실제 브라우저 통합 흐름·4개 사례·실패/재시도·요청 수, 375px 로고·sheet 접촉과 970px 점포 막대의 정보창 가림 수정, 터치 영역("지도에 표시" 44px), ARCHITECTURE 6장·DECISIONS D-020·DESIGN §8.15·§14

- [x] 6-1 태블릿 정보창 잘림: tablet 결과 지도 200 → 320px(`App.css`). autoPan 방식은 막대 겹침·크기 변경 잘림으로 실패해 되돌림(COMPARE_DESIGN.md 13장 "B6 후속")
- [x] 6-2 포커스 대상이 sticky 헤더에 가려짐(800×600 B 성공 비교 제목 등): 문서 `scroll-padding-top` = 헤더 실제 높이(`--header-offset`, App이 ResizeObserver + 포커스 직전 측정). 포커스 대상·지도 동작은 그대로(COMPARE_DESIGN.md 13장 "6-2")
- [x] 6-5 개발 모드(StrictMode)에서 A/B 전체 결과를 열면 화면이 맨 위(지도)에 남음: `CompareDetail` 마운트 effect의 스크롤 초기화가 StrictMode 재실행으로 App 포커스 뒤에 한 번 더 돌았다(실행 순서 기록으로 확인). 초기화를 App 포커스 layout effect(`focusLater(..., { resetScroll: true })`)로 옮겨 "초기화 → 포커스"를 한 곳에서 한 번. 테스트 +3(StrictMode 순서·반복·복귀 포커스), dev·production × 800/375/1280 실측, 늦은 참고 주소 포함(COMPARE_DESIGN.md 13장 "6-5")
- [x] 6-4 mobile 패널에서 고른 점포 정보창이 "지도 보기" 뒤 폭 24px로 접힘: 숨겨진 지도(0×0)에서 `InfoWindow.open` → SDK가 폭 0으로 고정(실측). `MapView` 크기 맞춤 흐름(ResizeObserver → setSize)이 `sized`도 정하고, 정보창은 `sized` + 열기 직전 실제 크기가 있을 때만 open·panTo(숨기면 닫아 둠, 보이면 그때 선택으로 다시 엶). 선택·막대·이동 규칙·지도 인스턴스 그대로. 테스트 +8(MapView 6, App 2), production build 375×812·360×640·tablet·desktop·단일·비교 요약·A/B 전체 결과 실측(COMPARE_DESIGN.md 13장 "6-4"). 보완: 0×0 알림 전 실제 크기 0으로 미룬 열기가 `sized`가 true 그대로라 다시 처리되지 않던 경로 → 미룸 표시 + 양수 크기 맞춤 뒤 재처리 카운터, 테스트 +4·브라우저 실측(13장 "6-4 보완"). 마지막 보완: 같은 크기로 숨김 → 보임이 한 프레임 안에 끝나 크기 알림이 없는 경우도 App 화면 전환 신호(`layoutKey` = mobileScreen)로 DOM 반영 뒤 크기 맞춤 → 미룬 정보창 처리, 테스트 +4(RO 콜백 없음)·브라우저 실측(창 크기 변경 없음)(13장 "6-4 마지막 보완")
- [x] 6-3 지도 안 SDK 요소(로고·축척, z-index 100)가 sticky 헤더(10) 위에 그려져 "데이터 출처" 링크를 덮던 문제: `.map { isolation: isolate }` 한 줄로 지도 안 쌓임을 닫음. 헤더 z-index·SDK DOM은 손대지 않음(COMPARE_DESIGN.md 13장 "6-3")

## 7. 주소 표시·주소 검색 (7차) — 구현·통합 검증 완료 (D-021), 운영 배포 완료 (2026-10-13, D-018 "7차 재배포")
설계: `docs/ADDRESS_DESIGN.md`. 분석 행정동은 backend `context` 그대로, 주소는 참고 정보. 채택안은 NAVER Web SDK Geocoder 서브모듈(Client ID만, backend·Secret 변경 없음) — 공식 문서로 인증·활성화 조건(Geocoding·Reverse Geocoding 선택, 문서상 미선택 시 429 — 7-B0 실측은 403, 원인 미확인)·요금(대표 계정 월 3,000,000건 무료, 초과 0.5원/건, 구 AI NAVER API 상품은 2025-07-01부터 무료량 없음)을 확인했다.
- [x] 7-A 설계 문서 (현재 SDK·설정 조사, 공식 문서 확인, 검색·표시 흐름, A/B 캐시·취소·늦은 응답, 장애 격리, 변경 파일·단계·테스트·콘솔 확인 항목)
- [x] 7-B0 콘솔 확인 + 브라우저 스파이크 (ADDRESS_DESIGN §9·§7-0·§11) — 상태 **준비 시점 확인 완료 / 정상 호출 확인 완료**(2026-10-12). 별도 페이지 `frontend/spike/geocoder-spike.html`에서 SDK 1회 로드, `load` 시점엔 `Service` 없고 `callback` 시점엔 있음(설계 §5.1 지도/Geocoder 준비 분리). 1차 호출은 둘 다 HTTP 403(SDK 콜백 ERROR·응답 없음). 사용자 콘솔 확인: 신규 Maps 상품·대표 계정·**Geocoding·Reverse Geocoding 미선택 → 선택 저장**. 재검증 각 1회: 역방향·정방향 모두 HTTP 200·SDK 200(54ms·123ms), 응답 구조 §3.4와 일치, fixture 2개 저장(인증값·URL 없음). 1차 403은 API 미선택과 일치(문서상 429와 다름). **남은 사용자 항목(당시 기록): 한도 및 알림 설정(§9-5)** → 현재 완료(2026-10-12 설정, 아래 "배포 전"·D-018 "7차 재배포"). 7-B1은 별도 승인 뒤
- [x] 7-B1 로더 `submodules=geocoder&callback` + 지도/Geocoder 준비 분리(`GeocoderAvailability`, 10초 타임아웃 → unavailable, failed 끝 상태 `reduceSdkState`) + `MapView.onSdkState`(최소 연결, App 미사용) + `map/geocoder.ts` adapter(Zod looseObject·8초 timeout·첫 콜백만·동기 예외 결과 객체·좌표 형식/범위 검증·주소 공백 정규화·ERROR+응답 없음=unknown) + 테스트 38개(adapter 22, 로더·reducer 10, MapView 6). 브라우저: 1280/800 단일·비교 정상, Geocoder 호출 0건, 서브모듈만 차단해도 지도·분석 정상(ADDRESS_DESIGN §12). 검수 보완(`938682c`): 성공 응답 `addresses` 누락 → schema(정상 `[]`만 empty), `callOnce` 동기 예외 시 타이머 즉시 해제·이후 콜백 무시(+6 테스트, adapter 28개). 잔여(사용자): 한도 설정·운영 URL 검증
- [x] 7-B2 참고 주소 표시(단일): `lib/addressCache.ts`(좌표 키 그대로, LRU 100, in-flight 공유, ok·none 유지, error 60초 뒤 다음 조회 때만) + `lib/useReferenceAddress.ts`(ready+geocoder ready일 때만 조회, 현재 키 캐시만 표시 → 좌표 변경 첫 렌더부터 이전 주소 없음, failed면 캐시도 숨김) + `ReferenceAddress`(성공일 때만 "참고 주소 · … (NAVER 지도)") + App `onSdkState` 연결·위치 필드·mobile sheet(한 줄 말줄임, max-height 640 숨김)·결과 패널. 비교 화면은 슬롯을 넘기지 않아 미연결(7-B3). 테스트 +28(캐시 7, hook 13, App 6, 레이아웃 2). 실패·없음은 기존 표시 그대로(ADDRESS_DESIGN §12)
  - 7-B2 실측 중 발견(기존 동작, 7-B2와 무관 — stash한 옛 코드로 재현): mobile 패널 화면에서 점포 목록으로 정보창을 연 뒤 "지도 보기"로 넘어오면 SDK 정보창 폭이 24px로 접힌다(지도가 숨겨진 상태에서 크기를 잼). 지도 화면에서 고르면 정상. 별도 항목(ADDRESS_DESIGN §12 "7-B2") → 6-4에서 고침
- [x] 7-B3 참고 주소(비교 A/B): 기존 `ReferenceAddress`·캐시·hook 재사용. B 카드(B 고르기·분석 중·오류의 현재 B 좌표), 비교 요약 A/B 카드(각 `context` 좌표), A/B 전체 결과 막대(보고 있는 위치). B 선택·성공·요약·전체 결과·점포 기준·종료가 같은 키라 좌표당 1회. 늦은 주소 줄이 포커스를 화면 밖으로 밀면 `lib/keepFocusInView.ts`로 밀린 만큼만 되돌림. 테스트 +9(App 비교 6 — 7-B2 "비교 줄 없음" 1개 대체, keepFocusInView 4). 브라우저 1280·800·375 긴 주소 넘침 0, 실제 호출 2건(ADDRESS_DESIGN §12 "7-B3")
- [x] 7-B4 주소 검색(단일): `components/AddressSearch.tsx`(+css, `lib/addressSearch.ts` 상수·정렬) — 위치 필드 "주소로 찾기" disclosure(Geocoder ready일 때만), 제출 1회 = 호출 1회(공백 0회, 입력 중 0회), 인천시청 기준 10건 → 5건 + "더 보기"(재호출 없음), 인천 먼저·인천 밖은 시·도 caption만(선택 허용, backend `location_outside` 판정), 선택 = adapter lat/lng 그대로 `selectLocation`(분석 자동 실행 없음) → 폼 접고 위치 요약(`tabIndex=-1`) 포커스. 요청 번호로 입력 변경·재검색·닫기·api 변경·언마운트 뒤 늦은 응답 폐기, SDK 실패로 폼이 포커스를 가진 채 사라지면 "좌표 직접 입력"으로 복구. 테스트 +21(AddressSearch 14, App 7). 브라우저 1280·800·375, 실제 호출 검색 2·역지오코딩 1(ADDRESS_DESIGN §12 "7-B4")
- [x] 7-B5 주소 검색(비교 B): `AddressSearch` 재사용(`labelPrefix="B "` → "B 주소로 찾기"·"B 주소"·"B 주소 검색"), B 카드 좌표 입력 위, Geocoder ready·B 분석 중 잠금 규칙. 선택 = adapter lat/lng 그대로 `submitCompareLocation`(B만 변경, 분석 없음, 포커스 "B 분석하기"), A 같은 좌표 → D2·`/analyze` 0, 인천 밖 → backend 판정(A 유지). 비교 취소·재시작·조건 변경은 언마운트로 늦은 응답 폐기. SDK 실패 포커스 복구는 `lib/useSearchFocusRecovery.ts`로 공통화(B: "B 위도" 또는 B 카드 제목). mobile 비교 sheet에는 검색 없음(패널에서). 테스트 +10(App 9, AddressSearch 1). 브라우저 1280·800·375, 실제 호출 검색 1·역지오코딩 2(ADDRESS_DESIGN §12 "7-B5"). 보완: B 오류의 "지도에서 다시 선택"(pickB)은 B 고르기 화면을 그대로 둬 늦은 검색 응답이 보였다 → App `bPickSeq`를 B 검색 `key`로 써서 pickB마다 검색 초기화(지도 클릭은 유지), 포커스 복구 신호는 커밋 안에서만. 테스트 +4(ADDRESS_DESIGN §12 "7-B5 보완")
- [x] 7-B6 통합 검증·문서: 실제 API 정상 흐름 1회(키보드, 1280×800 production build — 검색 A/B 각 1·역지오코딩 좌표당 1, 화면·점포 기준 전환 추가 호출 0, `/analyze`·`/nearby-stores` 좌표 = 선택 좌표), mock 장애·경합(검색 0건·실패, 참고 주소 없음·실패·지연, Geocoder 서브모듈 차단, B 오류 다시 선택·비교 취소 재시작·늦은 응답), production 6개 크기(1280×800·970×800·800×600·375×812·375×667·360×640) 가로 넘침 0·포커스 헤더 아래·터치 44px·sheet 말줄임/숨김, 점포 지도↔패널·닫기·Escape, dev StrictMode A/B 전체 결과. 새 회귀 없음 → 테스트 추가 없음. ADDRESS_DESIGN §12 "7-B6", README·ARCHITECTURE·DECISIONS D-021 정리
- [x] 배포 전 (사용자): NAVER 콘솔 Geocoding·Reverse Geocoding 사용량 한도(일 1,000·월 10,000, 초과 불허)·알림 수신자 설정 (2026-10-12)
- [x] 7차 운영 재배포 (2026-10-13, 커밋 `6f7df52`, Codex 배포 검수 통과): 로컬 Docker 검증 → push(index digest `68bb28e6…` 대조 확인, 실제 amd64 `089a90d0…`) → 무트래픽 리비전 `<서비스>-6f7df52` → 태그 URL API 검증(`tests/helpers.py` 기준 로컬 대조, `/nearby-stores` 87건 = 엔진 동종점포수) → 100% 전환 → NAVER 등록 주소에서 운영 화면 검증(지도·주소 검색 A/B·참고 주소·분석·비교, 실제 호출 검색 2·역지오코딩 2, 375px) → 검증 태그 제거. 이전 리비전 `<서비스>-00001-872`·`:b3b3897` 복구용 보존(Retired, 최소 인스턴스 미배치). 상세·복구 절차는 D-018 "7차 재배포"
  - 별칭 URL(NAVER 미등록)에서 지도 인증 실패를 보고 복구 1회 → 확인 주소 오류로 판단해 재전환. 운영 화면 검증은 NAVER 등록 주소에서만 한다. 복구 구간의 실제 사용자 영향(새 화면의 `/nearby-stores` 404 등)은 미확인
  - 복구 완료 확인은 `/health` 200 + `service_ready`·warm 29/29까지(Retired 리비전은 재시작·warm 필요). 운영 첫 `/analyze` 약 4.5초의 원인은 미확정

## 보류 (이번 범위 아님)
로그인, DB, AI 설명, 지원사업 추천, 점수 공식 개선, 업종 추가.
- 통계청 SGIS(공식 배포)에서 2026-07 이후 기준 행정동 경계를 받을 수 있게 되면 `data/geo/`의 2차 가공본(vuski/admdongkor ver20260701)을 공식 파일로 교체하고 `scripts/build_geo.py`로 재검증한다 (eng review D4·D14, D-009). 2026-10-06 현재 SGIS OpenAPI 경계 최신 연도는 2025(2026-07 개편 미반영)라 구월1/3동만 교정했다 (D-017).
