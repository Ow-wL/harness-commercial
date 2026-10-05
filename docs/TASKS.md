# Tasks

각 작업은 끝날 때 `scripts/check` 전체 통과가 조건이다. 위에서부터 순서대로.

## 완료
- [x] H-0 하네스: 원본 보호(해시), canonical 엔진, 런타임 데이터 분리, adapter, golden regression(29/29), check 스크립트, 문서

## 1. Analysis Context Builder (구현 완료 — 팀 확인 1-5a·1-6 남음)
- [x] 1-1 행정동 경계 데이터 확보: `data/geo/` (runtime 아님). 2026-07-01 경계 158개 + 2024→2026 crosswalk(검증용), 별도 매니페스트 `tests/manifests/geo.sha256.json`. 출처·한계는 `docs/DATA.md`, 결정은 `docs/DECISIONS.md` D-009
- [x] 1-2 경계 ↔ 패널 키 검증 테스트: 경계·crosswalk의 행정동코드 집합 == 패널 158개 (`tests/test_geo_data.py`)
- [x] 1-3 `LocationResolver.resolve(lat, lng)` → 행정동코드·행정동명·시군구코드·시군구명, 인천 밖이면 오류 (`scoring_engine/location.py`, `tests/test_location.py`). 경계 밖·바다 → `LocationOutside`, 잘못된 좌표 → `InvalidCoordinate`. SiteContext 생성과 주변 상가 0개(no_data_nearby) 검사는 1-7에서
- [x] 1-4 부평역 좌표의 실제 행정동: polygon 기준 **부평1동** (부평6동 경계까지 17m) = golden `BUPYEONG_STATION`과 같은 행정동 → 엔진 버전 변경·새 golden 불필요. 최근접 점포가 부평6동 라벨인 것은 경계 건너편 점포라서이며 좌표의 행정동으로 쓰지 않는다 (D-010)
- [x] 1-5 검증 테스트: 상가 점포 좌표 → 점포 행정동 라벨 일치율 (전수 135,750개, 전체 96.6% / 알려진 충돌 제외 98.4%). floor·근거는 D-010, `tests/test_location_agreement.py`
- [ ] 1-5a (팀 확인) 남동구 구월1동 서쪽 띠(경도 126.7007~126.7079): 경계는 구월1동, 점포 라벨 2,486개는 구월3동. 실제 행정동 확인 후 경계 또는 라벨 출처 판단 (D-010). 확인 전까지 `ContextBuilder`는 보정 없이 polygon 결과(구월1동)를 쓴다 — 이 구역 고객성 점수에 영향
- [ ] 1-6 임대료 상권 연결 규칙 결정(팀): 설계서 11-x 역 중심 500m 근사 vs 연결 안 함. **현재 정책: `ContextBuilder`는 모든 좌표에 `rent_area=None`(S4 제외)**, 부평역 근처도 특별 처리 없음. `"부평"`은 golden fixture `BUPYEONG_STATION`에만 있다
- [x] 1-7 `ContextBuilder.build(lat, lng) -> SiteContext` (`scoring_engine/location.py`) + 테스트 (`tests/test_context_builder.py`). 반경 500m 점포 0개 → `NoDataNearby`, runtime 연결 실패 → `ContextDataError`. golden 테스트는 계속 `BUPYEONG_STATION`으로 통과 (D-011)

## 2. 성능 준비
- [x] 2-1 `ReferenceCache.warm()` 시작 시간 측정·상한 (D-013). check: `tests/test_reference_cache.py` (업종 1개 cold warm ≤ 15s, 두 번째 warm 재계산 없음, entry 29/14). 전체 29개 cold warm(약 60s)은 `python scripts/bench_reference.py` (≤ 180s)
- [ ] 2-2 (필요 시 — 현재 불필요, D-013) reference 디스크 캐시 `data/cache/` — 키에 엔진 버전·데이터 해시 포함, 캐시 경로 결과 == 비캐시 결과 테스트

## 3. Backend (FastAPI)
- [x] 3-1 `backend/app` skeleton (`backend/app/main.py`, `backend/tests/test_app.py`). app factory `create_app(service=None, warm_biz=None)`. production: lifespan 에서 `AnalysisService` 1회 생성(RuntimeData 로드) 후 바로 요청 수신, `ReferenceCache` 29개 업종 warm은 background thread에서 진행. `/health`가 warm 진행도(`warm.completed`/`warm.total`/`done`/`failed`/`error`)를 보여 준다. 아직 warm되지 않은 업종 요청은 on-demand 계산(캐시 lock 대기 ≤ 약 2s) 허용. 테스트: 세션 공유 `AnalysisService`(`real_service`)를 주입하고 테스트가 쓰는 업종만 warm(scoped warm) — 테스트마다 29개 전체 warm을 반복하지 않는다 (D-012)
- [x] 3-2 `GET /businesses` (29개 업종·4개 그룹). 엔진 `config.BIZ_GROUP`을 정의 순서 그대로 반환, 별도 목록 없음. 응답 `{groups:[{code,name,businesses:[{code,name,group}]}], total}` (`backend/tests/test_businesses.py`)
- [x] 3-3 `POST /analyze {lat,lng,biz_code,importance?,user_weights?,user_licenses?}` → `location.ContextBuilder`(앱당 1개, 첫 요청 때 생성) → `AnalysisService`. 응답 `{context:{lat,lng,gu_code,gu_name,dong_name,label,rent_area}, result:<엔진 dict 그대로>}`. 일반 좌표의 `rent_area`는 `None` (1-6 결정 전, 부평역 근접 특별 처리 없음). happy path 테스트 `backend/tests/test_analyze.py`
- [x] 3-4 API 테스트 = pass-through equality (`backend/tests/test_pass_through.py`): 부평역·PC방, 구월 충돌 구역·카페(polygon 그대로 구월1동), 아라2동·미용실, 부평역·PC방+importance 에 대해 API `result` 전체 == `AnalysisService.analyze(ContextBuilder.build(lat, lng), biz, ...)` JSON, `context` == SiteContext 공개 필드. golden 29/29는 `BUPYEONG_STATION`을 쓰는 service/engine regression에 그대로 둔다. public API에 golden 재현용 preset·테스트 전용 필드를 추가하지 않는다 (D-012)
- [ ] 3-5 오류 계약 (full mapping, D-012). 입력·도메인 오류 → 안정적인 4xx + frontend가 구분할 error code: 요청 검증(유한한 lat/lng, `importance` 1..5, `user_weights` ≥ 0) · `InvalidCoordinate` · `LocationOutside`(location_outside) · `NoDataNearby`(no_data_nearby) · 잘못된 업종 · 엔진 가중치 `ValueError`. 내부 오류(`ContextDataError`, `KeyError`, 예상하지 못한 예외) → 500 + `request_id`, traceback은 응답에 넣지 않고 server log에만. 구체적 status 값은 구현 시 예외 구조를 보고 확정. 오류 경로마다 테스트
- [ ] 3-6 check에 backend 단계 연결 (이미 자리 있음). backend 테스트는 3-1의 scoped warm으로 check 시간 증가를 최소화

## 4. Frontend (React + TypeScript)
- [ ] 4-1 Vite + TS skeleton, `npm run check`(tsc + lint + test) → check에 자동 연결
- [ ] 4-2 API 응답 Zod schema를 source of truth로 두고 TypeScript 타입은 schema에서 추론 (손으로 쓴 interface 대신). `npm run check`에서 29개 golden JSON(`tests/golden/v0.3/json`)이 모두 schema를 통과하는 테스트. 개발 환경에서 live API 응답도 같은 schema로 검증할 수 있게 설계 (D-012)
- [ ] 4-3 결과 화면 (원본 `06_MVP화면` 시안 기준) — 지도 없이 부평역 고정 응답으로
- [ ] 4-4 지도 + 위치 선택 (API 키는 `.env`, commit 금지)

## 보류 (이번 범위 아님)
로그인, DB, AI 설명, 지원사업 추천, 점수 공식 개선, 업종 추가.
- 통계청 SGIS(공식 배포)에서 2026-07 이후 기준 행정동 경계를 받을 수 있게 되면 `data/geo/`의 2차 가공본(vuski/admdongkor ver20260701)을 공식 파일로 교체하고 `scripts/build_geo.py`로 재검증한다 (eng review D4·D14, D-009).
