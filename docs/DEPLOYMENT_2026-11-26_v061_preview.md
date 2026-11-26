# 운영 전환 기록 — 앱 v0.6.1 + 엔진 v0.5.1 + 데이터 2026-09 (2026-11-26 · **운영 전환 4장**)

배포 후보 = v0.6.0 운영본(`771607d`) 뒤 v0.6.0 배포 기록 문서 커밋(`930c96a`) + 13-52 검색창 하나로(`7e21393`, D-050). 사용자 지시 "합치기" → "배포 진행". `771607d` 대비 바뀐 코드는 프런트뿐(`LocationSearch.tsx`·`lib/locationSearch.ts`·`LocationMethodSwitch.tsx`·`ConditionPanel.tsx`·`App.tsx` 한 줄, 결과 버튼 두 개 export) — 백엔드·엔진·데이터·AI 프롬프트는 같다.

## 1. 검증 (규칙 F)
| 소스 | 명령 | 결과 |
| --- | --- | --- |
| `7e21393` | 전체 check `--jobs 5` | **19단계 PASS, 재실행 없음**(v0.3 382 · v0.4 61 · v0.5 104 · v0.5.1 40 · backend 259 passed/1 skipped · frontend 1,087 · patch-notes, 608.0초) |
| `7e21393` | E2E `--only e2e` | 5흐름 PASS |

- 로그 `.gstack/deploy-7e21393/check.log`·`e2e.log`(git 제외). 보호 경로 변경 0.
- 커밋 전 로컬 화면 확인은 하지 못했다 — 로컬 주소에서 지도 SDK 가 준비되지 않아 주소 검색이 꺼진 상태("장소 이름" 탭)만 떴다. 통합 검색 화면은 아래 무트래픽 리비전에서 처음 확인했다.

## 2. 이미지
- 작업 폴더 `.gstack/deploy-7e21393/`: `git archive 7e21393` → blob 대조 1,171개 중 차이 2개 = `eol=crlf` 보호 원본(의도된 차이)·추가 0·누락 0. 데이터 2026-09(직전 컨텍스트와 해시 일치), 공고 스냅샷 518건(2026-11-26 20:38 기준).
- 빌드 "data version 2026-09 roles 8 bad []". push digest `sha256:d4a442665e2e5a33f8e3b110c01498d9a9a0afd2e6a3f01bdb4bb64578862ee9`. 이미지는 전체 check 와 나란히 만들었고 배포는 check·E2E 통과 뒤에 했다.

## 3. 무트래픽 리비전 `<서비스>-7e21393-v051`
- `deploy_cloud_run.py candidate 7e21393 --ai --support --places --apply`, 태그 `preview`, 트래픽 0.
- `smoke_api.py check`(`e396c85` 기대값) **SMOKE PASSED 1회**: 48건 불일치 0(지연 최소 112 · 중앙값 131 · 최대 201ms), `/rank` 29개, AI budget ok.
- 화면(preview 주소, 내장 브라우저): 번들 `v0.6.1`. 지도가 준비되면 위치 입력 방법이 [지도에서 고르기 │ 검색으로 찾기 │ 좌표 입력] 3개. "부평대로 1" → 주소 1건, 예시 "부평역" → 장소 5건, 첫 결과를 고르면 위치 선택(참고 주소 "부평구 광장로 16 부평민자역사")·지도 이동. 콘솔 오류 0, 리비전 ERROR·5xx 0.
- 관찰: 지도 SDK 가 준비되기 전(이 확인에서는 10여 초)에는 주소 검색이 꺼져 있어 탭이 "장소 이름"으로 보이다가 준비되면 "검색으로 찾기"로 바뀐다(D-050 의 "한쪽만 되면 기존 이름" 규칙대로). 로딩 중 이름이 한 번 바뀌는 것은 후속 후보.

## 4. 운영 전환 (2026-11-26 20:55 KST)
- `python scripts/deploy_cloud_run.py switch <서비스>-7e21393-v051 --apply`: 전환 전 `771607d-v051` 100%, 전환 뒤 `7e21393-v051` 100%·서비스 `minScale` 1, 최신 생성 리비전 그대로. 태그는 `preview` 하나.
- 운영 주소 `smoke_api.py check` **SMOKE PASSED**: 48건 불일치 0(지연 최소 116 · 중앙값 132 · 최대 204ms), `/rank` 29개. Firebase 짧은 주소 `/health`·`/og.png`·`/manifest.json` 200, `POST /places` "부평역" 5건.
- 화면(Firebase 짧은 주소): 번들 `v0.6.1`, 지도 준비 뒤 위치 입력 방법 3개("검색으로 찾기"), 지도 톤 dark, 콘솔 오류 0.
- 복구: `python scripts/deploy_cloud_run.py rollback <서비스>-771607d-v051 --apply`(v0.6.0 — 탭 4개로 돌아간다).
- 미검증: 실기기·Safari·Firefox·스크린리더, mobile 지도 시트에서 "검색으로 찾기"를 눌러 패널로 넘어가는 흐름(단위 규칙만 확인).
