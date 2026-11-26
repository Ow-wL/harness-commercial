# 운영 전환 기록 — 앱 v0.6.0 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-26 · **운영 전환 4장**)

배포 후보 = v0.5.0 운영본(`f10be10`) 뒤 v0.5.0 배포 기록 문서 커밋(`c8b54e1`) + 13-51 화면 단순화·후속 결정(`771607d`, D-049). 사용자 지시 "그 안으로 시작" → "권한 부여 후 배포". `f10be10` 대비 바뀐 코드: 프런트(결과 두 단 `FoldSection`·비교 버튼 위치·반경 한 줄·mobile 더보기 메뉴·`og:image`), 백엔드 `backend/app/places.py`(NAVER API HUB 지역 검색), 스크립트(`deploy_cloud_run.py --places`·`run_local_backend.py`·`build_share_assets.py`). 엔진·데이터·AI 프롬프트는 같아 점수·AI 요약 캐시는 그대로다.

## 0. 사전 작업 — Secret 접근 권한 (사용자 승인 "권한 부여 후 배포")
- 사용자가 등록한 Secret `naver-search-client-id`·`naver-search-client-secret` 에 Cloud Run 기본 서비스 계정의 `roles/secretmanager.secretAccessor` 가 없어(기존 Secret 3개에는 있음) 같은 계정에 두 Secret 의 읽기 권한만 부여했다. 값은 읽어 출력하지 않았다(로컬 실제 호출 확인 때 프로세스 변수로만 사용).

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `771607d` | 전체 check `--jobs 5` | **19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 259 passed/1 skipped · frontend 1,082 · patch-notes, 683.6초) |
| `771607d` | E2E `--only e2e` | 5흐름 PASS(1.2분) |

- 로그 `.gstack/deploy-771607d/check.log`·`e2e.log`(git 제외). 보호 경로 변경 0. `docs/presentation/` 발표 자료(사용자 파일, 미커밋)는 배포 소스에 들어가지 않는다.
- 커밋 전: 프런트 테스트에서 2건(인쇄 규칙 위치·지원사업 줄 펼치기), E2E 에서 1건(mobile 에서 테마 버튼이 더보기 메뉴 안으로 이동)이 실패해 새 구조에 맞게 고친 뒤 통과. Codex 교차 검토 1회(읽기 전용) — 탭 4개는 접힌 줄로 바꾸지 않고, 반경은 숨기지 않고 한 줄로 접고, 줄은 따로 펼치게 반영.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-771607d/`: `git archive 771607d` → blob 대조 1,167개 중 차이 2개 = `eol=crlf` 보호 원본(직전과 같은 의도된 차이)·추가 0·누락 0.
- 데이터 2026-09 파일(직전 배포 컨텍스트와 해시 일치) + 역 승하차 자료. **공고 스냅샷 새로 받음** — 518건(기업마당 415 + K-Startup 111), 2026-11-26 19:58 기준.
- 빌드 "data version 2026-09 roles 8 bad []", 지도 build arg 2개(값 기록 안 함). push digest `sha256:41fe12b5142fe1641ae13f38941e4e09afa92aea5afb4579bed9b454d78e5c93`.

## 3. 무트래픽 리비전 `<서비스>-771607d-v051`
- `deploy_cloud_run.py candidate 771607d --ai --support --places --apply`(Secret 5개 이름만), 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값) **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 119 · 중앙값 149 · 최대 282ms), `/rank` 29개, AI budget ok.
- 장소 검색: `/health` `places.enabled` true, `POST /places` "부평역" 5건(첫 결과 부평역 1호선, 좌표 정상).
- 화면(preview 주소): 번들 `v0.6.0`, 산곡3동 카페 51.5, "더 알아보기" 줄 3개, 비교 버튼이 결과 활용 줄에 있고 넓은 화면에 아래 고정 행 없음, `/og.png` 200, 콘솔 오류 0. 375×812: 조건 바 96px(2줄), 더보기 메뉴 열림, 가로 넘침 없음, 44px 미만 조작 0. 리비전 ERROR·5xx 0.

## 4. 운영 전환 (2026-11-26 20:17 KST)
- `python scripts/deploy_cloud_run.py switch <서비스>-771607d-v051 --apply`: 전환 전 `f10be10-v051` 100%, 전환 뒤 `771607d-v051` 100%·서비스 `minScale` 1, 최신 생성 리비전 그대로. 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED**: 48건 불일치 0(지연 최소 122 · 중앙값 146 · 최대 264ms), `/rank` 29개. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json`·`/heatmap.json` 200, `POST /places` "인천시청" 5건.
- 화면(Firebase 짧은 주소): 번들 `v0.6.0`, 위치 입력 방법에 "장소 이름", "분석 반경 500m · 바꾸기" 한 줄, 지도 인증 성공, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-f10be10-v051 --apply`(v0.5.0 — 장소 검색 없이 돌아간다).
- 미검증: 실기기·Safari·Firefox·스크린리더, 메신저(카카오톡 등)에서 링크 미리보기 이미지가 실제로 뜨는지.
- 후속 후보: 위치 입력 방법 4개(지도·주소·장소 이름·좌표)가 좁은 패널에서 두 줄 — 주소·장소 이름 통합 검색, 결과 아래 탭 4개 정리.
