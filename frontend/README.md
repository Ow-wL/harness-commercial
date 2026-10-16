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

- NAVER Cloud Platform 콘솔 → Maps → Application 등록 → **Dynamic Map**, 주소 기능용 **Geocoding**·**Reverse Geocoding**을 선택한다(선택하지 않으면 주소 호출만 실패하고 지도·분석은 그대로 — 실측 403). 브라우저 호출이라 Geocoding·Reverse Geocoding에 **일·월 사용량 한도와 알림**을 두기를 권한다(값은 운영자가 정함, `docs/ADDRESS_DESIGN.md` §9).
- **Web 서비스 URL**에 지도를 열 주소를 등록한다(개발: `http://localhost:5173`, 다른 포트를 쓰면 그 주소도). 등록하지 않은 주소에서는 인증 실패 화면이 나온다.
- `frontend/.env` (commit 금지, `.gitignore`):
  ```
  VITE_NAVER_MAP_CLIENT_ID=발급받은_Client_ID
  ```
  Client ID만 쓴다. **Client Secret은 frontend에 넣지 않는다**(브라우저에 그대로 노출된다). 값이 없는 템플릿은 `.env.example`.
- `.env`를 바꾸면 개발 서버를 다시 시작한다. Client ID가 없거나 SDK 로드·인증이 실패하면 지도 자리에 설정/오류 안내가 나오고, 패널의 "좌표 직접 입력"으로 위치를 고를 수 있다.
- SDK는 `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=…&submodules=geocoder&callback=__naverMapsReady`를 singleton으로 한 번만 붙인다(`src/map/naverMaps.ts`). Geocoder 서브모듈(`maps-geocoder.js`)은 SDK가 뒤에 붙이며, 준비 여부는 지도와 따로 본다 — 서브모듈이 실패해도 지도는 그대로 쓴다(7-B1, `docs/ADDRESS_DESIGN.md` §5.1). 주소 기능을 켜려면 콘솔 Application에서 **Geocoding·Reverse Geocoding**을 선택해야 한다(미선택이면 호출이 403/429로 실패하고 지도는 영향 없음).
- **참고 주소**(7-B2·B3): 선택 좌표의 역지오코딩 결과를 "참고 주소 · {도로명 또는 지번} (NAVER 지도)"로 위치 필드·mobile sheet·결과 패널, 두 위치 비교의 B 카드·비교 요약 A/B 카드·A/B 전체 결과에 보인다(A는 A 좌표, B는 B 좌표). 분석 행정동(Context Bar·제목)은 backend `context` 그대로이고 주소는 분석에 쓰지 않는다. 좌표마다 1회만 조회(캐시)하며, 조회 실패·주소 없음·Geocoder 미준비에서는 줄이 없고 분석에는 영향이 없다.
- 선택 키(값은 commit 금지): `VITE_NAVER_MAP_GL=1`이면 제품 지도를 GL 벡터 지도로 띄운다(검수용, 기본 끔 — 하드웨어 WebGL2가 없으면 SDK가 래스터로 대체). `VITE_NAVER_MAP_STYLE_ID`는 NAVER Style Editor My Style ID로, 지금은 검수 스파이크 `spike/a3-naver-review.html`에서만 읽는다(제품 다크 지도는 UI 개편 단위, `DESIGN.md` §19).
- **지도 범위 맞춤**(8-B1, D-022): 새 위치를 고르면 반경 원이 지도의 사용 영역(범례·안내·점포 막대·SDK 컨트롤을 뺀 곳)에 들도록 zoom·중심을 옮긴다(`src/map/mapFit.ts`). 지도 `init` 전·숨김 중에는 미뤘다가 1회, 사용자가 휠·드래그로 바꾸면 미룬 자동 맞춤은 하지 않는다. 범례의 "범위에 맞추기"는 무조건 맞춘다. 단일 점포 정보창은 사용 영역 안에서 선택 지점을 가리지 않게 연다. 비교 중에는 8-B2 전까지 기존 `panTo`.
- **주소로 찾기**(7-B4, 단일 위치): 위치 필드의 "주소로 찾기"에서 주소를 검색(제출 때만 1회 호출)하고 결과를 고르면 그 좌표로 위치를 고른다(분석은 "분석하기"를 눌러야 시작). 인천 밖 결과도 고를 수 있고 분석 가능 여부는 backend가 판정한다. Geocoder가 준비되지 않았거나 SDK가 실패하면 버튼이 없고 지도 클릭·좌표 입력은 그대로다. 비교 중에는 B 카드의 "B 주소로 찾기"(7-B5)가 같은 방식으로 B 위치만 고른다(A는 그대로, 고른 뒤 "B 분석하기"). mobile 비교 sheet에는 검색이 없고 패널에서 쓴다.

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
  components/AddressSearch.tsx  주소로 찾기(단일 위치 7-B4, 비교 B 7-B5 — labelPrefix "B "): 펼침 버튼·폼·aria-live 상태·결과 목록 → onSelect({lat,lng}). 요청 번호로 늦은 응답 폐기
  lib/useSearchFocusRecovery.ts  SDK 실패로 검색이 포커스를 가진 채 사라지면 남은 기본 조작(좌표 직접 입력 / B 위도·B 카드 제목)으로
  lib/addressSearch.ts  검색 기준점(인천시청)·결과 수(10, 처음 5)·인천 먼저 정렬
  map/dongBoundary.ts   분석된 행정동 경계: data/geo 원본을 ?url로 참조(복사하지 않음), context의 (gu_code, dong_name)으로 찾음
  map/mapFit.ts         지도 범위 맞춤 순수 계산(8-B1): 사용 영역 U, 원 사각형, 맞춤 zoom, GL/래스터 환산, 정보창 위치 후보
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
