# 자동 E2E smoke 도입 결정안 (TASKS 5-3, 2026-10-28 — **결정: A+B 도입**, C는 미도입·선택, D-035)

배포 때마다 사람이 브라우저로 확인하던 흐름(지도·테마·단일 분석·반경·A/B 비교·업데이트 내역·모바일)을 자동화할지 정한다.
이 문서는 비교와 추천까지만 한다. 의존성 추가·코드 작성은 결정 뒤에 한다(TASKS 5-3 원칙).

## 1. 지금 무엇을 어떻게 확인하나

| 층 | 지금 | 자동화 정도 |
|---|---|---|
| 엔진·데이터 | pytest + golden (전체 check) | 자동 |
| API 계약 | backend pytest(TestClient) + 배포 때 `remote_validate.py`(48건 기대값 대조, `.gstack/` — 저장소 밖) | 반자동, 저장소에 없음 |
| 화면 로직 | vitest + jsdom, NAVER 지도는 `MapView` 통째 mock | 자동, 실제 CSS·빌드·지도 없음 |
| 화면 실제 동작 | 배포 때 Claude/Codex 가 브라우저에서 손으로(매번 10~20분) | 수동 |

최근 결함 3건이 모두 **마지막 층**에서만 보였다: ① 지도 인증 실패 뒤 테마 전환 빈 화면(실제 SDK), ② 운영 번들에서 `:has()` 선택자 누락(실제 build CSS), ③ 지도 재시도 때 SDK script 누적(실제 SDK). jsdom 단위 테스트로는 원리상 잡히지 않는다.

## 2. 선택지

| | A. API smoke 스크립트를 저장소로 | B. Playwright UI smoke (SDK 대체) | C. Playwright + 실제 NAVER 지도 | D. 지금처럼 수동 + 체크리스트 |
|---|---|---|---|---|
| 내용 | `remote_validate.py`를 `scripts/smoke_api.py`로 정리(warm·48건·반경별 점포·학교구역·422·정적 파일) | production build + 로컬 backend(v0_5_1)를 띄우고, `page.route`로 `oapi.map.naver.com`을 **가짜 SDK**로 바꿔 흐름 검사. 인증 실패 SDK 변형으로 실패 경로도 | B와 같은 테스트를 NAVER 등록 주소(localhost:5173·`preview` 태그 주소)에 실제 SDK로 | 확인 목록을 문서로 고정 |
| 잡는 것 | API 회귀, 배포 설정(엔진·데이터 버전) | 실제 CSS·build(②), 실패 경로 격리(①의 앱 쪽), 키보드·모바일 레이아웃, 흐름 회귀 | 실제 지도 표시·테마 스타일·GL, SDK 동작(①③) | 사람이 보는 모든 것 |
| 못 잡는 것 | 화면 | 실제 SDK 내부 동작(③은 SDK가 붙이는 script를 흉내 내야 함) | 네트워크·NAVER 상태에 따라 흔들림 | 반복 비용, 사람마다 누락 |
| 새 의존성 | 없음(표준 라이브러리) | `@playwright/test`(devDependency) + Chromium(약 150MB, 이 PC에는 gstack용으로 이미 있음) | B와 같음 + NAVER 등록 주소 | 없음 |
| 시간(예상) | 1~2분(대상 서버가 warm된 뒤) | 2~4분(backend 시작·첫 반경 계산 포함, 8~10개 흐름) | 2~4분 + 네트워크 | 10~20분(사람) |
| check 포함 | 아니오(배포 단계에서 대상 주소에 실행) | 기본 전체 check에는 **넣지 않고** `--only e2e` 단계로(배포 후보 F 때 함께 실행) | 아니오(배포 단계, 사람이 켬) | — |
| 공개 정보 | 서비스 주소를 인자로 받음(저장소에 쓰지 않음) | 지도 Client ID 불필요(가짜 SDK) | Client ID는 `.env`·build arg 그대로(커밋 안 함) | — |

## 3. 추천

**A + B를 도입하고, C는 B 테스트를 실제 SDK 모드로도 돌릴 수 있게만 열어 둔다.**

1. A(바로): 매 배포에 쓰던 API 검증을 저장소의 정식 스크립트로 옮긴다 — 의존성 없음, 위험 없음.
2. B(결정 후): 흐름 8~10개 — 첫 화면, 좌표 분석(부평역 PC방 62.3), 반경 300/1km, A/B 비교, 테마 연속 전환, 업데이트 내역 키보드, 모바일 375 결과 시트(참고 주소 숨김), 지도 인증 실패(가짜 SDK)에서 테마·재시도·분석 유지. `scripts/check.py --only e2e`로 실행하고 배포 후보 확정(F) 때 전체 check와 함께 돌린다. 기본 전체 check에 넣을지는 1~2회 운영 뒤 소요 시간을 보고 다시 정한다.
3. C(선택): 같은 테스트를 `E2E_BASE_URL=<preview 주소> E2E_REAL_MAP=1`로 돌려 실제 지도 확인을 보조한다 — 사람의 마지막 확인을 대체하지 않는다.

## 4. 사용자가 정할 것

- B의 devDependency(`@playwright/test`) 추가와 Chromium 설치(다른 PC·Codex 환경에서도 `npx playwright install chromium` 필요)를 허용할지
- B를 기본 전체 check에 넣을지(시간 +2~4분) / 배포 후보 때만 돌릴지(추천)
- C를 배포 절차에 넣을지(추천: 선택 단계)

결정되면 `docs/DECISIONS.md`에 D-0xx로 기록하고 TASKS 5-3을 닫는다.
