# Codex 검수 자료 — R1 대시보드 리디자인 (앱 v0.1.0 후보, 2026-10-31)

## 0. 검수 범위와 기준 소스
- 기준 코드 `33d0625`(R1 한 커밋, master) — 운영은 `ef32cc5` v0.0.16. 계획 [IMPROVEMENT_PLAN_2026-10-30.md](IMPROVEMENT_PLAN_2026-10-30.md) 4장, 단위 [TASKS.md](TASKS.md) 13-10~13-22, 화면 규칙 `DESIGN.md` §20, 팀 점검 보고서(저장소 밖 PDF, 2026-10-30)의 P1 B1·B3·B4·C1·C3, P2 D1~D6.
- 검수 요청 범위: (1) 점수 불변(엔진·golden·`data/runtime` 변경 0, 표시만 바뀜), (2) 면책 정책(순위·확률·추천·매출 표현 없음 — 한 줄 결론·시간대 문장·업종 순위 카드), (3) 지도 배치 전환의 A2 회귀(지도 DOM 유지·맞춤), (4) 백엔드 새 엔드포인트의 검증 순서·오류 계약·캐시, (5) 프런트 계약(`insights` strict 스키마 — 백엔드와 같은 배포 단위), (6) 접근성(행 버튼 aria-expanded, 거미줄 숨은 목록, 탭 이름 변경).
- 지적은 TASKS 13-22 아래 9-R1 방식으로 기록하고 수정 커밋을 잇는다.

## 1. 단위별 코드·테스트
| 단위 | 코드 | 테스트 | 확인 포인트 |
|---|---|---|---|
| 13-10 레이아웃 | `App.tsx`(`layout`·`mapExpandedFor`·`fitSeq`·`panelScrolled`), `App.css` "대시보드 레이아웃" 블록, `MapView.tsx` `fitSeq` | `App.test.tsx`(layoutKey `:dashboard`/`:map`), E2E 5흐름 | 지도 unmount 없음, 대시보드에서 `data-map-obstacle` 제거, SDK 실패 시 덮개 버튼 없음, mobile 은 `isMobile()` 로 map |
| 13-11·13-3 점수 카드 | `ScoreCard.tsx`, `OverallScore.tsx`, `ResultAlerts.tsx` | `ResultAlerts.test.tsx` | 배너 → 숫자 → 결론 → 주의 순서 |
| 13-12 한 줄 결론 | `lib/conclusion.ts`, `content/conclusion.ts` | `lib/conclusion.test.ts`(규칙 4 + 금지 표현) | raw 키(동종점포수·타겟연령_거주인구·최근접역_거리m·3년_생존율) 인용, 엔진 최고_지표·병목_지표 우선 |
| 13-13 거미줄 | `RadarChart.tsx`, `lib/radar.ts` | `RadarChart.test.tsx` | 미산출은 꼭짓점 제외(0 아님), 3개 미만이면 면 없음 |
| 13-14 정렬·펼침 | `PerspectiveScores.tsx`, `lib/perspectiveOrder.ts` | `AnalysisResult.test.tsx`·`ResultQuiet.test.tsx` | 표시 전용 정렬, 아코디언 1개 |
| 13-15 시간대 | backend `main.py` `build_insights`·`AnalyzeInsights`, `lib/timeInsights.ts`, `content/timeInsights.ts`, `TimeInsightsCard.tsx`, `api/schemas.ts` `AnalyzeInsightsSchema` | backend `test_analyze.py`(insights = rt.market 행, 실패 시 null), `lib/timeInsights.test.ts`, `TimeInsightsCard.test.tsx` | 점수 불변 문구, insights 없으면 카드 없음, **이전 프런트 번들은 새 응답을 거부(strict)** |
| 13-16 업종 순위 | backend `POST /rank`(`rank_items`·LRU), `lib/useRank.ts`, `RankCard.tsx`, `scripts/smoke_api.py` `check_rank` | backend `test_rank_stations.py` 16건, `useRank.test.ts`(실패 키 재요청 없음), `RankCard.test.tsx` | 정렬 `service.ranking` 규칙, warm 전 2분+(프런트는 로딩 문구), 캐시 키 좌표 6자리 |
| 13-17 역 제안 | backend `GET /stations`, `lib/stations.ts`, `StationSuggest.tsx`, `AddressSearch.tsx` | `lib/stations.test.ts`, backend 테스트 | `lines=[]`(엔진 구조에 노선명 없음), 선택은 좌표만 |
| 13-18 규제 표시 | `content/regulatedBusinesses.ts`, `ConditionPanel.tsx` 안내 문구 | — | 엔진 access.py 입지규제=True 4개와 같은지 |
| 13-19 용어·데이터 한계 | `lib/evidence.ts`, `lib/gaps.ts`, `content/fieldChecks.ts`, `CoverageMeta.tsx`, `AttentionBand.tsx`(label·extraCount·children), `AnalysisResult.tsx` | 문구 테스트 7파일 | 숫자는 raw 포맷뿐(`evidence.test` 전수) |
| 13-20 D2~D6 | `CompareResult.tsx/.css`(`compare-row__hi`, A/B 글자), `App.css`(foot-split), `App.tsx`(shareNotice), `RadiusTable.css` | `CompareResult.test.tsx`, App 공유 링크 테스트 | D4 는 `analysis.status !== 'error'` 일 때만 숨김(업종 미존재 링크는 안내 유지) |

## 2. 교차 관심사
- 응답 계약: `/analyze` 에 `insights`(선택) 추가 — `AnalyzeResponseSchema` strict + optional. v0.0.16 번들은 strict 라 새 서버 응답을 거부한다 → 백엔드·프런트 같은 이미지로만 배포.
- 캐시: `ResultCache`(분석)와 별개로 `/rank` 는 `lib/useRank` 모듈 캐시(키 좌표·반경) — 데이터·엔진 버전 전환 시 비우지 않는다(같은 세션 안 리비전 전환은 드묾, 응답 헤더 `X-Data-Version` 비교 미구현). `/stations` 1회.
- 접근성: 관점 행 버튼 `aria-expanded`, "상세 근거 ›" 별도 버튼, 거미줄 `<title>` + visually-hidden 목록, 탭 이름 "자세히 보기", 데이터 한계 `details`.
- 인쇄: 새 카드가 결과 패널 안이라 기존 print.css 규칙으로 함께 인쇄된다 — 실제 인쇄 대화상자 미확인(13-21 미착수).

## 3. Claude가 확인하지 못한 것
- 1366×768 첫 화면에 다섯 관점이 모두 보이는지(보고서 체크리스트 4번) — 1400×900 에서는 점수 카드 + 거미줄 + 막대 3~4개까지 보였다.
- 비교 요약 화면에 거미줄 겹침(13-13 B 시리즈 구현은 있으나 CompareResult 에 넣지 않음), 태블릿 D2 버튼 쌓기 실측, D3 점 글자 실측(테스트·CSS 만).
- warm 전 `/rank` 2분+ 대기(운영은 시작 시 warm — 무트래픽 검증에서 warm 뒤에만 확인 가능).
- 실기기·Safari·Firefox·스크린리더.

## 4. 검증 기록
- vitest 전체(`33d0625` 직전 소스): 57파일 948건 통과(App 182·신규 24건). typecheck·lint 통과.
- E2E `npm run e2e`: 1회차 1실패(지도 인증 실패 흐름 — 대시보드 덮개 버튼이 "지도 다시 불러오기"를 가림, 클릭 시간 초과) → `sdk.status !== 'failed'` 조건 추가 → 2회차 5흐름 통과(1.0분).
- backend `pytest backend/tests -q`(v0_3): 178 passed, 1 skipped(학교 규제 — v0.3 skip). `SCORING_ENGINE_VERSION=v0_5_1 … test_rank_stations.py`: 16 passed.
- 전체 check `--jobs 5`(`33d0625`): Python 18단계 PASS, frontend 단계 1건 실패(RankCard 테스트의 role=status 기대 — 테스트만 수정) → `--only frontend` 재실행 950/950 PASS. 상세는 TASKS 13-22.
- 보호 경로 변경 0건(`git diff --stat -- sources scoring_engine/v0_3 data/runtime tests/golden`), `git diff --check` 통과.

## 5. 재현 명령
```
.venv/Scripts/python.exe scripts/check.py --jobs 5
npm --prefix frontend run e2e
.venv/Scripts/python.exe -m pytest backend/tests/test_rank_stations.py backend/tests/test_analyze.py -q
npx --prefix frontend vitest run   # cwd frontend
```
dev 서버: `.claude/launch.json` `backend-v0_5_1-r0`(엔진 v0.5.1, 8000) + `frontend-vite`(5173). 확인 주소: `/?lat=37.50115&lng=126.72030&biz=R10406&r=500`(학교 옆 PC방 — 배너·규제 배지·순위 카드 규제 표시), `/?lat=37.4894&lng=126.7246&biz=R10406&r=500`(부평역 — 순위 노래방 72.3…PC방 18위, 시간대 카드 낮 34%), `/?lat=37.47117&lng=126.62543&biz=I21201&r=500`(신포동 카페 — 주의 한 줄).
