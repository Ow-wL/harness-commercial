# frontend (예정: React + TypeScript)

아직 구현하지 않았다. 순서와 범위는 `docs/TASKS.md` 4장.

원칙
- scoring engine을 직접 호출하지 않는다. Backend API만 호출한다.
- 화면 시안 참고: `sources/team_v0.3/06_MVP화면/` (page.html + data.js는 엔진 출력 PC방 1건을 손으로 옮긴 정적 스냅샷).
- 지도 API 키는 `.env`에만. commit 금지.
- `package.json`에 `check` 스크립트(tsc·lint·test)를 만들면 `scripts/check.py`가 자동 실행한다.
