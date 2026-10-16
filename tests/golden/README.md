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
