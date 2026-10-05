# 우리동네 상권분석 매니저 — 웹 개발 저장소

인천 지도에서 위치와 업종을 고르면 v0.3 스코어링 엔진(`mvp-0.3`)으로 상권을 분석하는 웹 애플리케이션.
현재 상태: **MVP 구현 완료** — closeout(QA·배포 준비) 단계. 다음 작업은 `docs/TASKS.md` 5장.

## MVP 기능
- **지도 위치 선택**: NAVER Maps(Dynamic Map)에서 클릭하거나 좌표를 직접 입력. 마커 + 반경 500m 원 표시
- **업종 선택**: `GET /businesses`의 29개 업종·4개 그룹 (엔진 `config` 그대로, frontend 하드코딩 없음)
- **분석**: `POST /analyze` (FastAPI) → 좌표 → 인천 행정동 판정(`LocationResolver`) → `ContextBuilder` → 엔진 v0.3. 엔진 결과는 바꾸지 않고 그대로 전달
- **결과 화면**: 종합 점수, 5대 관점, 병목·주의할 점, 데이터 충족률, 세부지표, 데이터 출처 (`DESIGN.md`)
- **행정동 경계 강조**: 분석된 행정동 polygon을 지도에 표시 (`data/geo` 경계 파일을 backend와 같은 것으로 사용)
- 오류는 `error.code`별 안내 (인천 밖·바다, 주변 점포 없음, 입력 오류, 내부 오류 + request_id)

## 설치·검증

```powershell
.\scripts\setup.ps1      # .venv 생성 + Python 의존성 설치 (Python 3.10+)
.\scripts\check.ps1      # 전체 검증 — 완료 판정 기준 (원본 무결성, 엔진, golden 29/29, backend, frontend)
```
bash: `scripts/setup.sh`, `scripts/check.sh`. frontend 의존성은 `frontend/`에서 `npm install` (Node `^20.19` 또는 `>=22.12`).

## 개발 실행

```powershell
# 1) backend (저장소 루트, .venv 활성화 상태) — 데이터 로드 약 4s 뒤 요청 수신, 업종 warm은 background
python -m uvicorn backend.app.main:app --port 8000
```
```powershell
# 2) frontend (frontend/) — http://localhost:5173, /businesses·/analyze 는 vite dev proxy가 backend로 넘긴다
npm run dev
```
자세한 내용: `backend/README.md`, `frontend/README.md`.

## 환경변수 (값은 commit하지 않는다)

| 파일 | 용도 | 키 |
|---|---|---|
| `frontend/.env` | 지도 표시 (필수) | `VITE_NAVER_MAP_CLIENT_ID` — NAVER Maps Client ID만. Client Secret은 넣지 않는다. 선택: `BACKEND_URL` (dev proxy 대상) |
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
| `docs/` | 구조·엔진·데이터·작업·결정 (`ARCHITECTURE`, `ENGINE`, `DATA`, `TASKS`, `DECISIONS`) |

작업 규칙은 `CLAUDE.md`, UI 규칙은 `DESIGN.md`.
