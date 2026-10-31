# 배포 후보 무트래픽 검증 — 앱 v0.2.0 + 엔진 v0.5.1 (2026-10-31, AI 요약·질문)

배포 후보 = v0.1.1 운영본(`0cfb689`) + R2 AI 요약·질문(`docs/TASKS.md` 13-23~13-29, D-037) + 운영 비용 점검의 배포 스크립트·AI 하루 상한(13-C, D-038) + 분당 제한 기본값 수정(`9d22d1c`). 사용자 지시 "다음 단계 진행해줄래?"(v0.2.0 무트래픽 → 실제 AI 평가 → 화면 → 기록 → 전환 승인 요청). 이 문서 시점의 운영 트래픽은 `<서비스>-0cfb689-v051`(앱 v0.1.1) 100% 그대로다. 배포는 `scripts/deploy_cloud_run.py`(D-038)로만 했다.

## 1. 1차 후보 `251930d` — smoke 실패(429), 원인 수정
- 무트래픽 리비전 `<서비스>-251930d-v051`(Secret 연결)에서 `smoke_api.py check` 가 `/analyze` **429 `rate_limited`** 로 중단. 리비전 로그: 1분 안 POST 99건 중 200 30건 → 이후 429 69건.
- 원인: 12-9 분당 제한은 D-037·TASKS 13-25 에서 **240회**로 정했는데 코드 상수 `ANALYZE_PER_MINUTE` 가 계획값 **30** 으로 남아 있었다(테스트는 제한을 직접 넘겨 확인해 기본값을 보지 않았다). smoke 는 한 IP 에서 1분에 약 110건 보낸다. 실제 사용자에게도 비교·반경 전환 흐름에서 막힐 수 있는 결함이라 운영 전환 전에 잡혔다.
- 수정 `9d22d1c`: 상수 240, 회귀 테스트(운영 앱 기본값에서 240건까지 429 없음, 241번째 429 — `backend/tests/test_frontend.py`). 클라이언트 IP 판정(`X-Forwarded-For` 마지막 값)은 이번 로그로는 문제 근거가 없어 바꾸지 않았다(모든 요청이 이 PC 한 곳).
- `251930d-v051` 은 `preview` 태그가 옮겨가 트래픽·태그 없음(최소 0 — 비용 없음). 리비전은 남김.

## 2. 검증 (최종 소스 `9d22d1c`, 규칙 F) — **전체 check 깨끗한 1회 통과는 아님**
| 실행 | 소스 | 결과 |
|---|---|---|
| 전체 check `--jobs 5` | `251930d` | Python 단계 PASS(v0.3 381 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 206 passed/1 skipped), **frontend FAIL 1/1003**(5초 시간 초과), 865초 |
| E2E | `251930d` | 5흐름 PASS(2.0분) |
| `--only backend` | `9d22d1c` | PASS(195.7초) — 바뀐 것은 백엔드 상수·테스트·평가 스크립트뿐 |
| `--only frontend` | `9d22d1c` | **FAIL 2/1003**(둘 다 5초 시간 초과 — 같은 시각 Docker 빌드 중) |
| 실패 테스트 단독(`App.test.tsx` 188건) | `9d22d1c` | 188 PASS, 문제 테스트 각 1.8초·1.9초 |

- 시간 초과는 모두 비교 화면 테스트(`App.test.tsx` 5차-B3)이고 단독으로는 5초 한도의 절반도 쓰지 않는다. 검증 내내 이 PC 에서 게임(VALORANT)이 돌고 있었다. frontend 소스는 `8af2e5c` 와 같고(`git diff 8af2e5c 9d22d1c -- frontend` 비어 있음) 그때 frontend 단계 1003/1003 PASS.
- 3회차 `--only frontend,patch-notes`(`9d22d1c`, Docker 빌드 끝난 뒤 — 게임은 여전히 실행 중) **PASS 1003/1003**(209.5초)·patch-notes PASS. 정리: 최종 소스의 Python 단계는 `251930d` 전체 check(엔진·데이터 동일) + `9d22d1c` backend 단계, frontend 는 `9d22d1c` 3회차로 통과 — 한 번의 전체 check 로 모두 통과한 것은 아니다(frontend 시간 초과 실패 2회 포함).

## 3. 이미지·리비전 `<서비스>-9d22d1c-v051`
- `git -c core.autocrlf=false archive` ZIP 대조: 1,069파일 중 차이 2(`eol=crlf` CSV 2개 — 이전과 같음)·추가 0·누락 0. `build_image.py`(지도 설정은 운영용 build arg, 값 기록 안 함), 태그 `:9d22d1c`, 이미지 안 `ANALYZE_PER_MINUTE` 240·모델 `claude-sonnet-5-5` 확인.
- index `sha256:bc2d01b7125d71b247a4dd5635523907ce4730a39dbb4641c3d2d2eafb1df1b8`
- linux/amd64 `sha256:4b3299d3c1cbec5741e092743b961fc645c2fee07e63729a34690de2440a2cf0`(리비전 imageDigest 와 같음)
- `deploy_cloud_run.py candidate 9d22d1c --ai --apply`: `--no-traffic --tag preview --min-instances 0 --max-instances 1 --cpu 1 --memory 1Gi --concurrency 4 --timeout 300 --no-cpu-throttling --cpu-boost`, 환경변수 `SCORING_ENGINE_VERSION=v0_5_1`, Secret `ANTHROPIC_API_KEY=anthropic-api-key:latest`(이름만 — 값은 보지 않음). Ready 모두 True. 운영 `0cfb689-v051` 100% 유지.

## 4. API·AI
- `smoke_api.py check`(기대값 48건 — `251930d`·v0.1.1 기대값과 **바이트 동일**, 점수 불변) **SMOKE PASSED**: warm 87/87, 불일치 0(지연 최소 112 · 중앙값 125 · 최대 358ms), `/rank` 29개 일치(1,058ms), `/insights` 200, `/health ai` enabled·budget ok, GET `/summary`·`/ask` 405.
- 실제 AI 평가 `scripts/eval_ai.py --base-url <preview>`(원격 모드 — 키는 서버 Secret, 이 PC 로 가져오지 않음) → `docs/AI_EVAL_2026-10-31.md`: 10사례 모두 요약 200, **수치 일치 99%(171/172)**, 결측 고지 10/10, 근거 연결 100%, 금지 표현 0, 자료 밖 질문("월세") 거절 10/10. 불일치 1건은 "약 223,103명"(원값 223,102.87 반올림 — 지어낸 수 아님). 호출 약 20회, 비용은 Anthropic Console 사용량에서 확인.

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공)
- 공유 링크 부평역 PC방 500m: 점수 62.3, **AI 요약 카드**(좋은 점 3·주의할 점 3·결정 전에 확인할 것 2, 각 문장 근거, 하단 고지 "AI가 이 분석 자료만 보고 쓴 요약입니다…"), 수치는 위 카드와 일치(고객성 77.5·경쟁성 31.9·동종 12곳).
- **AI에게 질문** 창: 안내 문구·추천 질문 3개·내 상황(선택)·30일 보관 고지 표시. 추천 질문을 보내자 "오늘 이 기기에서 쓸 수 있는 AI 횟수를 다 썼어요" — 평가가 이 PC IP 의 하루 질문 10회를 이미 썼기 때문(IP 하루 한도·안내 문구 동작 확인).
- 미검증: 질문 창의 정상 답변 표시(이 PC 는 오늘 한도 소진 — API 로는 평가에서 10회 확인), 모바일 AI 카드, 실기기·Safari·Firefox·스크린리더.
- 관찰(후속 판단): 근거 표시가 내부 필드 경로(`지표.customer.raw.타겟연령_거주인구`)를 그대로 보여 준다 — 사용자용 이름으로 바꿀지 다음 묶음에서 판단.

## 6. 다음 (승인 필요)
- 전환: `python scripts/deploy_cloud_run.py switch <서비스>-9d22d1c-v051 --apply`(트래픽 100% + 서비스 최소 인스턴스 1 — A 설정) → 운영 주소 smoke(같은 기대값) → 화면 → `deployments` 운영 전환 기록 → CLAUDE·README·TASKS 운영 상태.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-0cfb689-v051 --apply`(v0.1.1).
- 운영 주의: AI 상태(월·하루 집계, IP 한도)는 컨테이너 `/tmp` — 재배포·재시작 때 초기화(D-037 한계). 월 $30 의 마지막 안전장치는 Anthropic Console 조직 지출 한도 US$30.
- 작업 파일: `.gstack/deploy-9d22d1c/`(git 제외).
