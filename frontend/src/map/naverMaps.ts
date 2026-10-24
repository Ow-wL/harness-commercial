/**
 * NAVER Maps JavaScript API v3 로더 (TASKS 4-4, Geocoder 서브모듈은 7-B1).
 *
 * - script: https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId={VITE_NAVER_MAP_CLIENT_ID}&submodules=geocoder&callback=__naverMapsReady
 *   Client ID만 쓴다. Client Secret은 frontend에 두지 않는다.
 * - singleton: 모듈 수준 Promise 하나 + 고정 script id. React StrictMode의 effect 두 번 실행이나
 *   여러 컴포넌트가 동시에 불러도 script는 한 번만 붙는다.
 * - 실패: Client ID 없음(config) / script 로드 실패(load) / 인증 실패(auth, NAVER가 부르는
 *   window.navermap_authFailure). 실패한 Promise는 다음 호출 때 다시 시도할 수 있게 비운다.
 * - 지도 준비와 Geocoder 준비는 따로 본다 (docs/ADDRESS_DESIGN.md §5.1, 7-B0 실측):
 *   `maps.js`의 load 이벤트는 서브모듈 script(maps-geocoder.js)보다 먼저 와서 그때는 naver.maps.Service가 없고,
 *   `callback=`으로 지정한 전역 함수는 서브모듈까지 준비된 뒤 불린다. 지도는 load(또는 callback — 순서가 달라도)로
 *   준비되고, Geocoder는 callback이 와서 Service가 있을 때 'ready', callback이 안 오거나(지도 준비 뒤 10초)
 *   Service가 없으면 'unavailable'이다. Geocoder가 없어도 지도는 그대로 쓴다.
 *
 * 아래 타입은 이 앱이 쓰는 SDK 부분만 선언한 것이다(공식 타입 패키지 없음).
 */

export interface NaverLatLng {
  lat(): number
  lng(): number
}

export interface NaverMapEvent {
  coord: NaverLatLng
}

/** 지도 영역 (getBounds). GL 모드에서는 init 이벤트 전에 부르면 오류다 */
export interface NaverBounds {
  getSW(): NaverLatLng
  getNE(): NaverLatLng
}

export interface NaverMap {
  setSize(size: unknown): void
  panTo(latlng: NaverLatLng): void
  getZoom(): number
  setZoom(zoom: number, effect?: boolean): void
  /** 범위 맞춤(8-B1): setCenter → setZoom(z, false) → panBy. 세 호출 모두 동기로 끝난다(8-B0) */
  setCenter(latlng: NaverLatLng): void
  /** 지도 중심 — 테마 전환으로 지도를 다시 만들 때 이어받는다(묶음 A). GL은 init 전에 부르면 오류일 수 있어 init 뒤에만 */
  getCenter?(): NaverLatLng
  panBy(offset: unknown): void
  getBounds(): NaverBounds
  /** 지도 옵션 읽기. 'renderMode' = 1 래스터 / 2 GL (GL을 요청해도 지원 안 되면 1) */
  get?(key: string): unknown
  getMinZoom?(): number
  getMaxZoom?(): number
  destroy?(): void
}

export interface NaverOverlay {
  setMap(map: NaverMap | null): void
}

export interface NaverMarker extends NaverOverlay {
  setPosition(latlng: NaverLatLng): void
  setIcon(icon: unknown): void
  /** 쌓임 순서(선택 점포를 다른 점포 위로, 묶음 B). undefined면 SDK 기본값 */
  setZIndex?(zIndex: number | undefined): void
}

export interface NaverCircle extends NaverOverlay {
  setCenter(latlng: NaverLatLng): void
  setRadius(radius: number): void
}

export interface NaverPolygon extends NaverOverlay {
  /** 선 색 등 옵션 변경(구 경계 줌 단계, 묶음 A). 없으면 다시 만들지 않고 그대로 둔다 */
  setOptions?(options: Record<string, unknown>): void
}

/** 정보창 (동종 점포 상호·주소·거리, 4차). content는 DOM 요소로 넘긴다(문자열 HTML을 만들지 않는다). */
export interface NaverInfoWindow {
  open(map: NaverMap, anchor: NaverMarker): void
  close(): void
  setContent(content: HTMLElement): void
  /** 연 상태에서 위치 옵션(pixelOffset·disableAnchor·anchorSkew)을 바꾼다 — 동기로 다시 배치된다(2026-10-14 실측) */
  setOptions?(options: Record<string, unknown>): void
  getContentElement?(): HTMLElement
}

/** SDK 콜백: status는 naver.maps.Service.Status(OK 200 / ERROR 500), response는 성공일 때만 온다(실패면 undefined) */
export type NaverServiceCallback = (status: number, response?: unknown) => void

/** Geocoder 서브모듈 (naver.maps.Service). 응답 구조 검증은 map/geocoder.ts가 한다 */
export interface NaverService {
  geocode(options: Record<string, unknown>, callback: NaverServiceCallback): void
  reverseGeocode(options: Record<string, unknown>, callback: NaverServiceCallback): void
  Status: { OK: number; ERROR: number }
}

export interface NaverMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMap
  LatLng: new (lat: number, lng: number) => NaverLatLng
  Point: new (x: number, y: number) => unknown
  Size: new (w: number, h: number) => unknown
  Marker: new (options: Record<string, unknown>) => NaverMarker
  Circle: new (options: Record<string, unknown>) => NaverCircle
  Polygon: new (options: Record<string, unknown>) => NaverPolygon
  InfoWindow: new (options: Record<string, unknown>) => NaverInfoWindow
  Position: Record<string, unknown>
  /** 확대 컨트롤 모양 (SMALL = +/−만, 8-B1) */
  ZoomControlStyle?: Record<string, unknown>
  Event: {
    addListener(target: unknown, type: string, handler: (e: NaverMapEvent) => void): unknown   // marker click은 e를 쓰지 않는다
    removeListener(listener: unknown): void
  }
  /** 서브모듈이 준비되기 전·로드 실패면 없다 */
  Service?: NaverService
}

declare global {
  interface Window {
    naver?: { maps?: NaverMapsApi | null }      // 실제 SDK는 인증 실패 때 maps 를 null 로 바꾼다
    navermap_authFailure?: () => void
    /** SDK `callback=` 파라미터가 부르는 전역 — 서브모듈까지 준비된 뒤 */
    __naverMapsReady?: () => void
  }
}

/** init: 지도를 만들었지만 준비(init)되지 않음 — 다크 스타일 실패 뒤 밝은 대체 지도까지 실패(8-DK, DESIGN.md §19.3.1) */
export type MapLoadErrorKind = 'config' | 'load' | 'auth' | 'init'

export class MapLoadError extends Error {
  readonly kind: MapLoadErrorKind
  constructor(kind: MapLoadErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** Geocoder 서브모듈 준비 상태. 지도 준비와 별개다 */
export type GeocoderAvailability = 'loading' | 'ready' | 'unavailable'

/**
 * 지도 컴포넌트가 App에 올리는 SDK 상태 (docs/ADDRESS_DESIGN.md §5.1). 주소 기능은 ready && geocoder === 'ready'일 때만.
 * failed는 끝 상태다 — 뒤늦은 인증 실패 뒤에 온 Geocoder 준비 알림이 ready로 되돌리지 못한다 (reduceSdkState).
 */
export type SdkState =
  | { status: 'loading' }
  | { status: 'ready'; api: NaverMapsApi; geocoder: GeocoderAvailability }
  | { status: 'failed'; kind: MapLoadErrorKind }

export type SdkEvent =
  | { type: 'map-ready'; api: NaverMapsApi; geocoder: GeocoderAvailability }
  | { type: 'map-failed'; kind: MapLoadErrorKind }
  | { type: 'geocoder'; geocoder: GeocoderAvailability }
  | { type: 'auth-failed' }

/** 순수 상태 전이. failed 뒤의 어떤 이벤트도 상태를 바꾸지 않는다 */
export function reduceSdkState(state: SdkState, event: SdkEvent): SdkState {
  if (state.status === 'failed') return state
  switch (event.type) {
    case 'map-ready':
      return { status: 'ready', api: event.api, geocoder: event.geocoder }
    case 'map-failed':
      return { status: 'failed', kind: event.kind }
    case 'auth-failed':
      return { status: 'failed', kind: 'auth' }
    case 'geocoder':
      return state.status === 'ready' && state.geocoder !== event.geocoder ? { ...state, geocoder: event.geocoder } : state
  }
}

export function isGeocoderAvailable(api: NaverMapsApi | null | undefined): boolean {
  return typeof api?.Service?.geocode === 'function' && typeof api?.Service?.reverseGeocode === 'function'
}

export const NAVER_SCRIPT_ID = 'naver-maps-sdk'
export const NAVER_READY_CALLBACK = '__naverMapsReady'
/** 지도가 준비된 뒤 이 시간 안에 callback이 오지 않으면 Geocoder는 'unavailable' (지도는 그대로) */
export const GEOCODER_TIMEOUT_MS = 10_000
const SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js'

let pending: Promise<NaverMapsApi> | null = null
const authListeners = new Set<() => void>()
/**
 * NAVER가 인증 실패를 알렸는지. 실제 SDK는 인증 실패 때 `window.naver.maps`를 null 로 바꾸고, 이미 만든 지도·리스너를 다루는
 * SDK 내부도 그 전역을 읽어 예외를 던진다(2026-10-25 무트래픽 리비전 검증에서 확인). 그래서 같은 페이지에서 다시 부르면(테마 전환 등)
 * SDK를 쓰지 않고 바로 인증 실패로 돌려준다. 새로 받으려면 resetNaverMapsForRetry()
 */
let authFailed = false

let geocoder: GeocoderAvailability = 'loading'
const geocoderListeners = new Set<(state: GeocoderAvailability) => void>()
let geocoderTimer: ReturnType<typeof setTimeout> | null = null

function settleGeocoder(next: 'ready' | 'unavailable'): void {
  if (geocoder !== 'loading') return                      // 한 번 정해지면 바꾸지 않는다 (늦은 callback 무시)
  if (geocoderTimer) {
    clearTimeout(geocoderTimer)
    geocoderTimer = null
  }
  geocoder = next
  geocoderListeners.forEach((l) => l(next))
}

/** 지도가 준비된 시점부터 callback을 기다린다. 이미 정해졌거나 타이머가 돌고 있으면 아무것도 하지 않는다 */
function armGeocoderTimeout(): void {
  if (geocoder !== 'loading' || geocoderTimer) return
  geocoderTimer = setTimeout(() => {
    geocoderTimer = null
    settleGeocoder('unavailable')
  }, GEOCODER_TIMEOUT_MS)
}

export function getGeocoderAvailability(): GeocoderAvailability {
  return geocoder
}

/** Geocoder 준비 상태가 정해질 때 알린다. 이미 정해져 있으면 바로 한 번 부른다 (구독 시점이 늦어도 놓치지 않게) */
export function onGeocoderAvailability(listener: (state: GeocoderAvailability) => void): () => void {
  if (geocoder !== 'loading') listener(geocoder)
  geocoderListeners.add(listener)
  return () => {
    geocoderListeners.delete(listener)
  }
}

/** 인증 실패는 로드 성공 뒤에도 올 수 있다 (도메인 미등록 등). 지도 컴포넌트가 구독한다. */
export function onNaverAuthFailure(listener: () => void): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

/**
 * options.gl: GL 서브모듈(`submodules=geocoder,gl`)도 불러온다(8-B1, 검수용 선택 — 기본 끔). GL은 서브모듈 script가 준비된 뒤에
 * 지도를 만들어야 하므로 load 이벤트가 아니라 callback으로만 준비를 알린다. callback이 load 뒤 10초 안에 오지 않으면 그대로
 * 준비로 넘긴다 — 지도는 래스터로 그려지고(renderMode 1) MapView가 실제 모드를 읽는다.
 */
export function loadNaverMaps(clientId: string | undefined, options: { gl?: boolean } = {}): Promise<NaverMapsApi> {
  if (authFailed || (window.naver && window.naver.maps === null)) {
    // 인증 실패한 SDK — 이미 붙은 script 의 load 를 기다리면 끝나지 않고, 지도를 만들면 SDK 내부 예외가 난다
    return Promise.reject(new MapLoadError('auth', 'NAVER Maps 인증에 실패했습니다.'))
  }
  if (window.naver?.maps) {
    // 이미 로드된 SDK(HMR 등): Service가 있으면 Geocoder도 준비, 없으면 callback·타임아웃을 기다린다
    if (isGeocoderAvailable(window.naver.maps)) settleGeocoder('ready')
    else armGeocoderTimeout()
    return Promise.resolve(window.naver.maps)
  }
  if (pending) return pending
  if (!clientId) {
    return Promise.reject(new MapLoadError('config', 'VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다.'))
  }

  // 새 로드 시도(첫 로드 또는 이전 script 로드 실패 뒤 재시도): Geocoder 판정도 처음부터
  if (geocoderTimer) clearTimeout(geocoderTimer)
  geocoderTimer = null
  geocoder = 'loading'

  pending = new Promise<NaverMapsApi>((resolve, reject) => {
    window.navermap_authFailure = () => {
      authFailed = true
      reject(new MapLoadError('auth', 'NAVER Maps 인증에 실패했습니다.'))
      authListeners.forEach((l) => l())
    }
    // 서브모듈까지 준비된 뒤 SDK가 부른다. load 이벤트보다 먼저 올 수도 있으므로 여기서도 지도 준비를 알린다
    window[NAVER_READY_CALLBACK] = () => {
      const maps = window.naver?.maps
      if (maps) resolve(maps)
      settleGeocoder(isGeocoderAvailable(maps) ? 'ready' : 'unavailable')
    }

    let script = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = NAVER_SCRIPT_ID
      script.async = true
      script.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}&submodules=geocoder${options.gl ? ',gl' : ''}&callback=${NAVER_READY_CALLBACK}`
      document.head.appendChild(script)
    }
    script.addEventListener('load', () => {
      if (window.naver?.maps) {
        const maps = window.naver.maps
        if (options.gl) setTimeout(() => resolve(maps), GEOCODER_TIMEOUT_MS)   // GL: callback을 기다리되 끝없이는 아니다
        else resolve(maps)
        armGeocoderTimeout()                               // 지도는 준비됐다 — callback은 10초까지만 기다린다
      } else {
        reject(new MapLoadError('load', 'NAVER Maps SDK를 초기화하지 못했습니다.'))
        settleGeocoder('unavailable')
      }
    })
    script.addEventListener('error', () => {
      script?.remove()
      reject(new MapLoadError('load', 'NAVER Maps SDK를 불러오지 못했습니다.'))
      settleGeocoder('unavailable')
    })
  })
  pending.catch(() => {
    pending = null   // 다음 마운트에서 다시 시도할 수 있게
  })
  return pending
}

/**
 * 지도 "다시 불러오기"(인증·로드 실패 뒤): 붙어 있던 SDK script·전역을 걷어 내고 다음 loadNaverMaps 가 SDK를 새로 받게 한다.
 * 구독(authListeners·geocoderListeners)은 지도 컴포넌트가 effect 단위로 걸고 풀므로 그대로 둔다
 */
export function resetNaverMapsForRetry(): void {
  pending = null
  authFailed = false
  geocoder = 'loading'
  if (geocoderTimer) {
    clearTimeout(geocoderTimer)
    geocoderTimer = null
  }
  document.getElementById(NAVER_SCRIPT_ID)?.remove()
  delete window.naver
  delete window.navermap_authFailure
  delete window[NAVER_READY_CALLBACK]
}

/** 테스트 전용: 모듈 singleton 상태를 지운다. */
export function resetNaverMapsLoaderForTest(): void {
  resetNaverMapsForRetry()
  authListeners.clear()
  geocoderListeners.clear()
}
