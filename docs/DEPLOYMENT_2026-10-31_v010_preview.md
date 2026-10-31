# 배포 후보 검증·운영 전환 — 앱 v0.1.0 + 엔진 v0.5.1 (2026-10-31 무트래픽 검증 1~7장 · **운영 전환 8장**)

배포 후보 = v0.0.16 운영본 + R1 대시보드 리디자인(`docs/IMPROVEMENT_PLAN_2026-10-30.md` 4장, `docs/TASKS.md` 13-10~13-22) + Codex 검수 수정(R1-1~R1-10, `docs/CODEX_REVIEW_2026-10-31_v010.md` — 3회 검수 → 재검수 → 2차 재검수 통과) + 무트래픽 검증에서 찾은 수정 1건(13-22-D1). 사용자 지시 "푸시 + 무트래픽 배포". 이 문서 시점의 운영 트래픽은 `<서비스>-ef32cc5-v051`(앱 v0.0.16) 100% 그대로다. 장소 이름 검색은 서버 키가 없어 **꺼진 상태**.

## 1. 1차 무트래픽 리비전 `f047257` — smoke 1건 실패
- 코드 `f047257`(Codex 2차 재검수 통과 기준). 전체 check `--jobs 5` 19단계 PASS·E2E 5/5 는 커밋 직전의 같은 소스에서 실행한 기록(TASKS 13-22 "수정 검증 … R1-9·R1-10").
- 이미지 `:f047257`(amd64 `sha256:f98b1f716cfdfd832d029c020d3e3a1a0d04db7a42e25a504c366b5b753d4f36`), 리비전 `<서비스>-f047257-v051`, `preview` 태그, `--no-traffic`. Ready 조건 모두 True, 템플릿은 `ef32cc5-v051`과 이미지 외 동일.
- `smoke_api.py check` **SMOKE FAILED 1건**: `GET /insights` 가 405 가 아니라 200(index.html). 그 밖(48건·rank·insights·버전·정적 경로)은 통과. 원인: 정적 프런트 폴백(`mount_frontend`)에 넘기는 API 경로를 손으로 적어 새 `/insights` 를 빠뜨림 → **13-22-D1** 로 수정(`2542152`, 등록된 route 에서 읽음 + 모든 API route 의 다른 method 405 회귀 검사, 수정 전 실패 확인). 이 리비전은 트래픽 0 으로 남겨 두었다(`preview` 태그는 2차로 옮김).

## 2. 검증 (배포 후보 코드 `2542152`, 규칙 F)
- 전체 check `.venv` python `scripts/check.py --jobs 5` **1회차 19단계 PASS, SKIP 0, 재실행 없음**(427.9초 — v0.3 381 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 185 passed/1 skipped(학교 규제, v0.3) · frontend 973), E2E `--only e2e` **5흐름 1회차 PASS**(53.8초, 전체 check 뒤 단독). 로그 `.gstack/check-logs/r1-2542152-*.log`(git 제외).
- 이 문서 커밋은 `2542152` 위의 기록뿐 — 코드 검증 결과를 재사용한다.

## 3. 이미지
- 소스 `2542152…`(전체 해시는 작업 파일). `git -c core.autocrlf=false archive` ZIP 을 커밋 blob 과 대조: 1,051파일 중 차이 2(`.gitattributes` `eol=crlf` CSV 2개 — `sources/`·`tests/golden/`, `.dockerignore` 제외라 이미지에 없음, 이전 배포와 같음)·추가 0·누락 0.
- `docker build --platform linux/amd64`, 태그 `:2542152`, revision label = 위 커밋, 지도 설정은 운영용 build arg(Client ID·다크 스타일, 값 기록 안 함). 이미지 안에서 번들 `v0.1.0`·"다시 분석"·`scoring_engine/v0_3·v0_4·v0_5·v0_5_1`·`APIRoute` 경로 집합 확인.
- index `sha256:25027effc6ccbde8be8979b1559123685d38b968bb2e2444121d8e4a172cd657`
- linux/amd64 `sha256:9dd256176a42c8243ec4dfb99d2bd195b18f28b9b83899d5f25cfb700e0e66a1` (리비전이 실행하는 digest)

## 4. 무트래픽 리비전 `<서비스>-2542152-v051`
- 고정 태그 `preview`(`f047257-v051`에서 옮김), `--no-traffic`, `--update-env-vars SCORING_ENGINE_VERSION=v0_5_1`(환경변수는 이것 하나 — 배포 전 서비스 템플릿에서 확인), 모든 gcloud 명령에 프로젝트·리전 명시. 리비전 spec 은 `ef32cc5-v051`과 이미지 외 동일(자원 1 CPU·1Gi, min 1·max 1, CPU 상시, startup boost 주석 포함 대조). Ready·Active·ContainerHealthy·ContainerReady·MinInstancesProvisioned·ResourcesAvailable 모두 True. 운영 트래픽 `ef32cc5-v051` 100% 유지, 기존 리비전·이미지 보존.

## 5. API — `scripts/smoke_api.py check` **SMOKE PASSED**
- 기대값: 같은 소스·엔진 v0_5_1 로 새로 만든 48건 + `/rank`. **48건은 v0.0.16(`ef32cc5`) 기대값과 완전히 같다** — R1 은 점수를 바꾸지 않았다. `f047257` 기대값과도 같다.
- warm 87/87, 48건 일치(불일치 0, 지연 최소 100 · 중앙값 131 · 최대 256ms), 성공 응답 `X-Data-Version` = `/health data.version` = `2026-06`, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17(동종 = 목록), 학교구역 첫 줄, 422 `invalid_radius`.
- 새 항목: `/rank` 부평역 500m 200·29개·내림차순·기대값 본문 일치(상위 노래방 72.3 · 독서실/스터디 카페 72.1 · 당구장 71.1, 1,659ms — warm 뒤 첫 요청), `/insights` 200·부평구 24시간·영업 프로파일 24개, **`/analyze` 최상위 키 = `context`·`result`**(열린 이전 화면 계약, R1-3), `/rank`·`/insights` 의 `engine_version`·`X-Data-Version` = `/health`(R1-9), 정적 경로 `GET /rank`·`GET /insights`·`GET /places` 405.
- 번들 gzip 실측(preview): 주 번들 599,974바이트 → `Accept-Encoding: gzip` 180,340바이트(v0.0.16 573,690→171,180).
- 리비전 ERROR·5xx 로그 0(Cloud Logging, 검증 중 1시간).

## 6. 화면 (preview 주소 — NAVER 등록, 인증 성공, 앱 내 브라우저)
- **1366×768, 학교 옆 PC방 공유 링크**(`?lat=37.50115&lng=126.72030&biz=R10406&r=500`): 대시보드 배치(결과 전폭 + 오른쪽 위 지도 카드, 다크 GL 타일·마커·반경 원), 규제 배너 펼침("학교 200m 안 초·중·고 2곳 — PC방은 학교 주변 영업 규제 업종입니다…" — 조사 처리), 70.2 좋음 + 규제 확인 필요 배지, 한 줄 결론 "고객성이 특히 좋은 자리예요(주요 손님층 거주).", 다섯 관점(규제 배너가 있으면 첫 화면에 4개 + 다섯째 일부 — Codex 재검수의 "배너 펼친 상태는 보장하지 않음"과 같음), 시간대 카드("PC방은 영업 시간대에 사람이 몰리는 편이에요(주로 저녁 영업 · 시간대 적합도 1.32 …)"), 업종 순위(노래방 78.3 규제 확인 · 세탁소 77.9 · 당구장 76.7 · 생맥주 73.9 · 편의점 73.2 … 지금 업종 PC방 70.2 규제 확인). 지도 크게 보기 → 지도 전폭·포커스 "결과로 돌아가기" → 복귀 → 포커스 "지도 크게 보기". 업데이트 내역 v0.1.0. 콘솔 오류 0.
- **375×812 부평역 PC방**: 패널 화면, 가로 스크롤 없음(scrollWidth 375), 첫 관점 행 top 570 · 거미줄 927(막대 먼저).
- 미검증: 640·768·958 태블릿은 로컬·Codex 검수에서만(preview 에서 다시 재지 않음), 라이트 테마, 실제 인쇄 대화상자, 실기기·Safari·Firefox·스크린리더, 운영 중 서버 전환 순간의 버전 불일치(헤더 주입으로만), 장소 검색 실제 호출(키 없음), 등급 경계값의 엔진 담당 확인.

## 7. 다음 (승인 필요)
- 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-2542152-v051=100` → 등록 운영 주소 확인 + `smoke_api.py check <운영 주소>`(같은 기대값) → `deployments` 운영 전환 기록 → CLAUDE.md·TASKS·README 현재 운영 상태 갱신.
- 복구: `--to-revisions <서비스>-ef32cc5-v051=100`(v0.0.16). v0.1.0 화면이 열린 채 복구되면 `/rank`·`/insights` 404 로 두 카드만 빠지고 분석은 유지된다(R1-3, Codex 재검수에서 이전 backend 로 확인).
- 작업 파일: `.gstack/deploy-f047257/`·`.gstack/deploy-2542152/`(git 제외 — build·push·deploy 로그, 서비스·리비전 JSON, 기대값·smoke 결과).

## 8. 운영 전환 (2026-10-31 08:39 KST, 사용자 승인 "전환 진행")
- `gcloud run services update-traffic … --to-revisions <서비스>-2542152-v051=100`. 전환 전 `ef32cc5-v051` 100% 확인, 전환 뒤 spec·status 모두 `2542152-v051` 100%(`preview`·`verify-*` 태그는 그대로).
- 운영 주소 `smoke_api.py check`(같은 기대값) **SMOKE PASSED**: warm 87/87, 48건 불일치 0(지연 최소 102 · 중앙값 126 · 최대 269ms), `/rank` 29개 기대값 일치(캐시 적중 80ms), `/insights` 200·`/analyze` 키 `context`·`result`, 보조 응답 버전·헤더·정적 경로 검사 통과.
- 등록 운영 주소 화면(인증 성공, 1366×768): 부평역 PC방 공유 링크 — 대시보드, 다섯 관점 행 하단 444~600 ≤ 스크롤 영역 666, 한 줄 결론 "고객성은 좋은 편이지만, 경쟁성이 약한 자리예요(참고: 반경 500m 안 같은 업종 12곳).", 순위 6행, 시간대 카드 "몰리는 편", 업데이트 내역 v0.1.0, 콘솔 오류 0. 전환 뒤 30분 리비전 ERROR·5xx 0.
- 복구 대상: `--to-revisions <서비스>-ef32cc5-v051=100`(v0.0.16).
