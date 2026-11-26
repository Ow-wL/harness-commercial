# 운영 전환 기록 — 앱 v0.5.0 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-26 · **운영 전환 4장**)

배포 후보 = v0.4.3 운영본(`15ad44e`) 뒤 13-50 상용 수준 다듬기(D-048) 커밋 `04d351a`·`0a3b7f2`·`f10be10` + v0.4.3 배포 기록 문서 커밋(`d28c91d`). 사용자 지시 "배포 준비" → "check 되면 바로 배포해줘". `15ad44e` 대비 바뀐 코드는 프런트(`frontend/src`·`frontend/index.html`·`frontend/public` 아이콘·manifest)와 `scripts/build_share_assets.py` 뿐 — 백엔드·엔진·데이터·AI 프롬프트는 같아 점수·AI 요약 캐시는 그대로다.

담긴 것: 터치 목표 44px(`styles/touch.css`)·최소 글자 12px·"아래에 더 있어요" 반 화면 뒤 숨김·서비스 안내 창·AI 질문 보관 고지 위치·링크 복사 안내, 현재 위치로 고르기, 홈 화면 아이콘·`manifest.json`·`theme-color`, 관점 행 구분점 수정, AI 요약을 다섯 관점 바로 아래로(사용자 결정).

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `f10be10` | 전체 check `--jobs 5` | **19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 258 passed/1 skipped · frontend 1,077 · patch-notes, 872.8초) |
| `f10be10` | E2E `--only e2e` | 5흐름 PASS(1.1분) |

- 로그 `.gstack/deploy-f10be10/check.log`·`e2e.log`(git 제외). 보호 경로 변경 0. 작업 트리의 `docs/presentation/` 발표 자료(사용자 파일, 미커밋)는 배포 소스(`git archive`)에 들어가지 않는다.
- 커밋 전 변경별 검증(B): 프런트 테스트·typecheck·lint, 로컬 375×812 에서 44px 미만 조작 0·12px 미만 글자 0(숨김 텍스트·SVG 제외), 서비스 안내 창·현재 위치 버튼·manifest 응답·AI 요약 순서 확인.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-f10be10/`(git 제외): `git -c core.autocrlf=false archive f10be10` → 추출 뒤 blob 대조 1,162개 중 차이 2개 = `.gitattributes` `eol=crlf` 보호 원본(직전 배포와 같은 의도된 차이)·추가 0·누락 0.
- 데이터 2026-09 파일(저장소 `data/versions/2026-09` 와 동일 — 직전 배포 컨텍스트와 해시 일치) + 역 승하차 자료(커밋 그대로).
- **공고 스냅샷 새로 받음**: `build_support_snapshot.py --secrets` 1회 성공 — 518건(기업마당 415 + K-Startup 111), **2026-11-26 19:06 기준**.
- 빌드 "data version 2026-09 roles 8 bad []", 지도 build arg 2개(값 기록 안 함). push digest `sha256:aa50a2bbc5ec4426d5be93e154f3410a4fc0edeab4278c4e3d098e7e9bdf545e`.

## 3. 무트래픽 리비전 `<서비스>-f10be10-v051`
- `deploy_cloud_run.py candidate f10be10 --ai --support --apply`(최소 0·최대 1·CPU 상시·Secret 3개 이름만), 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 의 데이터 2026-09·엔진 v0.5.1 기대값) **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 124 · 중앙값 147 · 최대 268ms), `/rank` 29개, AI budget ok.
- 화면(preview 등록 주소, 내장 브라우저): 부평구 산곡3동 카페 500m 결과 51.5, 번들 최신 `v0.5.0`, 카드 순서 종합 → 다섯 관점 → AI 요약 → 시간대, 서비스 안내 버튼 있음, `/manifest.json`·`/apple-touch-icon.png` 200, `theme-color` `#0A1226`, 콘솔 오류 0. 375×812: 가로 넘침 없음·지도 톤 dark, 44px 미만 조작 1개(어느 조작인지 미확인 — 로컬 측정에서는 0, 후속 확인). 리비전 ERROR·5xx 0.

## 4. 운영 전환 (2026-11-26 19:28 KST)
- `python scripts/deploy_cloud_run.py switch <서비스>-f10be10-v051 --apply`: 전환 전 `15ad44e-v051` 100%, 전환 뒤 `f10be10-v051` 100%·서비스 `minScale` 1, 최신 생성 리비전 그대로(새 리비전 안 생김). 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check`(같은 기대값) **SMOKE PASSED**: 48건 불일치 0(지연 최소 118 · 중앙값 147 · 최대 276ms), `/rank` 29개. Firebase 기본 주소 `/health`·`/manifest.json`·`/apple-touch-icon.png`·`/heatmap.json` 200.
- 화면(Firebase 짧은 주소): 번들 `v0.5.0`, 다크, 산곡3동 카페 51.5, AI 요약이 다섯 관점 바로 아래, 지도 인증 성공, 콘솔 오류 0. 전환 뒤 리비전 ERROR·5xx 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-15ad44e-v051 --apply`(v0.4.3).
- 미검증: 실기기(터치 영역·현재 위치 권한·홈 화면에 추가)·Safari·Firefox·스크린리더.
- 다음 단계(사용자 결정 2026-11-26): 링크 미리보기 이미지(`og:image`, `.web.app` 주소 사용 허용)·장소 이름 검색(NAVER API HUB 로 발급 — 주소·헤더가 달라 `backend/app/places.py` 수정 필요, Secret `naver-search-client-id`·`naver-search-client-secret` 등록됨)·모바일 상단 메뉴 묶기·화면 단순화. 만든 곳·문의 창구는 생략.
