# 배포 후보 검증·운영 전환 — 앱 v0.0.15 + 엔진 v0.5.1 (2026-10-29 무트래픽 검증 1~6장 · **운영 전환 7장**)

배포 후보 = v0.0.14 운영본 + 통합 개선 계획 1차 "활용"(`docs/IMPROVEMENT_PLAN_2026-10-29.md` 3장, `docs/TASKS.md` 12-3·12-26·12-27·12-25·12-15·12-14, D-036) + Codex 검수 지적 R1~R5 수정(12-28). 사용자 지시 "무트래픽 배포". 1~6장 시점의 운영 트래픽은 `<서비스>-c0ebd5b-v051`(앱 v0.0.14) 100% 그대로였다 — 전환은 7장(같은 날 사용자 승인 "전환 진행"). 장소 이름 검색은 서버에 NAVER 검색 키가 없어 **꺼진 상태**(`/health places.enabled=false`)로 올라갔다.

## 1. 검증 (배포 후보 코드 `b7979c4`, 규칙 F — D-032·D-034·D-035)
- 전체 check `.venv` python `scripts/check.py --jobs 5` 5회차(단독): **19단계 통과, SKIP 0, 재실행 없음**, 407.9초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 157 · frontend 49파일 907 · patch-notes). 같은 코드의 3회차는 E2E 와 동시 실행 중 frontend 1건 간헐 실패(첫 방문 안내 저장 단언, 10-5·9-R2 와 같은 미확인 건, 단독 3회 통과) → 4회차 단독 통과 → R5 수정 뒤 5회차. 기록 `docs/REVIEW_PACKAGE_2026-10-29_v0015.md` 4-1~4-3.
- E2E `--only e2e`: 5흐름 통과(54.4초). Codex 3차 재검수 통과(`docs/CODEX_REVIEW_2026-10-29_v0015.md`).
- HEAD `c83fd41`은 `b7979c4` 위의 문서 커밋뿐(`b3e0532`·`c83fd41`) — 코드 검증 결과를 재사용했다.

## 2. 이미지
- 소스 `b7979c4f0fd13a3a285ffa4d21b5efd7693ad1b9`. `git -c core.autocrlf=false archive` ZIP 컨텍스트를 커밋 blob 과 대조: 953파일 중 차이 2(`.gitattributes` `eol=crlf` 지정 CSV 2개 — `sources/`·`tests/golden/`, 둘 다 `.dockerignore` 제외라 이미지에 없음)·추가 0·누락 0.
- `docker build --platform linux/amd64`, 태그 `:b7979c4`, revision label = 위 커밋, 지도 설정은 운영용 build arg(Client ID·다크 스타일, 값 기록 안 함). 빌드 단계 GeoJSON 자산 검사 통과. 런타임 이미지에 번들 `v0.0.15`·"현장 확인"·`field-check__memo-print`, `backend/app/places.py`, `scoring_engine/v0_3·v0_4·v0_5·v0_5_1`, `data/geo` 2개, pandas 2.3.3·numpy 2.2.6·matplotlib 3.10.9 확인.
- index `sha256:43659cce0c6b67251c4b140b0ee521261b6be9517595be225564d03b4b3f19c1`
- linux/amd64 `sha256:567f12049e39ad13ef5869daa43fedd09b5c1838de5467796baca16c91dcf892` (리비전이 실행하는 digest)

## 3. 무트래픽 리비전 (2026-10-29 13:52 KST)
- `<서비스>-b7979c4-v051`, 고정 태그 `preview`(`c0ebd5b-v051`에서 이 리비전으로 옮김), `--no-traffic`, `SCORING_ENGINE_VERSION=v0_5_1`, 1 CPU·1Gi·min 1·max 1·concurrency 4·CPU 상시·startup boost, 모든 gcloud 명령에 프로젝트·리전 명시. 리비전 템플릿은 `c0ebd5b-v051`과 이미지 외 동일(환경변수·자원·프로브·서비스 계정·타임아웃·스케일 주석 대조), IAM 전후 동일. Ready·ContainerHealthy·MinInstancesProvisioned True. 기존 리비전·이미지 보존, 운영 트래픽 `c0ebd5b-v051` 100% 유지. 검색 키 환경변수는 넣지 않았다(장소 검색 꺼짐).

## 4. API — `scripts/smoke_api.py check`(헤더 검사 포함) **SMOKE PASSED**
- 기대값: 같은 소스·엔진 v0_5_1 로 새로 만든 48건(`smoke_api.py expected`, 2026-10-29). warm 87/87(`--wait-warm 600` 안에 완료), 48건 일치(불일치 0, 지연 최소 101 · 중앙값 131 · 최대 411ms), 모든 성공 응답 `X-Data-Version` = `/health data.version` = `2026-06`, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17(동종 = 목록), 학교구역 첫 줄, 422 `invalid_radius`, 정적 경로(`/places` GET 405 포함)·immutable 캐시·GeoJSON 해시 일치.
- gzip 실측(preview): 주 번들 567,376바이트 → `Accept-Encoding: gzip` 169,027바이트(`content-encoding: gzip`, immutable 캐시 유지; v0.0.14 533,645→159,201). `/favicon.svg`·`/robots.txt` 200. `/health`: engine mvp-0.5.1, data 2026-06, `places.enabled=false`.
- 리비전 ERROR 로그 0, 5xx 0(Cloud Logging). 요청 로그의 `/places` 항목은 경로만(GET 405, 검색어 없음). 메모리 사용률 최고 약 31%(Cloud Monitoring p99, 1Gi 기준).

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공, 앱 내 브라우저 800×600·375×812)
- 앱 v0.0.15, 지도 인증 성공(다크 GL, 마커·반경 원·점포 12곳), 콘솔 오류 0. 공유 링크(`?lat&lng&biz=R10406&r=500`)로 열기 → 업종·위치 복원, 단일 부평역 PC방 500m 62.3, 안내 "공유 링크의 조건으로 다시 분석했습니다 — 저장된 점수가 아니라 지금 서버의 결과입니다.", 주소창이 결과 조건(`data=2026-06&engine=mvp-0.5.1`)으로. 결과 활용 줄 [링크 복사][인쇄][보관], 탭 요약·주변 점포 12·상세 근거·현장 확인 3, 반경별 비교 표(500m 지금 행, 300m·1km "분석하기"), 첫 방문 결과 안내(④) 확인으로 닫힘.
- 현장 확인 탭: 카드 3장(같은 업종 12곳·점포당 잠재수요 1,925명 / 임대 조건 — "임대료 조사 상권이 연결되지 않아"(R3 문구) / 유동 관찰), 확인함 체크 → `fieldNotes.v1` 저장. 보관 → "보관함에 저장했습니다(1/3)", 조건 바 배지 1, `savedSites.v1` 스냅샷(62.3·2026-06·mvp-0.5.1). 보관함 모달: 저장 당시 결과 62.3·관점 5·같은 업종 12곳·확인 필요 4·현장 확인 0/3→1/3·메모·다시 분석·삭제, Escape 닫힘. "같은 조건으로 다시 분석" → `/analyze` 2회째 요청(캐시 우회, R2), 안내 "보관함의 조건으로 다시 분석했습니다 — 저장 당시 결과가 아니라 지금 서버의 결과입니다." 조건 바꾸기 → 주소창 쿼리 제거, 위치 입력 방법 [지도·주소·좌표]만(장소 이름 없음 = 키 없음). 모바일 375: 결과 활용 줄·탭·현장 카드 배치, 가로 스크롤 없음(scrollWidth 375).
- 미검증: 실제 인쇄 대화상자(로컬 Playwright print 측정은 검수 자료 2-10·2-11), 1km·A/B 비교 화면(같은 번들을 로컬 production 구조와 E2E 에서 확인), 실기기·Safari·Firefox·스크린리더, 장소 검색 실제 호출(키 없음), 계획 1차 완료 기준의 사람 검증.

## 6. 다음 (승인 필요)
- 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-b7979c4-v051=100` → 등록 운영 주소 확인 + `smoke_api.py check <운영 주소>`(같은 기대값) → `deployments` 운영 전환 기록 → CLAUDE.md·TASKS·README 현재 운영 상태 갱신.
- 복구: `--to-revisions <서비스>-c0ebd5b-v051=100`(v0.0.14).
- 장소 검색을 켜려면 NAVER 검색 API 키를 Cloud Run Secret(`NAVER_SEARCH_CLIENT_ID`·`NAVER_SEARCH_CLIENT_SECRET`)으로 넣는 별도 배포 단위가 필요하다(첫 호출에서 좌표가 인천 안에 찍히는지 확인).

## 7. 운영 전환 (2026-10-29 14:07 KST, 사용자 승인 "전환 진행")
- 명령: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-b7979c4-v051=100`. 소스 변경·재빌드·check 재실행 없음(1장 결과 재사용).
- 트래픽: `<서비스>-b7979c4-v051` **100%**(태그 `preview` 유지), `276157e-v051`·`965849c-v051` 0%(검증 태그). `c0ebd5b-v051`·`2970797-v051`·`b666eb1-v051`·`78a60d3-v051`·`1020200-v04`·`6f7df52`·`00001-872` 리비전과 이미지 보존. 서비스 템플릿·IAM 전환 전후 동일(JSON 대조).
- 운영 API: `smoke_api.py check <운영 주소>`(같은 기대값 48건, 헤더 검사 포함) **SMOKE PASSED** — warm 87/87, 48건 일치(지연 최소 98 · 중앙값 133 · 최대 238ms), 데이터 버전 헤더 2026-06, 부평역 PC방 300/500/1km 64.6·6 / 62.3·12 / 64.8·17, 학교구역 첫 줄, 422, 정적(`/places` GET 405)·캐시·GeoJSON. 전환 뒤 서비스 전체 ERROR·5xx 0. `/health places.enabled=false`.
- 운영 화면(등록 주소, 프로젝트 번호 형식, D-018): 앱 v0.0.15, 지도 인증 성공(다크 GL, 마커·반경 원·점포 12곳), 공유 링크로 열기 → 단일 부평역 PC방 500m 62.3·안내·주소창 결과 조건, 결과 활용 줄 [링크 복사][인쇄][보관], 탭 4개(현장 확인 3), 확인 필요 4항목, 라이트 테마 전환(지도 유지), 업데이트 내역 v0.0.15, 콘솔·처리되지 않은 오류 0. 현장 확인·보관함·다시 분석·반경 표·모바일 375 는 같은 이미지의 `preview` 주소에서 5장으로 확인했다. 문제 없음 → 복구하지 않았다.
- 복구 대상: `<서비스>-c0ebd5b-v051`(v0.0.14). `--to-revisions <서비스>-c0ebd5b-v051=100`.
- 기록: `patchNotes.json` `deployments`에 `2026-10-29-production-b7979c4`(같은 날 v0.0.13·v0.0.14 전환 기록과 구분). 미검증: 실기기·Safari·Firefox·스크린리더, 실제 인쇄 대화상자, 장소 검색 실제 호출(키 없음), 계획 1차 완료 기준의 사람 검증.
