# 운영 전환 기록 — 앱 v0.7.2 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-28 · **운영 전환 4장**)

배포 후보 = v0.7.1 운영본(`447a68d`) 뒤: 13-62 전시 모드는 주소로만·업종 지도 켜고 끄기·다크 지도 밝기(`bf6a3b2`, D-058), 지도 스타일 색 정리표(`b59664c`), 13-63 Style Editor 무채색 스타일 적용·화면 필터 제거·스타일 판정 보강(`402f92a`, D-059), 13-64 vitest 기본 시간 제한 15초(`7feac49`). 엔진·데이터·API 는 그대로다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `402f92a` | 전체 check `--jobs 5`(`.venv`) 1회 | **18단계 PASS · 1단계 FAIL**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 259 passed/1 skipped · patch-notes PASS, 1,058.6초). FAIL = frontend 1,100건 중 1건 — `ScoreGuide.test.tsx` "5개 관점 모두 아코디언…" 5초 시간 초과 |
| `402f92a` | 그 테스트 파일 단독 2회 | 2회 모두 11건 PASS |
| `7feac49`(= `402f92a` + `vite.config.ts` 의 `testTimeout: 15000`) | `--only frontend,patch-notes` 1회 | PASS(74파일 1,100건) — 전체 check 아님 |
| `402f92a` | E2E `--only e2e` 1회 | 5흐름 PASS |

- **전체 check 가 한 번에 모든 단계를 통과한 실행은 없다.** Python 단계는 `402f92a` 에서, 프런트 단계는 `7feac49` 에서 통과했다. 두 커밋의 차이는 vitest 설정 한 줄(테스트 시간 제한)뿐이라 Python 단계·E2E 결과를 재사용했다.
- 실패 1건의 판단: 전체 check 중 배포 폴더 준비(압축·해시·공고 수집)를 함께 돌려 부하가 컸다(직전 실행 758초 → 1,058초). 같은 날 서로 다른 긴 흐름 테스트 세 개가 같은 식으로 5초를 넘겨, 개별 처리 대신 기본 시간 제한을 15초로 올렸다(13-64). 테스트 내용·제품 코드는 그대로.
- 로그 `.gstack/deploy-7feac49/check-402f92a.log`·`check-frontend-rerun.log`·`e2e.log`(git 제외). 보호 경로 변경 0.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-7feac49/`: `git -c core.autocrlf=false archive 7feac49` → blob 대조 1,175개 중 차이 2개 = `eol=crlf` 보호 원본(의도된 차이)·추가 0·누락 0.
- 데이터 2026-09(저장소 원본과 해시 일치), 공고 스냅샷 498건(기업마당 401 · K-Startup 105, **2026-11-28 22:16 기준**).
- 지도 build arg 3개: 클라이언트 ID · 다크 스타일 ID(새로 발행한 무채색 스타일) · **라이트 스타일 ID(처음 넣음)**. push digest `sha256:3233276cefb4cc45a298c0160e2a217782bcf1e8c7e31251a95cb108a428c486`.

## 3. 무트래픽 리비전 `<서비스>-7feac49-v051`
- `deploy_cloud_run.py candidate 7feac49 --ai --support --places --apply`, 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값, `--wait-warm 540`) 1회 **SMOKE PASSED**: 48건 불일치 0(지연 최소 143 · 중앙값 163 · 최대 291ms), warm 87/87.
- 화면(preview 주소, 내장 브라우저 좁은 폭 608px):
  - 다크·라이트 모두 새 무채색 스타일(GL)로 뜬다. 캔버스 필터 없음.
  - 테마 전환 3회 연속 GL 유지, 콘솔 경고 0(수정 전 로컬에서는 전환마다 번갈아 기본 밝은 지도로 떨어졌다).
  - 업종을 고르면 "업종 지도 보기" 칩, 누르면 업종 지도(가는 경계선, 무채색 바탕 위 파랑·주황 구간)와 닫기.

## 4. 운영 전환 (2026-11-28 22:50 KST, 사용자 승인 "확인하고 배포해줘")
- `python scripts/deploy_cloud_run.py switch <서비스>-7feac49-v051 --apply`: 전환 뒤 `7feac49-v051` 100%·서비스 `minScale` 1. 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 144 · 중앙값 166 · 최대 279ms), warm 87/87. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json`·`/favicon.svg` 200.
- 화면(Firebase 짧은 주소, 좁은 폭 다크, 부평역 · 카페 공유 링크): 종합 59.9 결과 화면, 새 다크 스타일 GL, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-447a68d-v051 --apply`(v0.7.1 — 이전 지도 스타일 ID 와 화면 필터로 돌아간다. 예전 다크 스타일은 Style Editor 에 그대로 있다).
- 미검증: 운영 주소의 넓은 폭·라이트 모드·업종 지도(후보 주소에서 확인), 전시 모드(`?kiosk=1`) 실제 자동 시연, 실기기·Safari·Firefox·스크린리더, 인쇄.
- 알려진 것: 새 지도 스타일에 음식점 등 일반 POI 표시가 켜져 있어 점포 점과 겹쳐 보일 수 있다(스타일 설정 — 사용자 작업).
