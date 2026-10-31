# 배포 후보 무트래픽 검증 — 앱 v0.3.0 + 엔진 v0.5.1 (2026-11-01, R3 지원사업·가까운 역)

배포 후보 = v0.2.0 운영본(`9d22d1c`) + v0.2.1(AI 요약 근거 이름표) + R3(`docs/TASKS.md` 13-30~13-43): 지원사업 수집·매칭·카드·AI 연결(D-039), 가까운 역 시간대별 승하차(D-040), 엔진 v0.6 요청서(문서), 배포 스크립트 `--support`. 사용자 지시 "13-43 시작". 이 문서 시점의 운영 트래픽은 `<서비스>-9d22d1c-v051`(앱 v0.2.0) 100% 그대로다. 배포는 `scripts/deploy_cloud_run.py` 로만 했다(D-038).

## 1. 검증 (배포 후보 코드 `bae906e`, 규칙 F)
- 전체 check `--jobs 5` **1회차 19단계 PASS, SKIP 0, 재실행 없음**(v0.3 381 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 235 passed/1 skipped · frontend 1,022 · patch-notes). 기기 한가한 상태(게임 없음).
- E2E **5흐름 1회차 PASS**(59.9초).
- 보호 경로(`sources/`·`scoring_engine/v0_3/`·`data/runtime/`·`tests/golden/`) 변경 0건.

## 2. 이미지
- `git -c core.autocrlf=false archive` ZIP 대조: 1,095파일 중 차이 2(`eol=crlf` CSV 2개 — 이전과 같음)·추가 0·누락 0. `build_image.py`(지도 설정 운영용 build arg, 값 기록 안 함), 태그 `:bae906e`. 이미지 안 역 승하차 자료 68역·AI 프롬프트 `r3-1` 확인.
- index `sha256:1a58f33e93d3bd46ef8e8835e21e8c61c85418ae2a9dceef550c4eebe21d5c06`
- linux/amd64 `sha256:f28451197d59ebcc8d746bd207c73456df2dc5734138178108958d61633b77e4`(리비전 imageDigest 와 같음)

## 3. 무트래픽 리비전 `<서비스>-bae906e-v051`
- `deploy_cloud_run.py candidate bae906e --ai --support --apply`: `--no-traffic --tag preview --min-instances 0 --max-instances 1 --cpu 1 --memory 1Gi --concurrency 4 --timeout 300 --no-cpu-throttling --cpu-boost`, 환경변수 `SCORING_ENGINE_VERSION=v0_5_1`, Secret `ANTHROPIC_API_KEY`·`BIZINFO_API_KEY`·`DATA_GO_KR_API_KEY`(이름만 — 값은 보지 않음). Ready 모두 True. 운영 `9d22d1c-v051` 100% 유지.

## 4. API
- `smoke_api.py check`(기대값 48건 — v0.2.0 기대값과 **바이트 동일**, 점수 불변) **SMOKE PASSED**: warm 87/87, 불일치 0(지연 최소 109 · 중앙값 127 · 최대 225ms), `/rank` 29개 일치(1,383ms), `/insights` 200(479ms)·가까운 역 **부평·20개 시간대**, `/health ai` enabled·ok, GET `/summary`·`/ask`·`/support/match` 405.
- `/health support`: enabled, **543건**(기업마당 425 ok · K-Startup 128 ok) — Cloud Run 안에서 시작 때 서버가 직접 수집(2026-11-01 02:49 KST).

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공, 다크 테마)
- 공유 링크 부평역 카페 500m:
  - **AI 요약**(프롬프트 r3-1 새 생성 1건): 근거가 사용자용 이름("입지성 점수, 가까운 역, 역까지 거리 …" — v0.2.1), 확인할 것 중 하나가 카드 맨 위 공고 「[인천] 2026년 원도심ㆍ지역상권 활성화를 위한 상권 활성화 특례보증 지원사업 공고」를 인용(목록 밖 공고 0).
  - **지원사업 카드**: "카페 · 부평구 기준", "171건 중 5건", 공고 5건(인천 소상공인 특례보증·경영안정자금, 마감 "예산 소진시까지"), "출처: 기업마당 · 2026-11-01 02:49 기준 …선정 가능성과는 무관".
  - **가까운 역**: "부평역 인천1호선 · 직선 85m", 평일 하차 7,231명 · 승차 7,143명, 18시 최다, 출처·기간·경인선 제외 고지.
- 콘솔 오류 0.
- 미검증: 운영 주소에서 질문 창의 정상 답변(이 PC 의 오늘 질문 한도는 새 날짜라 남아 있으나 이번엔 부르지 않음), 모바일 실기기·Safari·Firefox·스크린리더, 지원사업 하루 1회 재수집(다음 날 확인).

## 6. 다음 (승인 필요)
- 전환: `python scripts/deploy_cloud_run.py switch <서비스>-bae906e-v051 --apply`(트래픽 100% + 서비스 최소 1) → 운영 주소 smoke(같은 기대값) → 화면 → `deployments` 운영 전환 기록 → CLAUDE·README·TASKS 운영 상태.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-9d22d1c-v051 --apply`(v0.2.0).
- 운영 주의: 지원사업 캐시·AI 집계는 컨테이너 `/tmp` — 재시작 때 다시 수집(약 2초)·집계 초기화(D-037·D-039 한계).
- 작업 파일: `.gstack/deploy-bae906e/`(git 제외).
