/**
 * E2E 용 가짜 NAVER Maps SDK (TASKS 5-3 B, D-035). 실제 SDK·네트워크·Client ID 없이 앱의 지도 계약(map/naverMaps.ts 의
 * NaverMapsApi)만 흉내 낸다 — 타일·스타일·GL은 없다. 실제 지도 표시는 배포 때 NAVER 등록 주소에서 사람이 본다.
 *
 * - 'working': 지도·오버레이·이벤트·Service(geocode·reverseGeocode)가 동작한다. 지도 칸 클릭 = 화면 위치에 비례한 좌표.
 * - 'auth-fail': 실제 SDK 인증 실패 순서를 흉내 낸다 — 먼저 지도를 만들게 한 뒤 `naver.maps = null` 로 바꾸고
 *   `navermap_authFailure` 를 부른다. 그 뒤 이미 만든 객체의 정리 호출(removeListener·setMap·destroy)은 실제 SDK처럼
 *   TypeError 를 던진다(2026-10-25 테마 전환 빈 화면 결함의 조건, D-030).
 */
export type FakeSdkMode = 'working' | 'auth-fail'

/** 브라우저에서 실행할 스크립트 본문 (route.fulfill 로 maps.js 대신 돌려준다) */
export function fakeNaverSdk(mode: FakeSdkMode): string {
  return `(${sdk.toString()})(${JSON.stringify(mode)})`
}

// 아래 함수는 브라우저에서 문자열로 실행된다 — 바깥 변수를 쓰지 않는다
function sdk(mode: FakeSdkMode) {
  let dead = false
  const broken = () => {
    if (dead) throw new TypeError("Cannot read properties of null (reading 'isArray')")
  }
  type Listener = { target: unknown; type: string; handler: (e?: unknown) => void }
  const listeners = new Map<number, Listener>()
  let nextId = 0
  const Event = {
    addListener(target: unknown, type: string, handler: (e?: unknown) => void) {
      broken()
      listeners.set(++nextId, { target, type, handler })
      return nextId
    },
    removeListener(id: number) {
      broken()
      listeners.delete(id)
    },
    trigger(target: unknown, type: string, e?: unknown) {
      for (const l of [...listeners.values()]) if (l.target === target && l.type === type) l.handler(e)
    },
  }
  class LatLng {
    constructor(private readonly a: number, private readonly b: number) {}
    lat() {
      return this.a
    }
    lng() {
      return this.b
    }
  }
  class Point {
    constructor(readonly x: number, readonly y: number) {}
  }
  class Size {
    constructor(readonly width: number, readonly height: number) {}
  }
  class Overlay {
    map: unknown = null
    constructor(readonly options: Record<string, unknown> = {}) {
      if (options.map) this.map = options.map
    }
    setMap(map: unknown) {
      if (map === null) broken()
      this.map = map
    }
    setOptions(o: Record<string, unknown>) {
      Object.assign(this.options, o)
    }
    setPosition(p: unknown) {
      this.options.position = p
    }
    setIcon(i: unknown) {
      this.options.icon = i
    }
    setZIndex() {}
    setCenter(c: unknown) {
      this.options.center = c
    }
    setRadius(r: number) {
      this.options.radius = r
    }
  }
  class FakeMap {
    private center: LatLng
    private zoom: number
    private readonly canvas: HTMLDivElement
    constructor(el: HTMLElement, options: { center?: LatLng; zoom?: number }) {
      this.center = options.center ?? new LatLng(37.45, 126.7)
      this.zoom = options.zoom ?? 11
      const canvas = document.createElement('div')
      canvas.className = 'fake-naver-map'
      canvas.style.cssText = 'position:absolute;inset:0;background:#c9d3dc'
      canvas.addEventListener('click', (ev) => {
        const r = canvas.getBoundingClientRect()
        const scale = 0.00002 * 2 ** (16 - this.zoom)
        const lat = this.center.lat() + (r.height / 2 - (ev.clientY - r.top)) * scale
        const lng = this.center.lng() + (ev.clientX - r.left - r.width / 2) * scale
        Event.trigger(this, 'click', { coord: new LatLng(lat, lng) })
      })
      el.appendChild(canvas)
      this.canvas = canvas
      setTimeout(() => {
        Event.trigger(this, 'init')
        Event.trigger(this, 'idle')
      }, 0)
    }
    setSize() {}
    panTo(c: LatLng) {
      this.center = c
    }
    getZoom() {
      return this.zoom
    }
    setZoom(z: number) {
      this.zoom = z
      Event.trigger(this, 'zoom_changed')
    }
    setCenter(c: LatLng) {
      this.center = c
    }
    getCenter() {
      return this.center
    }
    panBy() {}
    getBounds() {
      const c = this.center
      return { getSW: () => new LatLng(c.lat() - 0.05, c.lng() - 0.05), getNE: () => new LatLng(c.lat() + 0.05, c.lng() + 0.05) }
    }
    get(key: string) {
      return key === 'renderMode' ? 1 : undefined
    }
    getMinZoom() {
      return 6
    }
    getMaxZoom() {
      return 21
    }
    destroy() {
      broken()
      this.canvas.remove()
    }
  }
  class InfoWindow {
    private content: HTMLElement | null = null
    open() {}
    close() {}
    setContent(c: HTMLElement) {
      this.content = c
    }
    setOptions() {}
    getContentElement() {
      return this.content
    }
  }
  const OK = 200
  const Service = {
    Status: { OK, ERROR: 500 },
    reverseGeocode(_o: unknown, cb: (status: number, response?: unknown) => void) {
      setTimeout(() => cb(OK, { v2: { status: { code: 0 }, address: { roadAddress: '인천광역시 부평구 광장로 16 (가짜 SDK)', jibunAddress: null } } }), 0)
    },
    geocode(_o: unknown, cb: (status: number, response?: unknown) => void) {
      setTimeout(() => cb(OK, { v2: { status: 'OK', meta: { totalCount: 0 }, addresses: [] } }), 0)
    },
  }
  const w = window as unknown as Record<string, unknown> & { naver?: { maps: unknown } }
  w.naver = {
    maps: {
      Map: FakeMap, LatLng, Point, Size, Marker: Overlay, Circle: Overlay, Polygon: Overlay, InfoWindow, Event, Service,
      Position: { TOP_LEFT: 1, TOP_RIGHT: 3, BOTTOM_LEFT: 7, BOTTOM_RIGHT: 9, LEFT_BOTTOM: 6, RIGHT_BOTTOM: 4 },
      ZoomControlStyle: { SMALL: 1 },
    },
  }
  const script = document.currentScript as HTMLScriptElement | null
  const callback = script ? new URL(script.src).searchParams.get('callback') : null
  setTimeout(() => {
    if (callback && typeof w[callback] === 'function') (w[callback] as () => void)()
  }, 0)
  if (mode === 'auth-fail') {
    // 실제 SDK: 지도를 만든 뒤 인증 결과가 오면 전역을 null 로 바꾸고 실패 콜백을 부른다
    setTimeout(() => {
      dead = true
      w.naver = { maps: null }
      if (typeof w.navermap_authFailure === 'function') (w.navermap_authFailure as () => void)()
    }, 300)
  }
}
