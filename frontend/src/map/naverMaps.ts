/**
 * NAVER Maps JavaScript API v3 로더 (TASKS 4-4).
 *
 * - script: https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId={VITE_NAVER_MAP_CLIENT_ID}
 *   Client ID만 쓴다. Client Secret은 frontend에 두지 않는다.
 * - singleton: 모듈 수준 Promise 하나 + 고정 script id. React StrictMode의 effect 두 번 실행이나
 *   여러 컴포넌트가 동시에 불러도 script는 한 번만 붙는다.
 * - 실패: Client ID 없음(config) / script 로드 실패(load) / 인증 실패(auth, NAVER가 부르는
 *   window.navermap_authFailure). 실패한 Promise는 다음 호출 때 다시 시도할 수 있게 비운다.
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

export interface NaverMap {
  setSize(size: unknown): void
  panTo(latlng: NaverLatLng): void
  getZoom(): number
  setZoom(zoom: number, effect?: boolean): void
  destroy?(): void
}

export interface NaverOverlay {
  setMap(map: NaverMap | null): void
}

export interface NaverMarker extends NaverOverlay {
  setPosition(latlng: NaverLatLng): void
  setIcon(icon: unknown): void
}

export interface NaverCircle extends NaverOverlay {
  setCenter(latlng: NaverLatLng): void
}

export type NaverPolygon = NaverOverlay

export interface NaverMapsApi {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMap
  LatLng: new (lat: number, lng: number) => NaverLatLng
  Point: new (x: number, y: number) => unknown
  Size: new (w: number, h: number) => unknown
  Marker: new (options: Record<string, unknown>) => NaverMarker
  Circle: new (options: Record<string, unknown>) => NaverCircle
  Polygon: new (options: Record<string, unknown>) => NaverPolygon
  Position: Record<string, unknown>
  Event: {
    addListener(target: unknown, type: string, handler: (e: NaverMapEvent) => void): unknown
    removeListener(listener: unknown): void
  }
}

declare global {
  interface Window {
    naver?: { maps?: NaverMapsApi }
    navermap_authFailure?: () => void
  }
}

export type MapLoadErrorKind = 'config' | 'load' | 'auth'

export class MapLoadError extends Error {
  readonly kind: MapLoadErrorKind
  constructor(kind: MapLoadErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export const NAVER_SCRIPT_ID = 'naver-maps-sdk'
const SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js'

let pending: Promise<NaverMapsApi> | null = null
const authListeners = new Set<() => void>()

/** 인증 실패는 로드 성공 뒤에도 올 수 있다 (도메인 미등록 등). 지도 컴포넌트가 구독한다. */
export function onNaverAuthFailure(listener: () => void): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

export function loadNaverMaps(clientId: string | undefined): Promise<NaverMapsApi> {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps)
  if (pending) return pending
  if (!clientId) {
    return Promise.reject(new MapLoadError('config', 'VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다.'))
  }

  pending = new Promise<NaverMapsApi>((resolve, reject) => {
    window.navermap_authFailure = () => {
      reject(new MapLoadError('auth', 'NAVER Maps 인증에 실패했습니다.'))
      authListeners.forEach((l) => l())
    }

    let script = document.getElementById(NAVER_SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = NAVER_SCRIPT_ID
      script.async = true
      script.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}`
      document.head.appendChild(script)
    }
    script.addEventListener('load', () => {
      if (window.naver?.maps) resolve(window.naver.maps)
      else reject(new MapLoadError('load', 'NAVER Maps SDK를 초기화하지 못했습니다.'))
    })
    script.addEventListener('error', () => {
      script?.remove()
      reject(new MapLoadError('load', 'NAVER Maps SDK를 불러오지 못했습니다.'))
    })
  })
  pending.catch(() => {
    pending = null   // 다음 마운트에서 다시 시도할 수 있게
  })
  return pending
}

/** 테스트 전용: 모듈 singleton 상태를 지운다. */
export function resetNaverMapsLoaderForTest(): void {
  pending = null
  authListeners.clear()
  document.getElementById(NAVER_SCRIPT_ID)?.remove()
  delete window.naver
  delete window.navermap_authFailure
}
