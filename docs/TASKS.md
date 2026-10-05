# Tasks

각 작업은 끝날 때 `scripts/check` 전체 통과가 조건이다. 위에서부터 순서대로.

## 완료
- [x] H-0 하네스: 원본 보호(해시), canonical 엔진, 런타임 데이터 분리, adapter, golden regression(29/29), check 스크립트, 문서

## 1. Analysis Context Builder (다음)
- [ ] 1-1 행정동 경계 데이터 확보: 개편 후 인천 시군구 체계(제물포·영종·서해·검단)와 **같은 행정동코드**를 쓰는 경계 파일 선정, 출처·기준일 기록, `data/runtime/`에 추가 (원본 사본 아님 → 별도 매니페스트)
- [ ] 1-2 경계 ↔ 패널 키 검증 테스트: 경계의 행정동코드 집합 == 패널 158개
- [ ] 1-3 `LocationResolver.resolve(lat, lng)` → 행정동코드·행정동명·시군구코드·시군구명, 인천 밖이면 오류
- [ ] 1-4 부평역 좌표의 실제 행정동 확인. 근접 점포 라벨로는 `부평6동`이 유력 (ARCHITECTURE 4장 경고). golden(부평1동 컨텍스트)은 그대로 두고, "좌표 → Resolver" 결과가 다르면 팀 결정: (a) golden 테스트는 명시 컨텍스트 `BUPYEONG_STATION`으로 유지 + Resolver 테스트는 별도, 또는 (b) 엔진 버전 올려 새 golden
- [ ] 1-5 검증 테스트: 상가 점포 표본 N개의 좌표 → 점포에 붙은 행정동 라벨과 일치율 측정 (경계 품질 확인)
- [ ] 1-6 임대료 상권 연결 규칙 결정(팀): 설계서 11-x 역 중심 500m 근사 vs 연결 안 함. 결정 전에는 `rent_area=None`(S4 제외) — 단, 부평역 컨텍스트는 `"부평"` 유지
- [ ] 1-7 `ContextBuilder.build(lat, lng) -> SiteContext` + 테스트 (부평역 기대값은 1-4 결정에 따름). golden 테스트는 계속 `BUPYEONG_STATION`으로 통과해야 한다

## 2. 성능 준비
- [ ] 2-1 `ReferenceCache.warm()` 시작 시간 측정 테스트(상한 기록)
- [ ] 2-2 (필요 시) reference 디스크 캐시 `data/cache/` — 키에 엔진 버전·데이터 해시 포함, 캐시 경로 결과 == 비캐시 결과 테스트

## 3. Backend (FastAPI)
- [ ] 3-1 `backend/app` skeleton, 시작 시 RuntimeData 로드 + warm, `/health`
- [ ] 3-2 `GET /businesses` (29개 업종·그룹)
- [ ] 3-3 `POST /analyze {lat,lng,biz_code,...}` → ContextBuilder → AnalysisService. 응답은 엔진 JSON 그대로 + 컨텍스트 메타
- [ ] 3-4 API 테스트: 부평역 요청 응답 == golden JSON
- [ ] 3-5 오류 계약: 인천 밖, 잘못된 업종, 잘못된 가중치(엔진 ValueError → 422)
- [ ] 3-6 check에 backend 단계 연결 (이미 자리 있음)

## 4. Frontend (React + TypeScript)
- [ ] 4-1 Vite + TS skeleton, `npm run check`(tsc + lint + test) → check에 자동 연결
- [ ] 4-2 API 타입 (엔진 JSON 계약 기준, `docs/ENGINE.md`)
- [ ] 4-3 결과 화면 (원본 `06_MVP화면` 시안 기준) — 지도 없이 부평역 고정 응답으로
- [ ] 4-4 지도 + 위치 선택 (API 키는 `.env`, commit 금지)

## 보류 (이번 범위 아님)
로그인, DB, AI 설명, 지원사업 추천, 점수 공식 개선, 업종 추가.
