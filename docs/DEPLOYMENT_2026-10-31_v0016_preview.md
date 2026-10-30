# 배포 후보 검증·운영 전환 — 앱 v0.0.16 + 엔진 v0.5.1 (2026-10-31 무트래픽 검증 1~6장 · **운영 전환 7장**)

배포 후보 = v0.0.15 운영본 + R0 긴급 수정(`docs/IMPROVEMENT_PLAN_2026-10-30.md` 3장, `docs/TASKS.md` 13-1~13-5 — 팀 점검 보고서 P0 A1·A2·A3 + B2·C2). 사용자 지시 "푸시 + 무트래픽 배포". 이 문서 시점의 운영 트래픽은 `<서비스>-b7979c4-v051`(앱 v0.0.15) 100% 그대로다. 장소 이름 검색은 여전히 서버 키가 없어 **꺼진 상태**(`/health places.enabled=false`).

## 1. 검증 (배포 후보 코드 `ef32cc5`, 규칙 F — D-032·D-034·D-035)
- 전체 check `.venv` python `scripts/check.py --jobs 5` 1회차: **Python 18단계 PASS**(core 614.6 · v0_4 613.8 · v0_5 691.9 · v0_5_1 606.5 · backend 59.5초 등), **frontend 단계 FAIL** — 921건 중 시간 초과 3건(App 첫 방문 안내 저장 단언: 10-5·9-R2·12-28 과 같은 알려진 부하 간헐 건 / MapView 인증 실패 뒤 다시 불러오기 / ScoreGuide 관점 아코디언 5초 초과). 셋 다 단독 재실행(3파일 300건) 통과.
- `--only frontend` 재실행 1회차 FAIL(ScoreGuide 1건 5,073ms — dev 서버 2개·앱 내 브라우저가 떠 있던 상태), 서버를 끈 재실행 2회차 **PASS 921/921**(같은 테스트 단독 1,180ms). 병렬 pytest·서버 부하에서만 5초를 넘기는 테스트로 보며 코드 수정은 하지 않았다 — 숨기지 않고 기록한다.
- E2E `npm run e2e`(가짜 NAVER SDK, 엔진 v0.5.1 backend): 5흐름 통과(2.3분, 1회). 공유 링크 첫 로드의 지도 중심·zoom 검증(13-2)과 비교 머리 규제 배지(13-1)를 이번에 더했다.
- HEAD `c59123b`은 `ef32cc5` 위의 문서 커밋뿐 — 코드 검증 결과를 재사용했다.

## 2. 이미지
- 소스 `ef32cc50d36c651ccf32d24e36314b9f031fa171`. `git -c core.autocrlf=false archive` ZIP 컨텍스트를 커밋 blob 과 대조: 961파일 중 차이 2(`.gitattributes` `eol=crlf` CSV 2개 — `sources/`·`tests/golden/`, 둘 다 `.dockerignore` 제외라 이미지에 없음, v0.0.15 때와 같음)·추가 0·누락 0.
- Docker Desktop 데몬이 꺼져 있어 첫 빌드 시도가 실패(연결 오류) → 데몬을 띄운 뒤 재시도. `docker build --platform linux/amd64`, 태그 `:ef32cc5`, revision label = 위 커밋, 지도 설정은 운영용 build arg(Client ID·다크 스타일, 값 기록 안 함). 런타임 이미지에 번들 `v0.0.16`·"규제 확인 필요" 문자열, `scoring_engine/v0_3·v0_4·v0_5·v0_5_1`, `data/geo` 2개, `backend/app/places.py` 확인.
- index `sha256:b426f176540ee3c6c8ac907a7437db36c0210ae61422e40b850b5e2739aef249`
- linux/amd64 `sha256:19dd85747a5792993f0681cd8abe15b84a0b684b417542946ce35bb099e1fbfb` (리비전이 실행하는 digest)

## 3. 무트래픽 리비전 (2026-10-31 02:12 KST)
- `<서비스>-ef32cc5-v051`, 고정 태그 `preview`(`b7979c4-v051`에서 이 리비전으로 옮김), `--no-traffic`, `SCORING_ENGINE_VERSION=v0_5_1`, 모든 gcloud 명령에 프로젝트·리전 명시. 리비전 템플릿은 `b7979c4-v051`과 이미지 외 동일(환경변수·자원 1 CPU·1Gi·프로브·서비스 계정·타임아웃·동시성·min 1·max 1·CPU 상시·startup boost 주석 대조), IAM 은 v0.0.15 전환 뒤와 동일. Ready·Active·ContainerHealthy·ContainerReady·MinInstancesProvisioned·ResourcesAvailable 모두 True. 기존 리비전·이미지 보존, 운영 트래픽 `b7979c4-v051` 100% 유지. 검색 키 환경변수는 넣지 않았다(장소 검색 꺼짐).

## 4. API — `scripts/smoke_api.py check`(헤더 검사 포함) **SMOKE PASSED**
- 기대값: 같은 소스·엔진 v0_5_1 로 새로 만든 48건(`smoke_api.py expected`, 2026-10-31). **v0.0.15 배포 때 기대값 48건과 완전히 같다** — R0 는 화면만 바꾸고 점수를 바꾸지 않았다는 확인. warm 87/87(`--wait-warm 600` 안에 완료), 48건 일치(불일치 0, 지연 최소 110 · 중앙값 130 · 최대 241ms), 모든 성공 응답 `X-Data-Version` = `/health data.version` = `2026-06`, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17(동종 = 목록), 학교구역 첫 줄, 422 `invalid_radius`, 정적 경로(`/places` GET 405 포함)·immutable 캐시·GeoJSON 해시 일치.
- gzip 실측(preview): 주 번들 573,690바이트 → `Accept-Encoding: gzip` 171,180바이트(v0.0.15 567,376→169,027). `/health`: engine mvp-0.5.1, data 2026-06, `places.enabled=false`, warm 87/87.
- 리비전 ERROR·5xx 로그 0(Cloud Logging, 검증 중).

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공, 앱 내 브라우저 1400×900 에뮬레이션·375×812)
- 앱 v0.0.16, 지도 인증 성공(다크 GL, 마커·반경 원·점포), 콘솔 오류 0.
- **학교 옆 PC방 공유 링크**(`?lat=37.50115&lng=126.72030&biz=R10406&r=500`, 보고서 8장 체크리스트 1·2번): 결과 패널 위치 제목 아래 **빨간 규제 배너 펼침**("학교 200m 안 초·중·고 2곳 — PC방은(는) 학교 주변 영업 규제 업종입니다(교육환경보호구역). 점수보다 영업 가능 여부를 먼저 확인하세요."), 종합 70.2 / 100 **좋음** pill + **규제 확인 필요** 배지, 관점 등급 칩(시장성 61.6 보통 · 고객성 81.2 좋음 · 경쟁성 63.1 보통 · 입지성 66.6 보통 · 안정성 73.2 좋음), 확인할 점 2(학교구역·학교 주변), 반경별 표. 지도는 부평 일대 100m 축척·마커 화면 안(링크 첫 로드 — A2 증상 없음).
- **신포동 카페**(`?lat=37.47117&lng=126.62543&biz=I21201&r=500`, 체크리스트 3번, 모바일 375): 종합 51.2 **보통**, 점수 카드 아래 빨간 한 줄 "경쟁성이 매우 낮아요(6.9점) — 반경 500m 카페 80곳 · 비슷한 업종 포함 약 88.1곳 · 점포당 잠재수요(거주+종사자) 91명"(팀 보고서의 6.9·51.2 와 같은 값), 가로 스크롤 없음(scrollWidth = 375). 데스크톱 1400 에서는 관점 행 등급색(보통 파랑·약함 주황·주의 빨강·좋음 초록)을 로컬 dev 서버로 확인(1장 화면 검증과 같은 번들).
- 업데이트 내역 모달에 `v0.0.16 · 2026.10.31 점수보다 먼저 보여야 할 것` 표시.
- 미검증: "이 점수는?" 펼침·라이트 테마는 preview 가 아닌 로컬 dev 서버에서 확인(같은 번들), 1366×768 첫 화면에 다섯 관점이 모두 보이는지(체크리스트 4번 — R1 레이아웃 역전에서 다룬다), 인쇄 대화상자, 실기기·Safari·Firefox·스크린리더, 장소 검색 실제 호출(키 없음), 등급 경계값의 엔진 담당 확인.

## 6. 다음 (승인 필요)
- 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-ef32cc5-v051=100` → 등록 운영 주소 확인 + `smoke_api.py check <운영 주소>`(같은 기대값) → `deployments` 운영 전환 기록 → CLAUDE.md·TASKS·README 현재 운영 상태 갱신.
- 복구: `--to-revisions <서비스>-b7979c4-v051=100`(v0.0.15).
- 작업 파일: `.gstack/deploy-ef32cc5/`(git 제외 — build·push·deploy 로그, 서비스·리비전·IAM JSON, 기대값·smoke 결과).

## 7. 운영 전환 (2026-10-31 02:20 KST, 사용자 승인 "전환 진행")
- 명령: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-ef32cc5-v051=100`. 소스 변경·재빌드·check 재실행 없음(1장 결과 재사용).
- 트래픽: `<서비스>-ef32cc5-v051` **100%**(태그 `preview` 유지), `276157e-v051`·`965849c-v051` 0%(검증 태그). `b7979c4-v051`·`c0ebd5b-v051`·`2970797-v051`·`b666eb1-v051`·`78a60d3-v051`·`1020200-v04` 등 이전 리비전과 이미지 보존. 서비스 템플릿·IAM 전환 전후 동일(JSON 대조).
- 운영 API: `smoke_api.py check <운영 주소>`(같은 기대값 48건, 헤더 검사 포함) **SMOKE PASSED** — warm 87/87, 48건 일치(지연 최소 114 · 중앙값 129 · 최대 261ms), 데이터 버전 헤더 2026-06, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17, 학교구역 첫 줄, 422, 정적(`/places` GET 405)·캐시·GeoJSON. 전환 뒤 서비스 전체 ERROR·5xx 0. `/health places.enabled=false`.
- 운영 화면(등록 주소, 프로젝트 번호 형식, D-018, 1400×900): 앱 v0.0.16, 지도 인증 성공(다크 GL), 학교 옆 PC방 공유 링크 첫 로드 → 규제 배너 펼침·70.2 좋음·규제 확인 필요 배지, 지도는 부평 일대 100m 축척·마커 화면 안(처음 약 18초는 "지도를 불러오는 중"·5km 축척이었다가 GL init 뒤 맞춤 — A2 증상 없음), 콘솔 오류 0. 신포동 카페 모바일·업데이트 내역은 같은 이미지의 `preview` 주소에서 5장으로 확인했다. 문제 없음 → 복구하지 않았다.
- 복구 대상: `<서비스>-b7979c4-v051`(v0.0.15). `--to-revisions <서비스>-b7979c4-v051=100`.
- 기록: `patchNotes.json` `deployments`에 `2026-10-31-production-ef32cc5`. 미검증: 5장과 같음(1366×768 첫 화면 다섯 관점, 인쇄 대화상자, 실기기·Safari·Firefox·스크린리더, 장소 검색 실제 호출, 등급 경계값 엔진 담당 확인).
