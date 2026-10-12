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

production에서는 FastAPI가 `dist/`를 같은 origin에서 서빙한다(`FRONTEND_DIST`, D-018) — reverse proxy·Node 서버 없음. 이미지 build는 저장소 루트 `Dockerfile`(vite build만, NAVER Client ID는 build arg).

### NAVER Maps 설정

- NAVER Cloud Platform 콘솔 → Maps → Application 등록 → **Dynamic Map** 사용 설정.
- **Web 서비스 URL**에 지도를 열 주소를 등록한다(개발: `http://localhost:5173`, 다른 포트를 쓰면 그 주소도). 등록하지 않은 주소에서는 인증 실패 화면이 나온다.
- `frontend/.env` (commit 금지, `.gitignore`):
  ```
  VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
  ```
  Client ID만 쓴다. **Client Secret은 frontend에 넣지 않는다**(브라우저에 그대로 노출된다). 값이 없는 템플릿은 `.env.example`.
- `.env`를 바꾸면 개발 서버를 다시 시작한다. Client ID가 없거나 SDK 로드·인증이 실패하면 지도 자리에 설정/오류 안내가 나오고, 패널의 "좌표 직접 입력"으로 위치를 고를 수 있다.
- SDK는 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=…&submodules=geocoder&callback=__naverMapsReady`를 singleton으로 한 번만 붙인다(`src/map/naverMaps.ts`). Geocoder 서브모듈(`maps-geocoder.js`)은 SDK가 뒤에 붙이며, 준비 여부는 지도와 따로 본다 — 서브모듈이 실패해도 지도는 그대로 쓴다(7-B1, `docs/ADDRESS_DESIGN.md` §5.1). 주소 기능을 켜려면 콘솔 Application에서 **Geocoding·Reverse Geocoding**을 선택해야 한다(미선택이면 호출이 403/429로 실패하고 지도는 영향 없음).
- **참고 주소**(7-B2·B3): 선택 좌표의 역지오코딩 결과를 "참고 주소 · {도로명 또는 지번} (NAVER 지도)"로 위치 필드·mobile sheet·결과 패널, 두 위치 비교의 B 카드·비교 요약 A/B 카드·A/B 전체 결과에 보인다(A는 A 좌표, B는 B 좌표). 분석 행정동(Context Bar·제목)은 backend `context` 그대로이고 주소는 분석에 쓰지 않는다. 좌표마다 1회만 조회(캐시)하며, 조회 실패·주소 없음·Geocoder 미준비에서는 줄이 없고 분석에는 영향이 없다. 주소 검색은 아직 없다(7-B4).

## 구조

```
src/
  main.tsx              진입점
  App.tsx / App.css     상태(위치·업종·분석) + shell: Header · 조건/결과 패널 · 지도 (DESIGN.md §4.3·§14)
  App.test.tsx          흐름 테스트 (fetch mock, MapView mock)
  api/schemas.ts        API 응답 Zod schema (source of truth) + z.infer 타입
  api/client.ts         GET /businesses · POST /analyze · POST /nearby-stores. 응답은 모두 schema 검증, 실패는 api/network/schema로 구분
  map/naverMaps.ts      NAVER Maps SDK singleton loader + 이 앱이 쓰는 SDK 타입, 지도/Geocoder 준비 상태(SdkState)
  map/geocoder.ts       Geocoder 서브모듈 adapter(콜백 → 결과 객체, 7-B1)
  lib/addressCache.ts   참고 주소 캐시: 좌표 키 그대로, LRU 100, 진행 중 조회 공유, 오류 60초 뒤 다음 조회 때만 재시도 (7-B2)
  lib/useReferenceAddress.ts  좌표 하나의 참고 주소 hook — SDK ready + Geocoder ready일 때만 조회, 현재 좌표의 캐시만 표시
  components/ReferenceAddress.tsx  "참고 주소 · … (NAVER 지도)" 한 줄 (성공일 때만). 단일: 위치 필드·mobile sheet·결과 패널, 비교: B 카드·A/B 카드·전체 결과
  lib/keepFocusInView.ts  늦게 생긴 주소 줄이 아래의 포커스 요소를 화면 밖으로 밀었을 때만 밀린 만큼 되돌림 (7-B3)
  map/dongBoundary.ts   분석된 행정동 경계: data/geo 원본을 ?url로 참조(복사하지 않음), context의 (gu_code, dong_name)으로 찾음
  components/MapView    지도 클릭 → 좌표, 마커 + 반경 500m 원, 행정동 경계 강조, 두 위치 비교 A/B 표시(compare prop). SDK는 여기서만 쓴다
  components/ConditionPanel  단계 표시 · 위치(좌표 직접 입력 포함) · 업종 select(그룹) · 분석하기
  components/CoordinateForm  위도·경도 입력(지도 클릭의 키보드 대안). 조건 패널과 두 위치 비교(B)가 같이 쓴다
  components/ComparePanel    두 위치 비교 B 고르기: A 요약 · B 위치 입력·분석·오류(패널) + CompareSheet(mobile sheet)
  components/CompareResult   두 위치 비교 요약(점수 표·표시용 차이·안내·위치별 경고·원시값·출처) + CompareDetail(위치별 전체 결과)
  components/ErrorBlock      error.code별 오류 블록, internal_error request_id 복사
  components/AnalysisStatus  분석 중 skeleton · 분석 전 빈 상태
  components/AnalysisResult  결과 (4-3) — OverallScore · PerspectiveScores · CoverageMeta · WarningPanel ·
                             BeginnerAccess · IndicatorDetails(+ ScoreGuide) · DataSources · ContextBar · LocationSummary · NearbyStores · Chip · Icon
  lib/format.ts         표시 형식(점수 소수 1자리, %, 신뢰도·해상도 표기) — 값을 재계산하지 않는다
  content/scoreGuide.ts 5대 관점 설명 정적 문장 (근거: docs/SCORE_GUIDE_SOURCES.md). 결과 값은 넣지 않는다
  lib/errorView.ts      실패 → 오류 문구·위치·다음 행동 (DESIGN.md §10.3 표)
  lib/warnings.ts       "주의할 점" 문장(병목 경고 표시 문장·데이터 한계). WarningPanel과 두 위치 비교가 같이 쓴다
  lib/compareState.ts   두 위치 비교 B 분석 상태 타입 · 포커스 대상 id · 좌표 일치 판정
  lib/useNearbyRequest.ts  동종 점포 조회 1벌(요청 번호·취소·응답 조건 대조). A·B 점포가 각자 쓴다
  lib/compare.ts        두 위치 비교 표시 규칙(표시용 차이 A−B, 같은 구·동, 적용 가중치, 미산출, 반경 겹침, 원시값) — docs/COMPARE_DESIGN.md
  fixtures/             실제 POST /analyze 응답 캡처 (테스트 전용, 화면 데이터 아님)
                        bupyeong-pcbang.json = 부평역·PC방(정상 산출) / bupyeong-nailshop.json = 부평역·네일숍(안정성 미산출 + 병목 < 25)
                        bupyeong-pcbang-nearby.json = 같은 조건의 POST /nearby-stores 응답(12곳)
                        compare-*.json = 두 위치 비교 B 후보(PC방): guwol 다른 구 / bupyeong1b 같은 동 /
                          ganghwa 안정성 미산출 / songdo 동종 점포 0곳·경쟁성 미산출 (좌표는 docs/COMPARE_DESIGN.md 10.1)
                        compare-guwol-pcbang-nearby.json · compare-songdo-pcbang-nearby.json = 같은 조건의 POST /nearby-stores 응답(6곳·0곳)
  styles/tokens.css     DESIGN.md §17 디자인 토큰 그대로 (값 변경은 DESIGN.md 먼저)
  styles/global.css · controls.css   전역 기본 · 버튼/입력 공통
  test/setup.ts         jest-dom matcher, 테스트 후 cleanup
  test/a11yRefs.ts      테스트용 id 중복·접근성 참조 검사(펼친 뒤 aria-controls)
```

## 원칙

- frontend는 backend API(`/businesses`, `/analyze`)만 호출한다. scoring engine을 직접 호출하지 않는다.
- API 데이터는 Zod로 runtime validation하고 타입은 schema에서 추론한다(`z.infer`). 같은 내용의 interface를 손으로 쓰지 않는다. 검증 실패는 화면 오류 + console.error로 드러낸다.
- 오류는 `error.code`로만 분기한다(`message`로 분기하지 않는다, D-014).
- 행정동 판정은 backend(ContextBuilder)가 한다. frontend는 geocoding·reverse geocoding·point-in-polygon을 하지 않는다.
- 엔진 결과를 재계산·반올림·번역·key 재구성하지 않는다.
- UI는 `DESIGN.md`를 따른다. 색·spacing·radius·글꼴은 토큰, 컴포넌트별 고정 치수는 DESIGN 본문 값.
- 업종 목록을 frontend에 하드코딩하지 않는다(GET /businesses).
- 테스트 fixture 갱신: backend에서 `POST /analyze {"lat": 37.4894, "lng": 126.7246, "biz_code": "R10406"}`(네일숍은 `"S20703"`) 응답을, 동종 점포는 같은 body의 `POST /nearby-stores` 응답을 그대로 저장한다(손으로 고치지 않는다).
- 화면 시안 참고: `sources/team_v0.3/06_MVP화면/` (읽기 전용).
