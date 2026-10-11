# 주소 표시·주소 검색 설계 (7차-A)

작성 2026-10-12 · 기준 커밋 `fdb9eab` · 상태: **설계 검수 대기 — 구현·배포 시작하지 않음**

목표: 사용자가 (1) 주소로 위치를 찾아 기존 좌표 분석 흐름으로 넘기고, (2) 고른 좌표의 주소를 참고 정보로 볼 수 있게 한다.
분석 행정동은 지금처럼 backend `context`가 결정하며, 주소는 어떤 경우에도 분석 입력·결과를 바꾸지 않는다.

---

## 1. 범위

| 포함 | 제외 (이번 범위 아님) |
|---|---|
| 주소 검색(정방향 지오코딩) → 결과 선택 → 기존 좌표 선택 경로(단일 위치·비교 B) | 자동완성(입력 중 호출), 지명·상호(POI) 검색 |
| 선택 좌표의 참고 주소 표시(역방향 지오코딩): 분석 전 위치 필드·mobile sheet, 분석 후 결과 패널, 비교 A/B 카드 | NAVER 행정동(admcode)으로 분석 행정동을 바꾸거나 비교 안내하는 것 |
| 외부 API 실패·주소 없음·할당량 초과 시 기존 표시(행정동·최근접역·좌표)로 복귀 | 엔진·backend API·데이터·지도 크기·이동·확대 변경 |
| 단일·비교 A/B가 섞이지 않는 캐시·취소·늦은 응답 처리 | Client Secret을 쓰는 서버 경유 호출(대안으로만 기록, §4.2) |

---

## 2. 현재 상태 조사 (코드)

- **SDK 로더** `frontend/src/map/naverMaps.ts`: `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId={VITE_NAVER_MAP_CLIENT_ID}`를 singleton으로 1회 삽입. 서브모듈 없음. 실패 종류 `config`(ID 없음)·`load`·`auth`(`window.navermap_authFailure`). 타입은 이 앱이 쓰는 SDK 일부만 선언(`NaverMapsApi`에 `Service` 없음).
- **키 처리**: Client ID만 `VITE_NAVER_MAP_CLIENT_ID`(build arg → 번들, 공개 값). Client Secret은 어디에도 없다(frontend README·Dockerfile·D-018). backend에 외부 HTTP 호출·CORS 없음(`requirements.txt`의 httpx2는 TestClient용).
- **위치 입력 경로**(모두 좌표 `{lat, lng}` 하나로 수렴):
  - 지도 클릭 → `MapView` `onSelect`(소수 6자리 반올림) → `App.selectLocation` (비교 중이면 `selectCompareLocation`)
  - 좌표 직접 입력 → `CoordinateForm.onSubmit` → 단일: `ConditionPanel.onLocationInput` = `selectLocation`, 비교 B: `ComparePanel.onLocationSubmit` = `submitCompareLocation`(받아들이면 포커스를 "B 분석하기"로)
  - 분석 요청은 `analysis.request`/`compare.location` 좌표 그대로 `/analyze`로 간다. backend가 `context`(구·행정동)를 돌려주고 frontend는 `matchesRequest`로 좌표 일치를 확인한다.
- **위치 표시 자리**: 분석 전 `ConditionPanel.LocationField`("선택됨 · 좌표")·mobile `.map-sheet`("선택됨 · 좌표"), 분석 후 `ContextBar`(행정동 칩)·`LocationSummary`(최근접역 + 접힌 "좌표 보기")·결과 제목. 비교: `ComparePanel` B 카드("선택됨 · 좌표"), `CompareResult` A/B 카드와 `CompareDetail` 막대가 각자 `LocationSummary`를 쓴다.
- **요청 1벌 패턴**: `useNearbyRequest`(요청 번호 + AbortController, 늦은 응답 폐기, A·B 각각 인스턴스). 주소 조회도 같은 원칙으로 설계한다(§5.3).
- **DESIGN.md 현행 규칙**: §8.5 "행정동 이름이며 도로명주소가 아니다 … 주소 검색·역지오코딩·외부 지명 API는 쓰지 않는다", §5.D "분석 전에는 좌표만 보여 준다(지어내지 않는다)". 이 설계는 이 규칙을 **"분석 행정동은 context, 주소는 참고 정보(출처 표기)"**로 개정하는 것을 전제한다(§5.6).

---

## 3. NAVER 공식 문서 확인 (2026-10-12 열람)

### 3.1 제공 방식 두 가지

| 방식 | 호출 주체 | 인증 | 출처 |
|---|---|---|---|
| **Web SDK Geocoder 서브모듈** `maps.js?ncpKeyId=…&submodules=geocoder` → `naver.maps.Service.geocode / reverseGeocode` | 브라우저 | **Client ID(ncpKeyId)만**. "Geocoding / Reverse Geocoding API를 사용하려면 클라이언트 아이디를 이용해서 인증해야 합니다." 등록된 Client ID와 **웹 서비스 URL이 일치하는 페이지에서만** 동작 | [Geocoder 튜토리얼](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Geocoder-Geocoding.html), [geocoder 모듈](https://navermaps.github.io/maps.js.ncp/docs/module-geocoder.html), [Service 레퍼런스](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Service.html) |
| **REST** `GET https://maps.apigw.ntruss.com/map-geocode/v2/geocode`, `GET …/map-reversegeocode/v2/gc` | 서버(또는 브라우저) | 헤더 `x-ncp-apigw-api-key-id`(Client ID) + **`x-ncp-apigw-api-key`(Client Secret)** 둘 다 필수 | [Maps API 개요](https://api.ncloud-docs.com/docs/ko/application-maps-overview), [Geocoding](https://api.ncloud-docs.com/docs/ko/application-maps-geocoding), [Reverse Geocoding](https://api.ncloud-docs.com/docs/ko/application-maps-reversegeocoding) |

→ 기존 계획의 "Client ID만으로 가능"은 **Web SDK 서브모듈 경로에 한해 사실**이다. REST를 직접 부르려면 Client Secret이 필요하므로 브라우저에서는 쓸 수 없고 서버 경유가 필요하다.

### 3.2 API 활성화 조건 (둘 다 동일)
- Application 설정에서 **Geocoding과 Reverse Geocoding을 각각 선택**해야 한다. 문서상 선택하지 않은 API를 부르면 **429 (Quota Exceed)**. (geocoder 모듈 "사전 준비 사항", Maps API 개요) — 7-B0 실측(§11)에서는 **403**이 왔고 원인은 아직 확인되지 않았다(문서의 429와 다르며, 미선택·상품 소속·권한·URL 중 어느 것인지 콘솔 확인 전에는 단정하지 않는다).
- Web Dynamic Map은 **Web 서비스 URL** 등록이 필수(최대 10개, http/https 구분 없음, www 생략). 미등록 URL에서는 인증 실패(`navermap_authFailure`). 이미 등록된 `http://localhost:5173`·Cloud Run URL이 Geocoder에도 그대로 적용된다.
- 서브모듈 호출도 **같은 Application의 Geocoding/Reverse Geocoding 일일 허용량을 소비**한다("Geocoder는 Geocoding와 ReverseGeocoding의 일일 허용량을 사용합니다"). 요금은 Web SDK·REST 구분 없이 **상품별로 부과**된다.

### 3.3 요금 (ncloud 포털 Maps 상품 "요금" 탭, 리전 한국, VAT 별도)

| 상품 | 과금 기준 | 월 무료 이용량(**대표 계정 1개 한정**) | 초과 요금 |
|---|---|---|---|
| Dynamic Map | 이용 횟수 | 6,000,000건 | 0.1원/건 |
| Static Map | 이용 횟수 | 3,000,000건 | 2원/건 |
| **Geocoding** | 이용 횟수 | **3,000,000건** | **0.5원/건** |
| **Reverse Geocoding** | 이용 횟수 | **3,000,000건** | **0.5원/건** |
| Directions 5 / 15 | 이용 횟수 | 60,000건 / 3,000건 | 5원 / 20원 |

- 포털 각주: "**AI NAVER API 내 지도 API 상품은 무료 이용량을 제공하지 않습니다.**" — [공지 1965](https://www.ncloud.com/support/notice/all/1965)(2025-05-28, 수정 2025-06-24): 2025-03 지도 전용 상품 **'Maps'** 신규 출시, **2025-07-01부터 구 'AI NAVER API > 지도 API'(7종)는 월 무료 이용량 종료·100% 유료**, 점진 종료 예정. 무료 이용량은 신규 'Maps' 상품에서만 제공.
- 대표 계정([FAQ 2829](https://www.ncloud.com/support/faq/prod/2829)): 같은 전화번호(개인)/사업자번호(사업자)의 여러 계정 중 **Maps API를 가장 먼저 등록한 계정 1개**만 무료. 콘솔 Application 화면 "대표 계정 확인"으로 조회, 아니면 신청 시 '무료이용량 미제공' 팝업. 변경은 신청서(자료실) 제출.
- 무료 이용량([FAQ 2828](https://www.ncloud.com/support/faq/prod/2828)): 신청 없이 자동, **계정당**(Application 여러 개면 합산). 콘솔 [Maps > Application > 한도 및 알림 설정]로 무료량 안에서만 쓰게 상한을 둘 수 있다.
- 호출 한도([Application 가이드](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)): Geocoding·Reverse Geocoding 기본 3,000,000 / 일 최대 7,500,000 / 월 최대 25,000,000. 한도는 매일 0시·매월 1일 초기화, 변경 이력 기록, 통보 대상(사전 등록 수신자)에게 알림. 실시간 사용량 반영 약 1분.
- 이 앱의 예상 사용량: 분석 1회당 역지오코딩 ≤ 1건(좌표 캐시), 주소 검색은 제출 1회당 1건(자동완성 없음). 시연·과제 규모에서는 무료 이용량 안이다. 단, **대표 계정이 아니거나 Application이 구 AI NAVER API 소속이면 첫 호출부터 과금**된다(§9 확인 항목).

### 3.4 응답 구조·상태 (설계에 쓰는 부분만)
- `geocode({query, coordinate:'lng,lat', filter, page, count})` → `callback(status, response)`; `status`는 `Service.Status.OK(200)|ERROR(500)`; `response.v2 = {status:'OK'|'INVALID_REQUEST'|'SYSTEM_ERROR', meta:{totalCount,page,count}, addresses:[{roadAddress, jibunAddress, englishAddress, addressElements:[{types[],longName,shortName,code}], x(경도 문자열), y(위도 문자열), distance}], errorMessage}`. `coordinate`를 주면 가까운 순 정렬·`distance`(m) 제공. `filter`는 `HCODE@행정동코드;…`(행정동) / `BCODE@…`(법정동). `count` 1~100(기본 10).
- `reverseGeocode({coords:'lng,lat'|Coord, orders:'roadaddr,addr'})` → `response.v2 = {status:{code,name,message}, results:[{name, code:{id,type,mappingId}, region:{area0..area4:{name,…}}, land:{type,number1,number2,name,addition0…}}], address:{roadAddress, jibunAddress}}`. 상태 코드 `0 ok` / `3 no results`(성공이지만 결과 없음 — 해안·신규 개발지) / `100 invalid request` / `900 unknown error`. REST 가이드: `legalcode`·`admcode`는 동 단위까지는 나와도 `addr`·`roadaddr`는 비어 있을 수 있다.
- REST Geocoding 상태: 200 OK / 400 INVALID_REQUEST / 500 SYSTEM_ERROR, `errorMessage`는 500에서만. 429는 할당량·미선택 API.
- 레퍼런스의 `OrderType` 설명문은 서로 뒤바뀌어 있다(`ADDR`가 행정동으로 적힘). 설계는 **문자열 `'roadaddr,addr'`를 직접 넘기고** 결과는 `v2.address.roadAddress/jibunAddress`로 읽는다. 구현 첫 단계(7-B0 스파이크)에서 실제 응답으로 확인한다.

---

## 4. 결정

### 4.1 채택안: Web SDK Geocoder 서브모듈, Client ID만 (추천)
- 이유: ① 인증 정보 추가 없음(Client Secret을 어디에도 두지 않는 D-018 원칙 유지), ② backend·Dockerfile·Cloud Run 환경변수 변경 없음 → 외부 API 장애가 `/analyze` 경로와 완전히 분리됨, ③ 이미 등록된 Web 서비스 URL·같은 Client ID로 동작, ④ 요금·한도가 Application 단위로 콘솔에서 관리됨.
- 비용·보안 한계와 대응: 호출이 브라우저에서 나가므로 서버 측 횟수 제한을 걸 수 없다. 도메인 제한(등록 URL)이 1차 방어이고, **콘솔 "한도 및 알림 설정"으로 일·월 상한을 둔다**(§9). 앱은 자동완성을 하지 않고(제출 시 1회), 좌표별 결과를 세션 캐시한다(§5.3).
- 지도 SDK가 실패(ID 없음·로드·인증 실패)하면 주소 기능도 함께 없다 → 기존처럼 좌표 입력으로 분석은 계속된다. 주소는 부가 기능이므로 받아들인다.

### 4.2 대안: backend 프록시(REST + Client Secret) — 보류
- 필요해지는 조건: 서버 측 횟수 제한·감사 로그·결과 캐시 공유가 필요하거나, NAVER가 Web SDK 서브모듈 지원을 바꿀 때.
- 그때 요구사항: Cloud Run Secret Manager로 `NAVER_MAPS_CLIENT_SECRET` 주입, `httpx` 의존 추가, `/geocode`·`/reverse-geocode` 라우트(오류 계약 D-014 확장, 외부 오류는 502 별도 코드), 응답 캐시(좌표 반올림 키), 외부 호출 timeout·실패가 `/analyze`에 영향 없음을 테스트로 고정. 이번 설계에서는 구현하지 않는다.

### 4.3 유지하는 원칙
- 분석 행정동·결과 제목·Context Bar 칩 = backend `context` 그대로(D-010). NAVER `admcode`는 **읽지도 표시하지도 않는다**(두 기준이 다른 좌표에서 사용자를 혼란스럽게 하고, 경계 교정 D-017과 충돌할 수 있다).
- 주소는 "참고 주소"로 부르고 출처(NAVER 지도)를 표기한다. 분석 좌표·요청 body·응답 검증(`matchesRequest`)은 바뀌지 않는다.
- Frontend → Backend → Context Builder → Engine 구조는 그대로. 주소 모듈은 `src/map/`(SDK 경계) 아래 adapter로 두고 분석 상태를 참조하지 않는다.

---

## 5. 설계

### 5.1 모듈 경계
```
src/map/naverMaps.ts        로더: URL에 &submodules=geocoder 추가, NaverMapsApi.Service 타입(선택적)
src/map/geocoder.ts         SDK adapter: 콜백 → Promise, 응답 Zod 검증, timeout, 오류 종류. 분석 상태를 모른다
src/lib/addressCache.ts     좌표 키 → 참고 주소 상태의 모듈 캐시(LRU 100) + in-flight dedupe
src/lib/useReferenceAddress.ts  hook: 좌표 하나의 참고 주소(캐시 우선, 늦은 응답은 키로만 반영)
src/components/ReferenceAddress.tsx  "참고 주소" 한 줄 (성공일 때만 그린다)
src/components/AddressSearch.tsx     주소 검색 폼 + 결과 목록 → onSelect({lat,lng})
```
- **로더 준비 시점(7-B0 실측)**: `maps.js`의 `load` 이벤트는 서브모듈 스크립트(`maps-geocoder.js`, SDK가 뒤에 따로 붙인다)보다 **먼저** 온다 — 그 시점에 `naver.maps.Service`는 없다(11ms: Service false). SDK `callback=` 파라미터로 지정한 함수는 **서브모듈까지 준비된 뒤** 불린다(12ms: Service true).
- **지도 준비와 Geocoder 준비를 분리한다** (SDK는 지금처럼 **한 번만** 로드하고, 지도 인스턴스는 지금처럼 `load` 뒤 바로 만들어 유지한다 — 지도 생성 시점·방식은 바꾸지 않는다):
  - 지도 준비 = 기존 `loadNaverMaps`의 `load` 이벤트(`window.naver.maps` 존재). 기존 `config`/`load`/`auth` 실패 처리 그대로.
  - Geocoder 준비 = `&callback=__naverMapsReady`(모듈 고정 전역)가 불리고 `isGeocoderAvailable(api)`가 true일 때. 콜백이 `load` 뒤 **10초** 안에 오지 않거나 왔는데 `Service`가 없으면 Geocoder만 `unavailable`로 둔다 — **지도는 그대로 쓴다**. `submodules=geocoder`가 지도 로드 자체를 깨는 사례가 7-B0에서 없었지만(§11), 만약 보이면 로더 상수에서 `submodules`를 빼고 주소 기능만 끈다.
- **SDK 상태 계약** — `MapView`가 `onSdkState(state)`(새 prop 1개)로 App에 올리고, App이 들고 주소 컴포넌트에 내려준다. 다른 경로(`onReady`·`mapsApi`)는 두지 않는다:
  ```
  sdk: { status: 'loading' }
     | { status: 'ready', api, geocoder: 'loading' | 'ready' | 'unavailable' }
     | { status: 'failed', kind: 'config' | 'load' | 'auth' }
  ```
  - 지도는 `status === 'ready'`면 동작한다(기존과 같다). 주소 기능(검색 폼·참고 주소)은 `status === 'ready' && geocoder === 'ready'`일 때만 켜진다. `geocoder: 'unavailable'`은 "주소 기능만 비활성화" 경로다 — 버튼을 그리지 않고 줄도 없으며, 지도·분석은 영향이 없다.
  - **뒤늦은 인증 실패**(`onNaverAuthFailure` — 도메인 미등록 등으로 로드 성공 뒤에 올 수 있다)는 같은 콜백으로 `failed/auth`를 올린다. 지도는 기존대로 인증 실패 안내를 보이고, 주소 기능도 함께 꺼진다.
  - 주소 컴포넌트·hook은 `sdk.status === 'ready'`일 때만 `sdk.api`를 쓴다. `failed`로 바뀌면 **이전 `api` 참조를 버리고**(hook deps에 `api`가 있어 effect가 정리된다) 새 호출을 하지 않으며, 검색 폼은 숨기고 참고 주소 줄도 그리지 않는다. 진행 중이던 콜백은 세대(generation) 불일치로 폐기한다(캐시 기록은 유효한 데이터라 남겨도 되지만, 화면에는 쓰지 않는다).
  - 인증 실패 뒤 SDK 객체가 메모리에 남아 있어도 주소 기능은 그 객체를 다시 잡지 않는다 — 상태의 `api`는 `ready`에만 존재한다(타입으로 강제). 로더를 다시 부르거나 두 번째 SDK를 삽입하지 않는다.
- `geocoder.ts` 계약:
  - `isGeocoderAvailable(api)`: `api.Service?.geocode && api.Service?.reverseGeocode` (서브모듈 로드 실패·구버전이면 false → UI 숨김). `ready`라도 이 검사를 통과해야 주소 기능이 켜진다.
  - `geocode(api, query, opts) → Promise<GeocodeResult>` : `{ status:'ok', items:[{roadAddress, jibunAddress, lat, lng, sido, distanceM}] } | { status:'empty' } | { status:'error', kind:'invalid'|'system'|'unknown'|'timeout'|'schema' }`
  - **오류 분류는 SDK가 실제로 넘긴 정보 안에서만 한다.** SDK 콜백은 HTTP 상태를 주지 않으므로 adapter는 403·429·네트워크 단절을 구별할 수 없고, **추정하지 않는다**:
    | SDK가 준 것 | 분류 |
    |---|---|
    | `status === OK`, `v2.status === 'OK'`, 결과 있음 / 없음 | `ok` / `empty`(정방향), reverse `status.code 0` / `3` → `ok` / `none` |
    | `v2.status === 'INVALID_REQUEST'`, reverse `status.code 100` | `invalid` |
    | `v2.status === 'SYSTEM_ERROR'`, reverse `status.code 900` | `system` |
    | `status === ERROR`이고 `response`가 없거나 `v2`가 없음 (7-B0 실측 사례) | **`unknown`** — 원인 불명. 설정·권한·할당량·네트워크 중 무엇인지 앱은 모른다 |
    | 콜백이 8초 안에 안 옴 | `timeout` |
    | 응답이 있으나 schema와 다름 | `schema` |
    사용자 문구는 `invalid`를 뺀 모든 오류에서 같다("주소 기능을 지금 쓸 수 없습니다 …"). 원인 확인은 콘솔·DevTools(HTTP 상태)에서 한다. 문자열 추측(예: 메시지에 "quota"가 있으면 할당량)으로 분류하지 않는다.
  - `reverseGeocode(api, point) → Promise<AddressResult>` : `{ status:'ok', roadAddress|null, jibunAddress|null } | { status:'none' } (code 3) | { status:'error', kind }`
  - 좌표 변환: SDK는 `x`=경도·`y`=위도 **문자열** → `Number()` 후 유한성 검사(아니면 `schema`). `coords`는 `'lng,lat'` 순서.
  - timeout 8초(SDK 콜백이 오지 않는 경우) → `timeout`. 콜백은 1회만 반영(이중 호출 방어).
  - 로그: `console.warn('[geocoder] …', { kind, status })`만. **query·좌표 외 인증값은 로그에 없다**(Client Secret 자체가 없고, Client ID는 script URL에 이미 공개).
  - 할당량 초과·API 미선택·권한 문제는 SDK 콜백에서는 모두 `status === ERROR`(응답 없음)로만 보인다 → `unknown`. 앱은 이를 구별하지 않고, 운영자는 콘솔 사용량·DevTools HTTP 상태로 본다.

### 5.2 UI 흐름

**A. 주소 검색 → 결과 선택 → 기존 좌표 분석**
1. 위치 필드(`LocationField`)와 비교 B 카드에 "좌표 직접 입력" 옆 disclosure **"주소로 찾기"**(ghost small, `aria-expanded`/`aria-controls`). `sdk.status !== 'ready'`이거나 `isGeocoderAvailable`이 false이면 버튼을 **그리지 않는다**(지도 오류 안내는 기존 지도 자리 메시지가 맡는다). 뒤늦은 인증 실패로 `failed`가 되면 열려 있던 폼도 닫히고 버튼이 사라진다 — 입력 중이던 값은 잃지만 분석 흐름에는 영향이 없다.
2. 폼: 텍스트 입력(라벨 "주소", placeholder "예: 부평대로 1" / B는 "B 주소") + "검색" 버튼(제출·Enter). 입력 중 호출 없음. 빈 문자열·공백은 제출 막음(`aria-invalid` + 문구).
3. 호출: `geocode(query, { coordinate: 인천시청 좌표(결과 정렬용), count: 10 })`. **NAVER 지역 정보로 선택을 막지 않는다**(검수 결정): 모든 결과를 선택할 수 있고, 인천 안·밖 판정은 지금처럼 backend(`location_outside`)가 분석 요청 때 한다. `addressElements` SIDO는 **정렬·표시 보조**로만 쓴다 — "인천광역시"를 앞에 두고, 다른 시·도 항목에는 시·도 이름을 caption으로 함께 보여 사용자가 알고 고르게 한다(꼬리표 "분석 불가"·disabled 없음). SIDO 요소가 없으면 그대로 둔다.
4. 결과 목록(`ol`, 최대 5 + "더 보기"): 각 항목 `<button>` — 도로명주소(없으면 지번), 보조로 지번주소. 선택하면 `onSelect({lat, lng})` → 기존 `onLocationInput` / `onLocationSubmit`와 **같은 함수**로 넘긴다(단일: `selectLocation`, B: `submitCompareLocation` → "B 분석하기"로 포커스 이동 규칙 그대로). 지도는 기존 `selected` 변경 효과로 `panTo`(zoom 그대로). 폼은 접히고 위치 필드는 "선택됨 · 좌표" + 참고 주소(§B)로 바뀐다. 포커스(결정, §10 Q2): 단일은 위치 필드 요약(`tabIndex=-1`)에 둔다 — 사용자가 업종을 이어 고르는 흐름이고, 기존 좌표 제출과 같은 자리다. B는 기존 규칙("B 분석하기") 유지.
5. 상태 문구(`aria-live="polite"`): 검색 중 "주소를 찾는 중…", 0건 "찾은 주소가 없습니다. 도로명·번지까지 적어 보세요", 오류 "주소 검색을 지금 쓸 수 없습니다. 지도에서 고르거나 좌표를 입력하세요"(기존 경로 안내). 오류·0건은 입력값을 지우지 않는다.
6. 분석·비교 상태와의 관계: 분석 중(`analyzing`)·B 분석 중에는 기존 좌표 입력과 같이 `disabled`. 검색 결과 선택은 좌표 선택일 뿐이므로 B 선택 규칙(`selectCompareLocation`: 분석 중 무시, 같은 좌표 D2 안내)이 그대로 적용된다.

**B. 선택 좌표의 참고 주소 표시(역지오코딩)**
- 표시 자리와 키:
  | 자리 | 좌표 키 | 비고 |
  |---|---|---|
  | 분석 전 위치 필드 "선택됨 · 좌표" 아래 | `location` | 지도 클릭·좌표 입력·주소 선택 모두 |
  | mobile 지도 화면 sheet "선택됨 · 좌표" 아래 | `location` | 한 줄 말줄임. sheet가 한 줄(약 18~20px)만큼 커지므로 지도 높이 실측으로 확인(§5.5) |
  | 결과 패널 `LocationSummary` 최근접역 줄 아래 | `context.lat/lng` | 단일 결과·`CompareDetail` 막대 |
  | 비교 B 카드 "선택됨 · 좌표" 아래 | `compare.location` | B 고르기·분석 중·실패 모두 |
  | 비교 요약 A/B 카드(`LocationSummary`) | 각 `context.lat/lng` | A와 B가 각자 키 |
- 문구: `참고 주소 · 인천 부평구 부평대로 1 (NAVER 지도)` — `--text-small` secondary, 접두 "참고 주소"는 label 색. 도로명 없으면 지번, 둘 다 없으면(상태 `none`·오류·로딩·SDK 미준비/실패) **줄 자체를 그리지 않는다** → 기존 행정동·최근접역·좌표 표시가 그대로 남는다(요구사항 "실패·없음은 기존 표시로 복귀"). 로딩 표시 없음(결정, §10 Q3): 지연이 보통 1초 미만이고(7-B0 실측 §11), 줄이 늦게 나타나는 쪽이 "확인 중…" 깜빡임보다 낫다. 영문 주소(`englishAddress`)는 쓰지 않는다(§10 Q6).
- Context Bar·결과 제목·행정동 칩은 바꾸지 않는다. 역지오코딩 결과의 구·동이 `context`와 달라도 표시하지 않는다(§4.3).
- `orders: 'roadaddr,addr'`만 요청한다(`legalcode`·`admcode` 요청 안 함 → 응답을 줄이고 오용 여지 제거).

### 5.3 캐시·요청 취소·늦은 응답 — A/B가 섞이지 않게
- **상태를 "현재 주소" 한 칸에 두지 않는다.** `addressCache`는 `key = \`${lat},${lng}\``(요청에 쓴 숫자 그대로, 추가 반올림 없음 — 지도 클릭은 이미 6자리, 입력값은 그대로) → `{status:'ok'|'none'|'error', …, at}`의 Map(LRU 100). 늦게 온 응답은 **자기 키에만** 기록되므로 다른 좌표의 표시로 갈 수 없다.
- **in-flight dedupe**: 같은 키의 조회가 진행 중이면 Promise를 공유한다(A 결과 패널·mobile sheet·비교 카드가 같은 좌표를 동시에 그려도 호출 1회).
- **hook `useReferenceAddress(sdk, point | null)`**: `sdk.status === 'ready'`이고 point가 있을 때만 동작. 마운트/키 변경 때 캐시에 있으면 즉시, 없으면 조회를 시작. 콜백에서 `point`나 `sdk`가 바뀌었거나 언마운트됐으면(`generation` ref 비교) `setState`하지 않는다 — SDK 콜백은 abort할 수 없으므로 **결과 폐기로 취소를 대신한다**(캐시 기록은 유지 → 다음에 바로 쓴다).
- **오류 캐시와 재시도(명시)**: `error` 항목은 `expiresAt = 기록 시각 + 60초`를 가진다. **타이머·자동 반복 호출은 없다.** 만료 전에 같은 좌표를 다시 그리면 호출 없이 "줄 없음"이고, 만료 **뒤에 다음 조회가 일어날 때**(마운트·키 변경·화면 전환) 1회 다시 시도한다. 즉 사용자가 아무것도 하지 않으면 추가 호출은 0건이다. `none`(주소 없음)·`ok`는 세션 동안 유지한다. `timeout`도 `error`와 같이 다룬다.
- **검색(geocode)**: 폼 인스턴스별 상태 1벌 + 요청 번호(`seq`). 제출마다 `++seq`; 응답이 올 때 `seq`가 다르면 버린다. 입력값 변경·폼 닫힘·언마운트 때 `seq`를 올려 늦은 응답을 무효화한다. 검색 결과는 캐시하지 않는다(같은 질의 재제출은 드물고 신선도가 더 중요).
- **비교와의 경계**: 단일 위치 필드(`ConditionPanel`)와 B 카드(`ComparePanel`)는 동시에 마운트되지 않는다. 비교 요약의 A·B `LocationSummary`는 서로 다른 좌표 키로 각자 hook을 가진다. `pickB`(다시 고르기)·`endCompare`·`cancelAnalysis`는 해당 컴포넌트를 언마운트시키므로 별도 취소 코드가 필요 없다(검색 폼은 언마운트 시 `seq` 무효화).
- **SDK 준비 전·Geocoder 없음·실패**: hook은 `sdk`가 `{status:'ready', geocoder:'ready'}`가 아니면 `idle`로 남고 호출하지 않는다(`window.naver`를 직접 보지 않는다). SDK 상태는 §5.1의 `onSdkState` 계약 하나로만 받는다 — 로더를 두 번 부르지 않고, 두 번째 SDK를 삽입하지 않는다.

### 5.4 오류 격리
- 주소 모듈은 `analysis`·`compare` 상태를 읽거나 쓰지 않는다. 어떤 실패도 UI 한 줄(또는 폼 안 문구)로만 끝난다. `ErrorBlock`(분석 오류 계약 D-014)을 재사용하지 않는다 — 분석 오류와 시각적으로 구분.
- 예외는 adapter 안에서 모두 잡는다(Promise reject 없음, 결과 객체로만). `console.warn` 1줄, 인증값·응답 raw 전체는 남기지 않는다(응답에는 개인정보가 없지만 로그를 짧게 둔다).
- **지도와 Geocoder의 실패 분리(경로)**: ① `maps-geocoder.js` 로드 실패·`callback` 미도착(10초)·`Service` 없음 → `sdk.geocoder = 'unavailable'`, 지도는 `status:'ready'` 그대로 — 주소 버튼·줄만 없다. ② 지도 `load`/`config` 실패 → 기존 지도 자리 안내, 주소 기능도 없음. ③ 뒤늦은 `auth` 실패 → 기존 인증 실패 안내 + 주소 기능 끔. 7-B0에서 `submodules=geocoder`가 지도 로드를 깨는 사례는 없었다(§11). 어느 경우에도 SDK를 다시 로드하거나 지도 인스턴스를 다시 만들지 않는다.
- 테스트(§8-2·8-3)로 고정: "callback 없이 `load`만 온 경우 지도는 만들어지고 주소 버튼은 없다", "callback이 왔지만 `Service`가 없으면 `unavailable`", "auth 실패 뒤 `api` 재사용 없음".

### 5.5 접근성·반응형
- 검색 폼: 보이는 `<label>`, 결과는 `ol` + `<button>`(Enter/Space), `aria-live` 상태 문구, 44px 터치(§15). 결과 선택 뒤 포커스 규칙은 §5.2 A-4.
- 참고 주소 줄은 텍스트라 추가 ARIA 없음. 긴 주소는 줄바꿈 허용(`overflow-wrap: anywhere` 전역).
- **mobile sheet 공간**: 참고 주소를 넣으면 sheet는 **한 줄(약 18~20px, `--text-small`) 커진다**. mobile 지도 화면은 `100dvh` 안에서 지도가 `flex: 1`이므로 그만큼 지도가 줄어든다 — "높이 불변"을 가정하지 않는다. 방안과 실측 기준:
  - 주소는 **한 줄 말줄임**(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`)으로 길이와 무관하게 1줄만 차지한다(가장 긴 실제 도로명주소·건물명 포함 32자 이상도 1줄). sheet의 `-4px` 겹침·손잡이·버튼은 그대로.
  - 분석 뒤 sheet는 이미 "행정동 + 최근접역"(길면 2줄)이므로 주소까지 3줄이 될 수 있다. 분석 뒤 sheet에서는 **최근접역 줄과 주소 줄을 한 줄로 합치지 않고**, 대신 `@media (max-height: 640px)`(세로 공간이 작은 폰)에서는 sheet의 참고 주소 줄을 **숨긴다**(패널 화면의 참고 주소는 그대로).
  - 실측(7-B2에서, 내장 브라우저·gstack): 375×812·375×667·360×640에서 선택 전/선택 후/분석 후 각각 sheet 높이와 지도 높이를 재고, 결과 지도에서 점포 정보창(약 148px)·점포 막대·안내 칩·범례·NAVER 로고·확대 컨트롤이 겹치지 않는지 확인한다. 기준: 지도 높이 ≥ 280px(tablet 최소와 같음) — 미달이면 위 `max-height` 기준을 올리거나 주소 줄을 분석 전 sheet에만 둔다. 결과는 이 문서 "구현 기록"에 남긴다.

### 5.6 DESIGN.md 개정안 (구현 시 함께)
- §8.5: "주소 검색·역지오코딩·외부 지명 API는 쓰지 않는다" → "행정동 칩·제목은 context 그대로. **주소는 참고 정보**로 §8.5b에 따라 NAVER 지도 출처를 붙여 보인다. 외부 주소로 행정동을 바꾸지 않는다."
- 신설 §8.5b 참고 주소: 문구·위치·실패 시 생략 규칙(§5.2 B).
- §7.4 위치 필드: "주소로 찾기" disclosure 추가(좌표 직접 입력과 같은 급의 키보드 대안).
- §5.D: "분석 전에는 좌표만" → "좌표 + 참고 주소(있을 때만). 행정동은 분석 후 context".

---

## 6. 변경 파일 (구현 단계에서, 지금은 변경 없음)

| 구분 | 파일 | 변경 |
|---|---|---|
| 로더 | `frontend/src/map/naverMaps.ts` | script URL `&submodules=geocoder&callback=…`, 준비 판정을 `callback`으로(§5.1), `NaverMapsApi.Service?` 타입 |
| 스파이크 | `frontend/spike/geocoder-spike.html` | 7-B0 전용 dev 페이지(빌드·타입검사 밖, `.env`의 Client ID만 사용, 버튼당 1회 호출). 구현 뒤에도 콘솔 조건 재확인용으로 남긴다 |
| 신규 | `frontend/src/map/geocoder.ts` | adapter(§5.1) + Zod schema(`v2` 중 쓰는 필드만, `.loose()`) |
| 신규 | `frontend/src/lib/addressCache.ts`, `frontend/src/lib/useReferenceAddress.ts` | 캐시·hook(§5.3) |
| 신규 | `frontend/src/components/ReferenceAddress.tsx`(+css), `AddressSearch.tsx`(+css) | 표시·검색 UI |
| 수정 | `frontend/src/components/MapView.tsx` | `onSdkState?(state)` prop 1개 — 로더 성공·실패와 **뒤늦은 인증 실패**를 App에 올린다(로더 재호출 없음) |
| 수정 | `frontend/src/App.tsx` | `sdk` 상태(`loading/ready/failed`), 주소 컴포넌트에 전달, mobile sheet 참고 주소(+ `max-height` 숨김 규칙은 App.css) |
| 수정 | `frontend/src/components/ConditionPanel.tsx`, `ComparePanel.tsx` | "주소로 찾기" disclosure + 참고 주소 줄 |
| 수정 | `frontend/src/components/LocationSummary.tsx` | 최근접역 줄 아래 참고 주소 |
| 테스트 | `naverMaps.test.ts`, 신규 `geocoder.test.ts`, `useReferenceAddress.test.ts`, `App.test.tsx`(MapView mock이 `onSdkState`로 상태를 올리고, `Service`는 vi.fn mock) | §8 |
| 문서 | `DESIGN.md`(§5.D·§7.4·§8.5·§8.5b·§15), `frontend/README.md`(콘솔: Geocoding·Reverse Geocoding 선택, 한도), `docs/ARCHITECTURE.md`(외부 API 경계 1줄), `docs/DECISIONS.md` D-021, `docs/TASKS.md` 7장 | |
| 변경 없음 | backend 전체, `scoring_engine/`, `data/`, `Dockerfile`, `vite.config.ts`, `.env` 키 종류 | Client ID만 그대로 |

---

## 7. 구현 단계 (작게, 각 단계 끝에 `scripts/check` 통과)

0. **7-B0 콘솔 확인 + 브라우저 스파이크 (앱 코드 변경 없음)** — 스파이크는 **이미 SDK가 로드된 앱 페이지에 두 번째 SDK를 넣지 않고**, 등록된 origin(`http://localhost:5173`)의 별도 페이지 `frontend/spike/geocoder-spike.html`(vite dev가 그대로 서빙, 빌드 밖)에서 Geocoder 포함 SDK를 **한 번만** 로드한다. 버튼당 정확히 1회: `reverseGeocode({coords:'126.7246,37.4894', orders:'roadaddr,addr'})`, `geocode({query:'인천광역시 부평구 부평대로 1', coordinate:'126.7052,37.4563', count:5})`. 기록할 것: (a) `callback`·`load` 시점의 `Service` 유무, (b) SDK 콜백 결과(`status`·`response` 유무)와 **실제 HTTP 상태(DevTools·리소스 타이밍)를 따로** 적기, (c) `v2.address`·`addresses[0].x/y` 형태가 §3.4와 같은지, (d) 응답 시간. 응답 샘플은 `frontend/src/fixtures/geocoder-*.json`으로 저장(개인정보 없음, 인증값 없음). 콘솔 항목(§9)은 사용자가 확인한다 — 스파이크의 HTTP 상태는 사실로 기록하고, 원인은 추정으로 구분해 적는다. 결과는 §11.
1. **7-B1 로더·adapter** — `submodules=geocoder` 추가, `geocoder.ts` + Zod + timeout, 테스트(§8-1). 아직 UI 없음.
2. **7-B2 참고 주소(단일)** — `addressCache`·hook·`ReferenceAddress`, 위치 필드·mobile sheet·`LocationSummary`에 연결. 실패·없음은 줄 없음. App 테스트(§8-3).
3. **7-B3 참고 주소(비교 A/B)** — B 카드·비교 요약 A/B 카드. A/B 섞임 테스트(§8-3).
4. **7-B4 주소 검색(단일)** — `AddressSearch` + `LocationField` disclosure → `selectLocation`. 결과는 모두 선택 가능(시·도 caption만, 분석 가능 여부는 backend 판정). App 테스트.
5. **7-B5 주소 검색(비교 B)** — B 카드 disclosure → `submitCompareLocation`(포커스 "B 분석하기"), 같은 좌표(D2)·분석 중 무시 규칙 확인.
6. **7-B6 브라우저 검증·문서** — 1280/970/800/375, 실패 모사(DevTools 요청 차단·콘솔에서 API 해제), 요청 수 세기(검색 1회·좌표당 역지오코딩 1회), DESIGN/README/ARCHITECTURE/DECISIONS/TASKS 반영. 운영 배포는 **별도 승인 뒤**(Cloud Run 재배포는 Client ID build arg 그대로, 콘솔 설정만 선행).

---

## 8. 테스트 계획

1. **adapter 단위**(`geocoder.test.ts`, `window.naver.maps.Service`를 vi.fn으로 대체): 콜백 → Promise 변환, `x/y` 문자열 → 숫자·유한성, `v2.status` 매핑(OK/INVALID_REQUEST/SYSTEM_ERROR, reverse code 0/3/100/900), `status === ERROR` + `response` 없음 → `unknown`(추정 분류 없음, 7-B0 실측 모양으로 fixture), 콜백 미도착 8초 → `timeout`(fake timers), schema 불일치 → `schema` + `console.warn` 1회(인증값 없음), 콜백 2회 호출 시 1회만 반영, `Service` 없음 → `isGeocoderAvailable=false`.
2. **로더·SDK 상태**(`naverMaps.test.ts`, `MapView.test.tsx`): script src가 `…maps.js?ncpKeyId=test-client-id&submodules=geocoder&callback=__naverMapsReady`(순서 고정), script는 여전히 1개(singleton, 두 번째 삽입 없음), 기존 실패 테스트 그대로. 지도/Geocoder 분리: `load`만 오고 `callback`이 안 오면(fake timers 10초) 지도는 만들어지고 `onSdkState`는 `{ready, geocoder:'unavailable'}`; `callback`이 왔지만 `Service`가 없으면 `unavailable`; `callback` + `Service` 있으면 `geocoder:'ready'`; 로드 뒤 `navermap_authFailure` → `failed/auth`가 올라가고 그 뒤 주소 호출 0건.
3. **캐시·hook·A/B 분리**(`useReferenceAddress.test.ts` + `App.test.tsx`): 같은 키 동시 조회 1회, 늦은 응답은 자기 키에만 기록되고 바뀐 포인트의 화면에는 반영되지 않음(콜백을 수동으로 늦게 호출), 비교에서 A·B 카드가 각자 주소(B 응답이 A 줄에 나타나지 않음), B 다시 고르기 뒤 이전 B 주소가 새 B에 남지 않음, `error` 만료(60초) 전 재조회는 호출 0·만료 뒤 다음 조회 때 1회(타이머 없음), `none` 유지, `sdk`가 `loading`/`failed`/`geocoder:'unavailable'`이면 호출 0·줄 없음, `ready`→`failed` 전환 뒤 이전 `api`로 호출 없음.
4. **검색 흐름**(`App.test.tsx`): "주소로 찾기" → 입력 → 검색 → 결과 선택 → `/analyze` body 좌표가 선택한 `x/y`와 같음(단일·B 모두), 다른 시·도 결과도 선택 가능하고 시·도 caption이 붙으며 선택 뒤 backend `location_outside` 응답은 기존 오류 블록으로 처리(사전 차단 없음), 0건·오류 문구와 입력값 유지, 늦은 검색 응답(seq) 폐기, 검색 오류 뒤에도 좌표 입력·분석 성공(격리), `Service` 없으면 버튼 자체가 없음, B 선택 뒤 포커스 "B 분석하기"(기존 규칙 유지), 분석 중 disabled.
5. **표시 규칙**: 실패·없음에서 기존 행정동·최근접역·좌표 문구가 그대로이고 추가 줄 없음, 성공 시 "참고 주소 · … (NAVER 지도)", Context Bar·결과 제목은 변하지 않음(스냅샷이 아니라 텍스트 단언), a11y: `brokenReferences`·`duplicateIds` 기존 검사 통과(disclosure id 유일).
6. **레이아웃 계약**(`layout.test.ts`): mobile sheet 참고 주소 줄 한 줄 말줄임 규칙과 `max-height` 숨김 규칙(sheet 높이는 한 줄만큼 커질 수 있다 — 지도 높이 ≥ 280px는 §5.5 브라우저 실측으로 확인)·터치 44px(검색 버튼·결과 항목).
7. **브라우저**(7-B6, gstack `/browse` 또는 내장 브라우저): 실제 키로 검색→선택→분석, 역지오코딩 표시, 비교 A/B, DevTools로 `oapi.map.naver.com`/`maps.apigw` 요청 차단 시 기존 표시 유지·분석 정상, 네트워크 탭에서 호출 수 확인(검색 1·좌표당 1), 콘솔 오류 0, 1280/970/800/375.
8. **회귀**: `scripts/check` 전체(golden regression 포함) — 엔진·backend는 변경이 없으므로 통과가 전제.

---

## 9. 사용자가 직접 확인해야 할 콘솔 항목 (구현 시작 전)

NAVER Cloud Platform 콘솔(https://console.ncloud.com) — 값은 이 저장소·대화에 적지 않는다.
1. **상품 소속**: 이 앱의 Client ID(`VITE_NAVER_MAP_CLIENT_ID`)가 **Services > Application Services > Maps**(2025-03 신규 상품)의 Application인지, 구 **AI·NAVER API > Application**인지. 구 상품이면 2025-07-01부터 무료 이용량이 없고 종료 예정이므로 **Maps 상품에 새 Application을 만들고 Client ID를 교체**해야 한다(교체 시 `.env`·Cloud Run build arg만 바뀜, 코드 변경 없음).
2. **대표 계정**: Application 화면 "대표 계정 확인". 아니면 Geocoding·Reverse Geocoding이 **첫 호출부터 0.5원/건** 과금 — 진행 여부 결정 필요.
3. **API 선택**: Application 수정에서 **Geocoding**, **Reverse Geocoding** 체크(Dynamic Map은 이미 선택). 문서상 미선택이면 429(7-B0 실측은 403, §11). 선택 뒤에도 403이 계속되면 Web 서비스 URL·권한·상품 소속을 함께 본다 — Dynamic Map이 되는 것만으로 Geocoder 쪽 설정이 맞다고 보지 않는다.
4. **Web 서비스 URL**: `http://localhost:5173`(및 쓰는 다른 포트), Cloud Run URL이 등록돼 있는지(지도가 뜨고 있으므로 등록돼 있을 것).
5. **한도 및 알림 설정**: Geocoding·Reverse Geocoding 각각 **일 한도**(예: 1,000건)·**월 한도**(예: 10,000건)와 통보 대상 등록. 과제 규모에서 무료량(월 3,000,000) 안이지만, 브라우저 호출이라 상한을 둔다. 값은 사용자 결정.
6. **인증 정보 보호**: Client Secret은 어떤 파일·환경변수에도 넣지 않는다(이 설계에서 쓰지 않는다). `.env`는 `.gitignore`(기존).
7. 확인 결과(예/아니오만)를 7-B0 기록에 남긴다. 스크린샷·키 값은 남기지 않는다.

---

## 10. 검수 결정 (2026-10-12 보완)

1차 검수(2026-10-12)에서 Q4를 지시대로 바꾸고 나머지는 제안안을 적용했으며, 2차 검수(`7598511` 검수)에서 **UX 결정(Q1~Q4·Q6)은 아래 표대로 확정**했다. **계정·과금·한도(Q5, §9-1·9-2·9-5)는 사용자 확인 대기**로 남긴다.

| 항목 | 결정 | 반영 |
|---|---|---|
| Q1 방식 | Web SDK Geocoder, Client ID만(§4.1). 7-B0 진행 지시로 간주 | §4 |
| Q2 검색 결과 선택 뒤 포커스 | 단일: 위치 필드 요약(`tabIndex=-1`). B: "B 분석하기"(기존) | §5.2 A-4 |
| Q3 로딩 표시 | 없음 — 성공 시에만 줄이 나타남 | §5.2 B |
| Q4 인천 밖 결과 | **지시: NAVER 지역 정보로 backend보다 먼저 차단하지 않는다.** 선택 허용, 시·도 caption만 표시, 판정은 backend `location_outside` | §5.2 A-3 |
| Q5 한도 값·비대표 계정 | 사용자 콘솔 결정(§9-5·9-2). 스파이크는 각 1회만 호출 | §9·§11 |
| Q6 영문 주소 | 쓰지 않음 | §5.2 B |

추가 보완(같은 지시): 스파이크는 별도 페이지에서 SDK 1회 로드(§7-0), 뒤늦은 인증 실패를 주소 기능 준비 상태에 반영(§5.1), 오류 캐시 재시도는 자동 반복이 아니라 만료 뒤 다음 조회 때(§5.3), mobile sheet 높이 증가를 인정하고 공간 확보·실측 계획(§5.5).

7-B1 이후는 이 문서 §11의 7-B0 결과와 §9 콘솔 확인 결과를 보고 시작한다. 구현 중 결정이 바뀌면 같은 파일에 "구현 기록"을 덧붙인다(`docs/COMPARE_DESIGN.md` 13장 방식).

---

## 11. 7-B0 기록 (2026-10-12) — 상태: **준비 시점 확인 완료 / 정상 호출 확인 대기** (구현 시작 안 함)

**방법:** `frontend/spike/geocoder-spike.html`을 vite dev(`http://localhost:5173`, 등록된 Web 서비스 URL)에서 열어 SDK를 `submodules=geocoder&callback=__spikeReady`로 **한 번** 로드. 앱 페이지(SDK가 이미 로드된 곳)에는 손대지 않았다. 호출은 역방향 1회·정방향 1회뿐이다(이 밖의 호출 0건). Client ID는 `.env`에서 읽고 로그·문서에 적지 않았다.

**결과 1 — 로더 준비 시점 (설계 §5.1에 반영):**

| 시점 | 경과 | `naver.maps` | `naver.maps.Service` |
|---|---|---|---|
| `maps.js` `load` 이벤트 | 11ms | 있음 | **없음** |
| `callback=__spikeReady` | 12ms | 있음 | 있음 (`geocode`·`reverseGeocode` function) |
| 폴링으로 감지 | 113ms | 있음 | 있음 |

SDK는 `maps.js` 뒤에 `https://oapi.map.naver.com/openapi/v3/maps-geocoder.js`를 비동기 `<script>`로 따로 붙인다. 열거형 실측: `Service.Status {OK:200, ERROR:500}`, `GeocodeStatus {OK, INVALID_REQUEST, SYSTEM_ERROR}`, `OrderType {ADDR:'addr', ADM_CODE:'admcode', LEGAL_CODE:'legalcode', ROAD_ADDR:'roadaddr'}` — 레퍼런스 설명문의 뒤바뀜과 달리 값은 이름대로다.

**결과 2 — 호출 (둘 다 실패. 아래 "사실"과 "추정"을 구분한다):**

| 호출 | SDK 콜백 | 실제 HTTP | 엔드포인트(리소스 타이밍, 키 가림) |
|---|---|---|---|
| `reverseGeocode({coords:'126.7246,37.4894', orders:'roadaddr,addr'})` | `status 500(ERROR)`, `response.v2` 없음, 47ms | **403** | `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc-js?coords=…&orders=…&output=json&X-NCP-APIGW-API-KEY-ID=***&url=http%3A%2F%2Flocalhost…` |
| `geocode({query:'인천광역시 부평구 부평대로 1', coordinate:'126.7052,37.4563', count:5})` | `status 500(ERROR)`, `response.v2` 없음, 22ms | **403** | `https://maps.apigw.ntruss.com/map-geocode/v2/geocode-js?query=…&X-NCP-APIGW-API-KEY-ID=***&url=…` |

- **사실(실측)**:
  - Web SDK Geocoder는 브라우저에서 `X-NCP-APIGW-API-KEY-ID`(Client ID)와 현재 페이지 `url`을 쿼리로 붙여 전용 `-js` 엔드포인트를 XHR로 불렀다. 요청에 Client Secret은 없었다.
  - 두 요청 모두 HTTP **403**(브라우저 리소스 타이밍 `responseStatus`·콘솔 "Failed to load resource: 403"). SDK 콜백은 둘 다 `status 500(ERROR)`이고 `response`가 없었다 — **SDK만 보면 원인 불명(`unknown`)**이다. 응답 본문은 받지 못했다.
  - 같은 페이지에서 `maps.js`·`maps-geocoder.js` 로드는 정상이었고 `navermap_authFailure`는 불리지 않았다. 지도 로드가 서브모듈 때문에 깨지는 일은 없었다.
  - 콘솔 오류는 위 403 두 건뿐(그 밖은 vite HMR 로그).
- **추정(미확인)**: 403의 원인 후보는 ① Application에서 Geocoding·Reverse Geocoding 미선택, ② 이 Client ID가 구 AI NAVER API 상품 소속, ③ Geocoder 쪽 URL·권한 설정 문제다. **Dynamic Map이 같은 origin·Client ID로 정상인 것은 ①~③ 중 어느 것도 배제하지 못한다**(Dynamic Map과 Geocoder는 별도 API·권한이다). 공식 문서는 미선택 API를 429로 적고 있어 실측 403과 다르다 — 이 차이도 콘솔 확인 전에는 설명하지 않는다.
- 설계 반영: adapter는 HTTP 상태를 알 수 없으므로 403·429를 추정 분류하지 않고 `unknown`으로 둔다(§5.1). fixture는 정상 응답을 받은 뒤 저장한다.

**다음 행동(사용자, §9):** ① Application 소속 상품(신규 Maps / 구 AI NAVER API) 확인 → ② Geocoding·Reverse Geocoding 선택 → ③ Web 서비스 URL·권한 재확인 → ④ 대표 계정·한도 설정 확인(계정·과금·한도는 사용자 확인 대기). 완료 후 알려 주면 스파이크 페이지에서 **각 1회만** 다시 호출해 §11을 "정상 호출 확인"으로 갱신하고, 그 결과를 보고 7-B1 착수 여부를 결정한다. 그 전에는 추가 API 호출을 하지 않는다.
