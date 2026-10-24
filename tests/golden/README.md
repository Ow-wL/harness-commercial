# Golden fixtures

`v0.3/` = 원본 `sources/team_v0.3/05_분석결과/`의 바이트 동일 사본 (엔진 `mvp-0.3`, 분석 지점 부평역 반경 500m, 29개 업종).
- `부평역_업종별_적합도.csv` — 순위표
- `json/full_*.json` — 업종별 엔진 출력 전체

규칙
1. 테스트가 실패하면 **코드를 고친다.** fixture를 새 출력으로 덮어쓰지 않는다.
2. fixture는 엔진 버전이 바뀔 때만 새 디렉터리(`v0.4/` 등)로 추가한다. `v0.3/`은 수정·삭제하지 않는다.

`v0.4/` = 엔진 `mvp-0.4`(D-024)의 반경 300·1,000m 결과 (부평역 legacy 지점, 29개 업종) — `r300/json/`, `r1000/json/`.
- 500m 기준은 `v0.3/`을 그대로 쓴다(v0.4@500은 `meta.엔진버전`만 다르다, `tests/engine_v0_4`).
- 생성: `SCORING_ENGINE_VERSION=v0_4 python scripts/golden_v0_4.py` (있는 파일은 덮어쓰지 않는다).
3. 무결성은 `tests/test_integrity.py`가 원본 매니페스트 해시로 검사한다.

`v0.5/` = 엔진 `mvp-0.5`(D-028, 팀 전달 v0.5 + 반경 선택).
- `json/full_*.json`·`부평역_업종별_적합도.csv` — 팀 전달 `05_분석결과`의 바이트 사본(부평역 legacy 지점, 반경 500m, 임대료 상권 "부평"). 원본 해시는 `tests/manifests/source_team_v0.5.sha256.json`.
- `r300/json/`, `r1000/json/` — 웹 사본의 반경 300·1,000m 결과. 생성: `SCORING_ENGINE_VERSION=v0_5 python scripts/golden_v0_5.py` (있는 파일은 덮어쓰지 않는다).
- 팀 결과는 Python 3.12+로 만들어졌다. 3.10 실행과 `종합.적용_가중치` 반올림이 14칸 다르며(`sum()` 보정 합산 차이), `tests/engine_v0_5`가 그 칸만 재계산으로 확인해 허용한다. fixture는 고치지 않는다.

`v0.5.1/` = 엔진 `mvp-0.5.1`(D-029, v0.5 + 분동 배분 결함 수정). 팀 결과가 없는 웹 수정판이라 500m 포함 세 반경 모두 생성본이다 — `r500/json/`, `r300/json/`, `r1000/json/`.
- 생성: `SCORING_ENGINE_VERSION=v0_5_1 python scripts/golden_v0_5.py` (있는 파일은 덮어쓰지 않는다).
- golden v0.5와의 차이는 고객성·경쟁성(과 그 가중합인 종합·경고)·엔진버전에서만 허용한다(`tests/test_engine_v0_5_1_diff.py`).
