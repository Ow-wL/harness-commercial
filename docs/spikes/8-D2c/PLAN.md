# 8-D2c 운영 전 필수 조건 측정 계획 — vCPU 1·메모리 1Gi Linux 컨테이너 (2026-10-18, 계획 초안 보관 · 보류)

> **보류(사용자 지시 2026-10-18)**: 이 계획은 초안으로 보관한다. 측정 스크립트 변경, Docker Desktop 시작, 컨테이너 측정, Cloud Run 변경은 하지 않는다. 4장의 A~E 판단은 UI 개선 뒤 운영 전 검증 단계에서 다룬다. vCPU 1·1Gi 조건 측정, 컨테이너 메모리 확인, cold 지연 수용 판단은 v0.4 배포 전 필수 조건으로 유지한다.

8-D2b(로컬 측정·분석 검수 통과)에 이어, v0.4 운영 전환 전 필수 조건을 재기 위한 계획이다. 조건은 vCPU 1·1Gi 조건 측정, 컨테이너 메모리 확인, 시작 직후 cold 지연 수용 판단을 위한 자료다.

**이 문서는 계획이다.** Docker Desktop 시작, 이미지 빌드, 측정, Cloud Run 변경, 운영 배포, 제품 코드 변경은 하지 않았다. 합격 기준과 지연 상한은 정하지 않는다. 측정 뒤 사용자가 판단한다(4장).

## 0. 검토한 현재 상태
- `Dockerfile`: `node:22-slim`에서 `vite build`(build arg `VITE_NAVER_MAP_CLIENT_ID` 필수), 그다음 `python:3.10-slim` runtime이다.
  - 들어가는 것: `requirements.txt`(버전 고정), `scoring_engine/`(v0_3·v0_4), `backend/app/`, `data/runtime/`, 행정동 GeoJSON, `frontend/dist`
  - 실행: `USER app`, `FRONTEND_DIST=/app/frontend/dist`, `PORT=8080`, `CMD uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT} --workers 1`
  - `SCORING_ENGINE_VERSION`을 설정하지 않는다. 그래서 기본 v0.3이고, v0.4는 실행 때 `-e`로 준다.
- `.dockerignore`: `sources`, `tests`, `docs`, `scripts`, `.env*`를 빌드 context에서 뺀다. 측정 스크립트는 이미지 밖(호스트)에서 돈다.
- 운영 설정(D-018): Cloud Run vCPU 1, 1Gi, min/max 인스턴스 1/1, concurrency 4, `--no-cpu-throttling`, startup CPU boost, timeout 300s, worker 1.
- 로컬 환경: Docker CLI 29.5.2, WSL2 배포판 `docker-desktop`이 멈춘 상태(데몬 미실행). 커널 버전과 cgroup 버전은 데몬이 떠야 확인할 수 있다.
- 라이브러리: venv(로컬 측정)와 `requirements.txt` 고정 버전이 같다(pandas 2.3.3, numpy 2.2.6, scipy 1.15.3, fastapi 0.142.2, starlette 1.7.0, uvicorn 0.54.0). Python은 venv 3.10.11, 이미지는 `python:3.10-slim`의 그때 최신 3.10.x라 패치 버전이 다를 수 있다.
- 측정 도구: `scripts/bench_uvicorn.py`는 서버를 **직접 subprocess로 띄우는** 구조라 컨테이너에 그대로 쓸 수 없다(1장 도구 변경).

## 1. vCPU 1·1Gi Linux 컨테이너 측정 절차

### 1.1 사전 조건 (사용자)
1. Docker Desktop을 사용자가 시작하거나, Claude가 시작하도록 승인한다.
2. 확인할 것: `docker info`(엔진 실행), `docker info --format '{{.CgroupVersion}}'`, `docker run --rm python:3.10-slim uname -r`(커널). 결과를 측정 기록에 남긴다.
3. 측정하는 동안 호스트에서 다른 무거운 작업을 하지 않는다(8-D2b와 같은 조건).

### 1.2 이미지 빌드
```bash
docker build --build-arg VITE_NAVER_MAP_CLIENT_ID=<값> -t harness-commercial:measure-$(git rev-parse --short HEAD) .
```
- `<값>`은 두 가지 중 하나다. 측정은 API만 쓰므로 지도 키가 없어도 결과에 영향이 없다.
  - 측정용 더미: 지도 화면만 동작하지 않는다.
  - `frontend/.env`의 공개 Client ID: 출력·커밋하지 않는다.
- 기록할 것: git 커밋, 이미지 ID·digest, 빌드 시각, 이미지 안 Python 패치 버전(`docker run --rm <이미지> python -V`).

### 1.3 실행 조건 (회마다 새 컨테이너)
```bash
docker run -d --name hc-measure --cpus 1 --memory 1g --memory-swap 1g \
  -e SCORING_ENGINE_VERSION=v0_4 -p 127.0.0.1:18080:8080 harness-commercial:measure-<sha>
```
- `--cpus 1`은 CFS quota 1 CPU다. `--memory 1g --memory-swap 1g`은 메모리 1GiB에 swap 없음이다(Cloud Run에는 swap이 없다).
- 측정이 끝나면 `docker logs`를 저장하고 `docker rm -f`로 지운다. 이미지는 다시 빌드하지 않고 모든 회차에 같은 것을 쓴다.

### 1.4 회차 구성 (순서 교차)
- **부하 측정:** v0.4와 v0.3(같은 이미지, env만 다름)을 각 3회, 순서는 v0.4 → v0.3 → v0.3 → v0.4 → v0.4 → v0.3이다.
  - v0.3 회차는 같은 컨테이너 조건에서의 기준선이다(지금 운영 동작과 같은 29개 warm).
- **무부하 측정(선택):** 버전마다 1회. `/health` 확인만 하고 분석 요청은 보내지 않아, 순수 warm 시간을 잰다.
- 예상 소요 시간은 vCPU 1에서의 warm 시간을 모르므로 정하지 않는다(로컬은 v0.4 warm 약 5분). 회차마다 기한(아래)이 있다.

### 1.5 필요한 도구 변경 (측정 스크립트만 — 제품 코드 아님, 구현 전 검수)
- **`scripts/bench_uvicorn.py`의 측정 부분을 함수로 분리한다.** 측정 부분은 준비 대기, `/health` 기록, 고정 일정 요청, warm 뒤 30회, 유효성 판정이다. 서버 실행·생존 확인은 바꿔 끼울 수 있게 한다. 지금 uvicorn subprocess 방식의 결과는 바뀌지 않게 하고, 기존 테스트 8건으로 확인한다.
- **새 `scripts/bench_container.py`:**
  - 실행·종료: `docker run`/`docker rm`. 생존 확인: `docker inspect`의 `State.Running`·`ExitCode`·`OOMKilled`.
  - 메모리·CPU 샘플링(2장), `docker logs` 저장.
  - 무효 사유를 추가한다: 컨테이너 종료, OOMKilled, 메모리 샘플 수집 실패.
- **v0.3 회차의 cold 키:** v0.3은 1,000m를 받지 않으므로(422) cold 요청 반경을 엔진에 맞게 고를 옵션(`--cold-radius`)이 필요하다. v0.3 cold 키는 "warm이 가장 늦게 하는 업종·500m"가 된다. v0.4의 1,000m cold와 같은 키가 아니라는 점을 결과에 적는다.
- **테스트:** 데몬 없이 돌 수 있게, docker CLI를 흉내 내는 가짜 명령으로 실행·생존·OOM·종료 판정을 단위 테스트한다. 실제 docker 경로는 1.1 뒤 짧은 스모크로만 확인한다.

## 2. 수집 방법

시각 0은 호스트에서 `docker run -d`가 돌아온 직후다(호스트 시계). 컨테이너의 `State.StartedAt`도 함께 기록한다. 둘의 차이(시계 동기화 포함)는 보정하지 않고 기록만 한다.

| 항목 | 방법 | 비고 |
|---|---|---|
| 서버 준비 | `/health` 200을 처음 받은 시각(0.1초 간격 시도) | RuntimeData 로드가 포함된다 |
| 500m warm | `/health` `warm.completed ≥ 29`를 처음 관측한 시각(0.5초 간격). v0.4는 500m 29개를 먼저 한다(`warm_tasks`) | 해상도 0.5초. v0.3은 29개가 곧 전체다 |
| 전체 warm | `warm.done` 첫 관측. `failed`면 무효 | v0.4 87, v0.3 29 |
| warm 중 hit | 첫 키 완료 시각 S부터 60초 동안 0.25초마다 고정 시각에 `POST /analyze`(부평역·첫 업종·500m). 200만 지연 통계에 넣는다 | 8-D2b와 같은 일정 |
| warm 중 cold | S+10·25·40초에 warm이 가장 늦게 하는 키(v0.4: 1,000m, v0.3: 500m) | 키별 지연과 상태 코드 |
| 완료 후 응답 | warm 완료 뒤 같은 hit 30회(순차), 상태 코드 기록. 추가로 300·1,000m 몇 개(완료 뒤 모두 계산돼 있어야 함) | 경합 없는 기준 |
| 컨테이너 메모리 | ① 호스트에서 1초마다 `docker stats --no-stream --format '{{json .}}'`(MemUsage·MemPerc·CPUPerc) ② 끝에 `docker exec`로 cgroup v2의 `memory.current`·`memory.peak`(커널이 지원하면)·`memory.events`(oom, oom_kill)·`memory.stat`(anon, file) ③ `docker inspect State.OOMKilled` | `memory.peak`가 없으면 샘플 최대값만 남긴다(샘플 사이 최고점은 놓칠 수 있음). file(page cache)과 anon을 나눠 기록한다 |
| CPU | `docker stats`의 CPUPerc 샘플 | 1 CPU 상한에 붙어 있는지 확인용 |
| 로그 | `docker logs` 전체 | warm 실패·예외 확인 |

결과 형식은 8-D2b와 같은 JSON에 컨테이너 항목(이미지 ID, 커널, cgroup, 메모리·CPU 샘플, OOM)을 더한다. 원본은 `docs/spikes/8-D2c/results/`에 두고 덮어쓰지 않는다.

## 3. 기존 로컬 측정(8-D2b)과 비교할 수 있는 범위와 한계

**같은 것:** 측정 클라이언트 로직, 요청 일정·키, 유효성 판정, 엔진·서버 코드(같은 커밋), 라이브러리 고정 버전, worker 1.

**다른 것 (직접 비교할 때 주의):**
- OS·실행 환경: Linux 컨테이너(Docker Desktop의 WSL2 VM) 대 Windows 프로세스. Python 패치 버전이 다를 수 있다.
- CPU: 서버가 1 CPU quota 안에서 돈다. 로컬은 논리 CPU 16개 중 하나를 썼다. 측정 클라이언트는 두 경우 모두 호스트에서 돌고 컨테이너 quota 밖이다.
- 이미지는 프런트 정적 파일도 서빙한다. 측정 요청 경로(`/health`, `/analyze`)에는 영향이 없을 것으로 보지만 확인하지 않았다.
- 요청이 Docker 포트 포워딩을 거친다(로컬은 루프백 직접 연결).
- 그래서 8-D2b와는 "같은 클라이언트·같은 일정에서 실행 환경과 CPU 제한이 바뀌면 어떻게 달라지는가" 정도로만 비교한다. 차이의 원인을 하나로 단정하지 않는다.

**Cloud Run과 다른 것 (컨테이너 측정이 대신하지 못하는 것):**
- 하드웨어·CPU 세대·가상화(Cloud Run 샌드박스)가 다르다.
- startup CPU boost를 재현하지 않는다. Cloud Run은 시작 직후 CPU가 더 많을 수 있다.
- concurrency 4를 재현하지 않는다. Cloud Run에서는 동시 요청이 4를 넘으면 대기하거나 거절될 수 있는데, 우리 고정 일정은 warm 중 동시 요청을 많이 만든다.
- 실제 인터넷 왕복과 Google 프런트엔드 지연이 없다.
- Cloud Run 메모리 집계 방식(인메모리 파일시스템 포함 등)이 cgroup 값과 같다는 근거가 없다.
- 따라서 운영과 같은지 마지막으로 확인하려면 무트래픽 Cloud Run 리비전에서 재야 한다(`docs/UX_REDESIGN.md` 4.6 ③). 이것은 Cloud Run 변경이므로 사용자 승인이 필요하고, 이 계획 범위 밖이다.

## 4. 측정 결과로 확인할 사항과 사용자가 결정할 조건

**측정으로 확인할 것** (값을 보고하고 판단은 하지 않는다):
1. vCPU 1·1GiB에서 v0.4 warm이 실패·OOM·컨테이너 종료 없이 끝나는가(3회 모두).
2. 서버 준비, 500m 29개 완료, 전체 87개 완료 시각의 분포와 같은 조건 v0.3(29개) 대비 값.
3. warm 중 hit·cold 지연 분포와 최대값, warm 뒤 응답 분포. 1 CPU에서 warm 계산과 요청이 CPU를 나눠 쓰는 영향.
4. 컨테이너 메모리 최고값(`memory.peak` 또는 샘플 최대), anon/file 구성, 1GiB 대비 비율, OOM 이벤트 수.
5. 요청이 Cloud Run timeout 300초에 가까워지는지(관측 최대값만 보고).
6. 회차 사이 편차. 8-D2b처럼 실행마다 편차가 크면 결론의 범위를 그만큼 넓게 적는다.

**사용자가 결정할 것** (측정값을 보고 정한다 — 이 계획은 기준을 미리 정하지 않는다):
- **A. 시작 직후 cold 지연 수용 여부:** 배포·재시작 직후 warm이 끝날 때까지(측정값 T) 아직 계산되지 않은 300m·1km 요청의 지연(측정 분포)을 받아들일지.
- **B. 수용하지 않을 때의 방향** (각각 별도 단위·별도 승인):
  - 트래픽 전환을 warm 완료 뒤로 미루는 배포 절차(무트래픽 리비전 → `/health` warm 완료 확인 → 트래픽 이동)
  - warm이 끝날 때까지 반경 선택을 숨기거나 안내하는 제품 변경
  - warm 시간 단축(엔진 밖 성능 작업, 디스크 캐시 D-016 재검토 등)
- **C. 메모리:** 측정 최고값이 1GiB 안에서 얼마의 여유를 남기는지 보고, 메모리 설정 유지·변경(비용 영향)을 정한다.
- **D. 반복 횟수와 편차:** 3회로 충분한지, 편차가 크면 더 반복할지.
- **E. Cloud Run 무트래픽 리비전 측정:** 진행 여부(Cloud Run 변경 승인 필요).

## 5. 진행 순서 (승인 뒤)
1. 도구 변경(1.5)과 데몬 없는 단위 테스트를 구현하고 검수받는다.
2. 사용자가 Docker Desktop 시작을 승인하면 1.1 확인 → 1.2 빌드 → 짧은 스모크 1회를 한다(결과는 저장소 밖).
3. 1.4 회차를 측정하고, 원본·조건·한계를 기록한다.
4. 결과와 4장의 결정 사항을 보고하고 검수를 기다린다. 측정만 하며, 운영 변경은 없다.
