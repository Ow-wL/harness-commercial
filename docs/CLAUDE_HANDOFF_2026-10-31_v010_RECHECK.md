# 클로드 전달용 프롬프트 — R1 v0.1.0 재검수 후속

아래 내용을 그대로 전달하면 됩니다.

---

`C:\work\AICapstone\harness-commercial` 저장소의 R1 v0.1.0 Codex 재검수 결과를 반영해 줘.

코드 기준은 `ba9ff40`, 검수 시작 HEAD는 `master`의 `9a7397d`이며 두 커밋 사이는 검증 기록 문서만 다르다. 현재 미커밋 변경에는 Codex의 검수 문서·증거가 있으니 보존하고, HEAD가 더 진행됐다면 차이를 먼저 확인해 줘.

먼저 [Codex 검수 문서 맨 위의 “재검수” 절](C:/work/AICapstone/harness-commercial/docs/CODEX_REVIEW_2026-10-31_v010.md)을 읽어 줘. 이전 `c48a686` 검수의 8건과 이번 결과를 혼동하지 말아 줘. 기존 **R1-1~R1-8은 지정 재현 조건에서 해소 확인**, 이번 후속은 아래 **새 P2 두 건**이다.

1. **R1-9 — 보조 응답의 실제 버전 검증 누락**
   `useSideRequest`는 요청 당시 분석의 엔진·데이터 버전으로 key를 만들지만, 받은 `/rank`·`/insights` 응답의 실제 `X-Data-Version`이 달라도 표시·캐시한다. 응답 헤더만 바꾼 브라우저 재현에서 분석 `2026-06`과 보조 응답 `2099-01`이 함께 표시됐다. 저장 전 버전 일치 검증과 일관된 복구 경로를 추가하고, 필요하면 보조 API의 엔진 식별 계약도 정리해 줘. 이전 서버의 `/insights`·`/rank` 404에서도 기존 분석이 유지되는 동작은 보존해 줘.
2. **R1-10 — `/rank` 계산 실패 뒤 동일 key의 잠금이 둘로 나뉨**
   첫 계산이 실패하면 `finally`가 registry에서 key 잠금을 지우지만 기존 잠금을 기다리던 요청은 남아 있다. 그 대기자가 재계산할 때 새 요청이 다른 잠금으로 동시 계산한다. fake 서비스로 3요청을 제어한 재현에서 최대 동시 analyze 2, 총 59회(예외 1+29+29)가 확인됐다. 대기자까지 포함해 잠금 수명을 관리하거나 결과·예외를 공유하는 단일 계산 구조로 수정해 줘. 잠금 객체를 무한 누적하거나 서로 다른 좌표까지 직렬화하지 않도록 해 줘.

재현 자료:

- [브라우저 검사와 버전 오류 주입](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/browser.mjs), [결과 JSON](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/browser.json)
- [backend 실패 경합·오류 계약 재현](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/backend_edges.py), [결과 JSON](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/backend_edges.json)
- [공통 요청 훅 경계 검사](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/hooks.mjs), [결과 JSON](C:/work/AICapstone/harness-commercial/docs/review-r1-recheck/hooks.json)
- [TASKS 13-22 연결 기록](C:/work/AICapstone/harness-commercial/docs/TASKS.md)

제품 코드는 Codex 재검수 과정에서 수정하지 않았다. 전체 check 19단계·E2E 5/5는 네가 `ba9ff40`에서 실행한 기존 기록을 참조했으며 반복하지 않았다. Codex가 직접 추가 실행한 기존 검사는 frontend 관련 4파일 30/30, `/insights` backend 5 passed이고, 별도 API·브라우저·훅·PDF·실패 경합 검사도 문서에 구분했다.

두 문제를 먼저 재현한 뒤 필요한 범위만 수정하고, 버전 불일치 캐시 방지 및 실패 대기자 경합 회귀 검사를 추가해 줘. 수정 후 영향 검사를 실행하고, 최종 소스에 대한 배포 후보 검증은 저장소 규칙에 따라 판단·기록해 줘. 기존 소스의 전체 check 통과를 새 수정 소스의 결과로 쓰지 말아 줘.

`sources/`, `scoring_engine/v0_3/`, `data/runtime/`, `tests/golden/`을 수정하지 말고 점수 엔진도 바꾸지 말아 줘. **이번 후속에서는 커밋·푸시·배포하지 말아 줘.** 완료하면 수정 파일·원인·직접 검증 결과·남은 한계를 한국어로 보고하고, TASKS 13-22에 R1-9·R1-10 처리 내역을 추가해 줘.
