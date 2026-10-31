# 배포 후보 무트래픽 검증 — 앱 v0.3.2 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-01)

배포 후보 = v0.3.1 운영본(`e396c85`) + 12-9 보안 헤더(`42db1d4`) + 9-C5 새 자료 알림(`f94cc36`, 서버 동작 변화 없음) + 12-29 Firebase Hosting 앞단 대응(`1c95e66`, D-042: 오류 응답 `no-store`·Firebase 프록시 경유 요청의 사용자 IP 키). 사용자 지시 "배포 후보 진행". 이 문서 시점의 운영 트래픽은 `<서비스>-e396c85-v051`(v0.3.1) 100% 그대로다. 엔진·데이터(2026-09)는 운영과 같아 점수는 바뀌지 않는다.

## 1. 검증 (최종 소스 `1c95e66`, 규칙 F)
- 전체 check `--jobs 5` **1회차 19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 258 passed/1 skipped · frontend 65파일 1,022 · patch-notes, 441초). 로그 `.gstack/check-logs/v032-1c95e66-full.log`(git 제외).
- E2E `--only e2e` **5흐름 PASS**(57초, 1회차).
- 보호 경로 변경 0.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-1c95e66/`(git 제외): `git -c core.autocrlf=false archive 1c95e66` → 추출 뒤 blob 대조 1,110개 중 차이 2개 = `.gitattributes` `eol=crlf` 보호 원본(부평역_업종별_적합도.csv 두 벌, 작업 트리와 바이트 동일 — 의도된 차이).
- 데이터 2026-09 파일 8개 + 공고 스냅샷(`build_support_snapshot.py --secrets`, 543건 = 기업마당 425 + K-Startup 128, 05:01 기준) + 역 승하차 자료를 컨텍스트에 넣음. 첫 빌드는 데이터 파일 복사가 빠져(앞 단계 종료 코드로 복사가 건너뜀) sha256 검사에서 **실패** — 복사 뒤 다시 빌드 "data version 2026-09 roles 8 bad []". push digest `sha256:d9c2b50ad2e198aed7e933b3b599825b195bb2b285fc659a0fe12a8d3a5d20e0`.

## 3. 무트래픽 리비전 `<서비스>-1c95e66-v051`
- `deploy_cloud_run.py candidate 1c95e66 --ai --support --apply`(최소 0·최대 1·CPU 상시·Secret 3개 이름만), 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(기대값 = e396c85 때 만든 데이터 2026-09·엔진 v0.5.1 기대값 재사용 — 엔진·데이터 입력이 같다): 첫 실행은 warm 3/87 에서 돌려 **"warm 미완료" 1건 실패**, warm 87/87 확인 뒤 재실행 **SMOKE PASSED** — 48건 불일치 0(지연 최소 116 · 중앙값 147 · 최대 260ms), `/rank` 29개 일치, `/insights` 가까운 역 부평·20, `/health support` 543건(두 자료원 ok).
- 헤더: `/` 에 HSTS·nosniff·Referrer-Policy, 404 에 `Cache-Control: no-store`. 리비전 ERROR·5xx 0.

## 4. Firebase 경유 확인 (D-042)
- 임시 미리보기 채널(`v032-verify`, rewrite `tag: preview`)을 만들어 후보로 보냄 — 응답에 새 보안 헤더(후보 확인).
- **사용자 IP 키**: 같은 PC(IPv4)에서 채널로 `POST /support/match` 250회(8개 동시) → 240회 422 + 10회 429(분당 240 — Firebase 프록시 주소가 요청마다 달라도 한 사용자로 묶임). 이어서 같은 PC에서 후보 주소로 직접 1회 → 429(직접·경유가 같은 키), `Fastly-Client-IP: 9.9.9.9` 를 꾸민 직접 요청도 429(꾸민 값 무시).
- 확인 뒤 채널 삭제.

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공)
- 번들에 v0.3.2. 좌표 입력 부평1동(37.4894, 126.7246) 카페 500m: 종합 60.3, "데이터 묶음 2026-09", 가까운 역 부평역, AI 요약(지원사업 근거 포함). 콘솔 오류 0.

## 6. 다음 (승인 필요)
- 전환: `python scripts/deploy_cloud_run.py switch <서비스>-1c95e66-v051 --apply` → 운영 smoke(같은 기대값) → 화면 → 기록.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-e396c85-v051 --apply`(v0.3.1).
- Firebase 기본 주소는 전환과 동시에 새 리비전을 따른다(`pinTag` 없음). 그 주소의 지도는 NAVER 콘솔 등록(사용자) 뒤 동작한다.
