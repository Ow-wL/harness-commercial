# 운영 전환 기록 — 앱 v0.7.5 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-29 · **운영 전환 4장**)

배포 후보 = v0.7.4 운영본(`8d013c5`) 뒤: 13-67 글자 전체 +2px·참고 문구 진하게·관점 점수 칸 넓힘(`ef50503`, D-061). 엔진·데이터·API 는 그대로다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `ef50503` | 전체 check `--jobs 5`(`.venv`) 1회 | **19단계 모두 PASS**(frontend 74파일 1,100건 포함, 684.5초). 재실행 없음 |
| `ef50503` | E2E `--only e2e` 1회 | 5흐름 PASS(1.3분) |

- 로그 `.gstack/deploy-ef50503/`(git 제외). 보호 경로 변경 0.

## 2. 이미지
- `git -c core.autocrlf=false archive ef50503` → blob 대조 1,178개 중 차이 2개 = `eol=crlf` 보호 원본(의도된 차이)·추가 0·누락 0.
- 데이터 2026-09(저장소 원본과 해시 일치), 공고 스냅샷 495건(기업마당 399 · K-Startup 104, **2026-11-29 02:24 기준**).
- 지도 build arg 3개(v0.7.4 와 같은 값). push digest `sha256:a59ec9ed3ed5a44b70175ee237c35d8ffd1e79be0fe6841c34e96e2a4b4b9826`.

## 3. 무트래픽 리비전 `<서비스>-ef50503-v051`
- `deploy_cloud_run.py candidate ef50503 --ai --support --places --apply`, 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값, `--wait-warm 540`) 1회 **SMOKE PASSED**: 48건 불일치 0(지연 최소 109 · 중앙값 128 · 최대 215ms).
- 화면(preview 주소, 내장 브라우저 좁은 폭 800px, 부평역 · 노래방 공유 링크): 로컬에 없던 "지원사업" 탭(공고 카드)과 "AI 요약" 탭(좋은 점·주의할 점 카드)이 커진 글자로 넘침 없이 뜬다, 콘솔 오류 0.

## 4. 운영 전환 (2026-11-29 02:31 KST, 사용자 승인 "확정, 배포해")
- `python scripts/deploy_cloud_run.py switch <서비스>-ef50503-v051 --apply`: 전환 뒤 `ef50503-v051` 100%.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 111 · 중앙값 129 · 최대 233ms), warm 87/87. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json`·`/favicon.svg` 200.
- 화면(Firebase 짧은 주소): "부평구 부평1동 · 노래방 분석", 참고 문구 15px, `--text-small` 15px/22px, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-8d013c5-v051 --apply`(v0.7.4 — 이전 글자 크기).
- 미검증: 비교 화면·인쇄의 커진 글자, 실기기·Safari·Firefox·스크린리더. 휴대폰 폭의 "이 점수는?" 버튼 글자가 칸보다 살짝 넓게 잡힌다(화면에서 잘려 보이지는 않음).
