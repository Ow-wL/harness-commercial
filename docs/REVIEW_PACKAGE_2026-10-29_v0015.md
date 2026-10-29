# Codex 검수 자료 — 0차 "정확한 의미"(v0.0.14, 운영 중) + 1차 "활용"(v0.0.15 후보, 운영 미배포) (2026-10-29)

> **결과(2026-10-29)**: Codex 1차 검수 R1~R4 → 수정(`b5b8746`) → 재검수에서 R5 추가 → 수정(`b7979c4`) → **3차 재검수 통과, 추가 지적 없음**(`docs/CODEX_REVIEW_2026-10-29_v0015.md`). 배포 후보 = 코드 `b7979c4`(이후 문서 커밋만). 전체 check 5회차·E2E 통과 기록(4-3)을 배포 후보 검증으로 재사용한다. 남은 미확인: onboarding 간헐 실패 원인, 실제 NAVER 호출(키), 사람 검증, 실기기·다른 브라우저.

> 검수자(Codex)가 **직접 확인한 사실**과 **판단**을 구분해 적어 달라. 이 문서의 모든 수치·결과는 Claude가 2026-10-29 로컬(Windows 11, Python 3.10 venv, Node)에서 실행한 것이며, 아래 "Claude가 확인하지 못한 것"은 그대로 열려 있다. 결함을 찾으면 재현 테스트를 `.gstack/review-v0015/`(git 제외)에 두고 지적 사항을 `docs/TASKS.md` 12-28 에 적는다(지난 9-R1·9-R2·10-8·11-9 방식). 운영 전환은 검수 결과와 사용자 승인 뒤 별도 단위다.

## 0. 검수 범위와 기준 소스

| 구분 | 상태 | 커밋 범위 | 비고 |
|---|---|---|---|
| 0차 "정확한 의미" (앱 v0.0.14) | **운영 중**(2026-10-29 09:59 KST 전환, `docs/DEPLOYMENT_2026-10-29_v0014_preview.md`) | 코드 `2e0c4d0..c0ebd5b`(17 커밋), 배포 기록 `1d79da6`·`d534c75`·`2282f8d` | 계획 0-1~0-10 = `docs/TASKS.md` 12-16~12-22·12-1·2·4·5·6. 라벨·요약 노출·주소 안내·gzip·favicon. 엔진·golden·`data/runtime` 불변 |
| 1차 "활용" (앱 v0.0.15 후보) | **저장소 반영, 운영 미배포** | `2282f8d..HEAD`(`584b433`·`b71cf07`·`2a22e38`·`8ccef55`·`80d1b1e`·`7d8655b`·`b5abd96`·`e4ad1ff` + 이 문서를 담은 커밋) | 계획 1-1~1-6 = 12-3·12-26·12-27·12-25·12-15·12-14, 결정 D-036. 아래 2장 |
| 검수 기준 HEAD | 이 문서를 담은 커밋(`git log -1`) | — | 작업 트리에 git 제외 `.claude/`만. 보호 경로(`sources/`, `scoring_engine/v0_3/`, `data/runtime/`, `tests/golden/`) 변경 **0건**(`git diff --stat 2e0c4d0..HEAD -- <보호 경로>` 비어 있음) |

읽는 순서(추천): `docs/IMPROVEMENT_PLAN_2026-10-29.md`(0·1차 범위·완료 기준) → `docs/TASKS.md` 12장(단위별 구현·검증 기록) → `docs/DECISIONS.md` D-036(1차 정책) → `DESIGN.md` §8.4·§19.10(화면 규칙) → 이 문서 2~5장 → 코드.

0차는 운영 전환 전 Codex 기준(계획 §2 완료 기준)을 사람 확인 없이 넘긴 부분이 있다: "카페·PC방·네일숍에서 무슨 자료로 계산했고 무엇이 빠졌는지를 화면만 보고 말할 수 있는가"의 **사람 확인은 미실시**(사용자 몫으로 남김, 12-22). 이번 검수에서 그 기준으로 운영 화면(등록 주소)을 봐 주면 좋겠다.

## 1. 0차 요약 (운영 중, 검수는 "표기가 정확한가")

| 단위 | 커밋 | 바뀐 것 | 검증(Claude) |
|---|---|---|---|
| 12-16 업종평균 라벨 | `b9031c9` | 안정성 근거 줄에서 "인천 업종평균 N%" 제거, 상세 근거 계산 기준에 고정 기준선 55.2% 출처·한계 | vitest 98건 |
| 12-17 충족률 분리 | `acb1f71` | "데이터 충족 100%" → "관점 5/5 산출 · 세부지표 없음 N: …" | vitest 70건 |
| 12-18 자료 등급·단위 칩 | `0aec5ff`·`44e7bf2` | "신뢰도" → "자료 등급", 관점마다 자료 단위 칩(구 단위/반경 추정/지점 좌표) 상시 | vitest 173건 |
| 12-19 데이터 묶음 라벨 | `c1ba2bd` | "데이터 2026-06 기준" → "데이터 묶음 2026-06" + 출처 표 설명 | vitest 64건 + E2E 문구 |
| 12-20 요약 기본 노출(안 B) | `dd6a094` | 근거 줄·단위 칩 기본 표시, 종합 아래 "확인 필요" 한 줄(`lib/gaps.ts` 규칙 4개) | vitest 123건 |
| 12-21·12-6 주소 검색 안내 | `90a1540` | 지원 범위 안내 + 예시 주소 3개, 실패 문구 조사 회피 | vitest 17건 |
| 12-4 면책 주석 | `3145c89` | 엔진 면책 원문 아래 "상대 순위 = 백분위 계산 방식" 주석(원문 불변) | vitest 41건 |
| 12-1 gzip | `2b85d69` | `GZipMiddleware(minimum_size=1024)`, smoke 헤더 검사 | pytest 22건, 운영 실측 534KB→159KB |
| 12-5 favicon·meta·robots | `f35e782` | `public/favicon.svg`·`robots.txt`, OG 메타 | vitest 15건, build |
| 12-2 README | `994fc1f` | 운영 상태 현행화 | diff |
| 12-22 마무리 | `cce985c`·`c0ebd5b` | DESIGN §8.4, 패치노트 v0.0.14 | 전체 check `--jobs 5` 19단계(2회차, 1회차는 패치노트 형식 실패), E2E 4흐름, 운영 smoke 48건 |

0차에서 Claude가 확인하지 못한 것: 실기기·Safari·Firefox·스크린리더, 네일숍 등 안정성 미산출 업종 화면의 사람 확인.

## 2. 1차 단위별 상세 (운영 미배포)

공통 원칙(D-036): 점수 엔진·`/analyze` 계약 불변, 점수를 저장·공유하지 않는다(조건만), 로컬 저장은 익명·이 브라우저만, 문구에 순위·확률·추천·단정 없음.

### 2-1. 12-3 조건 공유 링크 — `584b433`
- 코드: `frontend/src/lib/shareLink.ts`(쿼리 `lat·lng·biz·r·blat·blng·data·engine` ↔ 조건, 좌표 범위·업종 코드 형식 `^[A-Z]\d{5}$`·반경 양의 정수 검증, 어긋나면 **링크 전체 무시**, B·버전은 그 값만 제외), `App.tsx`(적용은 `/businesses`·`/health` 두 fetch 콜백이 `applyShareRef.current()`를 불러 둘 다 온 뒤 1회 — effect 안 setState 를 피하려고 콜백 경로를 썼다; 업종 미존재 → 위치만; 반경은 서버 광고 안에 있을 때만, 아니면 기본 반경 + 안내; 링크 시점 데이터 묶음·엔진이 지금 서버와 다르면 안내; B 좌표는 `startA(..., { onSuccess })`로 A 성공 뒤 같은 업종·반경으로 비교), 결과가 보이는 동안 주소창 쿼리를 결과 조건으로 유지(`history.replaceState`, 결과 없으면 제거, 링크 적용 전에는 건드리지 않음), `components/ResultTools.tsx` "링크 복사"(클립보드 거부 시 읽기 전용 입력란).
- 테스트: `lib/shareLink.test.ts` 14, `App.test.tsx` "조건 공유 링크" 7. 테스트 setup 이 각 테스트 뒤 주소를 `/`로 되돌린다(`src/test/setup.ts`).
- 봐 달라는 점: ① 두 콜백이 같은 틱에 끝나도 `shareLinkRef` 가 null 이 돼 두 번 적용되지 않는지(`applyShareRef` 본문의 첫 줄). ② `useState(() => parseShareQuery(...))`와 콜백의 `parseShareQuery` 가 두 번 파싱하는 구조(의도: 렌더 중 ref 읽기 금지 lint 대응). ③ `replaceState` 가 뒤로 가기 이력을 만들지 않는 대신, 결과 화면에서 새로고침하면 링크로 다시 분석된다(의도된 동작 — 저장된 점수 없음).

### 2-2. 12-26 반경별 비교 표 — `b71cf07`
- 코드: `lib/radiusTable.ts`(광고 반경 오름차순, 지금 결과 + `ResultCache.peek`(LRU 순서 불변), 종합·관점 5·같은 업종 점포 수·`gapLines` 수, 종합 범위는 산출 점수 2개 이상일 때), `components/RadiusTable.tsx`(요약 탭 다섯 관점 아래, 단일 결과·반경 광고 서버에서만, 빈 반경 "N 분석하기" = 기존 `changeRadius`), `AnalysisResult` `radiusTable` 슬롯. `App.tsx`의 결과 캐시 객체를 `useState(() => new ResultCache())`로 1회 만들고 `resultCache = useRef(cacheStore)`로 별칭 — 렌더에서는 `cacheStore.peek`만 읽는다.
- 테스트: `lib/radiusTable.test.ts` 3, `components/RadiusTable.test.tsx` 2, `App.test.tsx` "반경별 비교 표" 2(500 → 1km 분석하기 → 두 행, 500 복귀 캐시 적중에도 1km 행 유지).
- 봐 달라는 점: ① 캐시 내용이 바뀌는 모든 경로(`putAnalyze`·`clear`·`dropRadiusOtherThan`)가 분석 상태 변경과 함께 일어나 표가 늦게 갱신되는 경우가 없는지(반경 복구 4.6 경로 포함). ② "변화 범위" 문구가 신뢰구간으로 읽히지 않는지(계획 1-5 주의).

### 2-3. 12-27 현장 확인 카드 — `2a22e38`
- 코드: `content/fieldChecks.ts` 규칙 8개(우선순위: 학교구역 경고 → 같은 업종 N곳 → 동종 0곳 → 임대료 미반영 → 유입 구 단위 → 반경 인구 면적 배분(v0.5) → 폐업률_높음 flag → 접근 동선(항상)), 맞는 것 중 앞 3장, `because`는 엔진 값 인용만. `components/FieldChecks.tsx` 4번째 탭 "현장 확인", `lib/fieldNotes.ts`(localStorage `fieldNotes.v1`, 키 = `cacheKey(요청)`, 최대 30키 LRU, 비면 삭제, 저장 실패 시 메모리 사본). 비교 A/B 전체 결과(`CompareDetail`)도 그 위치 키.
- 테스트: `content/fieldChecks.test.ts` 7(순위·확률·추천·비싸다·보장 표현 금지 포함), `lib/fieldNotes.test.ts` 5, `components/FieldChecks.test.tsx` 2, `App.test.tsx` 1(새 마운트 뒤 같은 조건에 체크·메모 유지).
- 봐 달라는 점: ① 카드 문구가 "지표가 확인하지 않은 사실을 단정"하지 않는지(특히 `school-zone`·`closure`). ② `App.tsx` `fieldNotesFor`가 **렌더마다 localStorage 를 읽어 JSON 파싱**한다(≤30키, 결과 화면에서만) — 성능·일관성 관점에서 state 캐시가 필요한지. ③ 규칙 우선순위가 사용자에게 가장 중요한 순서인지(학교구역이 첫 카드).

### 2-4. 12-25 후보 보관함 — `8ccef55`
- 코드: `lib/savedSites.ts`(localStorage `savedSites.v1`, 최대 3, 항목 = 조건 + 저장 당시 스냅샷(종합·관점·점포 수·확인 필요) + 데이터 묶음·엔진 + 저장 시각 + 메모, 같은 조건 키는 스냅샷·시각만 갱신(id·메모 유지), 가득 차면 `full`, 저장 불가 `storage`, 깨진 항목 무시·3개까지만 읽음), `components/SavedSites.tsx`(조건 바 버튼 "보관함 N곳" + 배지, 모달은 업데이트 내역 껍데기 재사용·Escape·포커스 복귀, 항목에 "저장 당시 결과" 칩·버전·저장일·현장 확인 N/3·메모·"같은 조건으로 다시 분석"·삭제), `ResultTools` "보관/보관됨 · 갱신" + 안내, `App.tsx` `reanalyzeSaved`(= `cancelAnalysis` → 조건 복원 → `startA`, 반경 미지원 안내, `share-notice`에 "저장 당시 결과가 아니라 지금 서버의 결과").
- 테스트: `lib/savedSites.test.ts` 4, `components/SavedSites.test.tsx` 2, `App.test.tsx` "후보 보관함" 2(저장 → 다시 분석 캐시 적중 → 삭제, 가득 참).
- 봐 달라는 점: ① 스냅샷이 "지금 결과"로 오해될 여지(모달 머리 문장·칩으로 구분했다). ② 모달 안 `readFieldNotes` 호출이 항목마다 렌더 시 파싱. ③ `reanalyzeSaved`가 비교 중에 불리면 `cancelAnalysis`로 비교를 끝낸다(의도).

### 2-5. 12-15 인쇄 — `80d1b1e`
- 코드: `styles/print.css`(`@media print` 만: 지도·조건 바·시트·패널 행동·결과 활용 줄·탭 조작·코치마크 숨김, 패널 정적 배치, `.tabpanel[hidden]{display:block}`로 네 탭 모두, 설명 함께 보기 내용 표시, `details:not([open]) > *:not(summary){display:block}`로 접힌 위치 정보·주의 띠 펼침, 카드·섹션·표 `break-inside: avoid`), `main.tsx` import, `App.tsx` `printResult = () => window.print()`·인쇄 머리말 `.print-only`(화면에서는 `display:none`).
- 테스트: `src/print.test.ts` 3(CSS 계약), `App.test.tsx` 1(`window.print` 호출·상태 유지).
- 봐 달라는 점: ① 실제 인쇄 미리보기(Chromium·Edge)에서 한 페이지에 요약이 들어오는지 — Claude는 jsdom 에서 CSS 규칙만 고정했다(실제 미리보기는 5장 참고). ② `details:not([open])` 규칙이 브라우저별로 적용되는지.

### 2-6. 12-14 장소 이름 검색 — `7d8655b`
- backend: `backend/app/places.py`(`PlacesClient.from_env`: `NAVER_SEARCH_CLIENT_ID`·`NAVER_SEARCH_CLIENT_SECRET`, 없으면 `enabled=False`; `search`: `https://openapi.naver.com/v1/search/local.json?query=&display=5`, 5초 timeout, 상태≠200·형식 불일치·예외 → `PlacesUpstreamError`; `parse_places`: 제목 `<b>` 태그·HTML 엔티티 제거, `mapx/mapy`(WGS84×1e7 정수 문자열) → 경도·위도, 좌표 없는 항목 제외; 로그는 상태·건수·소요 시간만), `main.py` `POST /places {q}`(본문 — GET 쿼리였다면 uvicorn·Cloud Run 요청 로그 경로에 검색어가 남으므로 POST, GET 은 405; 1~60자 아니면 422 `invalid_query`, 키 없음 503 `places_unavailable`, 상류 502 `places_upstream`), `/health places.enabled`, `mount_frontend` API 경로, `errors.py` `ApiError.status`(기본 422) — **D-014 의 "422/500" 계약에 503·502 를 더했다**. `scripts/smoke_api.py` 정적 검사 GET `/places` 405.
- frontend: `api/schemas.ts`(`HealthSchema.places`, `PlacesResponseSchema` strict, 오류 코드 3개), `api/client.ts` `searchPlaces`, `components/PlaceSearch.tsx`(주소 검색과 같은 모양, 예시 3개, 제출 때만 1회, 늦은 응답 번호로 폐기 + AbortController 취소, 결과 선택 → `onSelect(좌표)`), `LocationMethodSwitch` "장소 이름"(광고 때만), `ConditionPanel`·mobile 시트·`ComparePanel` B 카드("B 장소 이름으로 찾기" 펼침), `AddressSearch` 안내 문구 분기, `lib/errorView.ts` 새 코드 매핑, `vite.config.ts` proxy.
- 테스트: `backend/tests/test_places.py` 14(가짜 fetch; 키 없음 503·health false, from_env, 프록시 호출 헤더·검색어·display, 로그에 검색어·키 없음, 422×3, q 없음 invalid_request, 상류 429·HTML·예외 → 502, SPA fallback 아님), `components/PlaceSearch.test.tsx` 3, `App.test.tsx` "장소 이름으로 찾기" 3. E2E 5번째 흐름은 키 없는 backend 에서 `/health places.enabled=false`·`/places` 503·입력 방법 없음을 본다.
- **Claude가 확인하지 못한 것**: 실제 NAVER 검색 API 호출(키 없음). `mapx/mapy` 가 WGS84×1e7 이라는 가정은 NAVER 개발자센터 문서(2023-05 이후 형식)에 따른 것으로 실제 응답으로 대조하지 않았다 → 키 발급 뒤 첫 호출에서 좌표가 인천 안에 찍히는지 반드시 확인. 일일 한도·약관·비용은 사용자가 developers.naver.com 에서.
- 봐 달라는 점: ① 검색어가 어떤 로그에도 남지 않는지 — 처음 구현(`7d8655b`)은 `GET /places?q=` 였고 이 자료를 쓰다가 uvicorn·Cloud Run 요청 로그의 경로에 검색어가 남는 점을 발견해 2-8 커밋에서 POST 본문으로 바꿨다(`backend.places` 로거는 상태·건수·소요 시간만). 오류 응답·예외 메시지에도 검색어가 없는지 봐 달라. ② 오류 계약 확장(503/502)이 프런트 `ErrorResponseSchema`·D-014 문서와 맞는지. ③ 인천 밖 결과를 막지 않는 정책(주소 검색과 같음).

### 2-8. `/places` POST 전환 — `e4ad1ff`
- 2-6 ① 의 요청 로그 노출을 막으려고 `GET /places?q=` → `POST /places {"q"}`(pydantic `StrictStr`, GET 405). 프런트 `searchPlaces` POST, 테스트·E2E·smoke 정적 검사(`/places` 405)·문서 갱신. backend 36건(places·smoke·frontend)·프런트 PlaceSearch 3·App 3·E2E 5흐름 재통과.

### 2-9. 공유 안내 정리 — 검수 자료 커밋
- 브라우저 확인(5장)에서 공유 링크로 연 뒤 조건 바의 반경을 바꿔도 "공유 링크의 조건으로 다시 분석했습니다" 안내가 남는 것을 보고, `changeRadius` 에서 `shareNotice` 를 지우도록 했다(안내는 링크·보관함 조건으로 낸 그 결과까지만). App 테스트 1건 보강(반경 변경 뒤 안내 없음), `App.test.tsx` 전체 182건 + shareLink 14건 재통과. 이 변경은 전체 check(4-1) **뒤**의 코드 변경이다 — 배포 후보 확정 때 전체 check 를 다시 1회 돌린다.

### 2-10. Codex 1차 검수 지적 수정 (R1~R4, `docs/CODEX_REVIEW_2026-10-29_v0015.md`) — 재검수 요청
| 지적 | 수정 | 회귀 테스트 | 재검증 |
|---|---|---|---|
| R1 [P1] 인쇄 잘림 | `main.tsx` 에서 `print.css` 를 App 뒤에 import, 앱 껍데기·패널·스크롤 영역 배치/높이/overflow 를 `!important` 로 문서 흐름·자동 높이(mobile `.app[data-screen] .panel`·`[data-folded]` 포함), 다크 토큰을 밝은 값으로 되돌림. 정책: 모든 탭을 여러 페이지로, 세부지표 아코디언은 인쇄 대상 아님 | `print.test.ts` 6건(로딩 순서·!important·토큰) | Playwright chromium + production `dist-e2e`, print 미디어, fixture API: 다크 1280·라이트 1280·다크 375 모두 패널 static 전체 폭, 문서 높이 4,882/4,882/6,071px, PDF 7페이지, 마지막 현장 카드·메모·출처·면책 포함, h1 #17202b. 결과 JSON·PDF·PNG 는 세션 scratchpad `print/`(Codex 재현 스크립트와 같은 방식 — 재검수 때 `.gstack/review-v0015/print-repro.mjs` 를 다시 돌리면 된다) |
| R2 [P2] 보관함 재분석이 캐시 반환 | `startA({ fresh: true })` — 캐시를 읽지 않고 서버에 요청(응답은 캐시 저장), `reanalyzeSaved` 가 사용 | App 테스트: 두 번째 응답 63.1 → `/analyze` 2회·새 점수 표시 | — |
| R3 [P2] 임대료 "조사 상권 밖" 단정 | "이 위치에는 임대료 조사 상권이 연결되지 않아 임대료를 점수에 반영하지 않았습니다"(D-015) | fieldChecks 금지 표현에 상권 밖·대상 밖, FieldChecks 문구 단언 | — |
| R4 [P2] 손상 보관함 항목 | `isSite` 전체 스키마 검증(좌표 범위·반경·점수 null\|유한·관점 원소·점포 수·gaps·versions·memo) | savedSites 손상 13종 거절 + null 허용, SavedSites 손상 섞인 저장소 렌더 | — |

수정 뒤 검증: 단위 테스트(위) + typecheck·lint, 최종 소스 전체 check `--jobs 5` 와 E2E `--only e2e` 재실행(결과는 아래 4-2). 보호 경로 변경 0.

### 2-11. Codex 재검수 지적 R5 수정 — 재검수 요청
| 지적 | 수정 | 회귀 테스트 | 재검증 |
|---|---|---|---|
| R5 [P2] 긴 현장 메모가 인쇄에서 앞 두 줄만 남음(rows=2 textarea) | 메모가 있을 때만 인쇄용 `.field-check__memo-print`(값 그대로, `aria-hidden`)를 두고 화면에서는 숨김, `print.css` 가 textarea 를 숨기고 전문을 `pre-wrap`·`overflow-wrap: anywhere` 로 표시. 빈 메모는 placeholder 를 찍지 않는다 | FieldChecks(메모 있는 카드에만 전문 요소)·print.test(규칙) | Codex 의 `.gstack/review-v0015/print-recheck.mjs`(Edge, 14줄 메모) + `check-print-memos.py` 를 그대로 실행: 다크 1280·라이트 1280·다크 375 PDF 모두 시작·끝 표식 포함(6페이지), 페이지 이미지에서 메모 박스 전문 확인 |

### 4-3. R5 수정 뒤 전체 check·E2E (`b7979c4`, 2026-10-29)
- E2E `--only e2e`: 5흐름 통과(54.4초).
- 전체 check 5회차(단독, `.venv` python, `--jobs 5`): **19단계 통과, SKIP 0, 재실행 없음**, 407.9초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 157 · frontend 49파일 907 · patch-notes). 로그 `full-check-v0015-run5.log`. 이 커밋이 재검수 기준이다.
- 보호 경로 변경 0.

### 4-2. 수정 뒤 전체 check·E2E (`b5b8746`, 2026-10-29)
- E2E `--only e2e`: 5흐름 통과(80.1초 — 아래 3회차 전체 check 와 동시에 돌려 첫 흐름이 1분).
- 전체 check 3회차(`.venv` python, `--jobs 5`, E2E 와 동시 실행): 18단계 통과, **frontend 1건 실패** — `App.test.tsx` "첫 방문 안내 … ④결과 안내 → 확인하면 끝나고 저장된다"에서 `localStorage onboarding` 이 `done` 이 아님(905/906). 이전 기록(TASKS 10-5·9-R2)과 같은 **간헐 실패**로, 단독 실행 3회(8건씩) 모두 통과. 원인은 미확인 그대로다(부하 중 타이밍 의심). 로그 `full-check-v0015-run3.log`.
- 전체 check 4회차(단독 실행): **19단계 통과, SKIP 0**, 417.9초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 157 · frontend 49파일 906 · patch-notes). 로그 `full-check-v0015-run4.log`. 이 커밋이 재검수 기준이다.
- 보호 경로 변경 0(`git diff --stat 2e0c4d0..HEAD -- sources scoring_engine/v0_3 data/runtime tests/golden` 비어 있음).

### 2-7. 공통·마무리 — `b5abd96`
- E2E `frontend/e2e/smoke.spec.ts` 5번째 흐름(공유 링크로 열기 → 결과·URL → 반경 표 → 현장 확인 탭·확인함 → 보관 → 보관함 모달 → 장소 이름 없음 → 조건 바꾸기로 쿼리 제거). README·CLAUDE·계획·DESIGN §19.10·패치노트 `work` 4줄.
- 패치노트 v0.0.15 `changes` 3줄(사용자 요약) — 장소 검색 줄 "서버에 검색 키가 설정된 경우"가 운영 키 없이 배포될 때 사용자에게 적절한 표현인지 봐 달라.

## 3. 교차 관심사

- **개인정보·보안**: 새로 서버로 가는 값은 `/places?q=`(장소 이름)뿐. 공유 링크·보관함·현장 기록은 브라우저 localStorage(익명, 좌표 원문 포함). 키는 환경변수/Secret, 프런트 번들·패치노트·문서에 식별정보 없음(`git grep` 으로 `openapi.naver.com` 외 URL·키 없음 확인 요청).
- **접근성**: 새 모달(보관함)은 업데이트 내역과 같은 포커스 가두기·Escape·복귀, 표는 `caption`·`scope`, 카드 체크·메모 라벨, 결과 활용 줄 `role=group`, 안내 `role=status`. 스크린리더 실기기 확인은 없음.
- **성능**: 렌더 중 localStorage 읽기(2-3·2-4), `radiusRows` 매 렌더(peek 3회). 번들 크기 변화는 5장 build 로그 참고.
- **엔진·데이터**: 변경 없음. `scoring_engine/`·`data/runtime/`·golden 0건.
- **발견한 회귀 1건(수정됨)**: 12-3 에서 넣은 테스트 setup 의 `window.history.replaceState` 가 `@vitest-environment node` 파일(`api/schemas.test.ts`)에서 `window is not defined` 로 전체 프런트 묶음을 깨뜨렸다 — 단위별 선택 실행에서는 보이지 않았고 전체 묶음 실행에서 잡혀 `7d8655b` 에서 `typeof window` 가드로 고쳤다. 단위 커밋 `584b433`~`8ccef55` 상태의 전체 프런트 묶음은 실패했을 것이다(커밋 기록 그대로 둠).

## 4. 검증 기록 (Claude, 2026-10-29)

| 검사 | 소스 | 결과 |
|---|---|---|
| 단위별 vitest(위 2장) + typecheck·lint | 각 커밋 | 통과 |
| 프런트 전체 `npx vitest run` | `7d8655b` 작업 중(장소 검색 포함) | 49파일 901건 통과(52.7초) |
| backend `pytest backend/tests` | `7d8655b` | 157건 통과 |
| E2E `scripts/check.py --only e2e` | `b5abd96` | 5흐름 통과(50.6초, 첫 1km 분석 포함) |
| 전체 check `scripts/check.py --jobs 5` | `b5abd96` | (아래 4-1) |
| production build·브라우저 | `b5abd96` | (아래 5장) |

### 4-1. 전체 check (`e4ad1ff`, 2026-10-29)
- 1회차: 시스템 `python`으로 `scripts/check.py --jobs 5` 를 띄워 pytest 5단계가 `No module named pytest` 로 즉시 실패(exit 1, 0.1s) — **코드 문제가 아니라 인터프리터 실수**(나머지 14단계는 통과). 로그 `full-check-v0015-run1.log`(세션 scratchpad).
- 2회차: `.venv/Scripts/python.exe scripts/check.py --jobs 5` → **19단계 통과, SKIP 0, 재실행 없음**, 365.8초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 157 · frontend 49파일 901 · patch-notes). 로그 `full-check-v0015-run2.log`.
- E2E `--only e2e`: `b5abd96`·`e4ad1ff` 각 1회 5흐름 통과(50.6·50.9초).
- 2-9 의 작은 코드 변경(App `changeRadius` 안내 정리)은 이 뒤에 들어갔다 — 배포 후보 확정 시 전체 check 재실행.

## 5. production build·브라우저 확인 (`e4ad1ff`, 2026-10-29)
- `npm --prefix frontend run build`: 주 번들 566.8KB(gzip 171.7KB) — 0차 운영본 533.6KB(gzip 159.2KB)에서 약 33KB(gzip 12KB) 증가. CSS 82.3KB(gzip 14.3KB). 500KB 경고는 기존과 같다.
- 로컬 production 구조(backend 엔진 v0.5.1 + `FRONTEND_DIST=frontend/dist`, 127.0.0.1:8000, 앱 내 브라우저 800×600·375×812). 지도 인증은 등록 주소가 아니라 실패(401, D-018 — 콘솔의 `[map] 지도 세대 정리 중 NAVER SDK 오류` 는 D-030 의 의도된 기록) — 패널 기능만 본다.
- **확인한 것**: 공유 링크(`?lat&lng&biz=R10406&r=500&data=2026-05&engine=mvp-0.5`)로 열기 → 업종·위치 복원, 500m 62.3, 안내 "공유 링크의 조건으로 다시 분석했습니다 — … 링크를 만들 때는 데이터 묶음 2026-05 · 엔진 mvp-0.5였고 지금은 데이터 묶음 2026-06 · 엔진 mvp-0.5.1입니다", 주소창이 지금 결과 조건(`r=500&data=2026-06&engine=mvp-0.5.1`)으로 바뀜 · 결과 활용 줄 [링크 복사][인쇄][보관] · 반경별 비교 표(500m 지금 행, 300m·1km "분석하기") → "1km 분석하기" → 1km 64.8·점포 17, 두 행 채움, 범위 문구 "분석한 반경 2개의 종합 점수 범위 62.3~64.8 — … 오차범위나 신뢰구간이 아닙니다", 주소창 `r=1000` · 현장 확인 탭(3): 같은 업종(반경 1km 17곳·점포당 잠재수요 4,755명)·임대 조건·유동 관찰 카드, 확인함 → `fieldNotes.v1` 저장 · 보관 → "보관함에 저장했습니다(1/3)", 버튼 "보관됨 · 갱신", 조건 바 배지 1, `savedSites.v1` 스냅샷(64.8, 2026-06, mvp-0.5.1) · 보관함 모달: 머리 문장, "저장 당시 결과 64.8", 저장일·데이터 묶음·엔진, 관점 5·같은 업종 17곳, 확인 필요 4개, "현장 확인 1/3 확인함", 메모·다시 분석·삭제, Escape 로 닫히고 포커스가 버튼으로 복귀 · 모바일 375: 결과 활용 줄·안내·표·탭 배치, 가로 스크롤 없음(scrollWidth 375), 보관함 모달 전체 폭.
- **확인하지 못한 것**: 실제 인쇄 미리보기(인쇄 대화상자는 열지 않음), 장소 이름 검색 실제 호출(키 없음 → 입력 방법이 없는 상태만), 지도 위 동작(인증 실패 환경), 실기기·Safari·Firefox·스크린리더.

## 6. Claude가 확인하지 못한 것 (요약)
1. 실제 NAVER 검색 API 호출·좌표 형식(키 없음).
2. 실제 인쇄 미리보기(한 페이지 배치, `details` 펼침).
3. 실기기·Safari·Firefox·스크린리더.
4. 계획 1차 완료 기준의 사람 검증(후보 2곳 비교 → 근거 2개·미확인 2개 기록 → 다시 열기/전달).
5. 운영 Cloud Run 에서의 동작(이미지 빌드·무트래픽 리비전은 검수 뒤 배포 단위에서).
6. (해소) 요청 로그의 검색어 노출은 POST 본문으로 바꿔 막았다 — Cloud Run 실제 요청 로그에서의 확인은 배포 단위에서.

## 7. 재현 명령
```bash
python -m pytest backend/tests -q                      # backend 157
cd frontend && npx vitest run                          # 프런트 901
cd frontend && npm run typecheck && npm run lint
python scripts/check.py --only e2e                     # E2E 5흐름(약 1분, 첫 Chromium 설치 필요)
python scripts/check.py --jobs 5                       # 전체 check(약 11분)
python scripts/patch_notes.py check
git diff --stat 2e0c4d0..b5abd96 -- sources scoring_engine/v0_3 data/runtime tests/golden   # 보호 경로 0건
```
로컬 화면: `SCORING_ENGINE_VERSION=v0_5_1 FRONTEND_DIST=frontend/dist uvicorn backend.app.main:app --port 8000`(먼저 `npm --prefix frontend run build`; 지도 인증은 등록 주소가 아니라 실패하지만 패널은 동작). 장소 검색은 `.env`에 `NAVER_SEARCH_CLIENT_ID/SECRET`을 넣고 서버를 띄우면 `/health places.enabled=true`.
