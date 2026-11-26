# 운영 전환 기록 — 앱 v0.4.3 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-26 · **운영 전환 4장**)

배포 후보 = v0.4.2 운영본(`151ca36`) 뒤 v0.4.2 배포 기록(`2d0665b`)·README 역할 단락(`b51f537`) 문서 커밋 + 13-49 첫 방문 테마 다크(`15ad44e`, D-047: 저장된 선택이 없으면 시스템 `prefers-color-scheme` 과 상관없이 다크, 고른 라이트·다크는 유지). 사용자 지시 "커밋·배포 진행"(요청: "처음 접속했을 때 화이트 모드로 나오는데 기본 나이트모드로"). `151ca36` 대비 바뀐 코드는 `frontend/src/lib/theme.ts`·`frontend/index.html`(첫 그리기 스크립트)·테스트 2개뿐 — 백엔드·엔진·데이터·AI 프롬프트는 같아 점수·AI 요약 캐시는 그대로다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `15ad44e` | 전체 check `--jobs 5` | **19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 258 passed/1 skipped · frontend 1,067 · patch-notes, 835.3초) |
| `15ad44e` | E2E `--only e2e` | 5흐름 PASS(1.5분) |

- 로그 `.gstack/deploy-15ad44e/check.log`·`e2e.log`(git 제외). 보호 경로 변경 0. 작업 트리의 `docs/presentation/` 발표 자료(사용자 파일, 미커밋)는 배포 소스(`git archive`)에 들어가지 않는다.
- 커밋 전 변경별 검증(B): 프런트 테스트 1,065·typecheck·lint·build, 로컬 production 미리보기에서 시스템 라이트 흉내 + 저장값 없음 → 다크, 라이트 선택 뒤 새로고침 → 라이트.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-15ad44e/`(git 제외): `git -c core.autocrlf=false archive 15ad44e` → 추출 뒤 blob 대조 1,148개 중 차이 2개 = `.gitattributes` `eol=crlf` 보호 원본(직전 배포와 같은 의도된 차이)·추가 0·누락 0.
- 데이터 2026-09 파일(저장소 `data/versions/2026-09` 와 동일) + 역 승하차 자료(커밋 그대로).
- **공고 스냅샷 새로 받음**: `build_support_snapshot.py --secrets` 1회 성공 — 518건(기업마당 415 + K-Startup 111), **2026-11-26 18:14 기준**(11-10 배포 때의 기업마당 오류는 해소).
- 빌드 "data version 2026-09 roles 8 bad []", 지도 build arg 2개(값 기록 안 함). push digest `sha256:8545bef180f73f238522d4d01786b0ca710ed50e50fbe2479ac0890e7d07d82f`.

## 3. 무트래픽 리비전 `<서비스>-15ad44e-v051`
- `deploy_cloud_run.py candidate 15ad44e --ai --support --apply`(최소 0·최대 1·CPU 상시·Secret 3개 이름만), 태그 `preview`, 트래픽 0.
- `/health` warm 87/87 · AI budget ok · 지원사업 518건(18:14 기준) 확인 뒤 `smoke_api.py check`(`e396c85` 의 데이터 2026-09·엔진 v0.5.1 기대값) **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 126 · 중앙값 150 · 최대 285ms), `/rank` 29개, 가까운 역 부평·20.
- 화면(preview 등록 주소, 내장 브라우저 1440×900, **시스템 라이트 흉내**): 저장값 없음 → `data-theme="dark"`(배경 다크), 라이트 버튼 → 저장 `light` → 다시 열어도 라이트. 부평1동 PC방 500m 결과 62.4, 지도 인증 성공, 콘솔 오류 0, 번들 최신 `v0.4.3`. 리비전 ERROR·5xx 0.

## 4. 운영 전환 (2026-11-26 18:39 KST)
- `python scripts/deploy_cloud_run.py switch <서비스>-15ad44e-v051 --apply`: 전환 전 `151ca36-v051` 100%, 전환 뒤 `15ad44e-v051` 100%·서비스 `minScale` 1, 최신 생성 리비전 그대로(새 리비전 안 생김). 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check`(같은 기대값) **SMOKE PASSED**: 48건 불일치 0(지연 최소 124 · 중앙값 154 · 최대 290ms), `/rank` 29개, 가까운 역 부평·20. Firebase 기본 주소 `/health`·`/heatmap.json` 200.
- 화면(시스템 라이트 흉내, 저장값 없음): 사용자가 알린 짧은 주소(Firebase) 첫 화면 다크·번들 `v0.4.3`, 등록 운영 주소 다크·지도 톤 dark·부평1동 PC방 62.4·콘솔 오류 0. 전환 뒤 리비전 ERROR·5xx 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-151ca36-v051 --apply`(v0.4.2).
- 이 배포 도중(18:3x) 로컬 master 에 13-50 커밋 `04d351a`·`0a3b7f2`(앱 v0.5.0, D-048)가 생겼다 — 이미지는 `15ad44e` 아카이브로 만들었으므로 운영에 들어가지 않았다(운영 번들 최신 `v0.4.3` 확인).
- 미검증: 실기기(라이트 설정 휴대폰)·Safari·Firefox. 이미 라이트를 골라 둔 방문자는 저장값대로 라이트로 열린다(의도, D-047).
