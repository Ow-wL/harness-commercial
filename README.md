# 우리동네 상권분석 매니저 — 웹 개발 저장소

인천 지도에서 위치와 업종을 고르면 v0.3 스코어링 엔진으로 상권을 분석하는 웹 애플리케이션 (개발 중).
현재 상태: 엔진을 보호하는 Harness만 있다. 웹 기능 없음.

```powershell
.\scripts\setup.ps1      # .venv 생성 + 의존성 설치 (Python 3.10+)
.\scripts\check.ps1      # 전체 검증 (약 1분 20초)
```
bash: `scripts/setup.sh`, `scripts/check.sh`

| 경로 | 내용 |
|---|---|
| `sources/team_v0.3/` | 팀 원본 (읽기 전용) |
| `scoring_engine/` | 엔진 v0.3 사본(`v0_3/`) + 데이터 로더·캐시·adapter |
| `data/runtime/` | 엔진 입력 데이터 |
| `tests/` | 무결성, 엔진 단위, 데이터 스키마, golden regression |
| `docs/` | 구조·엔진·데이터·작업·결정 |

작업 규칙은 `CLAUDE.md`.
