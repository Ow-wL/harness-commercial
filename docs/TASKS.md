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
- [ ] 5-4 production 배포 구조 결정: 서빙 방식(같은 origin reverse proxy 등)·워커 수·환경변수 관리·build asset(행정동 경계) 포함을 DECISIONS에 기록하고, 워커 수에 따라 디스크 캐시 재검토 조건(D-016)을 판단한다 (구현은 결정 후)
  - 진행 (2026-10-08): Cloud Run 서비스 1개에서 FastAPI가 frontend build까지 같은 origin으로 서빙하기로 결정(D-018). `Dockerfile`·`backend/app/frontend.py`·테스트 준비, 로컬 Docker 실행·golden 검증 완료. 실제 GCP 배포는 아직

## 보류 (이번 범위 아님)
로그인, DB, AI 설명, 지원사업 추천, 점수 공식 개선, 업종 추가.
- 통계청 SGIS(공식 배포)에서 2026-07 이후 기준 행정동 경계를 받을 수 있게 되면 `data/geo/`의 2차 가공본(vuski/admdongkor ver20260701)을 공식 파일로 교체하고 `scripts/build_geo.py`로 재검증한다 (eng review D4·D14, D-009). 2026-10-06 현재 SGIS OpenAPI 경계 최신 연도는 2025(2026-07 개편 미반영)라 구월1/3동만 교정했다 (D-017).
