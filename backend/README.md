# backend (FastAPI)

순서와 범위는 `docs/TASKS.md` 3장, 결정은 `docs/DECISIONS.md` D-012·D-013.

```bash
python -m uvicorn backend.app.main:app --reload
```

구조
- `app/main.py` — `create_app(service=None, warm_biz=None, frontend_dist=None, places=None)` + module-level `app`. `GET /health`, `GET /businesses`, `POST /analyze`, `POST /nearby-stores`, `POST /places {q}`(12-14).
- `app/places.py` — 장소 이름 검색 프록시(D-036): 환경변수 `NAVER_SEARCH_CLIENT_ID`·`NAVER_SEARCH_CLIENT_SECRET`(운영은 Cloud Run Secret)가 있을 때만 켜지고 `/health`의 `places.enabled`로 광고한다. 없으면 `POST /places`는 503 `places_unavailable`. 검색어·결과를 서버 로그에 남기지 않는다(본문 요청이라 요청 로그 경로에도 없다). 결과는 좌표 선택용이며 분석 행정동은 `/analyze`가 좌표로 판정한다.
- `app/errors.py` — 오류 응답 모델(`ErrorResponse`)·error code·exception handler.
- `app/frontend.py` — production에서 Vite build(`FRONTEND_DIST`)를 같은 origin으로 서빙: `/assets/*`, SPA fallback. API route 뒤에 붙어 API가 우선 (D-018). 이 모드에서는 `/docs`·`/redoc`·`/openapi.json`을 끈다(404, 인증 아님). 환경변수가 없으면 API만(문서 유지).
- `tests/` — `python -m pytest -q backend` (`scripts/check.py`가 `backend/app`이 있으면 자동 실행).

수명 주기 (3-1)
- import 시점에는 데이터를 읽지 않는다. FastAPI lifespan 시작에서 `AnalysisService`를 1회 만든다(`RuntimeData` 로드 약 4s). 이후 요청을 받는다.
- `ReferenceCache` warm은 **background thread**에서 업종 하나씩 진행한다(29개 약 60s). 서버 시작은 warm을 기다리지 않는다. warm되지 않은 업종은 요청 때 `ReferenceCache`가 계산한다. 이미 계산된 키는 warm 중에도 잠금을 기다리지 않고, 요청이 기다리면 warm이 다음 계산을 미룬다(8-D2a, `docs/spikes/8-D2a/`).
- 종료 시 warm thread에 중지 신호를 보낸다. 진행 중인 업종 1개가 끝나면 멈추고, 최대 5s만 기다린다(daemon thread).
- warm 실패: server log에 traceback, `/health`에는 `failed`와 `"업종코드: 예외이름"`만 보인다.

`GET /health`
```json
{"status": "ok", "service_ready": true,
 "engine": {"version": "mvp-0.3", "radius_options": [500], "default_radius_m": 500},
 "warm": {"completed": 7, "total": 29, "done": false, "failed": false, "error": null}}
```
- `engine`(8-D2, D-024): 이 서버 엔진이 받는 분석 반경. v0.4(`SCORING_ENGINE_VERSION=v0_4`)는 `"mvp-0.4"`, `[300, 500, 1000]`. v0.5(`SCORING_ENGINE_VERSION=v0_5`, D-028)는 `"mvp-0.5"`, v0.5.1(`v0_5_1`, D-029 분동 배분 수정)은 `"mvp-0.5.1"`, 둘 다 `[300, 500, 1000]`. 프런트는 `radius_options`가 2개 이상일 때만 반경 선택을 보인다(8-D3).
- warm 단위: 반경이 하나(v0.3)면 업종 29개, 여럿(v0.4·v0.5)이면 (업종, 반경) 87개 — 500m를 모두 먼저, 그다음 300·1,000m. 실패 표시는 `"업종코드@반경m: 예외이름"`.
- v0.5 는 시작 때 인구 면적 배분 경계(`data/geo/SGIS_행정동경계_2025_2Q_인천.geojson`)를 한 번 더 읽고(matplotlib 필요), `/analyze` 응답에 v0.5 raw 항목(실효 동종 수·집적도·역 의존도·학교구역 등)과 학교구역 경고(`경고[0]`)가 생긴다. `/nearby-stores count`는 계속 정확 일치 동종 점포 수(= `경쟁성.raw.동종점포수`)다.

`GET /businesses` (3-2) — 엔진 `config.BIZ_GROUP` 그대로 (그룹·업종 순서 = 정의 순서, 업종 목록을 backend에 따로 두지 않는다). service·warm과 무관하게 즉시 응답.
```json
{"groups": [{"code": "A_고객밀착형", "name": "고객밀착형",
             "businesses": [{"code": "G20405", "name": "편의점", "group": "A_고객밀착형"}, ...]}, ...],
 "total": 29}
```

`POST /analyze` (3-3) — 좌표 → `ContextBuilder` → `AnalysisService.analyze`. `ContextBuilder`는 첫 `/analyze` 때 1회 만들어 앱 수명 동안 재사용한다(lock으로 동시 첫 요청에서도 1개).
```json
요청  {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406",
       "importance": {"market": 5}, "user_weights": null, "user_licenses": [],
       "radius_m": 500}                                                              // 뒤 네 개는 선택
응답  {"context": {"lat": 37.4894, "lng": 126.7246, "gu_code": "28237", "gu_name": "부평구",
                   "dong_name": "부평1동", "label": "부평구 부평1동", "rent_area": null},
       "result": { …AnalysisService.analyze 반환 dict 그대로 (meta·종합·지표·초보자_접근성·경고·면책)… }}
```
- `result`는 `AnalysisService.analyze` 결과를 변형하지 않는 pass-through다(키 번역·반올림·삭제·추가 없음). `tests/test_pass_through.py`가 여러 좌표에서 전체 equality로 고정한다(3-4). 엔진 JSON 계약은 `docs/ENGINE.md`.
- 일반 좌표의 `rent_area`는 항상 `null`(MVP 정책, D-015: 임대료 상권을 일반 좌표에 연결하지 않음). 부평역 좌표도 `BUPYEONG_STATION`을 쓰지 않으므로 안정성·종합 점수가 legacy golden과 다를 수 있다(의도된 동작).
- `importance`·`user_weights`·`user_licenses`는 요청 검증을 통과한 값 그대로 엔진에 넘긴다.
- warm되지 않은 업종도 바로 계산한다(업종당 약 2.5s, `ReferenceCache` on-demand).
- `radius_m`(8-D2): JSON 정수만, 생략·`null` = 500. 엔진이 받는 값(`/health`의 `engine.radius_options`)이 아니면 422 `invalid_radius`. 검증 순서: 업종 → 분석 옵션 → 반경 → 좌표. 분석 가능 지점 판정(`no_data_nearby`)은 반경과 무관하게 500m 기준(D-024).

`POST /nearby-stores` (4차, D-019) — 분석 반경(`radius_m`, 생략 500) 안 같은 업종 점포 목록(표시용). `/analyze` 계약은 바꾸지 않고 별도 경로로 둔다. 검증 순서·오류 코드는 `/analyze`와 같다(업종 → 반경 → 좌표 `ContextBuilder`). 응답 `radius_m`은 쓴 반경, `count`는 같은 반경 `/analyze`의 경쟁성 `동종점포수`와 같다. 엔진 `analyze`는 부르지 않는다.
```json
요청  {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}
응답  {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406", "radius_m": 500, "as_of": "2026-06-30", "count": 12,
       "stores": [{"id": "MA0101…", "name": "라네이즈PC방", "road_address": "인천광역시 부평구 동수북로 156",
                   "jibun_address": "인천광역시 부평구 부평동 728-9", "lat": 37.48881, "lng": 126.72352, "distance_m": 115}, …]}
```
- 기준은 엔진 경쟁성과 같다: 거리 `radius_demand.haversine_m`, 반경 `거리 <= config.RADIUS_M`, 업종 `상권업종소분류코드 == biz_code` (`scoring_engine/nearby.py`). 그래서 `count == len(stores) ==` 같은 요청 `/analyze`의 `경쟁성.raw.동종점포수` (`tests/test_nearby.py` 부평역 29개 업종·여러 지점 × 29개, `backend/tests/test_nearby_stores.py`).
- `stores`는 가까운 순. `distance_m`은 직선거리(m, 반올림)이며 도보 거리가 아니다. 상호·주소가 비면 `null`.
- `as_of`는 상가(상권)정보 기준일(`SHOPS_AS_OF`, 원본 `00_README.md` 데이터 표). `NearbyStoreFinder`는 첫 요청 때 1회 만들어 재사용한다(RuntimeData 다시 읽지 않음, 요청당 약 15ms).

오류 계약 (3-5, D-014) — frontend는 status로 사용자/서버 오류를 나누고 `error.code`로 원인을 나눈다(`message`로 분기하지 않는다).
```json
422 {"error": {"code": "location_outside", "message": "인천 내 분석 가능한 위치가 아닙니다."}}
500 {"error": {"code": "internal_error", "message": "서버 내부 오류가 발생했습니다.", "request_id": "3f2a…(32자)"}}
```
| status | code | 언제 |
|---|---|---|
| 422 | `invalid_request` | 요청 형식·타입·범위 오류, 깨진 JSON (lat/lng는 JSON 숫자·유한·범위 안, importance는 정수 1..5, user_weights는 유한 ≥ 0, 관점 키는 엔진 5개만) |
| 422 | `invalid_business` | `biz_code`가 엔진 `config.CODE_NAME`에 없음 |
| 422 | `invalid_analysis_options` | 엔진 가중치 규칙 위반 (importance와 user_weights 동시 사용, 가중치 합 0 등) |
| 422 | `invalid_coordinate` / `location_outside` / `no_data_nearby` | location 계층 오류: 잘못된 좌표 / 인천 행정동 경계 밖 / 반경 500m 안 상가 0개 |
| 500 | `internal_error` | 그 밖의 모든 예외. 응답에는 traceback·예외 내용이 없고, server log(`backend.errors`)에 같은 `request_id`와 traceback |

원칙
- 엔진은 `scoring_engine.service.AnalysisService`로만 호출한다. 엔진 결과(JSON)를 바꾸지 않는다.
- 요청마다 CSV 로드·reference 재계산 금지.
- 테스트는 `create_app(service=공유 서비스, warm_biz=[...])`로 `RuntimeData`를 다시 읽지 않고 쓰는 업종만 warm한다(`tests/conftest.py`의 `real_service`).
