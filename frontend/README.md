# frontend (React + TypeScript + Vite)

현재 단계: MVP 완료 (`docs/TASKS.md` 4장 4-0~4-4: NAVER 지도 + 위치·업종 선택 + 실제 backend 분석 흐름). 남은 closeout 작업은 5장.

## 실행

Node `^20.19` 또는 `>=22.12` 필요 (Vite·Vitest 요구사항). `frontend/`에서 실행한다.

```bash
npm install        # package-lock.json 기준 설치 (CI·재현에는 npm ci)
npm run dev        # 개발 서버 (http://localhost:5173)
npm run check      # typecheck → lint → test (scripts/check.py가 자동 실행)
npm run build      # tsc -b + vite build → dist/
```

개별 스크립트: `npm run typecheck`(tsc, strict), `npm run lint`(ESLint), `npm run test`(Vitest + jsdom + Testing Library).

### 개발 실행 순서 (backend + frontend)

1. backend (저장소 루트): `python -m uvicorn backend.app.main:app --port 8000`
   — 데이터 로드 약 4s 뒤 요청을 받는다. 업종 reference warm은 background(약 60s), 미warm 업종 첫 분석은 약 2.5s.
2. frontend (`frontend/`): `npm run dev`
   — vite dev proxy가 `/businesses`·`/analyze`를 `http://127.0.0.1:8000`으로 넘긴다(backend에 CORS 없음).
   backend 주소가 다르면 `frontend/.env`에 `BACKEND_URL=http://host:port` (VITE_ 접두어 없음 → 브라우저 번들에 들어가지 않음).
3. 브라우저에서 `http://localhost:5173`.

`npm run build` 결과(`dist/`)를 배포할 때는 같은 origin에서 `/businesses`·`/analyze`를 backend로 넘기는 reverse proxy가 필요하다(dev proxy는 개발 서버에서만 동작).

### NAVER Maps 설정

- NAVER Cloud Platform 콘솔 → Maps → Application 등록 → **Dynamic Map** 사용 설정.
- **Web 서비스 URL**에 지도를 열 주소를 등록한다(개발: `http://localhost:5173`, 다른 포트를 쓰면 그 주소도). 등록하지 않은 주소에서는 인증 실패 화면이 나온다.
- `frontend/.env` (commit 금지, `.gitignore`):
  ```
  VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
  ```
  Client ID만 쓴다. **Client Secret은 frontend에 넣지 않는다**(브라우저에 그대로 노출된다). 값이 없는 템플릿은 `.env.example`.
- `.env`를 바꾸면 개발 서버를 다시 시작한다. Client ID가 없거나 SDK 로드·인증이 실패하면 지도 자리에 설정/오류 안내가 나오고, 패널의 "좌표 직접 입력"으로 위치를 고를 수 있다.
- SDK는 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=…`를 singleton으로 한 번만 붙인다(`src/map/naverMaps.ts`).

## 구조

```
src/
  main.tsx              진입점
  App.tsx / App.css     상태(위치·업종·분석) + shell: Header · 조건/결과 패널 · 지도 (DESIGN.md §4.3·§14)
  App.test.tsx          흐름 테스트 (fetch mock, MapView mock)
  api/schemas.ts        API 응답 Zod schema (source of truth) + z.infer 타입
  api/client.ts         GET /businesses · POST /analyze. 응답은 모두 schema 검증, 실패는 api/network/schema로 구분
  map/naverMaps.ts      NAVER Maps SDK singleton loader + 이 앱이 쓰는 SDK 타입
  map/dongBoundary.ts   분석된 행정동 경계: data/geo 원본을 ?url로 참조(복사하지 않음), context의 (gu_code, dong_name)으로 찾음
  components/MapView    지도 클릭 → 좌표, 마커 + 반경 500m 원, 행정동 경계 강조. SDK는 여기서만 쓴다
  components/ConditionPanel  단계 표시 · 위치(좌표 직접 입력 포함) · 업종 select(그룹) · 분석하기
  components/ErrorBlock      error.code별 오류 블록, internal_error request_id 복사
  components/AnalysisStatus  분석 중 skeleton · 분석 전 빈 상태
  components/AnalysisResult  결과 (4-3) — OverallScore · PerspectiveScores · CoverageMeta · WarningPanel ·
                             BeginnerAccess · IndicatorDetails · DataSources · ContextBar · Chip · Icon
  lib/format.ts         표시 형식(점수 소수 1자리, %, 신뢰도·해상도 표기) — 값을 재계산하지 않는다
  lib/errorView.ts      실패 → 오류 문구·위치·다음 행동 (DESIGN.md §10.3 표)
  fixtures/             bupyeong-pcbang.json = 실제 POST /analyze 응답 캡처 (테스트 전용, 화면 데이터 아님)
  styles/tokens.css     DESIGN.md §17 디자인 토큰 그대로 (값 변경은 DESIGN.md 먼저)
  styles/global.css · controls.css   전역 기본 · 버튼/입력 공통
  test/setup.ts         jest-dom matcher, 테스트 후 cleanup
```

## 원칙

- frontend는 backend API(`/businesses`, `/analyze`)만 호출한다. scoring engine을 직접 호출하지 않는다.
- API 데이터는 Zod로 runtime validation하고 타입은 schema에서 추론한다(`z.infer`). 같은 내용의 interface를 손으로 쓰지 않는다. 검증 실패는 화면 오류 + console.error로 드러낸다.
- 오류는 `error.code`로만 분기한다(`message`로 분기하지 않는다, D-014).
- 행정동 판정은 backend(ContextBuilder)가 한다. frontend는 geocoding·reverse geocoding·point-in-polygon을 하지 않는다.
- 엔진 결과를 재계산·반올림·번역·key 재구성하지 않는다.
- UI는 `DESIGN.md`를 따른다. 색·spacing·radius·글꼴은 토큰, 컴포넌트별 고정 치수는 DESIGN 본문 값.
- 업종 목록을 frontend에 하드코딩하지 않는다(GET /businesses).
- 테스트 fixture 갱신: backend에서 `POST /analyze {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}` 응답을 그대로 저장한다(손으로 고치지 않는다).
- 화면 시안 참고: `sources/team_v0.3/06_MVP화면/` (읽기 전용).
