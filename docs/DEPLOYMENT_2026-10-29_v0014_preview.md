# 배포 후보 검증·운영 전환 — 앱 v0.0.14 + 엔진 v0.5.1 (2026-10-29 무트래픽 검증 1~6장 · **운영 전환 7장**)

배포 후보 = v0.0.13 운영본 + 통합 개선 계획 0차 "정확한 의미"(`docs/IMPROVEMENT_PLAN_2026-10-29.md`, `docs/TASKS.md` 12-16~12-21·12-1·12-2·12-4·12-5·12-6, 안 B). 사용자 지시 "무트래픽 배포". 1~6장 시점의 운영 트래픽은 `<서비스>-2970797-v051`(앱 v0.0.13) 100% 그대로였다 — 전환은 7장(같은 날 사용자 승인 "전환 진행").

## 1. 검증 (배포 후보 `c0ebd5b`, 규칙 F — D-032·D-034·D-035)
- 전체 check `scripts/check.py --jobs 5`: 1회차(`44e7bf2`) patch-notes 단계 실패(v0.0.14 changes 8줄·90자 초과) → 문구 정리 뒤 2회차(`c0ebd5b`) **19단계 통과, SKIP 0, 재실행 없음**, 410.7초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 143 · frontend 832 · patch-notes). 기록 `docs/TASKS.md` 12-22.
- E2E `scripts/check.py --only e2e`: 4흐름 1회 통과(58초). 로컬 production build + uvicorn(v0_3)에서 `smoke_api.py check` PASSED(gzip·favicon·robots 포함).
- `1d79da6`(HEAD)는 `c0ebd5b` 위의 문서 커밋뿐(`git diff --stat c0ebd5b HEAD` = `docs/TASKS.md` 1파일) — 코드 검증 결과를 재사용했다.

## 2. 이미지
- 소스 `c0ebd5b6d25d1fb13ac26d1113a68c340a5511d2`. `git -c core.autocrlf=false archive` ZIP 컨텍스트를 커밋 blob과 대조: 922파일 중 차이 2(`.gitattributes` `eol=crlf` 지정 파일 2개 — `sources/`·`tests/golden/`의 부평역 CSV, 둘 다 `.dockerignore` 제외 경로라 이미지에 없음)·추가 0·누락 0.
- `docker build --platform linux/amd64`, 태그 `:c0ebd5b`, revision label = 위 커밋, 지도 설정은 운영용 build arg(Client ID·다크 스타일, 값 기록 안 함). 빌드 단계 GeoJSON 자산 검사 2개 통과. 런타임 이미지에 `data/geo` 2개(SGIS 2025 2Q·2026 행정동)·matplotlib 3.10.9·pandas 2.3.3·numpy 2.2.6·`scoring_engine/v0_3·v0_4·v0_5·v0_5_1`, 번들에 `v0.0.14`·"확인 필요", `favicon.svg`·`robots.txt`, backend `GZipMiddleware` 확인. 178MB.
- index `sha256:d97e8b66f6b28ec1e5d482c07463643107a732570dd509a1b1cc38d928edf119`
- linux/amd64 `sha256:33fa7d94c1abb5eb9eda277d404ee19863c354418cb3c7be31fa6787f7cf7853` (리비전이 실행하는 digest)

## 3. 무트래픽 리비전 (2026-10-29 09:42 KST)
- `<서비스>-c0ebd5b-v051`, 고정 태그 `preview`(`2970797-v051`에서 이 리비전으로 옮김), `--no-traffic`, `SCORING_ENGINE_VERSION=v0_5_1`, 1 CPU·1Gi·min 1·max 1·concurrency 4·CPU 상시·startup boost, 모든 gcloud 명령에 프로젝트·리전 명시. 리비전 템플릿은 `2970797-v051`과 이미지 외 동일(환경변수·자원·프로브·서비스 계정·타임아웃 대조), IAM 전후 동일. Ready·ContainerHealthy·MinInstancesProvisioned True. 기존 리비전·이미지 보존, 운영 트래픽 `2970797-v051` 100% 유지.

## 4. API — `scripts/smoke_api.py check`(헤더 검사 포함) **SMOKE PASSED**
- 기대값: 같은 소스·엔진 v0_5_1 로 만든 48건(`smoke_api.py expected`, 2026-10-29 09:40 KST). warm 87/87(`--wait-warm 600` 안에 완료), 48건 일치(불일치 0, 지연 최소 107 · 중앙값 139 · 최대 242ms), 모든 성공 응답 `X-Data-Version` = `/health data.version` = `2026-06`, 부평역 PC방 300/500/1km 64.6·6 / **62.3·12** / 64.8·17(동종 = 목록), 학교구역 첫 줄, 422 `invalid_radius`, 정적 경로·immutable 캐시·GeoJSON 해시(gzip 해제 뒤) 일치.
- 12-1 gzip 실측(preview): 주 번들 533,645바이트 → `Accept-Encoding: gzip` 159,201바이트(`content-encoding: gzip`, `cache-control: public, max-age=31536000, immutable` 유지). 12-5: `/favicon.svg` 200 `image/svg+xml`, `/robots.txt` 200, `index.html`에 description·og:title·og:description·icon.
- 리비전 ERROR 로그 0, 5xx 0, 메모리 사용률 최고 약 31%(Cloud Monitoring p99, 1Gi 기준).

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공, 앱 내 브라우저 1024×768·375×812)
- 앱 v0.0.14, 지도 인증 성공, 콘솔 오류 0. 단일 부평역 PC방 500m 62.3, 머리줄 **"분석 결과 · 반경 500m · 데이터 묶음 2026-06"**, 종합 점수 아래 **"확인 필요 — 임대료 미반영 · 유입·생존율은 구 단위 자료 · 반경 인구는 면적 배분 추정 · 잠재수요에 방문객 유동 없음"**, 요약에 관점별 근거 한 줄 + 자료 단위 칩(구 단위 / 반경 500m 추정 / 반경 500m / 지점 좌표 / 구 단위, 스크린리더 구분말 "· 자료 단위"), 안정성 근거 "3년 생존율 52.3%"(인천 업종평균 없음).
- 상세 근거: 관점 chip "자료 등급 보통/높음", 데이터 출처 "이 결과는 데이터 묶음 2026-06으로 계산했습니다. 묶음 이름은 자료마다 다른 기준일을 대신하지 않습니다", 면책 원문 아래 "엔진 원문의 '상대 순위'는 … 후보지 순위가 아닙니다" 주석, 엔진 `mvp-0.5.1`.
- 1km 전환 64.8·점포 17, 다크 테마 전환(지도 유지). 업데이트 내역 v0.0.14 맨 위("점수 설명의 의미를 정확하게", 수정·개선·추가 3줄). A/B 비교(B 학교 50m) 1km 64.8 / 68.9, 비교 머리줄 "· 반경 1km · 데이터 묶음 2026-06", 확인 필요 줄(A·B 같아 하나), B 주소 찾기 안내 "도로명·지번 주소만 찾습니다 …"와 예시 3개. 모바일 375 비교 화면 가로 스크롤 없음(scrollWidth 375), 확인 필요 줄 표시.
- 미검증: 모바일 실기기·Safari·Firefox·스크린리더, 네일숍(안정성 미산출 업종) 화면의 사람 확인(12-22 원래 항목)은 사용자 몫.

## 6. 다음 (승인 필요)
- 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-c0ebd5b-v051=100` → 등록 운영 주소 확인 + `smoke_api.py check <운영 주소>`(같은 기대값) → `deployments` 운영 전환 기록 → CLAUDE.md·TASKS 현재 운영 상태 갱신.
- 복구: `--to-revisions <서비스>-2970797-v051=100`(v0.0.13).

## 7. 운영 전환 (2026-10-29 09:59 KST, 사용자 승인 "전환 진행")
- 명령: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-c0ebd5b-v051=100`. 소스 변경·재빌드·check 재실행 없음(1장 결과 재사용).
- 트래픽: `<서비스>-c0ebd5b-v051` **100%**(태그 `preview` 유지), `276157e-v051`·`965849c-v051` 0%(검증 태그). `2970797-v051`·`b666eb1-v051`·`78a60d3-v051`·`1020200-v04`·`6f7df52`·`00001-872` 리비전과 이미지 보존. 서비스 템플릿·IAM 전환 전후 동일(JSON 대조).
- 운영 API: `smoke_api.py check <운영 주소>`(같은 기대값 48건, 헤더 검사 포함) **SMOKE PASSED** — warm 87/87, 48건 일치(지연 최소 110 · 중앙값 130 · 최대 340ms), 데이터 버전 헤더 2026-06, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17, 학교구역 첫 줄, 422, 정적·캐시·GeoJSON. 전환 뒤 서비스 전체 ERROR·5xx 0.
- 운영 화면: 첫 확인을 NAVER 미등록 별칭 주소(해시 형식)에서 열어 "지도 인증에 실패했습니다"(401)가 나왔다 — D-018에 기록된 주소 확인 오류이며 배포 결함이 아니다(같은 번들이 등록된 `preview` 주소에서는 5장대로 정상). 등록 운영 주소(프로젝트 번호 형식)에서 다시 확인: 앱 v0.0.14, 지도 인증 성공, 단일 부평역 PC방 500m 62.3, 머리줄 "데이터 묶음 2026-06", 확인 필요 줄 4항목, 관점별 근거 줄·자료 단위 칩, 안정성 "3년 생존율 52.3%", 업데이트 내역 v0.0.14 맨 위, 다크 테마 전환(지도 유지), 콘솔·처리되지 않은 오류 0. 1km·A/B 비교·모바일 375는 같은 이미지의 `preview` 주소에서 5장으로 확인했다. 문제 없음 → 복구하지 않았다.
- 복구 대상: `<서비스>-2970797-v051`(v0.0.13). `--to-revisions <서비스>-2970797-v051=100`.
- 기록: `patchNotes.json` `deployments`에 `2026-10-29-production-c0ebd5b`(같은 날 v0.0.13 전환 기록 `2026-10-29-production`과 구분). 미검증: 실기기·Safari·Firefox·스크린리더, 네일숍 화면의 사람 확인.
