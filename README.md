# 우리동네 상권분석 매니저 — 웹 개발 저장소

인천 지도에서 위치와 업종을 고르면 버전 선택형 스코어링 엔진으로 상권을 분석하는 웹 애플리케이션.
엔진은 프로세스당 하나 — `SCORING_ENGINE_VERSION = v0_3(코드 기본) | v0_4(반경 300·500·1,000m) | v0_5(팀 전달 v0.5 + 반경) | v0_5_1(v0.5 + 분동 배분 결함 수정, D-029, **현재 운영**)` (`docs/ENGINE_V0_5.md`).
현재 상태(2026-10-31): **운영 = 앱 v0.0.16 + 엔진 v0.5.1**(2026-10-31 02:20 KST 전환, `docs/DEPLOYMENT_2026-10-31_v0016_preview.md` — R0 긴급 수정: 학교구역 규제 배너·점수 등급·주의 관점 강조·"이 점수는?" 문구·지도 맞춤 방어, 직전 v0.0.15 는 2026-10-29 14:07 KST 전환). A3 지도 탐색형·블루안 UI(`DESIGN.md` §19), 라이트·다크 테마, 반경 300·500·1,000m, 두 위치 비교, 주소 검색, 첫 방문 안내, 업데이트 내역, 데이터 묶음 표시, 0차 "정확한 의미"(근거 줄·자료 단위·확인 필요 줄, gzip·favicon)까지 운영 반영. 1차 "활용"(`docs/IMPROVEMENT_PLAN_2026-10-29.md` 3장, D-036) — 조건 공유 링크·반경별 비교 표·현장 확인 카드·후보 보관함·인쇄·장소 이름 검색(서버에 검색 키가 있을 때만, 현재 운영은 꺼짐)까지 운영 반영(Codex 검수 통과, 지적 5건 수정, `docs/CODEX_REVIEW_2026-10-29_v0015.md`). 다음: 2차 "체계"(`docs/TASKS.md` 12-7~12-12) — 사용자 지시로 시작. 현재 운영 상태의 기준 기록은 `CLAUDE.md`와 `docs/TASKS.md` "현재 운영 상태"다.

## MVP 기능
- **지도 위치 선택**: NAVER Maps(Dynamic Map)에서 클릭하거나 좌표를 직접 입력. 마커 + 반경 500m 원 표시
- **지도 범위 맞춤**(8차 8-B1, D-022): 새 위치를 고르면 반경 원이 지도의 사용 영역(범례·컨트롤을 뺀 곳)에 맞게 보이도록 zoom·중심을 옮긴다. 사용자가 직접 확대·이동하면 미뤄 둔 자동 맞춤을 하지 않고, 범례의 "범위에 맞추기"로 다시 맞춘다. 점포 정보창은 사용 영역 안에서 선택 지점을 가리지 않게 연다. 두 위치 비교(8-B2)에서는 B를 고르면 두 원이 함께 잘 보이면 함께, 너무 멀면 B 원을 맞추고 "두 위치 모두 보기"로 두 위치를 한 화면에 본다
- **주소로 찾기·참고 주소**(7차, D-021): NAVER 지도 SDK Geocoder로 주소를 검색해 위치를 고르고(단일·비교 B), 고른 좌표의 도로명/지번 주소를 "참고 주소 · … (NAVER 지도)"로 보인다. 주소는 분석에 쓰지 않는다(분석 행정동은 backend 판정). 콘솔에서 Geocoding·Reverse Geocoding을 선택해야 하며, 실패해도 지도·좌표 입력·분석은 그대로다
- **업종 선택**: `GET /businesses`의 29개 업종·4개 그룹 (엔진 `config` 그대로, frontend 하드코딩 없음)
- **분석**: `POST /analyze` (FastAPI) → 좌표 → 인천 행정동 판정(`LocationResolver`) → `ContextBuilder` → 엔진 v0.3. 엔진 결과는 바꾸지 않고 그대로 전달
- **결과 화면**: 종합 점수, 5대 관점, 병목·주의할 점, 데이터 충족률, 세부지표, 데이터 출처 (`DESIGN.md`)
- **행정동 경계 강조**: 분석된 행정동 polygon을 지도에 표시 (`data/geo` 경계 파일을 backend와 같은 것으로 사용)
- 오류는 `error.code`별 안내 (인천 밖·바다, 주변 점포 없음, 입력 오류, 내부 오류 + request_id)

## 설치·검증

```powershell
.\scripts\setup.ps1      # .venv 생성 + Python 의존성 설치 (Python 3.10+)
.\scripts\check.ps1      # 전체 검증 — 배포 후보 완료 판정 (원본 무결성, 엔진, golden, backend, frontend, 패치노트)
.\scripts\check.ps1 --jobs 5         # 같은 전체 검증을 Python 테스트 동시 실행으로 (약 11분)
.\scripts\check.ps1 --only e2e        # 자동 E2E smoke (Playwright, 가짜 NAVER SDK — 처음 한 번 npx playwright install chromium)
.\scripts\check.ps1 --only frontend   # 작업 중 고른 단계만 (--list 로 키 확인, 전체 check 아님 — CLAUDE.md 검증 규칙)
```
bash: `scripts/setup.sh`, `scripts/check.sh`. frontend 의존성은 `frontend/`에서 `npm install` (Node `^20.19` 또는 `>=22.12`).

## 개발 실행

```powershell
# 1) backend (저장소 루트, .venv 활성화 상태) — 데이터 로드 약 4s 뒤 요청 수신, 업종 warm은 background
python -m uvicorn backend.app.main:app --port 8000

# 1-0) 엔진 v0.5 로 띄우기 (PowerShell) — /health engine.version = "mvp-0.5", 반경 300·500·1,000m
$env:SCORING_ENGINE_VERSION = "v0_5"; python -m uvicorn backend.app.main:app --port 8000

# 1-1) venv 활성화 
.\.venv\Scripts\Activate.ps1

# 1-2) venv 비활성화 
deactivate
```
```powershell
# 2) frontend (frontend/) — http://localhost:5173, /businesses·/analyze 는 vite dev proxy가 backend로 넘긴다
npm run dev
```
자세한 내용: `backend/README.md`, `frontend/README.md`.

## Production 실행 (Docker, Cloud Run 준비)

FastAPI 하나가 API와 frontend build를 같은 origin에서 서빙한다 (`docs/DECISIONS.md` D-018). Node 서버 없음.

```powershell
docker build --build-arg VITE_NAVER_MAP_CLIENT_ID=<NAVER Maps Client ID> -t harness-commercial .
```
```powershell
docker run --rm -p 8080:8080 harness-commercial   # http://localhost:8080 , /health 의 warm.done=true 후 시연
```
Docker 없이 같은 구성: `frontend/`에서 `npm run build` 후 루트에서 `FRONTEND_DIST=frontend/dist`로 uvicorn 실행.
NAVER 콘솔 Web 서비스 URL에 접속 주소(로컬 `http://localhost:8080`, Cloud Run URL)를 등록해야 지도가 뜬다.

## 환경변수 (값은 commit하지 않는다)

| 파일 | 용도 | 키 |
|---|---|---|
| `frontend/.env` | 지도 표시 (필수) | `VITE_NAVER_MAP_CLIENT_ID` — NAVER Maps Client ID만. Client Secret은 넣지 않는다. 선택: `BACKEND_URL` (dev proxy 대상), `VITE_NAVER_MAP_GL=1`(제품 지도를 GL로 띄우는 검수용, 기본 끔), `VITE_NAVER_MAP_STYLE_ID`(NAVER Style Editor My Style ID — 다크 테마 지도의 GL 다크 스타일, 미설정 또는 스타일 실패 시 밝은 지도 사용), `VITE_NAVER_MAP_LIGHT_STYLE_ID`(선택 — 라이트 테마 지도의 GL 라이트 스타일, 없으면 NAVER 기본 밝은 지도. 묶음 A, `DESIGN.md` §19.7) |
| 루트 `.env` | SGIS 유지보수·검증 스크립트 전용 (`scripts/fetch_sgis_boundary.py`, `scripts/verify_guwol_admin_dong.py`). 앱 실행에는 필요 없다 | `SGIS_CONSUMER_KEY`, `SGIS_CONSUMER_SECRET` |

템플릿은 `frontend/.env.example`, `.env.example` (빈 값). 두 `.env`는 `.gitignore` 대상이다.

## 구조

| 경로 | 내용 |
|---|---|
| `sources/team_v0.3/` | 팀 원본 (읽기 전용, 해시 검증) |
| `scoring_engine/` | 엔진 v0.3 사본(`v0_3/`, 수정 금지) + 데이터 로더·캐시·`service`·`location`(좌표 → 행정동 → SiteContext) |
| `backend/` | FastAPI: `/health`, `/businesses`, `/analyze`, 오류 계약 |
| `frontend/` | React + TypeScript + Vite: 지도·조건 패널·결과 화면, Zod 응답 검증 |
| `data/runtime/` | 엔진 입력 데이터 (원본 `07_가공데이터`와 바이트 동일) |
| `data/geo/` | 인천 행정동 경계 158개 (2026-07 기준, 구월1·3동 SGIS 교정) |
| `tests/` | 무결성, 엔진 단위, 데이터 스키마, golden regression, location |
| `docs/` | 구조·엔진·데이터·작업·결정 (`ARCHITECTURE`, `ENGINE`, `DATA`, `TASKS`, `DECISIONS`), 8차 설계 `UX_REDESIGN`, 주간 보고 `reports/` |
| `frontend/spike/`, `docs/spikes/` | 개발 서버 전용 검수 페이지(빌드 밖)와 재현 기록 — 8-B0 지도 맞춤(`map-fit-spike.html`), A3 NAVER 다크 지도·스타일 실패 복구(`a3-naver-review.html`, `docs/spikes/a3-naver/README.md`) |

작업 규칙은 `CLAUDE.md`, UI 규칙은 `DESIGN.md`.
