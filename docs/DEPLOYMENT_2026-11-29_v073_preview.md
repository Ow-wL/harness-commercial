# 운영 전환 기록 — 앱 v0.7.3 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-29 · **운영 전환 4장**)

배포 후보 = v0.7.2 운영본(`7feac49`) 뒤: 13-65 인천 외곽선·구 경계를 가늘고 옅은 무채색 선으로(`0ccb869`), 새 지도 스타일의 일반 POI 는 켜 둔다는 결정 기록(`8390969`, 문서만). 엔진·데이터·API 는 그대로다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `0ccb869` | 전체 check `--jobs 5`(`.venv`) 1회 | **19단계 모두 PASS**(v0.3 · v0.4 · v0.5 · v0.5.1 · backend · frontend 74파일 1,100건 · patch-notes, 585.1초). 재실행 없음 |
| `0ccb869` | E2E `--only e2e` 1회 | 5흐름 PASS(1.1분) |

- 지난 배포에서 시간 초과가 났던 점을 감안해 check 는 다른 작업 없이 단독으로 돌렸다. 로그 `.gstack/deploy-0ccb869/`(git 제외). 보호 경로 변경 0.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-0ccb869/`: `git -c core.autocrlf=false archive 0ccb869` → blob 대조 1,176개 중 차이 2개 = `eol=crlf` 보호 원본(의도된 차이)·추가 0·누락 0.
- 데이터 2026-09(저장소 원본과 해시 일치), 공고 스냅샷 495건(기업마당 399 · K-Startup 104, **2026-11-29 00:49 기준**).
- 지도 build arg 3개(클라이언트 ID · 다크 · 라이트 스타일 ID, v0.7.2 와 같은 값). push digest `sha256:dc73652013f249b6cd808e3508b411f85daad150e1969f5bb56c73219ee80d12`.

## 3. 무트래픽 리비전 `<서비스>-0ccb869-v051`
- `deploy_cloud_run.py candidate 0ccb869 --ai --support --places --apply`, 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값, `--wait-warm 540`) 1회 **SMOKE PASSED**: 48건 불일치 0(지연 최소 113 · 중앙값 145 · 최대 262ms).
- 화면(preview 주소, 내장 브라우저 800px 다크): 새 다크 스타일 GL, 인천 외곽선·구 경계가 가늘고 옅은 흰 선, 콘솔 오류 0.

## 4. 운영 전환 (2026-11-29 00:58 KST, 사용자 승인 "좋아, 배포해" · "이어서 전환해")
- `python scripts/deploy_cloud_run.py switch <서비스>-0ccb869-v051 --apply`: 전환 뒤 `0ccb869-v051` 100%.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 115 · 중앙값 145 · 최대 258ms), warm 87/87. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json`·`/favicon.svg` 200.
- 화면(Firebase 짧은 주소, 다크, 부평역 · 카페 공유 링크): 종합 59.9 결과 화면, 새 다크 스타일 GL, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-7feac49-v051 --apply`(v0.7.2 — 이전 경계선 색·굵기로 돌아간다).
- 미검증: 운영 주소의 라이트 모드 경계선(로컬에서만 확인), 분석 뒤 행정동 점선, 실기기·Safari·Firefox·스크린리더, 인쇄.
