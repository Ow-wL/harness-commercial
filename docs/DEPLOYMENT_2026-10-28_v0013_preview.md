# 배포 후보 무트래픽 검증 — 앱 v0.0.13 + 엔진 v0.5.1 (2026-10-28, **트래픽 전환 미실행**)

배포 후보 = v0.0.12 운영본 + 결과마다 데이터 버전·"데이터 YYYY-MM 기준" 표시(9-C4, D-033) + 점검 도구(check `--jobs`, API smoke, E2E — 화면 영향 없음). 사용자 지시 "v0.0.13 배포 후보". 운영 트래픽은 `<서비스>-b666eb1-v051`(앱 v0.0.12) 100% 그대로 — **운영 반영 아님**.

## 1. 검증 (배포 후보 `2970797`, 규칙 F — D-032·D-034·D-035)
- 전체 check `scripts/check.py --jobs 5`: **19단계 1회 통과**, 재실행·SKIP 없음, 632초(core 381 · v0_4 61 · v0_5 104 · v0_5_1 40 · backend 142 · frontend 818 · patch-notes). 로그 `.gstack/check-logs/v0013-full-check.log`(git 제외).
- E2E `scripts/check.py --only e2e`: 4흐름 1회 통과(92.6초).

## 2. 이미지
- 소스 `2970797029d5009fc959e8c53e7f39086edc3fe1`, `git archive` 컨텍스트 커밋 대조 차이 0·추가 파일 0. 태그 `:2970797`, revision label = 위 커밋, linux/amd64, 지도 설정은 운영용 build arg(값 기록 안 함). 번들에 `v0.0.13`, backend 에 `X-Data-Version` 확인.
- index `sha256:b93db1b8eee2770e8bb6e924650c3ece4728fa216d9f225552e7093be7aa235d`
- linux/amd64 `sha256:dac64384c7c073786c22f8816eae7c9a1489a7382fbe90fe434ccf6410b486cc`

## 3. 무트래픽 리비전
- `<서비스>-2970797-v051`, 고정 태그 `preview`(이 리비전으로 옮김), `--no-traffic`, `SCORING_ENGINE_VERSION=v0_5_1`, 모든 gcloud 명령에 프로젝트·리전 명시. 템플릿은 `b666eb1`과 이미지 외 동일, IAM 변경 없음. 기존 리비전·이미지 보존.

## 4. API — `scripts/smoke_api.py check`(헤더 검사 포함) **SMOKE PASSED**
- 기대값: 같은 소스·엔진 v0_5_1 로 만든 48건(`smoke_api.py expected`, 2026-10-28). warm 87/87(`--wait-warm 600` 안에 완료), 48건 일치(불일치 0, 지연 중앙값 131ms), 모든 성공 응답 `X-Data-Version` = `/health data.version` = `2026-06`, 부평역 PC방 300/500/1km 64.6·6 / **62.3·12** / 64.8·17(동종 = 목록), 학교구역 첫 줄, 422 `invalid_radius`, 정적 경로·캐시·GeoJSON 일치. ERROR 로그 0, 메모리 최대 약 29%.

## 5. 화면 (preview 주소 — NAVER 등록, 인증 성공)
- 앱 v0.0.13, 지도 인증 성공, 라이트/다크 전환(지도 유지). 단일 부평역 PC방 500m 62.3, 머리줄 **"분석 결과 · 반경 500m · 데이터 2026-06 기준"**, 데이터 출처 표 기준일이 서버 메타로 채워짐(2026-06-30·2026-08-31, 2024·2026-08·2024-12 / 2026-03·2026-05-07·2026-09-29·2026년 2분기), "이 결과는 데이터 2026-06 기준입니다." A/B 비교(B 학교 50m) 500m 62.3 / 67.2, 비교 머리줄 "… · 반경 500m · 데이터 2026-06 기준", 비교 중 1km 64.8 / 68.9. 업데이트 내역 v0.0.13 맨 위. 콘솔·처리되지 않은 오류 0.
- 미검증: 모바일 실기기·Safari·Firefox·스크린리더(모바일 375 결과 시트는 E2E 로 확인).

## 6. 다음 (승인 필요)
- 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-2970797-v051=100` → 등록 운영 주소 확인 + `smoke_api.py check <운영 주소>` → `deployments` 운영 전환 기록.
- 복구: `--to-revisions <서비스>-b666eb1-v051=100`(v0.0.12).
