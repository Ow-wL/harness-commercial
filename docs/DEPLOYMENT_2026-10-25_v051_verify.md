# 운영 이미지·무트래픽 리비전 검증 — UI 묶음 A~D + 엔진 v0.5.1 (2026-10-25, **트래픽 전환 미실행**)

사용자 지시: 965849c 기준 운영 이미지 빌드·업로드, Cloud Run 무트래픽 리비전 검증까지. 운영 트래픽은 기존 v0.4 유지, 100% 전환은 하지 않는다.
서비스 URL·프로젝트 이름·지도 설정 값은 저장소에 쓰지 않는다(`<서비스>`). 원본 로그·JSON은 git 제외 `.gstack/deploy-965849c/`.

## 1. 이미지
- 소스: 커밋 `965849c30c5d2811f99df6e2fca1cb0ee70b50cf`(`git archive` ZIP을 별도 컨텍스트로 추출 — 작업 트리 미사용). 컨텍스트에서 원본·엔진 사본·경계 해시 확인(`source_v0_5.py verify` OK, engine v0_5·v0_5_1·geo 매니페스트 일치).
- 빌드: `docker build --platform linux/amd64`, label `org.opencontainers.image.revision=965849c…`, build arg = 로컬 `frontend/.env`의 `VITE_NAVER_MAP_CLIENT_ID`·`VITE_NAVER_MAP_STYLE_ID`(값 미출력). `VITE_NAVER_MAP_LIGHT_STYLE_ID`는 `.env`에 없어 넣지 않았다 → 라이트 테마는 NAVER 기본 밝은 지도(설계상 선택값). 빌드 단계 GeoJSON 자산 검사(2개·원본 해시) 통과. 로컬 컨테이너 `/health` = `mvp-0.5.1`.
- 업로드(Artifact Registry `<레지스트리>/harness-commercial:965849c`):
  - index digest `sha256:e54c2e3c5b91579af1519e11555aa75ad2bd28123ad6f9f0fd7d122e19ba21e3`
  - linux/amd64 manifest `sha256:91123070fc5074455485457ce77ea4099033c9b278f2608cbfa45ed81429c1b3` = 새 리비전 `status.imageDigest`
  - 이전 이미지(태그 1020200·6f7df52·b3b3897) 보존.

## 2. 무트래픽 리비전
- `gcloud run deploy <서비스> --region asia-northeast3 --image <레지스트리>/harness-commercial@sha256:e54c2e3c… --no-traffic --tag verify-965849c --revision-suffix 965849c-v051 --update-env-vars SCORING_ENGINE_VERSION=v0_5_1`
- **전환할 리비전: `<서비스>-965849c-v051`** (Ready·ContainerHealthy·MinInstancesProvisioned True).
- 보존 확인(배포 전후 서비스 정의 대조): 자원 1 vCPU·1Gi, 포트 8080, 동시성 4, 타임아웃 300초, 서비스 계정, 주석(min/max 1, CPU 상시 할당, startup CPU boost) 동일. 환경변수는 `SCORING_ENGINE_VERSION`만 `v0_4 → v0_5_1`. IAM `roles/run.invoker` 바인딩 1개(변경 명령 없음).
- 트래픽: `<서비스>-1020200-v04` **100% 그대로**, 새 리비전은 태그만. 이전 리비전 `1020200-v04`·`6f7df52`·`00001-872` 보존.
- 주의: min instances 1이 새 리비전에도 적용돼 전환 전까지 인스턴스 1개가 추가로 떠 있다(비용). 전환하지 않기로 하면 태그를 지우거나 리비전 정리 필요.

## 3. 새 리비전 검증 (태그 URL)
- 시작: 프로세스 시작 → `Application startup complete` 약 9.6초(17:13:55 → 17:14:04 UTC), STARTUP TCP probe 1회 성공.
- **warm 87/87, done=true, failed=false** — 배포 명령 시작(17:13:36) 후 약 5분(17:18:41 확인, 3초 간격 관측). 로컬 1 vCPU 컨테이너(약 2.5분)보다 길다(원인 미확인, 관측 1회).
- `/health`: `engine = {mvp-0.5.1, [300, 500, 1000], 500}`, 데이터 버전 `2026-06`.
- **전체 응답 대조**: 같은 커밋 코드로 로컬(v0_5_1) 계산한 기대값과 48건(부평역·학교 50m·송도·아라1동 중심 × PC방·카페·편의점·입시학원 × 300·500·1,000m)의 `/analyze`·`/nearby-stores` 응답이 모두 일치(불일치 0, 숫자 허용오차 1e-9). warm 뒤 응답 시간 102~238ms(클라이언트 측정, 중앙 122ms).
- 기준 점수(부평역 PC방, 웹 경로·임대료 미연결): 300m 61.6·77.5·42.4·66.4·73.2·종합 64.6 / **500m 61.6·77.5·31.9·66.4·73.2·종합 62.3** / 1km 61.6·76.8·44.2·66.4·73.2·종합 64.8. 엔진버전 `mvp-0.5.1`, `meta.분석반경_m` = 요청 반경.
- 반경별 점포 수: 6 / 12 / 17곳 = `경쟁성.raw.동종점포수` = `/nearby-stores count`.
- 학교구역: 부평고등학교 북쪽 50m PC방 `경고[0]` = "⚠ PC방은(는) 학교 주변 영업 규제 업종인데, 이 지점 200m 안에 …".
- 정적·오류 계약: `/`·`/health`·`/businesses` 200, JS/CSS immutable 캐시, GeoJSON 자산 2개 원본 해시 일치, `/docs`·`/redoc`·`/openapi.json`·없는 asset 404, GET `/analyze` 405, 반경 750 → 422 `invalid_radius`.
- 로그: 새 리비전 ERROR 이상 **0건**. WARNING 6건은 모두 위 부정 테스트 요청(404×4·405·422)의 요청 로그. 운영 v04 리비전 ERROR 0건(같은 1시간).
- 메모리(Cloud Monitoring `container/memory/utilizations`, 1분 정렬 4개 샘플): p50 28.5%, p99 29.0%(1Gi 기준 약 290~300MiB). 최고 순간값·장시간 부하 결과가 아니다.

## 4. 화면 (태그 URL — NAVER 미등록 주소)
- 지도: 예상대로 "지도 인증에 실패했습니다" 안내(NAVER 401). **지도 관련 화면은 미검증**: 다크 GL 스타일·지도 위 반경 원·마커·업종 글리프·행정동/구 경계·지도 맞춤·지도 클릭 위치 선택·비교 A/B 지도 표시·모바일 지도 시트. 확인하려고 운영 트래픽을 바꾸지 않았다.
- 확인한 것(좌표 입력 경로): 첫 방문 안내 ①(묶음 D), 반경 선택 표시, 학교 50m PC방 분석 67.2·주의 요약 첫 줄 학교구역 강조, 1km 전환 68.9·주변 점포 17·정확/실효 안내(약 20.3곳), 점포 선택 시 네이버(앱 스킴)·구글 검색 링크(묶음 B).
- **발견한 결함(묶음 A, 미수정)**: 지도 인증이 실패한 상태에서 테마 전환 버튼을 한 번 누르면 앱 전체가 사라진다(빈 화면, 버튼 0개). 새로고침 직후 분석 없이도 재현(2회). 콘솔에는 NAVER SDK 쪽 교차 출처 `Script error.` 4건과 `Cannot read properties of null (reading 'isArray')`. 앱에 오류 경계(Error Boundary)가 없어 테마 전환 때 지도 재생성 중 난 오류가 React 트리 전체를 내리는 것으로 추정한다(**원인 미확인**). 등록 주소(인증 성공)에서의 테마 왕복은 2026-10-19 로컬 검증(9-A4)에서 정상이었다 — 운영 사용자가 겪는 조건은 NAVER 인증·SDK 장애 때로 한정될 것으로 보이나 확인하지 않았다. 비교 흐름 확인은 이 빈 화면 때문에 태그 URL에서 끝내지 못했다(로컬 v0.5.1 서버 브라우저 확인은 완료, `docs/DEPLOYMENT_PLAN_v0_5_1.md` 2장).

## 5. 다음 (승인 필요)
- 위 결함을 전환 전에 고칠지(새 커밋·새 이미지·새 무트래픽 리비전) 또는 알려진 한계로 두고 전환할지 결정.
- 전환: `gcloud run services update-traffic <서비스> --region asia-northeast3 --to-revisions <서비스>-965849c-v051=100` → NAVER 등록 주소에서 지도 화면 확인 → 태그 제거 `--remove-tags verify-965849c` → 기록.
- 복구: `gcloud run services update-traffic <서비스> --region asia-northeast3 --to-revisions <서비스>-1020200-v04=100` (`docs/DEPLOYMENT_PLAN_v0_5_1.md` 4장).

## 6. 테마 전환 빈 화면 결함 수정 (2026-10-25, 전환 전 — 사용자 지시)

**원인(확인함)** — 로컬 개발 서버를 NAVER 미등록 주소(127.0.0.1:5177)로 띄워 같은 증상을 재현하고, SDK 함수를 감싸 우리 코드의 호출 위치를 기록했다.
1. 인증 실패 때 NAVER SDK는 `window.naver.maps`를 **null 로 바꾼 뒤** `navermap_authFailure`를 부른다.
2. 이미 만든 지도·리스너·오버레이를 다루는 SDK 내부(`Event.removeListener`, `Marker/Polygon.setMap` 등)가 그 전역을 읽어 `TypeError: Cannot read properties of null (reading 'isArray' | 'capitalize')`를 던진다.
3. 테마를 바꾸면 지도 effect 정리 → `disposeAttempt` → `loaded.Event.removeListener(l)`(MapView.tsx)에서 이 예외가 나고, React effect 정리 중 예외라 오류 경계가 없는 루트 전체가 내려갔다(빈 화면).
4. 덧붙여 정리가 끝나도 재생성 때 `loadNaverMaps`는 `naver.maps`가 null이라 이미 붙은 script의 load 이벤트를 기다리며 끝나지 않는 상태였다(무한 로딩).

**수정(엔진·점수·데이터 변경 없음)**
- `map/naverMaps.ts`: 인증 실패를 기억하고(`authFailed`), 그 뒤 로드 요청은 SDK를 쓰지 않고 바로 `auth` 실패로 돌려준다. `resetNaverMapsForRetry()` — script·전역을 걷어 내고 다음 로드가 SDK를 새로 받게 한다.
- `components/MapView.tsx`: 정리 경로의 SDK 호출(지도 세대·리스너·선택 마커·점포 마커·정보창·행정동/구 경계·줌 리스너·테마 보기 이어받기)을 `release()`로 단계마다 시도하고, 실패는 `console.error("[map] … 중 NAVER SDK 오류 N건 …")`로 남긴 뒤 나머지 정리를 계속한다(숨기지 않음). 인증 실패 알림을 받으면 그 세대(지도·리스너·init 대기)를 바로 걷어 내 대기 중인 스타일 지도가 밝은 지도를 다시 만들지 않게 한다. 지도 생성자·이벤트 등록이 예외면 부분 생성분을 정리하고 `init` 실패 안내로 둔다. 실패 안내에 **"지도 다시 불러오기"**(인증·로드 실패는 SDK를 새로 받음, 초기화 실패는 지도만 다시 만듦). 안내는 결과 패널 뒤로 가려지지 않게 지도에 보이는 영역 가운데에 둔다(CSS).
- `components/MapErrorBoundary.tsx` + `App.tsx`: 지도 영역 오류 경계(마지막 방어선) — 지도에서 예상하지 못한 예외가 나도 지도 칸만 "지도를 표시하지 못했습니다 + 지도 다시 불러오기"로 바꾸고 분석 폼·결과·비교는 그대로 둔다.

**회귀 테스트** — `MapView.test.tsx` "인증 실패·초기화 실패 격리" 4건(실제 SDK처럼 `naver.maps = null` + 정리 호출 TypeError: 라이트·다크 시작 반복 테마 전환, 인증 실패 뒤 다시 불러오기 성공, 지도 생성자 예외 정리·재시도 복구) — **수정 전 코드에서 4건 실패, 수정 후 4건 통과**. `MapErrorBoundary.test.tsx` 2건(정리 중 예외 격리·패널 유지·다시 불러오기).

**브라우저(Claude 로컬, 개발 서버 + v0.5.1 backend)**
- 인증 실패(127.0.0.1:5177): 테마 6회 연속 전환 — 앱 유지(버튼 수 그대로), 지도 칸 "지도 인증에 실패했습니다 + 지도 다시 불러오기", 처리되지 않은 오류 0. 좌표 입력 분석(학교 50m PC방 67.2·학교구역 강조) → 테마 2회 → 결과 유지 → 1km(68.9·점포 17) → A/B 비교(67.2 / 62.3) → 비교 중 테마 2회 → 비교 중 1km(68.9 / 64.8). "지도 다시 불러오기" → SDK 새로 받음 → (미등록 주소라) 다시 인증 실패 안내, 비교 상태 유지. 정리 중 SDK 오류는 `[map] …` 콘솔 오류로 남는다(실제 SDK에서도 콜백 전에 `naver.maps`가 null 이었음을 확인). 모바일 375×812: 안내·버튼 지도 칸 가운데, 가로 넘침 없음.
- SDK 초기화 실패(localhost:5173, 지도 생성자를 일부러 예외로): 테마 3회 — 지도 칸 "지도를 준비하지 못했습니다 + 다시 불러오기", 지도 요소 0개(부분 생성분 정리), 결과 유지, 그 상태에서 1km 분석(64.8). 생성자를 되돌리고 다시 불러오기 → 지도 복구(선택 위치·반경 1km 범례).
- 인증 성공(localhost:5173, NAVER 등록 주소): 부평역 PC방 분석 뒤 테마 8회 왕복 — 다크 = GL(renderMode 2)·다크 톤, 라이트 = 래스터·밝은 톤, 결과 62.3 유지, 지도 요소 1개, 경고·오류 없음.
- 미검증: 운영 도메인(등록 주소)에서의 새 리비전 지도 화면(트래픽을 바꾸지 않음), 실기기·Safari·Firefox·스크린리더.

**전체 `scripts/check.sh`** — 2회째 **CHECK PASSED 18/18**(pytest 368·v0_4 61·v0_5 104·v0_5_1 40·backend 137·frontend 759). 1회째는 2건 실패였다(숨기지 않음):
- `frontend/src/layout.test.ts` 정보창 닫기 44px 규칙 — 편집 중 작업 트리의 `MapView.css`·`MapView.tsx`·`naverMaps.ts`가 CRLF로 바뀌어(저장소 blob은 LF) LF 기준 문자열 검사가 규칙을 못 찾았다. 작업 트리를 LF로 되돌려 통과(내용 차이 없음, 커밋 기준 빌드는 원래 LF).
- `tests/test_bench_scripts.py::test_uvicorn_invalid_runs_are_marked[exit-server_exited]` — 측정 요청 1건 200 아님이 추가로 잡혔다. 가짜 서버(`tests/bench_fixtures/fake_app.py`)가 6번째 `/analyze`를 세고 응답을 보내기 전에 동시 `/health`가 프로세스를 끝내면 생기는 기존 테스트 장치의 경합으로 본다(부하 중에만, 단독 6회 연속 통과). 이번 변경과 무관하며 테스트는 고치거나 건너뛰지 않았다 — 후속 정리 후보.
