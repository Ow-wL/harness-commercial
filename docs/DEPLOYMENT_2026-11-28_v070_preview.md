# 운영 전환 기록 — 앱 v0.7.0 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-28 · **운영 전환 4장**)

배포 후보 = v0.6.1 운영본(`7e21393`) 뒤 화면 개편 1~3단계와 4단계 일부: 13-53 새 로고·Pretendard·다크 색(`aa8364a`, D-051), 13-54 점수 고리·관점 고리(`4bd17cf`, D-052), 13-55 결과 구역 탭 5개(`643ccbe`·`cd6c041`, D-053), 13-56 분석 전 화면 제목·분석하기 버튼(`bbda097`). 사용자 지시 "먼저 배포". `7e21393` 대비 바뀐 코드는 프런트와 `scripts/build_share_assets.py`뿐 — 백엔드·엔진·데이터·AI 프롬프트는 같다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `bbda097` | 전체 check `--jobs 5` 1회차 | **무효** — 프로젝트 `.venv` 가 아닌 시스템 Python 으로 실행해 Python 단계 5개가 의존성 누락(`openpyxl`)으로 실패(실행 실수). 프런트·패치노트 단계는 PASS |
| `bbda097` | 전체 check `--jobs 5` 2회차(`.venv`) | **18단계 PASS · 1단계 FAIL**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 259 passed/1 skipped · patch-notes PASS, 670.8초). FAIL = frontend 1,093건 중 1건 — `MapView.test.tsx` "인증 실패 뒤 지도 다시 불러오기 … 선택은 그대로"의 마지막 확인(새 지도에 선택 마커) |
| `bbda097` | 그 테스트 파일 단독 3회 | 3회 모두 111건 PASS |
| `bbda097` | `--only frontend` 재실행 1회 | PASS(74파일 1,093건) — 전체 check 아님 |
| `bbda097` | E2E `--only e2e` | 5흐름 PASS |

- **전체 check 가 한 번에 모든 단계를 통과한 실행은 없다.** 같은 소스에서 Python 단계는 2회차에, 프런트 단계는 1회차와 재실행에서 통과했다.
- 실패 1건의 판단: `MapView.tsx`·그 테스트는 이번 후보에서 바뀌지 않았다. 테스트가 지도 생성(`maps` 2개)만 기다린 뒤 마커 생성을 바로 확인하는데, 마커는 지도 생성과 다른 effect 에서 그린다 — 동시 실행 부하에서 순서가 밀린 간헐 실패로 **추정**한다(원인 확정 아님). 후속: 그 확인을 `waitFor` 로 감싸기.
- 로그 `.gstack/deploy-bbda097/check.log`·`check-wrong-python.log`·`check-frontend-rerun.log`·`e2e.log`(git 제외). 보호 경로 변경 0. 작업 트리의 `docs/presentation/` 발표 자료(사용자 파일, 미커밋)는 배포 소스에 들어가지 않는다.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-bbda097/`: `git -c core.autocrlf=false archive bbda097` → blob 대조 1,172개 중 차이 2개 = `eol=crlf` 보호 원본(의도된 차이)·추가 0·누락 0. (처음에 `core.autocrlf` 를 끄지 않고 묶어 593개가 줄바꿈 변환돼 버리고 다시 만들었다.)
- 데이터 2026-09(직전 컨텍스트·저장소 원본과 해시 일치), 공고 스냅샷 498건(기업마당 401 · K-Startup 105, **2026-11-28 14:57 기준**).
- 빌드 "data version 2026-09 roles 8 bad []". 첫 빌드 시도는 Docker Desktop 이 꺼져 있어 실패 — 켠 뒤 다시 빌드. push digest `sha256:e72d52277b3b4b2952d82cbe77ed661a9c0423bc1efe98e4fc8548f6a1b57646`.

## 3. 무트래픽 리비전 `<서비스>-bbda097-v051`
- `deploy_cloud_run.py candidate bbda097 --ai --support --places --apply`, 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값): 1회차 **FAILED 1건** — "warm 미완료 5/87"(새 인스턴스 준비 중, 점수 불일치 0). `--wait-warm 540` 으로 다시 **SMOKE PASSED**: 48건 불일치 0(지연 최소 122 · 중앙값 141 · 최대 255ms), warm 87/87, AI budget ok.
- 화면(preview 주소, 내장 브라우저 1366 다크, 부평역 · 카페 · 500m 공유 링크): 새 로고, Pretendard 적용, 점수 고리 60.1 · 관점 고리 5개, 구역 탭 5개(다섯 관점 · AI 요약 · 시간대와 사람 · 지원사업 · 더 보기) — 탭마다 한 구역만 보이고 AI 요약·지원사업·더 보기 구역에 내용 표시(로컬에서 못 본 AI·지원사업 구역을 여기서 처음 확인). 콘솔 오류 0, 리비전 ERROR·5xx 0.

## 4. 운영 전환 (2026-11-28 15:37 KST)
- `python scripts/deploy_cloud_run.py switch <서비스>-bbda097-v051 --apply`: 전환 전 `7e21393-v051` 100%, 전환 뒤 `bbda097-v051` 100%·서비스 `minScale` 1. 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 129 · 중앙값 149 · 최대 246ms), warm 87/87. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json`·`/favicon.svg` 200, 띠 색 `#07080A`.
- 화면(Firebase 짧은 주소): 점수 고리 60.1, 구역 탭 5개, Pretendard, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-7e21393-v051 --apply`(v0.6.1 — 이전 결과 화면으로 돌아간다).
- 미검증: 실기기·Safari·Firefox·스크린리더, 라이트 모드의 새 요약, mobile 폭의 운영 화면, 비교 A/B 전체 결과, 인쇄 화면, "지원사업 보기" 이동의 운영 동작. NAVER 다크 지도 스타일은 아직 남색(재발행은 사용자 작업).
- 알려진 것: "자세히 보기"를 누르면 구역 탭이 시트 맨 위까지 오지 않고 중간에 멈춘다(13-55). 전체 check 간헐 실패 1건(1장).
