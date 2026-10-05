# backend (FastAPI)

순서와 범위는 `docs/TASKS.md` 3장, 결정은 `docs/DECISIONS.md` D-012·D-013.

```bash
python -m uvicorn backend.app.main:app --reload
```

구조
- `app/main.py` — `create_app(service=None, warm_biz=None)` + module-level `app`. `GET /health`, `GET /businesses`.
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

원칙
- 엔진은 `scoring_engine.service.AnalysisService`로만 호출한다. 엔진 결과(JSON)를 바꾸지 않는다.
- 요청마다 CSV 로드·reference 재계산 금지.
- 테스트는 `create_app(service=공유 서비스, warm_biz=[...])`로 `RuntimeData`를 다시 읽지 않고 쓰는 업종만 warm한다(`tests/conftest.py`의 `real_service`).
