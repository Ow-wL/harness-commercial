# backend (FastAPI)

순서와 범위는 `docs/TASKS.md` 3장, 결정은 `docs/DECISIONS.md` D-012·D-013.

```bash
python -m uvicorn backend.app.main:app --reload
```

구조
- `app/main.py` — `create_app(service=None, warm_biz=None)` + module-level `app`. `GET /health`, `GET /businesses`, `POST /analyze`.
- `app/errors.py` — 오류 응답 모델(`ErrorResponse`)·error code·exception handler.
- `tests/` — `python -m pytest -q backend` (`scripts/check.py`가 `backend/app`이 있으면 자동 실행).

수명 주기 (3-1)
- import 시점에는 데이터를 읽지 않는다. FastAPI lifespan 시작에서 `AnalysisService`를 1회 만든다(`RuntimeData` 로드 약 4s). 이후 요청을 받는다.
- `ReferenceCache` warm은 **background thread**에서 업종 하나씩 진행한다(29개 약 60s). 서버 시작은 warm을 기다리지 않는다. warm되지 않은 업종은 요청 때 `ReferenceCache`가 계산한다(기존 lock·cache 그대로).
- 종료 시 warm thread에 중지 신호를 보낸다. 진행 중인 업종 1개가 끝나면 멈추고, 최대 5s만 기다린다(daemon thread).
- warm 실패: server log에 traceback, `/health`에는 `failed`와 `"업종코드: 예외이름"`만 보인다.

`GET /health`
```json
{"status": "ok", "service_ready": true,
 "warm": {"completed": 7, "total": 29, "done": false, "failed": false, "error": null}}
```

`GET /businesses` (3-2) — 엔진 `config.BIZ_GROUP` 그대로 (그룹·업종 순서 = 정의 순서, 업종 목록을 backend에 따로 두지 않는다). service·warm과 무관하게 즉시 응답.
```json
{"groups": [{"code": "A_고객밀착형", "name": "고객밀착형",
             "businesses": [{"code": "G20405", "name": "편의점", "group": "A_고객밀착형"}, ...]}, ...],
 "total": 29}
```

`POST /analyze` (3-3) — 좌표 → `ContextBuilder` → `AnalysisService.analyze`. `ContextBuilder`는 첫 `/analyze` 때 1회 만들어 앱 수명 동안 재사용한다(lock으로 동시 첫 요청에서도 1개).
```json
요청  {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406",
       "importance": {"market": 5}, "user_weights": null, "user_licenses": []}      // 뒤 세 개는 선택
응답  {"context": {"lat": 37.4894, "lng": 126.7246, "gu_code": "28237", "gu_name": "부평구",
                   "dong_name": "부평1동", "label": "부평구 부평1동", "rent_area": null},
       "result": { …AnalysisService.analyze 반환 dict 그대로 (meta·종합·지표·초보자_접근성·경고·면책)… }}
```
- `result`는 `AnalysisService.analyze` 결과를 변형하지 않는 pass-through다(키 번역·반올림·삭제·추가 없음). `tests/test_pass_through.py`가 여러 좌표에서 전체 equality로 고정한다(3-4). 엔진 JSON 계약은 `docs/ENGINE.md`.
- 일반 좌표의 `rent_area`는 항상 `null`(TASKS 1-6 미결정). 부평역 좌표도 `BUPYEONG_STATION`을 쓰지 않으므로 안정성·종합 점수가 legacy golden과 다를 수 있다(의도된 동작).
- `importance`·`user_weights`·`user_licenses`는 요청 검증을 통과한 값 그대로 엔진에 넘긴다.
- warm되지 않은 업종도 바로 계산한다(업종당 약 2.5s, `ReferenceCache` on-demand).

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
