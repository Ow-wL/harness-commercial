import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  analyze,
  DEFAULT_RADIUS_M,
  fetchBusinesses,
  fetchHealth,
  requestRadius,
  type AnalyzeRequest,
  type ApiFailure,
} from './api/client.ts'
import type { AnalyzeResponse, BusinessCatalog, NearbyStoresResponse } from './api/schemas.ts'
import { AnalysisResult, HeadlineText } from './components/AnalysisResult.tsx'
import { AnalysisLoading } from './components/AnalysisStatus.tsx'
import { BandPeek } from './components/AttentionBand.tsx'
import { ComparePanel, CompareSheet } from './components/ComparePanel.tsx'
import { CompareDetail, CompareResult, StoreSideSwitch } from './components/CompareResult.tsx'
import { ConditionPanel, type BusinessesState } from './components/ConditionPanel.tsx'
import { LocationMethodSwitch, type LocationMethod } from './components/LocationMethodSwitch.tsx'
import { ErrorBlock } from './components/ErrorBlock.tsx'
import { Icon } from './components/Icon.tsx'
import { MapErrorBoundary } from './components/MapErrorBoundary.tsx'
import { MapView, type LatLng, type MapCompare, type MapStore } from './components/MapView.tsx'
import { MoreBelow } from './components/MoreBelow.tsx'
import { NearbyStores } from './components/NearbyStores.tsx'
import { RadiusControl } from './components/RadiusControl.tsx'
import { RadiusTable } from './components/RadiusTable.tsx'
import { RankCard } from './components/RankCard.tsx'
import { ResultTools } from './components/ResultTools.tsx'
import { TimeInsightsCard } from './components/TimeInsightsCard.tsx'
import { useInsights } from './lib/useInsights.ts'
import { useRank } from './lib/useRank.ts'
import { SavedSites } from './components/SavedSites.tsx'
import { ReferenceAddress } from './components/ReferenceAddress.tsx'
import { UpdateNotes } from './components/UpdateNotes.tsx'
import type { SdkState } from './map/naverMaps.ts'
import type { CompareSide } from './lib/compare.ts'
import { COMPARE_IDS, sameCoordinates, type CompareState, type CompareView } from './lib/compareState.ts'
import { errorView, type ErrorAction } from './lib/errorView.ts'
import { effectiveSameCount } from './lib/evidence.ts'
import {
  formatDistance,
  formatRadius,
  formatScore,
  groupName,
  locationName,
  nearestStation,
  storeAddress,
  storeName,
} from './lib/format.ts'
import { conclusion } from './lib/conclusion.ts'
import { singleBand } from './lib/attentionBand.ts'
import { DataInfoContext, dataVersionLabel, dataVersionOf, type DataInfo } from './lib/dataVersion.ts'
import { parseShareQuery, shareQuery, shareUrl, versionsDiffer, type ShareConditions } from './lib/shareLink.ts'
import { readFieldNotes, writeFieldNotes, type FieldNote, type FieldNotes } from './lib/fieldNotes.ts'
import { radiusRows } from './lib/radiusTable.ts'
import { cacheKey, ResultCache } from './lib/resultCache.ts'
import { readSavedSites, removeSite, saveSite, siteFrom, updateSiteMemo, type SavedSite } from './lib/savedSites.ts'
import { storeGlyphFor } from './lib/storeIcons.ts'
import { buildStoreLinks } from './lib/storeLinks.ts'
import { useNearbyRequest, type RadiusProblem } from './lib/useNearbyRequest.ts'
import { useReferenceAddress } from './lib/useReferenceAddress.ts'
import { useTheme } from './lib/theme.ts'
import { stepIndex, useOnboarding } from './lib/onboarding.ts'
import { APP_VERSION } from './lib/patchNotes.ts'
import { RESULT_TEXT, TOUR_TEXT } from './content/onboarding.ts'
import { CoachMark, ReplayHelpButton } from './components/CoachMark.tsx'
import './App.css'

/**
 * sticky 헤더의 실제 높이를 html의 `--header-offset`에 쓴다 (`App.css`의 `html { scroll-padding-top }`).
 * 포커스·앵커·Tab 이동이 대상을 헤더 아래 보이는 영역으로 스크롤하게 한다 — 브라우저는 대상이 뷰포트 안이면(헤더 뒤라도)
 * 스크롤하지 않는다. 헤더는 Context Bar가 줄바꿈되면 56px보다 높아지므로 토큰 값이 아니라 잰 값을 쓴다
 */
function syncHeaderOffset(header: HTMLElement | null) {
  const height = header?.getBoundingClientRect().height
  if (height) document.documentElement.style.setProperty('--header-offset', `${Math.ceil(height)}px`)
}

/** 대시보드 지도 카드 버튼 id (13-10) — 확대·복귀 때 포커스 이동 대상 */
const MAP_CARD_IDS = { expand: 'map-card-expand', collapse: 'map-card-collapse', pill: 'map-card-pill' } as const

/** radius: 반경 변경(또는 반경 복구)으로 시작한 분석 — 결과 화면에서 다시 분석하는 중·그 실패 (8-D3, S3·S8) */
type AnalysisOrigin = 'radius'

type Analysis =
  | { status: 'idle' }
  | { status: 'loading'; request: AnalyzeRequest; origin?: AnalysisOrigin }
  | { status: 'success'; request: AnalyzeRequest; response: AnalyzeResponse }
  | { status: 'error'; request: AnalyzeRequest; failure: ApiFailure; origin?: AnalysisOrigin }

/** mobile(<640px)에서 지금 보이는 화면 (DESIGN.md §14). desktop·tablet에서는 무시된다 */
type MobileScreen = 'map' | 'panel'

/** mobile(<640px) 화면인지 — 포커스를 옮길 대상(패널 / 지도 화면 sheet)을 고를 때만 쓴다 */
const isMobile = () => window.matchMedia?.('(max-width: 639px)').matches ?? false

/** 분석 불가 지점은 회색 마커·반경 없음 (§8.11, §10.3) */
const INVALID_LOCATION_CODES = new Set(['invalid_coordinate', 'location_outside', 'no_data_nearby'])

/**
 * 응답이 보낸 요청과 같은 조건인지 확인한다. backend는 요청 좌표를 context에 그대로 돌려주고
 * 업종코드·분석 반경을 meta에 둔다. 다르면 다른 조건의 결과를 보여 주는 것이므로 계약 오류로 다룬다.
 * 'radius' = 좌표·업종은 같고 반경만 다름 (8-D3 S5 — 구버전 서버가 radius_m 을 무시한 경우일 수 있다, 4.6 R1)
 */
function checkResponse(res: AnalyzeResponse, req: AnalyzeRequest): 'ok' | 'condition' | 'radius' {
  if (res.context.lat !== req.lat || res.context.lng !== req.lng || res.result.meta.업종코드 !== req.biz_code) return 'condition'
  return res.result.meta.분석반경_m === requestRadius(req) ? 'ok' : 'radius'
}

/** 분석 요청 body. withRadius(서버가 반경을 2개 이상 광고)일 때만 radius_m 을 넣는다 — 그 밖에는 지금과 같은 body (4.6) */
function buildRequest(point: LatLng, bizCode: string, radius: number, withRadius: boolean): AnalyzeRequest {
  return withRadius
    ? { lat: point.lat, lng: point.lng, biz_code: bizCode, radius_m: radius }
    : { lat: point.lat, lng: point.lng, biz_code: bizCode }
}

const isInvalidRadius = (f: ApiFailure) => f.kind === 'api' && f.error.code === 'invalid_radius'

/**
 * 같은 비교 세대(업종·반경이 같은 A·B 요청)인데 엔진버전이 다른지 (4.5). 반경이 다르면 아직 다른 세대(다시 분석 중)라
 * 판정하지 않는다 — 그 세대의 다른 쪽 응답이 도착할 때 다시 본다. A·B 어느 쪽이 먼저 와도 나중 쪽에서 검사한다(8-D3 검수).
 */
/** 두 응답이 같은 엔진·같은 데이터 버전에서 나왔는지 (데이터 버전은 응답 헤더 X-Data-Version, 9-C4·D-033) */
function sameVersions(a: AnalyzeResponse, b: AnalyzeResponse): boolean {
  return a.result.meta.엔진버전 === b.result.meta.엔진버전 && dataVersionOf(a) === dataVersionOf(b)
}

/** A 결과와 B 결과가 한 비교로 함께 보일 수 있는지: 같은 업종·같은 반경 요청이고 엔진·데이터 버전도 같다 */
function consistentCompare(a: Analysis, c: Extract<CompareState, { status: 'success' }>): boolean {
  return (
    a.status === 'success' &&
    a.request.biz_code === c.request.biz_code &&
    requestRadius(a.request) === requestRadius(c.request) &&
    sameVersions(a.response, c.response)
  )
}

/** 같은 비교 세대인데 엔진 또는 데이터 버전이 다르면 한 비교에 섞지 않는다 (4.5, 9-C4) */
function mixedEngines(aReq: AnalyzeRequest, a: AnalyzeResponse, bReq: AnalyzeRequest, b: AnalyzeResponse): boolean {
  return aReq.biz_code === bReq.biz_code && requestRadius(aReq) === requestRadius(bReq) && !sameVersions(a, b)
}

/** 서버가 바뀌어 반경 선택을 잃었을 때(4.6 공통 복구) 알리는 문구 */
const RADIUS_RECOVERY_NOTICE = '서버가 바뀌어 반경 500m로 다시 분석합니다'

function App() {
  const [businesses, setBusinesses] = useState<BusinessesState>({ status: 'loading' })
  const [businessesLoad, setBusinessesLoad] = useState(0)
  const [location, setLocation] = useState<LatLng | null>(null)
  const [bizCode, setBizCode] = useState<string | null>(null)
  const [analysis, setAnalysisState] = useState<Analysis>({ status: 'idle' })
  // 상태와 ref 를 같은 자리에서 함께 바꾼다 — 같은 React 배치에서 끝나는 A·B 콜백도 서로의 최신 결과를 읽는다(렌더 뒤 동기화를
  // 기다리지 않는다, 8-D3 재검수). 비동기 처리(엔진버전 대조·반경 복구)는 이 ref 를 읽는다
  const analysisRef = useRef(analysis)
  const setAnalysis = useCallback((next: Analysis) => {
    analysisRef.current = next
    setAnalysisState(next)
  }, [])
  // 분석 반경 (8-D3, D-024, docs/UX_REDESIGN.md 4.3~4.6). radiusOptions = 서버 광고(GET /health engine.radius_options).
  // 2개 미만(구버전 서버 = engine 없음, 새 v0.3 서버 = [500])이면 반경 선택을 숨기고 radius_m 을 보내지 않는다
  const [radiusOptions, setRadiusOptions] = useState<number[]>([])
  // 서버 엔진 버전(/health engine.version) — 반경 안내 문구만 쓴다(v0.5 는 고객성도 반경을 따른다, D-028)
  const [serverEngine, setServerEngine] = useState<string | null>(null)
  // 서버 데이터 메타(/health data, 9-C4) — 결과 화면의 데이터 출처·설명 기준일. 구버전 서버·실패면 null
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null)
  // 장소 이름 검색 광고(/health places.enabled, 12-14) — 있을 때만 "장소 이름" 입력 방법을 보인다
  const [placesReady, setPlacesReady] = useState(false)
  const [radius, setRadius] = useState(DEFAULT_RADIUS_M)
  const [prevRadius, setPrevRadius] = useState<number | null>(null)
  const [radiusNotice, setRadiusNotice] = useState<string | null>(null)
  // 비교 중 반경 변경(또는 반경 복구)으로 A·B를 다시 분석하는 동안·A가 실패한 동안의 B 위치 (S9·S11). 비교를 유지한다
  // 조건 공유 링크(12-3, 계획 1-1): 첫 로드 때 쿼리의 조건을 읽어 두고, 업종 목록·/health 가 오면 **같은 조건으로 다시 분석**한다.
  // 링크에 점수는 없다(데이터 묶음·엔진이 바뀌면 결과가 달라질 수 있어 저장된 점수를 보여 주지 않는다). 링크의 버전이 지금 서버와
  // 다르면 안내한다. B 좌표는 A 성공 뒤 비교로 이어 간다(pendingB)
  // undefined = 아직 읽지 않음(적용 함수가 처음 불릴 때 주소창을 읽는다), null = 링크 없음·적용 끝
  const shareLinkRef = useRef<ShareConditions | null | undefined>(undefined)
  const [sharePending, setSharePending] = useState(() => parseShareQuery(window.location.search) !== null)
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  // 적용에 필요한 두 응답(업종 목록·/health)의 도착 여부와 값 — fetch 콜백에서 바로 읽는다(상태 반영을 기다리지 않는다)
  const shareInputs = useRef<{ catalog: BusinessCatalog | null; health: { options: number[]; engine: string | null; data: string | null } | null }>({
    catalog: null,
    health: null,
  })
  const shareLoaded = useRef({ businesses: false, health: false })
  const applyShareRef = useRef<() => void>(() => {})
  const [compareReload, setCompareReloadState] = useState<LatLng | null>(null)
  const compareReloadRef = useRef(compareReload)
  const setCompareReload = useCallback((next: LatLng | null) => {
    compareReloadRef.current = next
    setCompareReloadState(next)
  }, [])
  // 조건 키 (lat, lng, biz, radius) → 분석·점포 응답 (4.3). 적중이면 요청하지 않는다.
  // 객체는 state 로 1회 만들고(렌더에서 읽기만 하는 반경별 비교 표가 peek 한다 — ref 는 렌더 중 읽지 않는다, 12-26),
  // 쓰기(put·clear)는 콜백에서 같은 객체를 ref 로 부른다. 내용이 바뀔 때는 늘 분석 상태도 함께 바뀌어 다시 그려진다
  const [cacheStore] = useState(() => new ResultCache())
  const resultCache = useRef(cacheStore)
  // 요청 세대: 새 분석·B 요청·반경 변경·조건 변경·비교 시작/종료/다시 고르기 때 올린다. 반경 복구(/health 재조회)는 시작할 때의
  // 세대가 응답 뒤에도 같을 때만 상태를 바꾼다 — 늦게 온 복구가 더 새 결과를 덮지 않는다(8-D3 검수)
  const epoch = useRef(0)
  const radiusEnabled = radiusOptions.length >= 2
  // 반경 문제(R1 응답 반경 불일치·R2 invalid_radius) 처리기 — 점포 hook 이 먼저 만들어지므로 ref 로 넘긴다
  const radiusProblemRef = useRef<(request: AnalyzeRequest, problem: RadiusProblem) => void>(() => {})
  const nearbyOptions = {
    onSuccess: (request: AnalyzeRequest, data: NearbyStoresResponse) => resultCache.current.putNearby(request, data),
    onRadiusProblem: (request: AnalyzeRequest, problem: RadiusProblem) => radiusProblemRef.current(request, problem),
  }
  const [mobileScreen, setMobileScreen] = useState<MobileScreen>('map')
  // 대시보드 배치(R1 13-10): 결과가 있으면 결과 전폭 + 지도 작은 카드. 카드를 누르면 지도 배치(기존 A3)로 — 새 결과가 오면 다시 대시보드
  // 어느 결과에서 지도를 크게 봤는지 — 결과가 바뀌면 자동으로 대시보드로 돌아간다(effect 없이 파생)
  const [mapExpandedFor, setMapExpandedFor] = useState<AnalyzeResponse | null>(null)
  const [fitSeq, setFitSeq] = useState(0)
  // 대시보드에서 패널을 아래로 내리면 지도 카드는 내용 위에 떠 있지 않게 숨기고 작은 "지도" 버튼만 남긴다(크기는 그대로 — 지도 재맞춤 없음)
  const [panelScrolled, setPanelScrolled] = useState(false)
  // NAVER SDK 상태 (7-B2, docs/ADDRESS_DESIGN.md §5.1): MapView가 onSdkState로 올린다. 참고 주소는 ready + geocoder ready일 때만 조회한다.
  // 로더를 여기서 다시 부르거나 SDK를 다시 넣지 않는다
  const [sdk, setSdk] = useState<SdkState>({ status: 'loading' })
  // 화면 테마(묶음 A, DESIGN.md §19.7): 저장된 선택 > 시스템 설정 > 다크. 지도 톤은 MapView가 실제 렌더 결과로 따로 정한다
  const { theme, setPreference: setThemePreference } = useTheme()
  // 첫 방문 안내(묶음 D, docs/ONBOARDING_DESIGN.md): ①~③은 조건 패널·mobile 시트에, ④ 결과 안내는 결과 머리·결과 시트에 인라인 말풍선
  const { state: tour, send: sendTour } = useOnboarding()
  // 위치 입력 방법 (P2·P3): 조건 패널과 mobile 지도 sheet의 segmented가 같이 쓴다. sheet에서 주소·좌표를 고르면
  // 패널 화면으로 가서 그 폼의 첫 입력칸으로 포커스(methodFocus를 올린다, B5)
  const [locationMethod, setLocationMethod] = useState<LocationMethod>('map')
  const [methodFocus, setMethodFocus] = useState(0)
  // 고른 좌표의 참고 주소가 실제로 있는지 — 있으면 위치 요약에서 좌표를 접는다. ReferenceAddress와 같은 캐시라 조회는 1회
  const pickedAddress = useReferenceAddress(sdk, location)
  // 반경 안 동종 점포 (4차): 분석 성공 뒤 같은 좌표·업종으로 따로 조회한다. null = 분석 결과 없음
  // 조건이 바뀌면 취소·제거하고, 늦게 온 이전 요청 응답은 버린다 (useNearbyRequest)
  const nearbyA = useNearbyRequest(nearbyOptions)
  const nearby = nearbyA.state
  const [showStores, setShowStores] = useState(true)
  const [activeStoreId, setActiveStoreId] = useState<string | null>(null)
  // 비교 중 B 점포 (5차-B5): A와 별도 요청 번호·AbortController. B 분석 성공 뒤 같은 좌표·업종으로 조회한다
  const nearbyB = useNearbyRequest(nearbyOptions)
  // 비교 요약의 점포 기준(B 성공 뒤 기본 B)과 비교 중 "지도에 표시". A 단일 결과의 showStores는 건드리지 않는다
  const [storeSide, setStoreSide] = useState<CompareSide>('B')
  const [compareShowStores, setCompareShowStores] = useState(true)
  // 두 위치 비교 (5차, docs/COMPARE_DESIGN.md 3장): A = 위 analysis 그대로, B만 따로 둔다
  const [compareRaw, setCompareState] = useState<CompareState>({ status: 'off' })
  const compareRef = useRef(compareRaw)
  const setCompare = useCallback((next: CompareState) => {
    compareRef.current = next
    setCompareState(next)
  }, [])
  // 화면이 보는 비교 상태: B 성공은 A와 같은 세대(업종·반경 같음)이고 엔진버전도 같을 때만 성공으로 보인다. 아니면(A를 다시
  // 분석 중이거나 버전이 섞임) B를 "분석 중"처럼 다룬다 — 섞인 결과를 비교표에 그리지 않는다(8-D3 재검수, 렌더 보호).
  // 불일치의 계약 오류·캐시 폐기는 콜백(startA·acceptB)이 따로 한다
  const compare: CompareState =
    compareRaw.status === 'success' && !consistentCompare(analysis, compareRaw)
      ? { status: 'loading', location: compareRaw.location }
      : compareRaw
  // 실제로 B 분석 요청이 진행 중인지 — 표시 보류(위 compare 의 loading)와 다르다. 반경 조작 잠금(S15)·지도 클릭·B 선택은
  // 이것으로 판단한다(A 실패·B 성공처럼 요청이 모두 끝난 상태에서 반경을 다시 고를 수 있게, 8-D3 최종 검수)
  const bRequesting = compareRaw.status === 'loading'
  // B 성공 뒤 패널 화면: 비교 요약 / A 전체 결과 / B 전체 결과 (§3.3). 오가도 A·B 응답은 그대로다
  const [compareView, setCompareView] = useState<CompareView>('summary')
  // B 선택을 처음부터 다시 할 때마다(pickB) 올린다 → B 카드 주소 검색을 새로 그려 진행 중 검색·결과를 버린다(7-B5 보완).
  // 오류 상태의 "지도에서 다시 선택"은 B 고르기 화면(ComparePanel)을 그대로 둔 채 pickB를 부르므로 언마운트만으로는 초기화되지 않는다
  const [bPickSeq, setBPickSeq] = useState(0)
  // 비교 화면 전환 뒤 포커스를 옮길 요소 id (렌더 뒤에 옮긴다). resetScroll: 옮기기 직전에 그 요소의 조상 스크롤을 맨 위로(6-5)
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number; resetScroll?: boolean } | null>(null)
  // tablet 패널 접기 (P9, A3): 접은 화면(패널 이름 + 그때 보이던 결과 응답 객체)을 기억한다. 화면이 바뀌면(이름이나 응답이 달라지면)
  // 그 기록은 버린다 — 조건 바꾸기 → 다시 분석(캐시 적중 포함)으로 같은 이름의 화면이 와도 이전 접힘이 되살아나지 않는다(8-P 검수).
  // 포커스를 옮길 일이 생겨도 펼친다
  const [foldedAt, setFoldedAt] = useState<{ label: string; shown: object | null } | null>(null)
  const focusLater = (id: string, opts: { resetScroll?: boolean } = {}) => {
    setFoldedAt(null)                                      // 접힌 패널 안으로 포커스를 옮기지 않게 먼저 펼친다
    setFocusRequest((r) => ({ id, n: (r?.n ?? 0) + 1, ...opts }))
  }

  // GET /businesses — 업종 목록은 API에서만 받는다
  useEffect(() => {
    const ac = new AbortController()
    fetchBusinesses(ac.signal)
      .then((r) => {
        setBusinesses(r.ok ? { status: 'ready', catalog: r.data } : { status: 'error', failure: r.failure })
        shareInputs.current.catalog = r.ok ? r.data : null
        shareLoaded.current.businesses = true
        applyShareRef.current()                            // 공유 링크(12-3): 두 응답이 다 오면 1회 적용
      })
      .catch(() => {})                                     // 취소된 요청
    return () => ac.abort()
  }, [businessesLoad])

  // GET /health — 반경 광고(8-D3)와 데이터 메타(9-C4). 실패·구버전 응답이면 반경 선택 없음·기준일 없음(지금과 같은 화면·요청)
  useEffect(() => {
    const ac = new AbortController()
    fetchHealth(ac.signal)
      .then((r) => {
        setRadiusOptions(r.ok && r.data.engine ? r.data.engine.radius_options : [])
        setServerEngine(r.ok && r.data.engine ? r.data.engine.version : null)
        setDataInfo(r.ok && r.data.data ? r.data.data : null)
        setPlacesReady(r.ok && r.data.places ? r.data.places.enabled : false)
        // 공유 링크(12-3): 실패·구버전이어도 "알아봤다" — 적용을 더 기다리지 않는다
        shareInputs.current.health = {
          options: r.ok && r.data.engine ? r.data.engine.radius_options : [],
          engine: r.ok && r.data.engine ? r.data.engine.version : null,
          data: r.ok && r.data.data ? r.data.data.version : null,
        }
        shareLoaded.current.health = true
        applyShareRef.current()
      })
      .catch(() => {})                                     // 취소된 요청
    return () => ac.abort()
  }, [])

  // 9-C4: 보이는 결과의 데이터 버전이 알고 있는 서버 메타와 다르면(리비전 전환 직후 등) /health 를 다시 읽어 기준일을 맞춘다.
  // 맞출 때까지 결과 화면은 기준일을 비워 둔다(asOfFor) — 다른 버전의 날짜를 보이지 않는다
  const shownDataVersion = analysis.status === 'success' ? dataVersionOf(analysis.response) : null
  const knownDataVersion = dataInfo?.version ?? null
  useEffect(() => {
    if (shownDataVersion === null || shownDataVersion === knownDataVersion) return
    const ac = new AbortController()
    fetchHealth(ac.signal)
      .then((r) => {
        if (r.ok && r.data.data) setDataInfo(r.data.data)
        if (r.ok) setPlacesReady(r.data.places ? r.data.places.enabled : false)
      })
      .catch(() => {})                                     // 취소된 요청
    return () => ac.abort()
  }, [shownDataVersion, knownDataVersion])

  const reloadBusinesses = () => {
    setBusinesses({ status: 'loading' })
    setBusinessesLoad((n) => n + 1)
  }

  // 진행 중인 분석: 조건이 바뀌면 취소하고, 늦게 온 응답은 버린다 (이전 결과와 새 조건이 섞이지 않게)
  const inflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const seq = useRef(0)

  const { cancel: cancelNearbyA, load: loadNearbyA, prime: primeNearbyA } = nearbyA
  const { cancel: cancelNearbyB } = nearbyB
  const cancelNearby = useCallback(() => {
    cancelNearbyA()
    setActiveStoreId(null)
  }, [cancelNearbyA])

  const loadNearby = useCallback(
    (request: AnalyzeRequest) => {
      loadNearbyA(request)
      setActiveStoreId(null)
    },
    [loadNearbyA],
  )

  /** 캐시 항목의 점포가 있으면 바로 채우고(요청 0), 없으면(부분 캐시) 점포만 다시 조회한다 (4.3) */
  const showNearbyFromCache = useCallback(
    (request: AnalyzeRequest, data: NearbyStoresResponse | null) => {
      if (data) {
        primeNearbyA(data)
        setActiveStoreId(null)
      } else {
        loadNearby(request)
      }
    },
    [primeNearbyA, loadNearby],
  )

  /**
   * 한 비교에 두 엔진(4.5): B를 계약 오류로 두고 캐시를 전부 버린다(어느 쪽이 서버의 지금 엔진인지 모른다).
   * A·B 어느 쪽이 나중에 와도 같은 처리(startA·acceptB)
   */
  const rejectMixedEngines = useCallback(
    (point: LatLng, a: AnalyzeResponse, b: AnalyzeResponse) => {
      console.error('[api] A·B 엔진·데이터 버전이 다릅니다', {
        a: [a.result.meta.엔진버전, dataVersionOf(a)],
        b: [b.result.meta.엔진버전, dataVersionOf(b)],
      })
      resultCache.current.clear()
      cancelNearbyB()
      setCompare({ status: 'error', location: point, failure: { kind: 'schema', endpoint: '/analyze', status: 200 } })
      focusLater(COMPARE_IDS.bError)
    },
    [cancelNearbyB, setCompare],
  )

  // B 분석 요청: A와 다른 AbortController·요청 번호. 취소·종료·조건 변경 뒤 도착한 응답은 seq가 달라 버린다
  const compareInflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const compareSeq = useRef(0)

  const resetCompare = useCallback(() => {
    epoch.current++
    compareInflight.current?.controller.abort()
    compareInflight.current = null
    cancelNearbyB()                                        // 늦게 온 B 점포 응답도 버린다
    setCompare({ status: 'off' })
    setCompareView('summary')
  }, [cancelNearbyB, setCompare])

  const cancelAnalysis = () => {
    epoch.current++
    inflight.current?.controller.abort()
    inflight.current = null
    setAnalysis({ status: 'idle' })
    cancelNearby()
    resetCompare()                                         // A가 없으면 비교도 없다
    setCompareReload(null)
    setShareNotice(null)
    sendTour({ type: 'conditions-shown' })                 // 결과 안내가 열려 있었으면 닫는다(완료로 치지 않음)
  }

  /**
   * A 분석 1건. keepCompare: 비교 중 반경 변경·복구(B는 따로 다시 요청하거나 아직 없음) — 비교 상태를 지우지 않는다.
   * 캐시 적중이면 요청하지 않는다(S2). 저장은 활성 요청의 성공 응답만(늦은 응답은 seq 가 달라 화면·캐시 모두 반영 안 함, S7).
   */
  const startA = useCallback(
    (request: AnalyzeRequest, opts: { keepCompare?: boolean; origin?: AnalysisOrigin; onSuccess?: (request: AnalyzeRequest) => void; fresh?: boolean } = {}) => {
      epoch.current++
      inflight.current?.controller.abort()
      inflight.current = null
      cancelNearby()
      if (!opts.keepCompare) resetCompare()
      /** A 성공 뒤: 이미 받은 같은 세대 B와 엔진버전이 다르면 B를 계약 오류로(B가 먼저 도착한 경우) */
      const checkB = (response: AnalyzeResponse) => {
        const c = compareRef.current
        if (opts.keepCompare && c.status === 'success' && mixedEngines(request, response, c.request, c.response)) {
          rejectMixedEngines(c.location, response, c.response)
        }
      }
      // fresh(12-28-R2): 보관함 "같은 조건으로 다시 분석"처럼 사용자가 명시적으로 지금 서버의 결과를 요구하면 캐시를 읽지 않고 요청한다
      // (응답은 캐시에 다시 저장된다 — 엔진·데이터 버전이 바뀌었으면 ResultCache 가 전체를 비운다)
      const cached = opts.fresh ? undefined : resultCache.current.get(request)
      if (cached) {
        seq.current++
        setAnalysis({ status: 'success', request, response: cached.analyze })
        setCompareReload(null)
        setMobileScreen('panel')
        showNearbyFromCache(request, cached.nearby)
        checkB(cached.analyze)
        sendTour({ type: 'analyzed' })
        opts.onSuccess?.(request)                          // 공유 링크의 B(12-3): 같은 업종·반경으로 이어서
        return
      }
      const current = { seq: ++seq.current, controller: new AbortController() }
      inflight.current = current
      setAnalysis({ status: 'loading', request, origin: opts.origin })

      analyze(request, current.controller.signal)
        .then((r) => {
          if (inflight.current?.seq !== current.seq) return
          inflight.current = null
          if (!r.ok) {
            setAnalysis({ status: 'error', request, failure: r.failure, origin: opts.origin })
            if (isInvalidRadius(r.failure)) radiusProblemRef.current(request, 'invalid')       // 4.6 R2
            return
          }
          const check = checkResponse(r.data, request)
          if (check !== 'ok') {
            console.error('[api] /analyze 응답 조건이 요청과 다릅니다', { request, context: r.data.context, meta: r.data.result.meta })
            setAnalysis({
              status: 'error',
              request,
              failure: { kind: 'schema', endpoint: '/analyze', status: 200 },
              origin: opts.origin,
            })
            if (check === 'radius') radiusProblemRef.current(request, 'mismatch')            // 4.6 R1 (S5)
            return
          }
          resultCache.current.putAnalyze(request, r.data)
          setAnalysis({ status: 'success', request, response: r.data })
          setCompareReload(null)
          setMobileScreen('panel')
          loadNearby(request)                              // 실패해도 분석 결과는 그대로 둔다
          checkB(r.data)
          sendTour({ type: 'analyzed' })
          opts.onSuccess?.(request)                        // 공유 링크의 B(12-3). A 가 실패하면 B 는 없다
        })
        .catch(() => {})                                   // 취소된 요청
    },
    [cancelNearby, resetCompare, loadNearby, showNearbyFromCache, rejectMixedEngines, setAnalysis, setCompareReload, sendTour],
  )

  const runAnalysis = useCallback(() => {
    if (!location || !bizCode) return
    setRadiusNotice(null)
    setPrevRadius(null)
    startA(buildRequest(location, bizCode, radius, radiusEnabled))
  }, [location, bizCode, radius, radiusEnabled, startA])

  const analyzing = analysis.status === 'loading'
  const comparing = compare.status !== 'off'

  // ─── 두 위치 비교 (B) ───────────────────────────────────────────
  /** B 위치 고르기로 (시작·다시 고르기). desktop은 B 카드 제목, mobile은 지도 화면 sheet로 포커스 */
  const pickB = () => {
    epoch.current++
    compareInflight.current?.controller.abort()
    compareInflight.current = null
    nearbyB.cancel()                                       // B를 다시 고르면 이전 B 점포 요청·목록을 버린다
    setCompare({ status: 'picking', location: null })
    setBPickSeq((n) => n + 1)                              // 검색 초기화 신호 (지도 클릭으로 B 좌표만 바꿀 때는 올리지 않는다)
    setCompareView('summary')
    setActiveStoreId(null)                                 // 비교 중에는 A 점포 선택·정보창을 닫는다(A 점포 데이터는 그대로)
    setMobileScreen('map')
    focusLater(isMobile() ? COMPARE_IDS.sheetAction : COMPARE_IDS.bTitle)
  }

  /**
   * 비교 요약 → 위치별 전체 결과. 응답은 상태에 있는 것을 그대로 쓰고 다시 요청하지 않는다. 포커스는 그 결과 제목.
   * 요약에서 내려가 있던 스크롤을 이어받지 않게 맨 위("비교로 돌아가기" 막대)부터 보이도록 스크롤 초기화를 포커스와 한 번에 한다(6-5)
   */
  const showCompareDetail = (side: CompareSide) => {
    setCompareView(side === 'A' ? 'detail-A' : 'detail-B')
    setActiveStoreId(null)                                 // 점포 기준이 그 위치로 바뀐다 → 선택·정보창 해제
    focusLater('result-title', { resetScroll: true })
  }

  /** 전체 결과 → 비교 요약. 포커스는 눌렀던 "A/B 전체 결과 보기" 버튼으로 돌려준다 */
  const backToCompareSummary = (side: CompareSide) => {
    setCompareView('summary')                              // 요약의 점포 기준(storeSide)은 그대로 → 열기 전 기준 복원
    setActiveStoreId(null)
    focusLater(side === 'A' ? COMPARE_IDS.detailA : COMPARE_IDS.detailB)
  }

  /** 비교 요약에서 점포 기준 A/B 전환. 각 위치 점포 데이터는 그대로 두고 다시 조회하지 않는다 */
  const changeStoreSide = (side: CompareSide) => {
    if (side === storeSide) return
    setStoreSide(side)
    setActiveStoreId(null)
    focusLater(side === 'A' ? COMPARE_IDS.storeSideA : COMPARE_IDS.storeSideB)   // 목록이 새로 그려져도 누른 버튼에
  }

  const startCompare = () => {
    if (analysis.status !== 'success') return
    pickB()
  }

  /** 비교 종료·취소: B만 지우고 A 결과·A 점포 목록으로 돌아간다. 포커스는 "다른 위치와 비교" 버튼 */
  const endCompare = () => {
    resetCompare()
    setCompareReload(null)
    setMobileScreen('panel')
    focusLater(COMPARE_IDS.start)
  }

  /** 비교 중 지도 클릭·좌표 입력 = B 선택. A는 바꾸지 않는다. B 분석 중에는 무시(D9). 받아들였으면 true */
  const selectCompareLocation = (point: LatLng): boolean => {
    if (compare.status === 'off' || bRequesting) return false
    epoch.current++
    nearbyB.cancel()
    setCompare({ status: 'picking', location: point })    // 이전 B 결과·오류·점포는 지운다
    return true
  }

  /**
   * B 좌표 직접 입력 제출(유효한 좌표만 들어온다 — 잘못된 값은 CoordinateForm이 막고 오류를 보인다).
   * 입력란은 B 좌표가 바뀌면 새로 그려져(key) 제출 버튼·입력란이 사라지므로, 렌더 뒤 "B 분석하기"로 포커스를 옮긴다.
   * 지도 클릭(selectCompareLocation 직접)은 포커스를 옮기지 않는다 — 지도를 쓰는 중에 패널로 빼앗지 않게.
   */
  const submitCompareLocation = (point: LatLng) => {
    if (selectCompareLocation(point)) focusLater(COMPARE_IDS.bAnalyze)
  }

  /** B 성공(요청 응답 또는 캐시). A 응답과 엔진버전이 다르면 계약 오류 — 한 비교에 두 엔진을 섞지 않는다 (4.5) */
  const acceptB = (point: LatLng, request: AnalyzeRequest, response: AnalyzeResponse, cachedNearby: NearbyStoresResponse | null) => {
    const a = analysisRef.current
    // A가 아직 다시 분석 중이면(같은 세대가 아님) 지금은 판정하지 않는다 — A가 도착할 때 startA가 본다
    if (a.status === 'success' && mixedEngines(a.request, a.response, request, response)) {
      rejectMixedEngines(point, a.response, response)
      return
    }
    setCompare({ status: 'success', location: point, request, response })
    setCompareView('summary')
    setStoreSide('B')                                      // 점포 기준 기본값 B (D4)
    setCompareShowStores(true)
    setActiveStoreId(null)
    if (cachedNearby) nearbyB.prime(cachedNearby)
    else nearbyB.load(request)                             // 실패해도 A·B 분석 결과는 그대로 둔다
    focusLater(COMPARE_IDS.title)
  }

  /**
   * B 분석. 업종·반경은 A 요청과 같다(aRequest — 생략하면 지금 A 결과의 요청). 비교 중 반경 변경(S9)·복구는 새 A 요청을
   * 넘겨 A·B를 동시에 다시 분석한다. 캐시 적중이면 요청하지 않는다.
   */
  const requestCompare = (point: LatLng, aRequest?: AnalyzeRequest) => {
    const aReq = aRequest ?? (analysis.status === 'success' ? analysis.request : null)
    if (!aReq) return
    epoch.current++
    if (sameCoordinates(point, aReq)) {
      setCompare({ status: 'picking', location: point, sameAsA: true })   // 요청하지 않는다 (D2)
      return
    }
    compareInflight.current?.controller.abort()
    compareInflight.current = null
    nearbyB.cancel()
    const request: AnalyzeRequest = { ...aReq, lat: point.lat, lng: point.lng }
    const cached = resultCache.current.get(request)
    if (cached) {
      compareSeq.current++
      setMobileScreen('panel')
      acceptB(point, request, cached.analyze, cached.nearby)
      return
    }
    const current = { seq: ++compareSeq.current, controller: new AbortController() }
    compareInflight.current = current
    setCompare({ status: 'loading', location: point })

    analyze(request, current.controller.signal)
      .then((r) => {
        if (compareInflight.current?.seq !== current.seq) return    // 취소·종료·조건 변경·재요청 뒤 늦게 온 응답
        compareInflight.current = null
        setMobileScreen('panel')
        if (!r.ok) {
          setCompare({ status: 'error', location: point, failure: r.failure })
          focusLater(COMPARE_IDS.bError)
          if (isInvalidRadius(r.failure)) radiusProblemRef.current(request, 'invalid')       // 4.6 R2
          return
        }
        const check = checkResponse(r.data, request)
        if (check !== 'ok') {
          console.error('[api] /analyze(B) 응답 조건이 요청과 다릅니다', { request, context: r.data.context, meta: r.data.result.meta })
          setCompare({ status: 'error', location: point, failure: { kind: 'schema', endpoint: '/analyze', status: 200 } })
          focusLater(COMPARE_IDS.bError)
          if (check === 'radius') radiusProblemRef.current(request, 'mismatch')              // 4.6 R1
          return
        }
        resultCache.current.putAnalyze(request, r.data)
        acceptB(point, request, r.data, null)
      })
      .catch(() => {})                                     // 취소된 요청
  }

  const runCompare = () => {
    if (compare.status === 'picking' && compare.location) requestCompare(compare.location)
  }

  const handleCompareErrorAction = (action: ErrorAction) => {
    if (compare.status !== 'error') return
    switch (action) {
      case 'retry':
        requestCompare(compare.location)                   // 같은 B 좌표·같은 업종, 새 요청 번호
        return
      case 'reselect-location':
        pickB()
        return
      case 'reselect-business':
      case 'reselect-conditions':
        handleErrorAction(action)                          // 비교 안에서는 업종을 바꿀 수 없다 → 비교를 끝내고 조건부터
    }
  }

  /**
   * 분석 반경 변경 (8-D3, 4.4). 분석 전(S1)은 지도 원만 바꾼다. 결과를 보는 중이거나 반경 변경으로 실패한 화면이면
   * 같은 조건을 새 반경으로 다시 분석한다 — 캐시 적중이면 요청 0(S2), 아니면 로딩(S3). 비교 중이면 A·B 모두(S9).
   * 분석 중(A·B)에는 누를 수 없다(S15).
   */
  const changeRadius = (next: number) => {
    if (next === radius || analyzing || bRequesting) return
    epoch.current++
    setPrevRadius(radius)
    setRadius(next)
    setRadiusNotice(null)
    setShareNotice(null)                                   // 링크·보관함 조건으로 분석했다는 안내는 그 결과까지만(12-3)
    const base =
      analysis.status === 'success' || (analysis.status === 'error' && analysis.origin === 'radius')
        ? analysis.request
        : null
    if (!base) return
    const reqA = buildRequest(base, base.biz_code, next, true)
    const bLocation =
      compareReload ?? (compareRaw.status === 'success' || compareRaw.status === 'error' ? compareRaw.location : null)
    if (bLocation) {
      setCompareReload(bLocation)
      startA(reqA, { keepCompare: true, origin: 'radius' })
      requestCompare(bLocation, reqA)
    } else {
      startA(reqA, { keepCompare: compare.status !== 'off', origin: 'radius' })
    }
  }

  /**
   * 반경 복구 (4.6 R1·R2). 반경을 보낸 요청이 500m 응답을 받았거나(R1, 구버전 서버) invalid_radius 를 받으면(R2, 새 v0.3 서버)
   * /health 를 다시 본다. 요청 반경을 아직 광고하면 복구하지 않고 오류로 둔다(S5·S8). 더 이상 광고하지 않으면
   * 반경 선택 숨김(광고가 2개 미만이면) · 반경 500 복귀 · 반경 ≠ 500 캐시 폐기 · 안내 · 500m 재분석 1회(비교 중이면 A·B 모두).
   * 재분석은 반경을 보내지 않거나(광고 없음) 500을 보내므로 같은 경로로 다시 복구하지 않는다(반복 없음).
   */
  const recoveryRequests = useRef(new WeakSet<AnalyzeRequest>())
  // 지금 진행 중인 복구의 세대. 같은 세대의 두 번째 문제(A·B 오류가 함께 옴)는 건너뛰고, 새 세대의 문제는 이전 복구가
  // 끝나기를 기다리지 않고 새로 복구한다 — 이전 복구는 세대가 달라 응답 뒤 아무것도 바꾸지 않는다(8-D3 재검수)
  const recoveringEpoch = useRef<number | null>(null)
  const recoverRadius = async (request: AnalyzeRequest, problem: RadiusProblem) => {
    if (request.radius_m === undefined || recoveryRequests.current.has(request)) return
    const startedAt = epoch.current
    if (recoveringEpoch.current === startedAt) return
    recoveringEpoch.current = startedAt
    try {
      const r = await fetchHealth()
      // 그사이 새 분석·반경 변경·조건 변경·비교 종료가 있었으면 이 복구는 무효 — 광고·반경·캐시·안내·요청을 바꾸지 않는다
      if (epoch.current !== startedAt) return
      const engineInfo = r.ok ? r.data.engine : undefined
      const options = engineInfo ? engineInfo.radius_options : []
      setRadiusOptions(options)
      setServerEngine(engineInfo ? engineInfo.version : null)
      const dataMeta = r.ok && r.data.data ? r.data.data : null
      setDataInfo(dataMeta)
      setPlacesReady(r.ok && r.data.places ? r.data.places.enabled : false)
      if (options.length >= 2 && options.includes(request.radius_m)) {
        console.error(`[api] 반경 ${request.radius_m}m 문제(${problem})지만 서버가 아직 광고합니다 — 복구하지 않습니다`)
        return
      }
      const withRadius = options.length >= 2 && options.includes(DEFAULT_RADIUS_M)
      setRadius(DEFAULT_RADIUS_M)
      setPrevRadius(null)
      // 확인된 엔진이 캐시와 같을 때만 반경 500 항목을 재사용한다. 다른 엔진이거나 버전을 알리지 않는 구버전 서버면
      // 이전 캐시를 쓸 근거가 없으므로 전부 버리고 새 서버에서 다시 조회한다(8-D3 검수)
      if (
        engineInfo &&
        engineInfo.version === resultCache.current.engineVersion &&
        (dataMeta?.version ?? null) === resultCache.current.dataVersion
      ) {
        resultCache.current.dropRadiusOtherThan(DEFAULT_RADIUS_M)
      } else {
        resultCache.current.clear()
      }
      setRadiusNotice(RADIUS_RECOVERY_NOTICE)
      const a = analysisRef.current
      if (a.status === 'idle') return
      const c = compareRef.current
      const reqA = buildRequest(a.request, a.request.biz_code, DEFAULT_RADIUS_M, withRadius)
      recoveryRequests.current.add(reqA)
      const bLocation =
        compareReloadRef.current ??
        (c.status === 'success' || c.status === 'error' || c.status === 'loading' ? c.location : null)
      if (bLocation) {
        setCompareReload(bLocation)
        startA(reqA, { keepCompare: true, origin: 'radius' })
        requestCompareRef.current(bLocation, reqA)
      } else {
        startA(reqA, { keepCompare: c.status !== 'off', origin: 'radius' })
      }
    } finally {
      if (recoveringEpoch.current === startedAt) recoveringEpoch.current = null   // 새 세대 복구의 표시는 건드리지 않는다
    }
  }
  const requestCompareRef = useRef(requestCompare)
  useLayoutEffect(() => {
    requestCompareRef.current = requestCompare
    radiusProblemRef.current = (request, problem) => void recoverRadius(request, problem)
  })

  // 공유 링크 적용(12-3): 업종 목록과 /health 응답 콜백이 부른다 — 둘 다 온 뒤 1회. 업종을 모르면(목록 실패 포함) 위치만 가져온다.
  // 반경은 서버가 광고할 때만 링크 값, 아니면 기본 반경으로 분석하며 안내한다. 링크의 데이터 묶음·엔진이 지금 서버와 다르면
  // 결과가 다를 수 있다고 안내한다. B 좌표는 A 성공 뒤 같은 업종·반경으로 비교를 잇는다(startA thenB)
  useLayoutEffect(() => {
    applyShareRef.current = () => {
      if (shareLinkRef.current === undefined) shareLinkRef.current = parseShareQuery(window.location.search)
      const link = shareLinkRef.current
      if (!link || !shareLoaded.current.businesses || !shareLoaded.current.health) return
      shareLinkRef.current = null
      setSharePending(false)
      const point = { lat: link.lat, lng: link.lng }
      setLocation(point)
      const { catalog, health } = shareInputs.current
      const known = catalog?.groups.some((g) => g.businesses.some((b) => b.code === link.biz)) ?? false
      if (!known) {
        setShareNotice('공유 링크의 업종을 이 서버에서 찾을 수 없어 위치만 가져왔습니다. 업종을 골라 분석하세요.')
        return
      }
      setBizCode(link.biz)
      const options = health?.options ?? []
      const enabled = options.length >= 2
      const notes = ['공유 링크의 조건으로 다시 분석했습니다 — 저장된 점수가 아니라 지금 서버의 결과입니다.']
      let r = DEFAULT_RADIUS_M
      if (link.radius !== null && link.radius !== DEFAULT_RADIUS_M) {
        if (enabled && options.includes(link.radius)) r = link.radius
        else notes.push(`링크의 반경 ${formatRadius(link.radius)}는 이 서버가 지원하지 않아 ${formatRadius(DEFAULT_RADIUS_M)}로 분석합니다.`)
      }
      const now = { data: health?.data ?? null, engine: health?.engine ?? null }
      if (versionsDiffer(link, now)) {
        const label = (v: { data: string | null; engine: string | null }) =>
          [v.data && dataVersionLabel(v.data), v.engine && `엔진 ${v.engine}`].filter(Boolean).join(' · ')
        notes.push(`링크를 만들 때는 ${label(link)}였고 지금은 ${label(now)}입니다. 결과가 그때와 다를 수 있습니다.`)
      }
      setRadius(r)
      setPrevRadius(null)
      setShareNotice(notes.join(' '))
      const b = link.b
      startA(buildRequest(point, link.biz, r, enabled), b ? { onSuccess: (request) => requestCompareRef.current(b, request) } : {})
    }
  })

  // 지금 보이는 결과의 조건 = 공유 링크. 결과가 있으면 주소창 쿼리도 같게 둔다(replaceState — 뒤로 가기 항목을 만들지 않는다).
  // 결과가 없으면 쿼리를 지운다. 링크 조건을 아직 적용하기 전에는 주소를 건드리지 않는다
  const currentShare: ShareConditions | null =
    analysis.status === 'success'
      ? {
          lat: analysis.request.lat,
          lng: analysis.request.lng,
          biz: analysis.request.biz_code,
          radius: analysis.request.radius_m ?? null,
          b: compare.status === 'success' ? compare.location : null,
          data: dataVersionOf(analysis.response),
          engine: analysis.response.result.meta.엔진버전,
        }
      : null
  const currentQuery = currentShare ? `?${shareQuery(currentShare)}` : ''
  useEffect(() => {
    if (sharePending || window.location.search === currentQuery) return
    window.history.replaceState(null, '', `${window.location.pathname}${currentQuery}${window.location.hash}`)
  }, [sharePending, currentQuery])

  const selectLocation = (point: LatLng) => {
    if (analyzing) return                                  // 분석 중 새 선택은 무시 (§8.12)
    if (comparing) {
      selectCompareLocation(point)                         // 비교 중 지도 클릭은 B 선택 (A를 바꾸지 않는다)
      return
    }
    cancelAnalysis()
    setLocation(point)
    sendTour({ type: 'location-picked' })
  }

  const changeBusiness = (code: string) => {
    if (analyzing) return
    cancelAnalysis()
    setBizCode(code || null)
    if (code) sendTour({ type: 'business-picked' })
  }

  // 첫 방문 안내 말풍선 (묶음 D): ①~③은 ConditionPanel·mobile 시트가 해당 요소 아래에 그린다. ④는 결과 머리·결과 시트
  const tourStep = tour.step
  const conditionCoach =
    tourStep && tourStep !== 'result'
      ? {
          step: tourStep,
          text: TOUR_TEXT[tourStep],
          index: stepIndex(tourStep),
          onNext: () => sendTour({ type: 'next' }),
          onSkip: () => sendTour({ type: 'skip' }),
          onDismiss: () => sendTour({ type: 'dismiss' }),
        }
      : null
  const resultCoach =
    tourStep === 'result' ? (
      <CoachMark
        text={radiusEnabled ? RESULT_TEXT.withRadius : RESULT_TEXT.compareOnly}
        index={null}
        last
        onNext={() => sendTour({ type: 'next' })}
        onSkip={() => sendTour({ type: 'skip' })}
        onDismiss={() => sendTour({ type: 'dismiss' })}
      />
    ) : null
  const replayHelp = (screen: 'conditions' | 'result') => <ReplayHelpButton onClick={() => sendTour({ type: 'replay', screen })} />

  const mapRef = useRef<HTMLDivElement>(null)
  /** 패널(펼친 시트) 스크롤 영역 — "아래에 더 있어요" 표시가 본다 */
  const panelScrollRef = useRef<HTMLElement>(null)
  const pickOnMap = () => {
    setLocationMethod('map')
    setMobileScreen('map')
    mapRef.current?.scrollIntoView?.({ block: 'nearest' })
  }

  const handleErrorAction = (action: ErrorAction) => {
    switch (action) {
      case 'retry':
        // 같은 K 재시도(S14). 비교 중 반경 변경에서 A가 실패했으면 A·B 모두(S11), 반경 변경 실패는 비교를 유지한 채 A만
        if (analysis.status === 'error' && compareReload) {
          startA(analysis.request, { keepCompare: true, origin: 'radius' })
          requestCompare(compareReload, analysis.request)
          return
        }
        if (analysis.status === 'error' && analysis.origin === 'radius') {
          startA(analysis.request, { keepCompare: compare.status !== 'off', origin: 'radius' })
          return
        }
        runAnalysis()
        return
      case 'reselect-location':
        cancelAnalysis()
        setLocation(null)
        pickOnMap()
        return
      case 'reselect-business':
        cancelAnalysis()
        setBizCode(null)
        reloadBusinesses()
        return
      case 'reselect-conditions':
        cancelAnalysis()
        setLocation(null)
        setBizCode(null)
        pickOnMap()
    }
  }

  // sticky 헤더 높이 → 문서 스크롤 여백(syncHeaderOffset). 마운트 때와 헤더 크기가 바뀔 때(창 크기·글꼴 로드로 줄바꿈이 바뀜).
  // 포커스를 옮기는 effect는 그 전에 한 번 더 잰다 — 같은 렌더에서 헤더(Context Bar)가 바뀌면 ResizeObserver는 포커스 뒤에야 알린다
  const headerRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    syncHeaderOffset(headerRef.current)
    const observer = new ResizeObserver(() => syncHeaderOffset(headerRef.current))
    if (headerRef.current) observer.observe(headerRef.current)
    return () => observer.disconnect()
  }, [])

  // 결과가 나오면 결과 제목으로 포커스를 옮긴다 (스크린리더·키보드 사용자가 새 내용 시작점을 안다)
  useEffect(() => {
    if (analysis.status !== 'success') return
    syncHeaderOffset(headerRef.current)
    document.getElementById('result-title')?.focus()
  }, [analysis.status])

  // 비교 화면 전환 뒤 포커스 (렌더가 끝난 뒤라 새로 생긴 요소도 찾는다). 오류 블록은 그 안 첫 버튼(행동)으로.
  // layout effect: 화면이 그려지기 전에 옮긴다 — 사라진 요소에 포커스가 남은 프레임이 없고, 순서가 늘 같다.
  // resetScroll(전체 결과 열기): 스크롤하는 쪽이 desktop은 패널, tablet·mobile은 문서라 대상의 조상을 모두 맨 위로 둔 **다음**
  // 포커스한다 — 포커스가 제목을 화면에 넣으려고 스크롤한 것을 되돌리는 코드가 뒤에 없다. 이 effect는 App(이미 마운트됨)의
  // 것이라 StrictMode가 새 화면(CompareDetail) 마운트 때 다시 돌리지 않는다(6-5: 예전에는 CompareDetail 마운트 effect가 초기화해
  // 개발 모드에서 포커스 뒤에 한 번 더 돌았다)
  useLayoutEffect(() => {
    if (!focusRequest) return
    const el = document.getElementById(focusRequest.id)
    const target = focusRequest.id === COMPARE_IDS.bError ? el?.querySelector<HTMLElement>('button') : el
    if (focusRequest.resetScroll) for (let p = target?.parentElement; p; p = p.parentElement) p.scrollTop = 0
    syncHeaderOffset(headerRef.current)
    target?.focus()
  }, [focusRequest])

  const result = analysis.status === 'success' ? analysis.response : null
  // 이 자리 업종 순위(13-16): 단일 결과의 좌표·반경으로 — 비교 중에는 요청하지 않는다(A 결과 카드에만)
  // 엔진·데이터 버전 꼬리표: 바뀌면 같은 좌표라도 순위·시간대 자료를 다시 받는다. 새 분석 응답(객체)이면 실패도 다시 시도한다
  const sideVersion = result ? `${result.result.meta.엔진버전}/${dataVersionOf(result) ?? ''}` : ''
  const singleSuccess = analysis.status === 'success' && compare.status === 'off'
  const rankState = useRank(
    singleSuccess
      ? { lat: analysis.request.lat, lng: analysis.request.lng, ...(analysis.request.radius_m !== undefined ? { radius_m: analysis.request.radius_m } : {}) }
      : null,
    sideVersion,
    result,
  )
  const insightsState = useInsights(
    singleSuccess ? { lat: analysis.request.lat, lng: analysis.request.lng, biz_code: analysis.request.biz_code } : null,
    sideVersion,
    result,
  )
  const mapExpanded = result !== null && mapExpandedFor === result
  // 지도 크게 보기·결과로 돌아가기는 누른 버튼이 사라진다 → 포커스를 짝 버튼으로 옮긴다(Codex R1-8). 스크롤은 건드리지 않는다
  const [mapFocus, setMapFocus] = useState<{ to: 'collapse' | 'opener'; opener: string } | null>(null)
  const expandMap = (opener: string) => {
    setMapExpandedFor(result)
    setFitSeq((n) => n + 1)                                // 커진 지도에 지점·반경을 다시 맞춘다
    setMapFocus({ to: 'collapse', opener })
  }
  const collapseMap = () => {
    setMapExpandedFor(null)
    setMapFocus((f) => ({ to: 'opener', opener: f?.opener ?? MAP_CARD_IDS.expand }))
  }
  useLayoutEffect(() => {
    if (!mapFocus) return
    const ids = mapFocus.to === 'collapse' ? [MAP_CARD_IDS.collapse] : [mapFocus.opener, MAP_CARD_IDS.expand, MAP_CARD_IDS.pill, 'result-title']
    const target = ids.map((id) => document.getElementById(id)).find((el) => el !== null)
    target?.focus({ preventScroll: true })
  }, [mapFocus])
  // 비교 B 고르기 중에는 지도를 눌러야 하므로 지도 배치. 비교 요약·전체 결과는 다시 대시보드
  const pickingB = compare.status !== 'off' && compare.status !== 'success'
  // mobile(<640)은 화면 전환 방식(지도 화면 ↔ 패널 화면) 그대로 — 대시보드 배치는 데스크톱·태블릿만
  const layout: 'dashboard' | 'map' = result && !mapExpanded && !pickingB && !isMobile() ? 'dashboard' : 'map'
  useEffect(() => {
    const el = panelScrollRef.current
    if (!el) return
    const read = () => setPanelScrolled(el.scrollTop > 160)
    el.addEventListener('scroll', read, { passive: true })
    return () => el.removeEventListener('scroll', read)
  }, [layout])
  // 지금 보이는 점포 기준 (§3.3·4.3): 비교가 아니면 A. 비교 중에는 B 성공 뒤에만 — 요약은 고른 기준, 전체 결과는 그 위치.
  // B 고르기·분석 중·실패에는 없다(목록·마커를 숨긴다)
  const visibleSide: CompareSide | null =
    compare.status === 'off'
      ? 'A'
      : compare.status !== 'success'
        ? null
        : compareView === 'detail-A'
          ? 'A'
          : compareView === 'detail-B'
            ? 'B'
            : storeSide
  const visibleNearby = visibleSide === 'A' ? nearby : visibleSide === 'B' ? nearbyB.state : null
  const storesShown = compare.status === 'off' ? showStores : compareShowStores
  // 지도 마커용 표시 문구. 같은 응답·같은 토글이면 같은 배열(지도가 마커를 다시 만들지 않게)
  const mapStores = useMemo<MapStore[] | null>(
    () =>
      visibleNearby?.status === 'success' && storesShown
        ? visibleNearby.data.stores.map((s) => ({
            id: s.id,
            name: storeName(s),
            address: storeAddress(s),
            distance: `직선거리 ${formatDistance(s.distance_m)}`,
            lat: s.lat,
            lng: s.lng,
            links: buildStoreLinks(s),                    // 정보창의 네이버·구글 검색 링크 (묶음 B)
          }))
        : null,
    [visibleNearby, storesShown],
  )
  // 점포 마커의 업종 글리프(묶음 B): 보이는 점포 응답의 업종코드로 — 비교 중 A↔B도 같은 업종이라 하나다
  const storeGlyph = storeGlyphFor(visibleNearby?.status === 'success' ? visibleNearby.data.biz_code : null)
  const selectStore = (id: string | null) => {
    setActiveStoreId(id)
    if (id) (compare.status === 'off' ? setShowStores : setCompareShowStores)(true)
  }
  const changeShowStores = (show: boolean) => {
    ;(compare.status === 'off' ? setShowStores : setCompareShowStores)(show)
    if (!show) setActiveStoreId(null)
  }

  /**
   * 비교 중 한 위치의 점포 목록 (요약·전체 결과). 제목·개수 안내에 A/B와 위치 이름, 수 대조는 그 위치의 동종점포수.
   * key에 위치를 넣어 전환할 때 펼침 상태가 섞이지 않게 한다
   */
  const compareStores = (side: CompareSide, response: AnalyzeResponse, withSwitch: boolean) => {
    const state = side === 'A' ? nearby : nearbyB.state
    if (!state || analysis.status !== 'success' || compare.status !== 'success') return null
    // 다시 시도는 그 목록을 받은 원래 요청 그대로(반경 포함, 반경을 보내지 않는 서버면 없음) — A는 A 분석 요청, B는 B 분석 요청
    const request: AnalyzeRequest = side === 'A' ? analysis.request : compare.request
    return (
      <NearbyStores
        key={`${side},${response.context.lat},${response.context.lng},${response.result.meta.업종코드}`}
        state={state}
        bizName={response.result.meta.업종}
        radiusM={response.result.meta.분석반경_m}
        expectedCount={response.result.지표[2].raw.동종점포수}
        effectiveCount={effectiveSameCount(response.result.지표[2])}
        show={compareShowStores}
        onShowChange={changeShowStores}
        activeId={activeStoreId}
        onSelect={selectStore}
        onRetry={() => (side === 'A' ? loadNearby : nearbyB.load)(request)}
        place={`${side} ${locationName(response.context)}`}
        sideSwitch={
          withSwitch ? (
            <StoreSideSwitch side={side} a={result!} b={compare.response} onChange={changeStoreSide} />
          ) : undefined
        }
      />
    )
  }
  const station = result ? nearestStation(result.result.지표) : null
  // mobile sheet: 지금 선택한 좌표가 결과의 좌표와 같을 때만 행정동 이름을 쓴다 (이전 결과 이름이 남지 않게)
  const resultIsForSelection =
    result !== null && location !== null && result.context.lat === location.lat && result.context.lng === location.lng
  const failure = analysis.status === 'error' ? analysis.failure : null
  const failureView = failure ? errorView(failure) : null
  const errorAt = (placement: string) =>
    failure && failureView?.placement === placement ? <ErrorBlock failure={failure} onAction={handleErrorAction} /> : null
  const markerTone =
    failure?.kind === 'api' && INVALID_LOCATION_CODES.has(failure.error.code) ? 'invalid' : 'selected'

  // 지도 B 표시 (5차-B4, COMPARE_DESIGN.md 4.1·4.2). 비교 요약·A 전체·B 전체를 오가도 같은 값이다(화면 상태와 무관)
  const mapCompare: MapCompare | null =
    result && compare.status !== 'off'
      ? {
          location: compare.location,
          // 분석 불가 위치 오류만 회색(반경 없음). 서버·네트워크·응답 형식 오류는 위치 문제가 아니다
          tone:
            compare.status === 'error' &&
            compare.failure.kind === 'api' &&
            INVALID_LOCATION_CODES.has(compare.failure.error.code)
              ? 'invalid'
              : 'selected',
          dong:
            compare.status === 'success'
              ? { guCode: compare.response.context.gu_code, dongName: compare.response.context.dong_name }
              : null,
          guide:
            bRequesting
              ? 'B 위치 분석 중…'
              : compare.status === 'success'
                ? '지도를 누르면 B 위치를 다시 고릅니다'
                : compare.status === 'error'
                  ? `B 위치를 다시 고르세요 · A: ${locationName(result.context)}`
                  : compare.location
                    ? 'B 위치를 골랐습니다 · "B 분석하기"로 분석합니다'
                    : `B 위치를 고르세요 · A: ${locationName(result.context)}`,
          // 지금 보이는 점포 기준(B 성공 뒤 A/B) — 바뀌면 지도가 그 원으로 옮긴다(D-022 순위 6, 8-B2)
          focus: visibleSide,
        }
      : null

  const compared = compare.status === 'success' ? compare.response : null
  /**
   * 응답 위치의 참고 주소 줄 (7-B2 단일 결과, 7-B3 비교 A/B 카드·전체 결과). 분석에 쓴 context 좌표(= 요청 좌표,
   * matchesRequest가 보장)로 조회한다 — 선택 단계(위치 필드·B 카드)와 같은 키라 화면을 오가도 다시 조회하지 않는다.
   * A 응답이면 A 좌표, B 응답이면 B 좌표에만 묶인다(캐시 키가 좌표라 늦은 응답이 다른 위치에 붙지 않는다).
   */
  const addressOf = (r: AnalyzeResponse) => (
    <ReferenceAddress sdk={sdk} point={{ lat: r.context.lat, lng: r.context.lng }} />
  )

  // 주소로 찾기(7-B4 단일·7-B5 B): Geocoder가 준비됐을 때만. 인증 실패 등으로 failed가 되면 null → 폼이 사라진다
  const searchApi = sdk.status === 'ready' && sdk.geocoder === 'ready' ? sdk.api : null

  // 분석 반경 선택 (8-D3): 서버가 반경을 2개 이상 광고할 때만. 분석 전·결과·비교 화면 위에 같은 컨트롤 하나를 둔다
  const radiusBusy = analyzing || bRequesting
  const radiusStatus = !radiusBusy
    ? null
    : compareReload
      ? `두 위치를 반경 ${formatRadius(radius)}로 다시 분석 중`
      : analysis.status === 'loading' && analysis.origin === 'radius'
        ? `반경 ${formatRadius(radius)}로 다시 분석 중`
        : null
  const wider = radiusOptions.filter((r) => result && r > result.result.meta.분석반경_m)
  const narrowHint =
    result && result.result.지표[2].flags.includes('미개척_동종점포_0개') && wider.length > 0
      ? `${formatRadius(result.result.meta.분석반경_m)} 안에 같은 업종이 없어 경쟁성을 내지 않았습니다. ${wider.map(formatRadius).join('·')}로 넓히면 산출될 수 있습니다.`
      : null
  const radiusInBar = result !== null
  const radiusControl = radiusEnabled ? (
    <RadiusControl
      variant={radiusInBar ? 'bar' : 'step'}
      engineVersion={result?.result.meta.엔진버전 ?? serverEngine}
      options={radiusOptions}
      value={radius}
      disabled={radiusBusy}
      onChange={changeRadius}
      status={radiusStatus}
      narrowHint={narrowHint}
      back={
        analysis.status === 'error' && analysis.origin === 'radius' && prevRadius !== null && prevRadius !== radius
          ? { radius: prevRadius, onBack: () => changeRadius(prevRadius) }
          : null
      }
    />
  ) : null

  // 인쇄(12-15): 브라우저 인쇄 대화상자. 종이 배치는 styles/print.css(@media print)가 맡고 상태는 바꾸지 않는다
  const printResult = () => window.print()

  // 후보 보관함(12-25): 이 브라우저 저장소의 목록을 state 로 들고, 저장·메모·삭제 때 같이 쓴다. 같은 조건은 스냅샷만 갱신
  const [savedSites, setSavedSites] = useState<SavedSite[]>(() => readSavedSites())
  const [saveMessage, setSaveMessage] = useState<{ key: string; text: string } | null>(null)
  const saveCurrent = () => {
    if (analysis.status !== 'success') return
    const site = siteFrom(analysis.request, analysis.response)
    const outcome = saveSite(savedSites, site)
    if (outcome.ok) {
      setSavedSites(outcome.sites)
      setSaveMessage({ key: site.key, text: outcome.updated ? '보관함의 이 후보를 지금 결과로 갱신했습니다.' : `보관함에 저장했습니다(${outcome.sites.length}/3). 저장 당시 결과와 메모는 조건 바의 보관함에서 봅니다.` })
    } else {
      setSaveMessage({
        key: site.key,
        text: outcome.reason === 'full' ? '보관함이 가득 찼습니다(3곳). 조건 바의 보관함에서 하나를 지우고 다시 저장하세요.' : '이 브라우저에 저장할 수 없습니다(저장소 사용 불가).',
      })
    }
  }
  /** 보관함의 "같은 조건으로 다시 분석": 저장한 조건으로 **지금 서버에 다시 요청**한다(캐시 우회, 12-28-R2) — 스냅샷은 보여 주지 않는다 */
  const reanalyzeSaved = (site: SavedSite) => {
    if (analyzing || bRequesting) return
    cancelAnalysis()
    const point = { lat: site.conditions.lat, lng: site.conditions.lng }
    setLocation(point)
    setBizCode(site.conditions.biz)
    const wanted = site.conditions.radius ?? DEFAULT_RADIUS_M
    const r = radiusEnabled && radiusOptions.includes(wanted) ? wanted : DEFAULT_RADIUS_M
    setRadius(r)
    setPrevRadius(null)
    setShareNotice(
      r === wanted
        ? '보관함의 조건으로 다시 분석했습니다 — 저장 당시 결과가 아니라 지금 서버의 결과입니다.'
        : `보관함의 조건으로 다시 분석했습니다 — 저장 당시 결과가 아니라 지금 서버의 결과입니다. 반경 ${formatRadius(wanted)}는 이 서버가 지원하지 않아 ${formatRadius(DEFAULT_RADIUS_M)}로 분석합니다.`,
    )
    startA(buildRequest(point, site.conditions.biz, r, radiusEnabled), { fresh: true })
  }

  // 현장 확인 기록(12-27): 지금 결과의 조건 키로 이 브라우저 저장소에서 읽는다(렌더에서 읽기, 쓰기는 콜백). 저장소가 막혀 있으면
  // 메모리 사본(fieldNotesLocal)으로 이번 화면 동안만 유지한다. 비교 중 A·B 전체 결과는 그 결과의 조건 키
  const [fieldNotesLocal, setFieldNotesLocal] = useState<{ key: string; notes: FieldNotes } | null>(null)
  const fieldNotesFor = (request: AnalyzeRequest) => {
    const key = cacheKey(request)
    const notes = fieldNotesLocal?.key === key ? fieldNotesLocal.notes : readFieldNotes(key)
    return {
      notes,
      onChange: (id: string, note: FieldNote) => {
        const next = { ...notes, [id]: note }
        writeFieldNotes(key, next)
        setFieldNotesLocal({ key, notes: next })
      },
    }
  }

  // 반경별 비교 표(12-26): 서버가 반경을 광고하는 단일 결과에서, 같은 좌표·업종의 다른 반경 결과를 캐시에서 읽기만 한다(peek).
  // 빈 반경의 "분석하기"는 기존 반경 변경(changeRadius)과 같은 경로 — 그 반경으로 전환해 다시 분석하고 캐시에 남는다
  const radiusTable =
    radiusEnabled && result && analysis.status === 'success' && compare.status === 'off' ? (
      <RadiusTable
        rows={radiusRows(radiusOptions, result, (r) => {
          const req = buildRequest(analysis.request, analysis.request.biz_code, r, true)
          return cacheStore.peek(req)?.analyze ?? null
        })}
        busy={radiusBusy}
        onAnalyze={changeRadius}
      />
    ) : null

  const showMapFromCompare = () => {
    setMobileScreen('map')
    focusLater(COMPARE_IDS.sheetAction)
  }

  // ─── A3 화면 (DESIGN.md §19.1): 지도 = 배경 전체, 위쪽 조건 바, 오른쪽 떠 있는 패널(mobile은 하단 시트) ───
  const biz = result?.result.meta
  /** 조건 바: 단일 결과 = 위치 · 업종 · [바꾸기], 비교 = "두 위치 비교 · 업종 · 반경" · [B 다시 고르기] */
  const barCondition = !result || !biz ? null : comparing ? (
    <div className="bar__cond" role="group" aria-label="비교 조건">
      <span className="bar__place">두 위치 비교</span>
      <span className="bar__biz">
        {biz.업종} · 반경 {formatRadius(biz.분석반경_m)}
      </span>
      {(compare.status === 'success' || compare.status === 'error') && (
        <button type="button" className="bar__edit" onClick={pickB}>
          B 다시 고르기
        </button>
      )}
    </div>
  ) : (
    <div className="bar__cond" role="group" aria-label="분석 조건">
      <span className="bar__place">{locationName(result.context)}</span>
      <span className="bar__biz">
        {biz.업종} · {groupName(biz.업종그룹)}
      </span>
      <button type="button" className="bar__edit" onClick={cancelAnalysis}>
        <span className="visually-hidden">조건</span> 바꾸기
      </button>
    </div>
  )
  // 반경: 결과가 있으면 조건 바에(radiusInBar), 분석 전·실패·다시 분석 중이면 조건 패널 ③에 (한 번에 하나만 그린다)
  // 대시보드 결과 화면(13-10)에서는 끝난 안내(공유 링크·반경 다시 분석)를 다섯 관점 아래로 옮긴다 — 첫 화면은 점수·관점부터(B3, Codex R1-4).
  // 진행 중 안내(다시 분석하는 중·좁은 화면 힌트)는 위에 그대로
  const doneNotesBelow = layout === 'dashboard' && compare.status === 'off' && result !== null
  const doneNotes = (
    <>
      {/* 분석이 안 됐을 때(인천 밖 링크 등)는 "다시 분석했습니다" 안내를 숨긴다 — 오류 안내와 겹치지 않게(13-20 D4) */}
      {shareNotice && analysis.status !== 'error' && (
        <p className="radius-notice share-notice" role="status">
          {shareNotice}
        </p>
      )}
      {radiusNotice && (
        <p className="radius-notice" role="status">
          {radiusNotice}
        </p>
      )}
    </>
  )
  const hasDoneNotes = Boolean((shareNotice && analysis.status !== 'error') || radiusNotice)
  const hasBusyNotes = Boolean(radiusInBar && radiusEnabled && (radiusStatus || narrowHint))
  const radiusNotes =
    (hasDoneNotes && !doneNotesBelow) || hasBusyNotes ? (
      <div className="panel__notes">
        {!doneNotesBelow && doneNotes}
        {radiusInBar && radiusStatus && <p className="radius-notice radius-notice--busy">{radiusStatus}</p>}
        {radiusInBar && narrowHint && <p className="radius-notice">{narrowHint}</p>}
      </div>
    ) : null

  /** 패널 아래 고정 행동 (mobile에서는 "지도 보기"를 앞에) */
  const foot = (children: ReactNode) => (
    <div className="panel__foot">
      <button
        type="button"
        className="button button--ghost-fill mobile-only"
        onClick={comparing ? showMapFromCompare : () => setMobileScreen('map')}
      >
        지도 보기
      </button>
      {children}
    </div>
  )

  let panelLabel = '분석 조건'
  let panelBody: ReactNode
  let panelFoot: ReactNode = null
  if (result && compare.status === 'success') {
    panelLabel = '두 위치 비교 결과'
    if (compareView === 'summary') {
      // AnalysisResult는 한 번에 하나만 마운트한다(고정 id, COMPARE_DESIGN.md 6장). 점포 목록은 보이는 기준 위치의 것만(5차-B5)
      panelBody = (
        <>
          <ResultTools shareUrl={currentShare ? shareUrl(currentShare) : null} onPrint={printResult} />
          <CompareResult
            a={result}
            b={compare.response}
            nearby={compareStores(storeSide, storeSide === 'A' ? result : compare.response, true)}
            onShowDetail={showCompareDetail}
            onEnd={endCompare}
            onChangeConditions={cancelAnalysis}
            addresses={{ A: addressOf(result), B: addressOf(compare.response) }}
          />
        </>
      )
      panelFoot = foot(
        <>
          {(['A', 'B'] as const).map((side) => (
            <button
              key={side}
              id={side === 'A' ? COMPARE_IDS.detailA : COMPARE_IDS.detailB}
              type="button"
              className="button button--ghost-fill panel__foot-split"
              onClick={() => showCompareDetail(side)}
            >
              <span className={`pin-letter pin-letter--${side.toLowerCase()}`} aria-hidden="true">
                {side}
              </span>
              <span>
                {side} <span className="panel__foot-long">전체</span> 결과 <span className="panel__foot-long">보기</span>
              </span>
            </button>
          ))}
        </>,
      )
    } else {
      const side: CompareSide = compareView === 'detail-A' ? 'A' : 'B'
      const shown = side === 'A' ? result : compare.response
      panelBody = (
        <CompareDetail
          key={compareView}
          side={side}
          analysis={shown}
          nearby={compareStores(side, shown, false)}
          nearbyCount={(side === 'A' ? nearby : nearbyB.state)?.status === 'success' ? shown.result.지표[2].raw.동종점포수 : null}
          address={addressOf(shown)}
          fieldNotes={fieldNotesFor(side === 'A' && analysis.status === 'success' ? analysis.request : compare.request)}
        />
      )
      panelFoot = foot(
        <button type="button" className="button button--primary" onClick={() => backToCompareSummary(side)}>
          비교로 돌아가기
        </button>,
      )
    }
  } else if (result && compare.status !== 'off' && compare.status !== 'success') {
    panelLabel = '두 위치 비교 — B 위치 고르기'
    panelBody = (
      <ComparePanel
        a={result}
        compare={compare}
        onLocationSubmit={submitCompareLocation}
        onAnalyze={runCompare}
        onErrorAction={handleCompareErrorAction}
        onChangeConditions={cancelAnalysis}
        bAddress={<ReferenceAddress sdk={sdk} point={compare.location} />}
        searchApi={searchApi}
        placesReady={placesReady}
        searchResetKey={bPickSeq}
      />
    )
    panelFoot = foot(
      <button type="button" className="button button--ghost-fill" onClick={endCompare}>
        비교 취소
      </button>,
    )
  } else if (result) {
    panelLabel = '분석 결과'
    panelBody = (
      <>
        <AnalysisResult
        analysis={result}
        /* ④ 결과 안내(묶음 D)·결과 활용 줄(12-15·12-25)은 다섯 관점 아래(B3 — 첫 화면은 점수·관점부터) */
        notes={
          <>
            {doneNotesBelow && hasDoneNotes && <div className="panel__notes panel__notes--in-result">{doneNotes}</div>}
            {resultCoach}
          </>
        }
        timeCard={<TimeInsightsCard analysis={result} insights={insightsState.status === 'success' ? insightsState.data : null} />}
        rankCard={
          <RankCard
            state={rankState}
            onRetry={rankState.retry}
            currentBiz={result.result.meta.업종코드}
            busy={analyzing}
            onPick={(biz) => {
              // 같은 자리·같은 반경으로 업종만 바꿔 다시 분석(캐시 적중이면 요청 없음)
              if (analysis.status !== 'success') return
              setBizCode(biz)
              startA(buildRequest({ lat: analysis.request.lat, lng: analysis.request.lng }, biz, radius, radiusEnabled))
            }}
          />
        }
        tools={
          <ResultTools
            shareUrl={currentShare ? shareUrl(currentShare) : null}
            onPrint={printResult}
            save={{
              saved: analysis.status === 'success' && savedSites.some((s) => s.key === cacheKey(analysis.request)),
              onSave: saveCurrent,
              message: analysis.status === 'success' && saveMessage?.key === cacheKey(analysis.request) ? saveMessage.text : null,
            }}
          />
        }
        eyebrowAction={replayHelp('result')}
        radiusTable={radiusTable}
        fieldNotes={analysis.status === 'success' ? fieldNotesFor(analysis.request) : undefined}
        address={addressOf(result)}
        nearbyCount={nearby?.status === 'success' ? nearby.data.count : null}
        nearby={
          nearby && (
            <NearbyStores
              key={`${result.context.lat},${result.context.lng},${result.result.meta.업종코드}`}
              state={nearby}
              bizName={result.result.meta.업종}
              radiusM={result.result.meta.분석반경_m}
              expectedCount={result.result.지표[2].raw.동종점포수}
              effectiveCount={effectiveSameCount(result.result.지표[2])}
              show={showStores}
              onShowChange={changeShowStores}
              activeId={activeStoreId}
              onSelect={selectStore}
              onRetry={() => analysis.status === 'success' && loadNearby(analysis.request)}
            />
          )
        }
        />
      </>
    )
    panelFoot = foot(
      <button id={COMPARE_IDS.start} type="button" className="button button--primary" onClick={startCompare}>
        다른 위치와 비교
      </button>,
    )
  } else {
    panelBody = (
      <div className="intro">
        {errorAt('top')}
        <ConditionPanel
          location={location}
          bizCode={bizCode}
          businesses={businesses}
          analyzing={analyzing}
          locked={analyzing}
          locationError={errorAt('location')}
          businessError={errorAt('business')}
          onPickOnMap={pickOnMap}
          onLocationInput={selectLocation}
          onBizChange={changeBusiness}
          onRetryBusinesses={reloadBusinesses}
          onAnalyze={runAnalysis}
          address={<ReferenceAddress sdk={sdk} point={location} />}
          hasAddress={Boolean(pickedAddress?.roadAddress ?? pickedAddress?.jibunAddress)}
          searchApi={searchApi}
          placesReady={placesReady}
          method={locationMethod}
          methodFocus={methodFocus}
          onMethodChange={setLocationMethod}
          radiusStep={radiusControl}
          coach={conditionCoach}
          onReplayHelp={() => sendTour({ type: 'replay', screen: 'conditions' })}
        >
          {compareReload && analysis.status === 'error' && (
            <p className="radius-notice">
              비교 중 A 위치를 다시 분석하지 못했습니다. &quot;다시 시도&quot;는 A·B를 함께 다시 분석합니다.{' '}
              <button type="button" className="button-ghost" onClick={endCompare}>
                비교 종료
              </button>
            </p>
          )}
          <div className="intro__result">
            {analysis.status === 'loading' && <AnalysisLoading />}
            {errorAt('result')}
          </div>
        </ConditionPanel>
      </div>
    )
  }

  // 접은 화면 = 지금 화면인지: 패널 이름과 보이는 응답(비교 결과가 있으면 그것, 아니면 단일 결과)이 같아야 한다
  const shownResponse: object | null = compared ?? result
  if (foldedAt !== null && (foldedAt.label !== panelLabel || foldedAt.shown !== shownResponse)) {
    setFoldedAt(null)                                      // 화면이 바뀌었다 — 렌더 중 상태 조정(이전 기록을 남기지 않는다)
  }
  const panelFolded = foldedAt !== null && foldedAt.label === panelLabel && foldedAt.shown === shownResponse
  // 접힌 띠 문구 (P9, "지도 보기 · 반경 500m · 점포 12곳"을 A3에 맞춤): 단일 결과는 위치 · 반경 · 점포 수, 그 밖은 패널 이름
  const foldSummary =
    result && compare.status === 'off'
      ? [
          locationName(result.context),
          `반경 ${formatRadius(result.result.meta.분석반경_m)}`,
          nearby?.status === 'success' && `점포 ${nearby.data.count}곳`,
        ]
          .filter(Boolean)
          .join(' · ')
      : panelLabel

  return (
    <DataInfoContext.Provider value={dataInfo}>
    <div
      className="app"
      data-phase={result ? 'result' : 'select'}
      data-screen={mobileScreen}
      data-compare={comparing ? 'on' : 'off'}
      data-layout={layout}
      data-map-card={layout === 'dashboard' && panelScrolled ? 'hidden' : undefined}
    >
      <div className="app__map" ref={mapRef}>
        {/* 지도 영역 오류 격리: 지도에서 예외가 나도 지도 칸만 실패 안내로 바뀌고 패널(분석·결과·비교)은 그대로다 */}
        <MapErrorBoundary>
          <MapView
            theme={theme}
            onSdkState={setSdk}
            // mobile 지도↔패널 전환 신호: 크기 알림 없이 지도 화면으로 돌아와도 크기 맞춤·미룬 정보창 처리 (6-4)
            // tablet 패널 접기도 같은 신호 — 지도 크기는 그대로라 zoom은 바꾸지 않고 컨트롤 띠·미룬 정보창만 다시 본다(D-022 순위 8)
            layoutKey={`${mobileScreen}:${panelFolded ? 'folded' : 'open'}:${layout}`}
            fitSeq={fitSeq}
            selected={location}
            radiusM={radius}
            markerTone={markerTone}
            dong={result ? { guCode: result.context.gu_code, dongName: result.context.dong_name } : null}
            interactive={!analyzing && !bRequesting}
            onSelect={selectLocation}
            // 지금 보이는 점포 기준의 마커만 (B 고르기·분석 중·실패에는 없음). A 점포 데이터는 비교 중에도 그대로 둔다
            stores={mapStores}
            activeStoreId={activeStoreId}
            onStoreSelect={selectStore}
            storeGlyph={storeGlyph}
            storeContext={
              comparing && visibleSide
                ? `${visibleSide} ${(visibleSide === 'A' ? result : compared)?.context.dong_name} 주변`
                : undefined
            }
            compare={mapCompare}
          />
        </MapErrorBoundary>
        {/* 대시보드(13-10): 지도 카드 전체가 "크게 보기". 지도 배치로 돌아오면 왼쪽 위에 "결과로 돌아가기" */}
        {layout === 'dashboard' && sdk.status !== 'failed' && (
          <button type="button" id={MAP_CARD_IDS.expand} className="map-card__expand" onClick={() => expandMap(MAP_CARD_IDS.expand)} aria-label="지도 크게 보기">
            <span>지도 크게 보기</span>
          </button>
        )}
        {layout === 'map' && result && (
          <button type="button" id={MAP_CARD_IDS.collapse} className="map-card__collapse" onClick={collapseMap}>
            ‹ 결과로 돌아가기
          </button>
        )}
      </div>
      {layout === 'dashboard' && panelScrolled && (
        <button type="button" id={MAP_CARD_IDS.pill} className="map-card__pill" onClick={() => expandMap(MAP_CARD_IDS.pill)}>
          지도 보기
        </button>
      )}
      <header ref={headerRef} className="app-header bar" data-map-obstacle>
        <span className="bar__brand">
          <span className="bar__logo" aria-hidden="true" />
          <span className="bar__name">우리동네 상권</span>
        </span>
        {barCondition}
        {radiusInBar && radiusControl}
        {/* 업데이트 내역(D-031): 지도 영역 밖이라 지도 SDK가 실패해도 열 수 있다. 열고 닫아도 분석·비교 상태는 그대로 */}
        <UpdateNotes />
        {/* 후보 보관함(12-25): 지도 영역 밖. 다시 분석은 저장한 조건으로 지금 서버에서 새로(스냅샷을 결과로 보이지 않는다) */}
        <SavedSites
          sites={savedSites}
          onReanalyze={reanalyzeSaved}
          onMemo={(id, memo) => setSavedSites(updateSiteMemo(savedSites, id, memo))}
          onRemove={(id) => setSavedSites(removeSite(savedSites, id))}
        />
        {/* 테마 전환(묶음 A, §19.7): 누르면 그 선택을 저장하고 패널·지도가 함께 바뀐다. 아이콘은 "바뀔 테마"가 아니라 지금 상태 반대 행동 */}
        <button
          type="button"
          className="bar__theme"
          aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
        </button>
      </header>
      <div className="panel" data-map-obstacle={layout === 'map' || undefined} data-folded={panelFolded || undefined}>
        {/* tablet(640~1100px)에서만 보인다 — 패널을 접어 지도를 넓게 본다 (P9) */}
        <div className="panel__fold">
          {/* 펼친 상태에서는 패널 제목과 겹치므로 접혔을 때만 */}
          <span className="panel__fold-label">{panelFolded && foldSummary}</span>
          <button
            type="button"
            className="panel__fold-button"
            aria-expanded={!panelFolded}
            aria-controls="workspace-panel"
            onClick={() => setFoldedAt(panelFolded ? null : { label: panelLabel, shown: shownResponse })}
          >
            <span className="panel__fold-icon" aria-hidden="true">
              <Icon name="chevron-right" size={16} />
            </span>
            <span className="visually-hidden">패널</span> {panelFolded ? '펼치기' : '접기'}
          </button>
        </div>
        <main id="workspace-panel" ref={panelScrollRef} className="workspace__panel" aria-label={panelLabel}>
          {/* 인쇄 머리말(12-15): 종이에만 보인다(print.css). 서비스 성격·앱 버전·인쇄 시각 */}
          {result && (
            <p className="print-only" aria-hidden="true">
              우리동네 상권분석 매니저 · 참고 지표(순위·매출 예측 아님) · 앱 {APP_VERSION} · 인쇄 {new Date().toLocaleString('ko-KR')}
            </p>
          )}
          {radiusNotes}
          {panelBody}
          {/* 결과·비교 화면에서만 (분석 전 패널은 아래 고정 "분석하기"가 같은 자리) */}
          {result && <MoreBelow key={panelLabel} scrollerRef={panelScrollRef} />}
        </main>
        {panelFoot}
      </div>
      {/* mobile 지도 화면 하단 sheet (peek): 요약 → "결과 자세히"로 패널. 비교 중에는 B 선택용 sheet */}
      {result && compare.status !== 'off' ? (
        <CompareSheet
          a={result}
          compare={compare}
          onAnalyze={runCompare}
          onShowPanel={() => {
            setMobileScreen('panel')
            // 지금 패널 화면의 제목으로: B 고르기 → B 카드 제목, 비교 요약 → 비교 제목, 전체 결과 → 결과 제목
            focusLater(
              compare.status !== 'success'
                ? COMPARE_IDS.bTitle
                : compareView === 'summary'
                  ? COMPARE_IDS.title
                  : 'result-title',
            )
          }}
          onEnd={endCompare}
        />
      ) : (
        <div className="map-sheet mobile-only">
          {resultIsForSelection && analysis.status === 'success' ? (
            <>
              <p className="map-sheet__score">
                <span className="map-sheet__value">
                  {result.result.종합.점수 === null ? '산출 불가' : formatScore(result.result.종합.점수)}
                </span>
                {result.result.종합.점수 !== null && <span className="map-sheet__unit">/ 100</span>}
                <span className="map-sheet__cap">
                  <strong>{locationName(result.context)}</strong>
                  {station && ` · ${station.name} ${formatDistance(station.distanceM)}`}
                </span>
              </p>
              <p className="map-sheet__headline">
                <HeadlineText text={conclusion(result).text} />
              </p>
              {/* 참고 주소 한 줄(7-B2, 말줄임 · 작은 높이에서는 숨김 — ReferenceAddress.css). 분석에 쓴 context 좌표 */}
              {addressOf(result)}
              {/* 주의 요약 띠 첫 줄 (8-C1a) — 지금 선택과 같은 좌표의 결과일 때만 */}
              <BandPeek lines={singleBand(analysis.response)} />
              <div className="map-sheet__actions">
                <button type="button" className="button button--ghost-fill" onClick={() => setMobileScreen('panel')}>
                  결과 자세히
                </button>
                <button type="button" className="button button--primary" onClick={startCompare}>
                  다른 위치와 비교
                </button>
              </div>
              {/* ④ 결과 안내 (묶음 D): 버튼 줄 바로 아래 인라인. 패널 화면의 같은 안내와 한 번에 하나만 보인다(화면 전환으로 배타) */}
              {resultCoach}
            </>
          ) : (
            <>
              <p className="map-sheet__title">어디에, 어떤 가게를 열까요?</p>
              <p className="map-sheet__text">
                {location ? (
                  // 분석 전에는 행정동을 모른다(backend가 판정) — 고른 좌표만 보여 준다
                  <>
                    선택됨 · <span className="mono">{location.lat}, {location.lng}</span>
                  </>
                ) : (
                  '지도를 눌러 위치를 고르세요'
                )}
              </p>
              {/* 참고 주소 한 줄(말줄임, 작은 높이에서는 숨김 — ReferenceAddress.css). 좌표 키가 패널·결과와 같아 조회는 1회 */}
              <ReferenceAddress sdk={sdk} point={location} />
              {/* 조건 패널과 같은 segmented·같은 상태 (B5): 주소·좌표를 누르면 패널로 가서 그 폼을 바로 연다 */}
              <LocationMethodSwitch
                // 주소 기능이 꺼지면 조건 패널처럼 지도 안내로 본다
                value={(locationMethod === 'address' && !searchApi) || (locationMethod === 'place' && !placesReady) ? 'map' : locationMethod}
                addressReady={searchApi !== null}
                placesReady={placesReady}
                disabled={analyzing}
                onChange={(m) => {
                  setLocationMethod(m)
                  if (m === 'map') return
                  setMobileScreen('panel')
                  setMethodFocus((n) => n + 1)
                }}
              />
              {/* ① 위치 안내 (묶음 D): 시트의 segmented 바로 아래. 패널 화면의 같은 단계와 한 번에 하나만 보인다.
                  "다음"은 ②(업종 select 아래)가 있는 패널 화면으로 함께 간다 — 지도 화면에 남으면 ②가 숨겨진 패널에 있어 안내가 사라진다(9-R2).
                  지도를 눌러 실제로 위치를 고르는 흐름은 그대로(화면 유지, "이 위치로 계속"으로 패널) */}
              {conditionCoach?.step === 'location' && (
                <CoachMark
                  text={conditionCoach.text}
                  index={conditionCoach.index}
                  last={false}
                  onNext={() => {
                    conditionCoach.onNext()
                    setMobileScreen('panel')
                  }}
                  onSkip={conditionCoach.onSkip}
                  onDismiss={conditionCoach.onDismiss}
                />
              )}
              <button
                type="button"
                className={`button ${location ? 'button--primary' : 'button--secondary'}`}
                onClick={() => setMobileScreen('panel')}
              >
                {location ? '이 위치로 계속' : '조건 입력'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
    </DataInfoContext.Provider>
  )
}

export default App
