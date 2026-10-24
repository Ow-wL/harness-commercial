# 엔진 v0.5.1 운영 배포 계획·사전 검증 (2026-10-25 — **배포 미실행**)

운영 엔진은 v0.5.1(`mvp-0.5.1`, D-029)로 확정했다(사용자 결정 2026-10-25). 이 문서는 배포 전 로컬 검증 결과와 배포·복구 절차다.
**실제 운영 배포·트래픽 전환은 하지 않았다** — 실행은 별도 승인 뒤. 서비스 URL·프로젝트 이름·지도 설정 값은 저장소에 쓰지 않는다(아래 `<서비스>`·`<프로젝트>`·`<레지스트리>`).

## 1. 배포 범위 — 먼저 정할 것

- 현재 운영: `<서비스>-1020200-v04`(커밋 `1020200`, 엔진 v0.4, 2026-10-19).
- master에는 운영 미배포 상태인 **묶음 A(테마·구 경계)·B(점포 글리프·검색 링크)·C(데이터 버전 구조)·D(첫 방문 안내)** 커밋이 이미 있고, v0.5/v0.5.1 변경은 아직 **커밋 전**이다. 현재 트리로 이미지를 만들면 이 UI 변경이 함께 나간다.
  → 배포 전에 (a) v0.5 계열 변경 커밋, (b) 묶음 A~D를 함께 낼지 결정, (c) 다크 지도 구 라벨 가독성(9-A5) 등 미완료 항목 확인이 필요하다.
- **결정(2026-10-25, 사용자): 배포 범위 = master의 UI 묶음 A~D + 엔진 v0.5.1.** 따라서 운영 이미지 build arg에 라이트 스타일(`VITE_NAVER_MAP_LIGHT_STYLE_ID`, 선택)도 확인하고, 화면 smoke에 테마 전환(9-A)·점포 글리프·검색 링크(9-B)·첫 방문 안내(9-D)를 더한다. 9-A5(다크 구 라벨 가독성 미완료)는 알려진 한계로 둔다. v0.5 계열 변경은 커밋했다(이 문서와 같은 커밋 묶음).
- 운영 이미지는 **커밋된 소스**로 만든다(작업 트리 금지). 지난 배포처럼 커밋 기준 컨텍스트를 따로 만든다(Windows tar 한글 경로 추출 실패 → ZIP 컨텍스트, `docs/DEPLOYMENT_2026-10-19.md`).

## 2. 사전 검증 결과 (Claude 로컬, 2026-10-25, 작업 트리 = 미커밋 상태)

검증용 이미지는 작업 트리로 만든 `harness-commercial:v051-verify`이며 **운영 이미지가 아니다**(지도 Client ID는 자리표시자 — 지도 없이 API·엔진만 확인).

**브라우저(개발 서버 + 로컬 v0.5.1 backend, Windows, 1024×768 다크)** — `/health` `mvp-0.5.1`·[300, 500, 1000]
- 단일: 부평고등학교 북쪽 50m PC방 500m 종합 67.2, 주의 요약 띠 첫 줄 학교구역(강조), 상세 근거 주의할 점 첫 항목 "학교구역 주의 · 먼저 확인" + 엔진 원문, 엔진 표기 `mvp-0.5.1`.
- 반경: 같은 지점 300/500/1,000m API — 동종 0/7/17곳 = 점포 목록 0/7/17, 실효 –/7.3/20.3, 고객성 `인구_기준` "반경 {r}m 배분", `meta.분석반경_m`·경쟁성 `반경m` 일치, 학교구역 경고 세 반경 모두 맨 앞. 화면 1km 전환: 머리 "반경 1km", 범례 "반경 1km", 주변 점포 17.
- 비교: A = 학교 50m(부평4동) 67.2, B = 부평역(부평1동) 62.3(경쟁성 31.9). 띠: A 학교구역(강조) → A 학교 300m → B 학교 0곳 → "같은 구 · 시장성·안정성은 같은 데이터". 비교 중 1km 전환 → A·B 모두 1km(68.9 / 64.8), 지도 A·B 1km 원.
- 콘솔 오류 2건은 backend 기동 전 첫 페이지 로드의 `/businesses`·`/health` 프록시 502(개발 서버 순서 문제)이며 이후 요청 오류 없음, 서버 오류 로그 없음.

**Docker 이미지** — `docker build`(Docker 29.5.2, 작업 트리 컨텍스트, `.dockerignore` 적용) 성공 58초, linux/amd64 178MB. 빌드 단계 GeoJSON 자산 검사 통과. 런타임에 `data/geo/SGIS_행정동경계_2025_2Q_인천.geojson`, matplotlib 3.10.9·pandas 2.3.3·numpy 2.2.6, `scoring_engine/v0_3·v0_4·v0_5·v0_5_1`, `MPLCONFIGDIR=/tmp/matplotlib` 확인. 정적·API: `/`·`/health`·`/businesses` 200, `/docs`·`/openapi.json`·없는 asset 404, GET `/analyze` 405, 반경 750 → 422 `invalid_radius`.
- 로컬 환경 메모: Docker Desktop 4.76.0이 이전 실행의 오래된 소켓 파일(`%LOCALAPPDATA%\Dockerun\dockerInference`, `%LOCALAPPDATA%\docker-secrets-engine\engine.sock`)을 지우지 못해 시작 중 종료됐다. 공장 초기화 없이 두 폴더를 `*.stale-20261025`로 옮겨 해결했다(지우지 않음).

**1 vCPU·1Gi 컨테이너** — `docker run --cpus 1 --memory 1g --memory-swap 1g -e SCORING_ENGINE_VERSION=v0_5_1`, cgroup `cpu.max = 100000 100000`, `memory.max = 1073741824`. 측정 스크립트는 저장소 밖(원본 JSON `.gstack/docker-v051/`, git 제외). 각 1회씩 3번:

| 실행 | 요청 수신(service_ready) | 첫 1km `/analyze`(warm 0/87 시점) | warm 87/87 완료 | 메모리 최고(cgroup `memory.peak`) | OOM |
|---|---|---|---|---|---|
| A: 준비 직후 1km | 6.75s | **16.7s** (`/nearby-stores` 0.05s) | 142.7s | 221.8MiB | 0 |
| B: 요청 없음 | 7.13s | — | 145.5s | 221.7MiB | 0 |
| C: 준비 직후 1km | 7.76s | **16.1s** | 149.3s | 219.1MiB | 0 |

- warm 뒤 지연(서버 안 처리 + 로컬 HTTP): 1km 0.08~0.20s, 500m 0.03~0.05s. 부평역 PC방 500m = 61.6·77.5·31.9·66.4·73.2·종합 62.3, 학교 50m PC방 `경고[0]` 학교구역 — 세 실행 모두 같음.
- 첫 1km 지연의 대부분은 158개 중심점의 1km 면적 가중치 1회 계산이다(반경당 1회, 이후 재사용). warm은 500m를 먼저 끝내므로 시작 뒤 약 1~2분 사이 1km·300m 첫 요청은 10초대가 걸릴 수 있다.
- Windows 로컬 측정(2026-10-24, 1km 첫 계산 51.6s·warm 340s)보다 Linux 컨테이너가 훨씬 빠르다. 같은 코드·같은 결과이며 차이 원인(플랫폼·라이브러리 빌드)은 확인하지 않았다.
- 한계: 각 1회 관측이고 동시 부하·장시간·p95가 아니다. Cloud Run(startup CPU boost, 서울 리전) 실측은 배포 단계에서 무트래픽 리비전으로 한다. 지난 v0.4 배포의 컨테이너 메모리 최고는 233.4MiB였다(같은 1Gi 한도).

## 3. 배포 절차 (승인 뒤)

1. 소스 확정: v0.5·v0.5.1 변경 커밋 → 전체 `scripts/check` 통과 확인(최근: 18단계 통과, `docs/TASKS.md` 10-8).
2. 이미지: 커밋 기준 컨텍스트로 `docker build --build-arg VITE_NAVER_MAP_CLIENT_ID=<공개 Client ID> [--build-arg VITE_NAVER_MAP_STYLE_ID=…] [--build-arg VITE_NAVER_MAP_LIGHT_STYLE_ID=…] -t <레지스트리>/<이미지>:<커밋>` → push → **linux/amd64 manifest digest** 기록. 빌드 단계 GeoJSON 자산 검사(2개, 원본 해시 일치)가 통과해야 한다. 런타임 이미지에 `data/geo/SGIS_행정동경계_2025_2Q_인천.geojson`·matplotlib 포함 확인(`docker run --rm --entrypoint sh <이미지> -c 'ls data/geo; python -c "import matplotlib"'`).
3. 무트래픽 리비전 (기존 자원 설정 그대로 + 엔진 환경변수):
   ```
   gcloud run deploy <서비스> --project <프로젝트> --region asia-northeast3 --image <레지스트리>/<이미지>@<digest> \
     --no-traffic --tag verify-<커밋> --revision-suffix <커밋>-v051 \
     --cpu 1 --memory 1Gi --min-instances 1 --max-instances 1 --concurrency 4 --no-cpu-throttling --cpu-boost \
     --update-env-vars SCORING_ENGINE_VERSION=v0_5_1
   ```
4. 태그 URL 확인(전환 전):
   - `/health`: `engine = {version: "mvp-0.5.1", radius_options: [300, 500, 1000], default_radius_m: 500}`, `service_ready=true`, **warm 87/87, done=true, failed=false**까지 기다린다(2장 시간 참고).
   - smoke: 부평역 PC방(37.4894, 126.7246) 500m `/analyze` = 61.6·77.5·31.9·66.4·73.2·종합 62.3, 엔진버전 `mvp-0.5.1`. 반경별 `/nearby-stores count` = `경쟁성.raw.동종점포수` = 6·12·17. 부평고등학교 북쪽 50m(37.502726, 126.727619) PC방 `경고[0]`이 "⚠ PC방은(는) 학교 주변 영업 규제 업종인데"로 시작. 지원하지 않는 반경 422 `invalid_radius`. `/`·`/businesses` 200, `/docs` 404.
   - 화면: NAVER 등록 주소에서(별칭 URL은 지도 인증 실패 — D-018) 단일·1km 전환·A/B 비교·학교구역 강조, 모바일 375px. 열려 있던 옛 화면은 응답 엔진버전이 바뀌면 결과 캐시를 버린다(기존 동작).
   - Cloud Monitoring 메모리·ERROR 로그 확인.
5. 전환: `gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-<커밋>-v051=100` → 검증 태그 제거(`--remove-tags verify-<커밋>`) → `docs/DEPLOYMENT_<날짜>.md` 기록. 이전 리비전 `<서비스>-1020200-v04`와 이미지는 지우지 않는다.

## 4. 복구 절차

- 즉시 복구(파일 교체 없음, 프로세스째 바뀐다):
  ```
  gcloud run services update-traffic <서비스> --project <프로젝트> --region asia-northeast3 --to-revisions <서비스>-1020200-v04=100
  ```
- 복구 뒤 확인: `/health` `engine.version = "mvp-0.4"`, warm 87/87. 트래픽 없는 이전 리비전은 인스턴스 시작·warm이 다시 필요할 수 있다(v0.4 warm 약 5분, 그동안 미warm 키 요청은 느리다).
- 화면: 응답 엔진버전이 `mvp-0.5.1` → `mvp-0.4`로 바뀌면 프런트 결과 캐시를 전부 버린다. 반경 광고는 같다(300·500·1,000).
- 엔진만 되돌리고 같은 이미지를 쓰려면 새 리비전에 `--update-env-vars SCORING_ENGINE_VERSION=v0_4`(이미지에 v0_3·v0_4·v0_5·v0_5_1이 모두 들어 있다). 단 이때는 같은 이미지의 UI(묶음 A~D)가 그대로 남는다.
