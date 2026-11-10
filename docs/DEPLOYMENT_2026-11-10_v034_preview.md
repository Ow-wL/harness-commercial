# 운영 전환 기록 — 앱 v0.3.4 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-10 · **운영 전환 5장**)

배포 후보 = v0.3.3 운영본(`9e96e6f`) 뒤 문서 커밋(`97cb59d`) + 13-45 위치 핀 로고(`875ebed`). 사용자 지시 "바로 할 수 있는 3개 바로 진행해줘"(로고 v0.3.4 푸시·배포, README 캡처, 발표 폴더 정리). 바뀐 것은 브라우저 탭 아이콘(`public/favicon.svg`)과 조건 바 로고(인라인 SVG)뿐이다. 엔진·데이터(2026-09)·API 는 운영과 같아 점수는 바뀌지 않는다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `875ebed` | 전체 check `--jobs 5` | **19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 258 passed/1 skipped · frontend 66파일 1,038 · patch-notes, 607.3초) |
| `875ebed` | E2E `--only e2e` | 5흐름 PASS(77.6초) |

- 로그 `.gstack/check-logs/v034-*.log`(git 제외). 보호 경로 변경 0. 프런트 이외 서버·엔진·데이터 변경 0.
- 로고 단위 검증(커밋 전, 2026-11-02): 관련 vitest 3파일 207건, typecheck, lint, production build, 로컬 개발 서버 라이트·다크 로고 22×22px·색 확인.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-875ebed/`(git 제외): `git -c core.autocrlf=false archive 875ebed` → 추출 뒤 blob 대조 1,125개 중 차이 2개 = `.gitattributes` `eol=crlf` 보호 원본(직전 배포와 같은 의도된 차이).
- 데이터 2026-09 파일 + 공고 스냅샷(`build_support_snapshot.py --secrets`, 557건 = 기업마당 436 + K-Startup 131, 2026-11-10 16:04 기준) + 역 승하차 자료(커밋 그대로). 처음에 역 자료 2개를 작업 폴더 사본(줄바꿈 변환)으로 덮어썼다가 커밋 원본으로 되돌리고 추적 파일 전체를 다시 대조했다(차이 = 위 2개뿐).
- 첫 빌드는 Docker Desktop 이 꺼져 있어 **실패**(엔진 연결 불가) — 켠 뒤 다시 빌드 "data version 2026-09 roles 8 bad []". push digest `sha256:efc80946eeea17559e3503ab838f73b83284b28f12b7f3c2cb9fd4abcf31a98a`.

## 3. 무트래픽 리비전 `<서비스>-875ebed-v051`
- `deploy_cloud_run.py candidate 875ebed --ai --support --apply`(최소 0·최대 1·CPU 상시·Secret 3개 이름만), 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(기대값 = e396c85 때 만든 데이터 2026-09·엔진 v0.5.1 기대값 재사용 — 엔진·데이터 입력이 같다):
  - 1회차 **FAILED** — 리비전이 막 켜져 warm 3/87 에서 대조했다(실패 항목은 warm 미완료 1건뿐).
  - `/health` warm 87/87 을 기다린 뒤 2회차 **SMOKE PASSED**: 48건 불일치 0(지연 최소 116 · 중앙값 135 · 최대 229ms), `/rank` 29개 일치, `/insights` 가까운 역 부평·20, AI budget ok.
- 리비전 ERROR·5xx 0.

## 4. 화면 (preview 등록 주소, 인증 성공)
- Playwright(Chromium) 1440×900 다크, 실제 NAVER 지도: 지도 인증 성공(래스터), 조건 바 로고 = 위치 핀 22×22px, `/favicon.svg` 위치 핀, 부평1동 카페 500m 종합 60.3·가까운 역 부평역·AI 요약·지원사업 카드, 업데이트 내역 최신 v0.3.4, 콘솔 오류 0.
- 내장 브라우저 패널은 가려진 상태라 지도가 "불러오는 중"에 머물러(백그라운드 페이지) 판정에 쓰지 않았다.

## 5. 운영 전환 (2026-11-10 16:35 KST, 사용자 지시 "바로 진행해줘")
- `python scripts/deploy_cloud_run.py switch <서비스>-875ebed-v051 --apply`: 전환 전 `9e96e6f-v051` 100% 확인, 전환 뒤 `875ebed-v051` 100%·서비스 `minScale` 1, 새 리비전 안 생김.
- 운영 주소 `smoke_api.py check`(같은 기대값) **SMOKE PASSED**: warm 87/87, `/health data` 2026-09, 48건 불일치 0(지연 최소 106 · 중앙값 139 · 최대 240ms), `/rank` 29개 일치, 가까운 역 부평·20.
- Firebase 기본 주소도 `/health` 200.
- 등록 운영 주소 화면(Playwright 1440×900 다크): 지도 인증 성공, 위치 핀 로고·favicon, 부평1동 카페 500m 60.3·AI 요약·지원사업, 업데이트 내역 v0.3.4, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-9e96e6f-v051 --apply`(v0.3.3).
- 미검증: 실기기·Safari·Firefox·스크린리더, 실제 브라우저 탭에 보이는 아이콘(헤드리스로는 `/favicon.svg` 응답만 확인).

## 6. README 캡처
- 전환 뒤 등록 운영 주소에서 4장(시작·결과·비교 라이트 1440×900, 모바일 다크 390×844 @2x)을 다시 찍어 256색으로 줄여 `docs/images/` 에 넣었다. 공유 링크로 연 화면의 "공유 링크의 조건으로 다시 분석했습니다" 안내는 반경 1km → 500m 로 같은 조건을 다시 분석해 지운 뒤 찍었다.
