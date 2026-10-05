# frontend (React + TypeScript + Vite)

현재 단계: 4-1 기반만 구축했다(서비스명·안내 문구만 있는 App). 다음 순서와 범위는 `docs/TASKS.md` 4장.

## 실행

Node `^20.19` 또는 `>=22.12` 필요 (Vite·Vitest 요구사항). `frontend/`에서 실행한다.

```bash
npm install        # package-lock.json 기준 설치 (CI·재현에는 npm ci)
npm run dev        # 개발 서버 (http://localhost:5173)
npm run check      # typecheck → lint → test (scripts/check.py가 자동 실행)
npm run build      # tsc -b + vite build → dist/
```

개별 스크립트: `npm run typecheck`(tsc, strict), `npm run lint`(ESLint), `npm run test`(Vitest + jsdom + Testing Library).

## 구조

```
src/
  main.tsx            진입점
  App.tsx / App.css   초기 화면 (DESIGN.md §5-A 최소판)
  App.test.tsx        smoke test: App 렌더링 → 서비스명 제목 확인
  styles/tokens.css   DESIGN.md §17 디자인 토큰 그대로 (값 변경은 DESIGN.md 먼저)
  styles/global.css   전역 기본 스타일
  test/setup.ts       jest-dom matcher, 테스트 후 cleanup
```

## 원칙

- UI는 `DESIGN.md`를 따른다. 컴포넌트는 토큰만 참조한다(hex·px 직접 사용 금지).
- scoring engine을 직접 호출하지 않는다. Backend API만 호출한다.
- 화면 시안 참고: `sources/team_v0.3/06_MVP화면/` (읽기 전용).
- 지도 API 키 등 secret은 `.env`에만 둔다. commit 금지(`.env.example`만 허용).
