import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { NAVER_SCRIPT_ID, resetNaverMapsLoaderForTest, type NaverMapsApi } from '../map/naverMaps.ts'
import { findDongRings } from '../map/dongBoundary.ts'
import { boxToRect, circleBox, insideUsable, satisfiesSingle, usableArea } from '../map/mapFit.ts'
import { MapView, type MapCompare, type MapStore, type MapViewProps } from './MapView.tsx'

// 행정동 경계 파일(약 600KB) 대신 동마다 작은 사각형 하나 — 어떤 동을 요청했는지와 polygon 생성·제거만 본다
vi.mock('../map/dongBoundary.ts', () => ({
  findDongRings: vi.fn(async () => [[[
    { lat: 37.48, lng: 126.72 },
    { lat: 37.49, lng: 126.72 },
    { lat: 37.49, lng: 126.73 },
  ]]]),
}))

// NAVER SDK 경계 계약만 본다 — 실제 SDK 대신 window.naver.maps에 fake를 둔다(로더는 이미 로드된 SDK를 그대로 쓴다).
class FakeLatLng {
  constructor(
    readonly y: number,
    readonly x: number,
  ) {}
  lat() {
    return this.y
  }
  lng() {
    return this.x
  }
}
class FakeSize {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakePoint {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

// 래스터 Web Mercator 축척 모델(타일 256px): 범위 맞춤이 getBounds·setCenter·setZoom·panBy로 계산한 결과를 실제로 확인할 수 있게 한다
const worldPx = (z: number) => 256 * 2 ** z
const toPx = (lat: number, lng: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return { x: ((lng + 180) / 360) * worldPx(z), y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z) }
}
const fromPx = (x: number, y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / worldPx(z)
  return new FakeLatLng((180 / Math.PI) * Math.atan(Math.sinh(n)), (x / worldPx(z)) * 360 - 180)
}

let maps: FakeMap[] = []
class FakeMap {
  zoom = 11
  center = new FakeLatLng(37.4563, 126.7052)
  size = { w: 955, h: 365 }
  renderMode = 1
  setSize = vi.fn((s: FakeSize) => (this.size = { w: s.width, h: s.height }))
  panTo = vi.fn((c: FakeLatLng) => (this.center = c))
  setZoom = vi.fn((...[z]: [zoom: number, effect?: boolean]) => (this.zoom = z))
  getZoom = vi.fn(() => this.zoom)
  setCenter = vi.fn((c: FakeLatLng) => (this.center = c))
  /** panBy(+x, +y): 보이는 영역을 오른쪽·아래로 → 중심 px가 그만큼 이동 */
  panBy = vi.fn((p: FakePoint) => {
    const c = toPx(this.center.lat(), this.center.lng(), this.zoom)
    this.center = fromPx(c.x + p.x, c.y + p.y, this.zoom)
  })
  getBounds = vi.fn(() => {
    const c = toPx(this.center.lat(), this.center.lng(), this.zoom)
    const sw = fromPx(c.x - this.size.w / 2, c.y + this.size.h / 2, this.zoom)
    const ne = fromPx(c.x + this.size.w / 2, c.y - this.size.h / 2, this.zoom)
    return { getSW: () => sw, getNE: () => ne }
  })
  get = vi.fn((key: string) => (key === 'renderMode' ? this.renderMode : undefined))
  getMinZoom = () => 0
  getMaxZoom = () => 21
  destroy = vi.fn()
  options: Record<string, unknown>
  constructor(_el: unknown, options: Record<string, unknown>) {
    this.options = options
    this.renderMode = options.gl ? 2 : 1                                // GL 요청은 GL로 그려진다고 본다(다크 경로 테스트)
    maps.push(this)
  }
}
// SDK 오버레이는 `new`로 만든다 — 화살표 함수가 아닌 생성 가능한 함수
const overlay = function () {
  return { setMap: vi.fn(), setPosition: vi.fn(), setIcon: vi.fn(), setCenter: vi.fn(), setRadius: vi.fn() }
}
type FakeInfo = { open: Mock; close: Mock; setContent: Mock; setOptions: Mock; getContentElement: () => HTMLElement; content: HTMLElement }
let infos: FakeInfo[] = []
const infoWindow = function (opts: { content: HTMLElement }) {
  const info: FakeInfo = {
    open: vi.fn(),
    close: vi.fn(),
    setContent: vi.fn(),
    setOptions: vi.fn(),
    getContentElement: () => info.content,
    content: opts.content,
  }
  info.setContent.mockImplementation((c: HTMLElement) => (info.content = c))
  infos.push(info)
  return info
}
// 마커 click 리스너를 잡아 두고 테스트에서 부른다
let listeners: { target: unknown; type: string; handler: () => void }[] = []

const fakeSdk = {
  Map: FakeMap,
  LatLng: FakeLatLng,
  Point: FakePoint,
  Size: FakeSize,
  Marker: vi.fn(overlay),
  Circle: vi.fn(overlay),
  Polygon: vi.fn(overlay),
  InfoWindow: vi.fn(infoWindow),
  Position: { TOP_RIGHT: 'TOP_RIGHT', BOTTOM_RIGHT: 'BOTTOM_RIGHT' },
  ZoomControlStyle: { SMALL: 'SMALL', LARGE: 'LARGE' },
  Event: {
    addListener: vi.fn((target: unknown, type: string, handler: () => void) => {
      const l = { target, type, handler }
      listeners.push(l)
      return l
    }),
    removeListener: vi.fn((l: unknown) => (listeners = listeners.filter((x) => x !== l))),
  },
} as unknown as NaverMapsApi

// jsdom에는 ResizeObserver·레이아웃이 없다 — 관찰 대상과 콜백을 잡아 두고 크기는 직접 정한다
let observed: Element[] = []
let resize: () => void = () => {}
const layout = new Map<Element, { w: number; h: number }>()

beforeEach(() => {
  maps = []
  infos = []
  listeners = []
  vi.mocked(fakeSdk.Marker).mockClear()
  observed = []
  layout.clear()
  window.naver = { maps: fakeSdk }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resize = () => act(() => cb())                           // 크기 콜백은 지도 표시 상태(sized)도 바꾼다
      }
      observe(el: Element) {
        observed.push(el)
      }
      disconnect() {}
    },
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return layout.get(this)?.w ?? 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return layout.get(this)?.h ?? 0
  })
})

afterEach(() => {
  cleanup() // 지도 effect 정리가 stub 해제보다 먼저
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetNaverMapsLoaderForTest()
})

const props = (over: Partial<MapViewProps> = {}): MapViewProps => ({
  selected: null,
  markerTone: 'selected',
  dong: null,
  interactive: true,
  onSelect: () => {},
  ...over,
})

/** 지금 지도에서 원(중심·500m)의 화면 사각형과 U(jsdom: 오버레이 크기 0 → SDK 컨트롤 대체 사각형만) */
function viewOf(map: FakeMap) {
  const b = map.getBounds()
  const bounds = { s: b.getSW().lat(), n: b.getNE().lat(), w: b.getSW().lng(), e: b.getNE().lng() }
  const rectOf = (p: { lat: number; lng: number }) => boxToRect(circleBox(p.lat, p.lng, 500), { bounds, w: map.size.w, h: map.size.h })
  const u = usableArea(map.size, [
    { x: map.size.w - 60, y: 10, w: 50, h: 79 },
    { x: map.size.w - 168, y: map.size.h - 27, w: 158, h: 17 },
  ])
  return { rectOf, u }
}
/** 단일 완료 조건(원 ⊂ U, 지름 ≥ U 짧은 변 절반) */
const singleDone = (map: FakeMap, p: { lat: number; lng: number }) => {
  const v = viewOf(map)
  return satisfiesSingle(v.rectOf(p), v.u)
}
/** 비교 완료 조건: 'union' = 두 원 ⊂ U 그리고 래스터 기준 zoom ≥ 13, 'B' = B 원 단일 조건, 아니면 false */
const compareDone = (map: FakeMap, a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const v = viewOf(map)
  const zRaster = map.renderMode === 2 ? map.zoom + 1 : map.zoom
  if (zRaster >= 13 && insideUsable(v.rectOf(a), v.u) && insideUsable(v.rectOf(b), v.u)) return 'union'
  if (satisfiesSingle(v.rectOf(b), v.u)) return 'B'
  return false
}

/** SDK 지도 이벤트를 낸다 (init·zooming·dragstart) */
const fireMap = (type: string) => act(() => listeners.filter((l) => l.type === type && l.target === maps[0]).forEach((l) => l.handler()))

/**
 * 보이는 지도(기본 955×365)로 마운트. `size: null`이면 숨겨진 지도(0×0, mobile 패널 화면).
 * `init: false`면 SDK init 이벤트를 아직 내지 않는다(범위 맞춤은 init 뒤에만)
 */
async function mount(p: MapViewProps, size: { w: number; h: number } | null = { w: 955, h: 365 }, opts: { init?: boolean } = {}) {
  const view = render(<MapView {...p} />)
  const section = view.container.querySelector('section.map')!
  if (size) layout.set(section, size)
  // SDK 로드는 비동기 — 지도가 만들어지고 effect가 걸린 뒤(ResizeObserver 관찰 시작)부터 본다
  await waitFor(() => expect(observed).toHaveLength(1))
  if (opts.init !== false) fireMap('init')
  return { ...view, map: maps[0]!, section }
}

describe('MapView — 지도 크기 (B2)', () => {
  it('바깥 .map section을 관찰하고, 그 크기로 setSize 한다 (canvas inline 크기와 무관)', async () => {
    const view = render(<MapView {...props()} />)
    const section = view.container.querySelector('section.map')!
    layout.set(section, { w: 955, h: 365 })
    await waitFor(() => expect(observed).toHaveLength(1))
    const map = maps[0]!

    // mount 직후 현재 크기를 한 번 적용
    expect(observed).toEqual([section])
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(955, 365))

    // tablet 결과 화면(지도 200px) → 조건 화면(다시 커짐)
    layout.set(section, { w: 955, h: 200 })
    resize()
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(955, 200))
    layout.set(section, { w: 800, h: 744 })
    resize()
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(800, 744))
  })

  it('크기가 0이면(숨겨진 mobile 화면) setSize 하지 않는다', async () => {
    const { map, section } = await mount(props())
    map.setSize.mockClear()
    layout.set(section, { w: 0, h: 0 })
    resize()
    expect(map.setSize).not.toHaveBeenCalled()
  })

  it('tablet → (숨김) → mobile 지도 화면: 줄어든 크기로 setSize 하고, 지도·오버레이를 다시 만들지 않는다 (3차-B)', async () => {
    const selected = { lat: 37.4894, lng: 126.7246 }
    const view = render(<MapView {...props({ selected, dong: { guCode: '28237', dongName: '부평1동' } })} />)
    const section = view.container.querySelector('section.map')!
    layout.set(section, { w: 970, h: 199 })                      // tablet 결과 화면
    await waitFor(() => expect(observed).toHaveLength(1))
    const map = maps[0]!
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(970, 199))
    const markers = vi.mocked(fakeSdk.Marker).mock.calls.length
    const circles = vi.mocked(fakeSdk.Circle).mock.calls.length
    const pans = map.panTo.mock.calls.length

    layout.set(section, { w: 0, h: 0 })                          // 375px 패널 화면: 지도 숨김
    resize()
    layout.set(section, { w: 375, h: 570 })                      // "지도 보기": 부모 폭(375)을 따른다
    resize()
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(375, 570))
    layout.set(section, { w: 970, h: 199 })                      // 다시 tablet
    resize()
    expect(map.setSize).toHaveBeenLastCalledWith(new FakeSize(970, 199))

    expect(maps).toHaveLength(1)                                 // 지도 1개 유지 (중심·줌 그대로)
    expect(map.destroy).not.toHaveBeenCalled()
    expect(vi.mocked(fakeSdk.Marker).mock.calls.length).toBe(markers)
    expect(vi.mocked(fakeSdk.Circle).mock.calls.length).toBe(circles)
    expect(map.panTo.mock.calls.length).toBe(pans)              // 크기만 바뀌면 다시 이동하지 않는다
    expect(map.setZoom).not.toHaveBeenCalled()
  })
})

describe('MapView — 범위 맞춤 단일 (8-B1, D-022)', () => {
  const BUPYEONG = { lat: 37.4894, lng: 126.7246 }
  const GUWOL = { lat: 37.4482, lng: 126.7035 }
  /** 지금 지도에서 반경 원의 화면 사각형과 사용 영역 U(jsdom: 오버레이 크기 0 → SDK 컨트롤 대체 사각형만) */
  const circleState = (map: FakeMap, point: { lat: number; lng: number }) => {
    const b = map.getBounds()
    const bounds = { s: b.getSW().lat(), n: b.getNE().lat(), w: b.getSW().lng(), e: b.getNE().lng() }
    const rect = boxToRect(circleBox(point.lat, point.lng, 500), { bounds, w: map.size.w, h: map.size.h })
    const u = usableArea(map.size, [
      { x: map.size.w - 60, y: 10, w: 50, h: 79 },
      { x: map.size.w - 168, y: map.size.h - 27, w: 158, h: 17 },
    ])
    return { rect, u, ok: satisfiesSingle(rect, u) }
  }

  it('새 위치를 고르면 setCenter → setZoom(z, false) → panBy로 맞춰, 원이 U 안에 들고 지름이 U 짧은 변의 절반 이상이 된다 (panTo 아님)', async () => {
    const view = await mount(props())
    expect(circleState(view.map, BUPYEONG).ok).toBe(false)              // z11: 원이 점처럼 작다(P1)
    view.rerender(<MapView {...props({ selected: BUPYEONG })} />)

    expect(view.map.setCenter).toHaveBeenCalledWith(new FakeLatLng(BUPYEONG.lat, BUPYEONG.lng))
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    expect(view.map.setZoom.mock.calls[0]![1]).toBe(false)              // 즉시 이동
    const order = [view.map.setCenter, view.map.setZoom, view.map.panBy].map((f) => f.mock.invocationCallOrder[0]!)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(view.map.panTo).not.toHaveBeenCalled()
    const { rect, u, ok } = circleState(view.map, BUPYEONG)
    expect(ok).toBe(true)
    // 원 중심 = U 중심(±1px)
    expect(Math.abs(rect.x + rect.w / 2 - (u.x + u.w / 2))).toBeLessThan(1)
    expect(Math.abs(rect.y + rect.h / 2 - (u.y + u.h / 2))).toBeLessThan(1)
  })

  it('지금 화면이 이미 조건을 만족하는 새 위치는 움직이지 않고, 아니면 다시 맞춘다 (순위 2)', async () => {
    const view = await mount(props({ selected: BUPYEONG }))
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    const near = { lat: BUPYEONG.lat + 0.0003, lng: BUPYEONG.lng + 0.0003 } // 약 40m 옆: 원이 여전히 U 안
    view.rerender(<MapView {...props({ selected: near })} />)
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    expect(view.map.setCenter).toHaveBeenCalledTimes(1)

    view.rerender(<MapView {...props({ selected: GUWOL })} />)           // 4.8km 떨어진 곳: 화면 밖
    expect(view.map.setCenter).toHaveBeenLastCalledWith(new FakeLatLng(GUWOL.lat, GUWOL.lng))
    expect(circleState(view.map, GUWOL).ok).toBe(true)
  })

  it('분석 불가 지점도 고를 때 맞추고, 같은 좌표에서 tone·결과만 바뀌면 다시 맞추지 않는다', async () => {
    const outside = { lat: 37.5663, lng: 126.9779 }
    const view = await mount(props({ selected: outside }))
    expect(view.map.setCenter).toHaveBeenCalledTimes(1)
    view.rerender(<MapView {...props({ selected: { ...outside }, markerTone: 'invalid' })} />)
    expect(view.map.setCenter).toHaveBeenCalledTimes(1)
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
  })

  it('init 전에는 맞추지 않고(GL은 init 전 bounds 오류), init 뒤 1회 맞춘다', async () => {
    const view = await mount(props({ selected: BUPYEONG }), { w: 955, h: 365 }, { init: false })
    expect(view.map.getBounds).not.toHaveBeenCalled()
    expect(view.map.setZoom).not.toHaveBeenCalled()
    fireMap('init')
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    fireMap('init')                                                     // 두 번째 init은 무시
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
  })

  it('숨겨진 지도(0×0)에서 고르면 미뤘다가, 보이고 setSize한 뒤 그 크기로 1회 맞춘다 (순위 4)', async () => {
    const view = await mount(props({ selected: BUPYEONG }), null)
    expect(view.map.setZoom).not.toHaveBeenCalled()
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    expect(view.map.setSize.mock.invocationCallOrder.at(-1)!).toBeLessThan(view.map.setCenter.mock.invocationCallOrder[0]!)
    expect(circleState(view.map, BUPYEONG).ok).toBe(true)
    layout.set(view.section, { w: 970, h: 320 })                         // 그 뒤 크기만 바뀌면 zoom 그대로(순위 8)
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
  })

  it('창 크기 변경·점포 선택·분석 완료(행정동)는 zoom을 바꾸지 않는다 (순위 8)', async () => {
    const STORES: MapStore[] = [{ id: 'a', name: '라네이즈PC방', address: '주소', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 }]
    const view = await mount(props({ selected: BUPYEONG }))
    const zooms = view.map.setZoom.mock.calls.length
    for (let i = 0; i < 20; i++) {
      layout.set(view.section, { w: 955 - (i % 2) * 300, h: 365 + (i % 2) * 200 })
      resize()
    }
    view.rerender(<MapView {...props({ selected: BUPYEONG, dong: { guCode: '28237', dongName: '부평1동' }, stores: STORES })} />)
    view.rerender(<MapView {...props({ selected: BUPYEONG, dong: { guCode: '28237', dongName: '부평1동' }, stores: STORES, activeStoreId: 'a' })} />)
    expect(view.map.setZoom.mock.calls.length).toBe(zooms)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))   // 점포 선택은 기존 panTo
  })

  it('"범위에 맞추기"는 이미 조건을 만족해도 다시 맞추고 키보드로 누를 수 있다 (순위 1). 사용자 조정(zooming·dragstart) 뒤에도 무조건 맞춘다', async () => {
    const view = await mount(props({ selected: BUPYEONG }))
    const button = screen.getByRole('button', { name: '범위에 맞추기' })
    expect(button).toHaveAttribute('type', 'button')
    expect(screen.getByRole('list', { name: '지도 범례' }).contains(button)).toBe(true)
    fireEvent.click(button)
    expect(view.map.setZoom).toHaveBeenCalledTimes(2)                   // 조건 만족 상태에서도

    fireMap('zooming')                                                  // 사용자가 휠로 확대 → 잠금
    view.map.setZoom(18)
    fireMap('dragstart')
    fireEvent.click(button)
    expect(view.map.setZoom).toHaveBeenCalledTimes(4)                   // 사용자 setZoom(18) 1회 + 맞춤 1회
    expect(circleState(view.map, BUPYEONG).ok).toBe(true)
  })

  it('잠금 중 숨김 복귀는 미뤘던 자동 맞춤을 하지 않는다(사용자가 직접 둔 화면 유지)', async () => {
    const view = await mount(props())
    layout.set(view.section, { w: 0, h: 0 })
    resize()
    view.rerender(<MapView {...props({ selected: BUPYEONG })} />)        // 숨김 중 선택 → 미룸
    fireMap('zooming')                                                  // (잠금이 켜진 경우)
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect(view.map.setZoom).not.toHaveBeenCalled()
  })

  it('"범위에 맞추기"는 단일·유효 지점에서만 보인다 (위치 없음·분석 불가·비교 중에는 없음)', async () => {
    const view = await mount(props())
    expect(screen.queryByRole('button', { name: '범위에 맞추기' })).not.toBeInTheDocument()
    view.rerender(<MapView {...props({ selected: BUPYEONG, markerTone: 'invalid' })} />)
    expect(screen.queryByRole('button', { name: '범위에 맞추기' })).not.toBeInTheDocument()
    view.rerender(<MapView {...props({ selected: BUPYEONG, compare: { location: null, tone: 'selected', dong: null, guide: null } })} />)
    expect(screen.queryByRole('button', { name: '범위에 맞추기' })).not.toBeInTheDocument()
  })

  it('확대 컨트롤은 SDK SMALL, 실제 그리기 방식(renderMode)을 section에 남긴다', async () => {
    const view = await mount(props())
    expect(view.map.options.zoomControlOptions).toEqual({ position: 'TOP_RIGHT', style: 'SMALL' })
    expect(view.map.options.gl).toBeUndefined()                         // GL은 VITE_NAVER_MAP_GL=1일 때만
    expect(view.section).toHaveAttribute('data-render-mode', '1')
  })
})

describe('MapView — 동종 점포 마커 (4차, DESIGN.md §8.11·§8.14)', () => {
  const STORES: MapStore[] = [
    { id: 'a', name: '<img src=x onerror=alert(1)>PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 },
    { id: 'b', name: '두번째PC', address: '주소 정보 없음', distance: '직선거리 221m', lat: 37.49, lng: 126.726 },
  ]
  const storeMarkers = () => vi.mocked(fakeSdk.Marker).mock.results.slice(-STORES.length).map((r) => r.value)
  const clicks = () => listeners.filter((l) => l.type === 'click' && l.target !== maps[0])

  it('점포마다 누를 수 있는 마커를 만들고, 마커를 누르면 그 점포 id를 넘긴다', async () => {
    const onStoreSelect = vi.fn()
    await mount(props({ stores: STORES, onStoreSelect }))
    const calls = vi.mocked(fakeSdk.Marker).mock.calls.map(([o]) => o as { clickable: boolean; title: string })
    expect(calls).toHaveLength(2)
    expect(calls.every((o) => o.clickable)).toBe(true)
    expect(clicks()).toHaveLength(2)
    clicks()[1]!.handler()
    expect(onStoreSelect).toHaveBeenCalledWith('b')
  })

  it('선택한 점포는 정보창에 상호·주소·직선거리를 텍스트로 보이고(HTML로 해석하지 않음), 닫기는 선택을 지운다', async () => {
    const onStoreSelect = vi.fn()
    const view = await mount(props({ stores: STORES, onStoreSelect }))
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a', onStoreSelect })} />)
    expect(infos).toHaveLength(1)
    const info = infos[0]!
    expect(info.open).toHaveBeenCalledWith(view.map, storeMarkers()[0])
    expect(info.content.textContent).toContain('<img src=x onerror=alert(1)>PC방')
    expect(info.content.querySelector('img')).toBeNull()
    expect(info.content).toHaveTextContent('인천 부평구 1')
    expect(info.content).toHaveTextContent('직선거리 115m')
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))

    info.content.querySelector('button')!.click()
    expect(onStoreSelect).toHaveBeenLastCalledWith(null)
  })

  it('stores가 바뀌거나 없어지면 이전 마커·리스너를 지우고 정보창을 닫는다 (지도는 다시 만들지 않는다)', async () => {
    const view = await mount(props({ stores: STORES }))
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
    const old = storeMarkers()
    view.rerender(<MapView {...props({ stores: null, activeStoreId: null })} />)
    old.forEach((m) => expect(m.setMap).toHaveBeenLastCalledWith(null))
    expect(clicks()).toHaveLength(0)
    expect(infos[0]!.close).toHaveBeenCalled()
    expect(maps).toHaveLength(1)
  })
})

describe('MapView — 점포 정보창 닫기 접근성 (4차 보완, DESIGN.md §8.14)', () => {
  const STORES: MapStore[] = [
    { id: 'a', name: '라네이즈PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 },
    { id: 'b', name: '벨류피씨', address: '인천 부평구 2', distance: '직선거리 221m', lat: 37.49, lng: 126.726 },
  ]

  /** 선택 상태를 부모처럼 들고 있는 하네스 — 닫기 뒤 실제로 activeStoreId가 null로 바뀐다 */
  async function mountActive() {
    const onStoreSelect = vi.fn()
    const view = await mount(props({ stores: STORES, activeStoreId: 'a', onStoreSelect }))
    onStoreSelect.mockImplementation((id: string | null) =>
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: id, onStoreSelect })} />),
    )
    return { ...view, onStoreSelect }
  }

  it('점포를 고르면 SDK 정보창 밖(지도 위)에 키보드로 누를 수 있는 "정보창 닫기"가 생긴다', async () => {
    const view = await mount(props({ stores: STORES }))
    expect(screen.queryByRole('group', { name: '선택한 점포' })).not.toBeInTheDocument()
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
    const bar = screen.getByRole('group', { name: '선택한 점포' })
    expect(bar).toHaveTextContent('라네이즈PC방')
    const close = screen.getByRole('button', { name: '정보창 닫기' })
    expect(close).toHaveAttribute('type', 'button')
    expect(view.section.contains(close)).toBe(true)
    expect(infos[0]!.content.contains(close)).toBe(false)           // SDK 정보창 내용이 아니다
  })

  it('"정보창 닫기"를 누르면 선택만 지우고, 포커스는 지도 영역으로 옮긴다 (마커·중심·줌 유지)', async () => {
    const view = await mountActive()
    const markers = vi.mocked(fakeSdk.Marker).mock.calls.length
    const pans = view.map.panTo.mock.calls.length
    screen.getByRole('button', { name: '정보창 닫기' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '정보창 닫기' }))

    expect(view.onStoreSelect).toHaveBeenCalledWith(null)
    expect(infos[0]!.close).toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: '선택한 점포' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(view.section)               // 포커스를 잃지 않는다
    expect(view.section).toHaveAttribute('tabindex', '-1')
    expect(vi.mocked(fakeSdk.Marker).mock.calls.length).toBe(markers)
    vi.mocked(fakeSdk.Marker).mock.results.forEach((r) => expect(r.value.setMap).not.toHaveBeenCalledWith(null))
    expect(view.map.panTo.mock.calls.length).toBe(pans)
    expect(view.map.setZoom).not.toHaveBeenCalled()
    expect(maps).toHaveLength(1)
  })

  it('지도 영역에서 Escape를 누르면 닫고, 선택이 없으면 아무것도 하지 않는다', async () => {
    const view = await mountActive()
    fireEvent.keyDown(screen.getByRole('button', { name: '정보창 닫기' }), { key: 'Escape' })
    expect(view.onStoreSelect).toHaveBeenCalledWith(null)
    expect(document.activeElement).toBe(view.section)

    view.onStoreSelect.mockClear()
    fireEvent.keyDown(view.section, { key: 'Escape' })
    expect(view.onStoreSelect).not.toHaveBeenCalled()
  })

  it('정보창 안 "닫기"도 포커스를 지도 영역으로 옮긴다', async () => {
    const view = await mountActive()
    infos[0]!.content.querySelector('button')!.click()
    expect(view.onStoreSelect).toHaveBeenCalledWith(null)
    expect(document.activeElement).toBe(view.section)
  })
})

describe('MapView — 숨겨진 지도에서 고른 점포 정보창 (6-4, mobile 패널 → 지도 보기)', () => {
  const STORES: MapStore[] = [
    { id: 'a', name: '라네이즈PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 },
    { id: 'b', name: '벨류피씨', address: '인천 부평구 2', distance: '직선거리 221m', lat: 37.49, lng: 126.726 },
  ]
  const storeMarkers = () => vi.mocked(fakeSdk.Marker).mock.results.slice(-STORES.length).map((r) => r.value)
  const hide = (section: Element) => {
    layout.set(section, { w: 0, h: 0 })
    resize()
  }
  const show = (section: Element, w = 375, h = 566) => {
    layout.set(section, { w, h })
    resize()
  }

  it('숨겨진 지도(0×0)에서 고르면 열지도 옮기지도 않고, 지도가 보이면 setSize 뒤에 그 점포 정보창을 열고 한 번 옮긴다', async () => {
    const view = await mount(props({ stores: STORES }), null)                   // mobile 패널 화면: 지도 숨김
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
    expect(infos).toHaveLength(0)                                               // 0×0에서 open 하지 않는다
    expect(view.map.panTo).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: '선택한 점포' })).toHaveTextContent('라네이즈PC방')   // 선택(막대)은 그대로

    show(view.section)                                                          // "지도 보기"
    expect(view.map.setSize).toHaveBeenLastCalledWith(new FakeSize(375, 566))
    expect(infos).toHaveLength(1)
    const info = infos[0]!
    expect(info.open).toHaveBeenCalledTimes(1)
    expect(info.open).toHaveBeenCalledWith(view.map, storeMarkers()[0])
    expect(view.map.setSize.mock.invocationCallOrder.at(-1)!).toBeLessThan(info.open.mock.invocationCallOrder[0]!)   // 크기 먼저
    expect(info.content).toHaveTextContent('라네이즈PC방')
    expect(info.content).toHaveTextContent('인천 부평구 1')
    expect(info.content).toHaveTextContent('직선거리 115m')
    expect(view.map.panTo).toHaveBeenCalledTimes(1)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))
    expect(maps).toHaveLength(1)
    expect(view.map.setZoom).not.toHaveBeenCalled()
  })

  it('지도를 보이기 전에 선택을 지우거나 위치를 바꾸면(점포 목록이 사라짐) 이전 정보창이 다시 나타나지 않는다', async () => {
    const view = await mount(props({ stores: STORES, activeStoreId: 'a' }))
    expect(infos[0]!.open).toHaveBeenCalledTimes(1)                             // 보이는 지도에서 연 상태
    hide(view.section)
    expect(infos[0]!.close).toHaveBeenCalled()                                  // 숨기면 닫아 둔다
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: null })} />)
    show(view.section)
    expect(infos[0]!.open).toHaveBeenCalledTimes(1)                             // 다시 열지 않는다

    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'b' })} />)  // 보이는 지도에서 다른 점포
    expect(infos[0]!.open).toHaveBeenCalledTimes(2)
    hide(view.section)
    view.rerender(<MapView {...props({ stores: null, activeStoreId: null, selected: { lat: 37.4475, lng: 126.7015 } })} />)   // 다른 위치 선택
    show(view.section)
    expect(infos[0]!.open).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('group', { name: '선택한 점포' })).not.toBeInTheDocument()
  })

  it('숨긴 동안 다른 점포로 바꾸면 보일 때 새 점포로 열고 그 점포로 옮긴다', async () => {
    const view = await mount(props({ stores: STORES, activeStoreId: 'a' }))
    const pans = view.map.panTo.mock.calls.length
    hide(view.section)
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'b' })} />)
    expect(infos[0]!.open).toHaveBeenCalledTimes(1)
    expect(view.map.panTo.mock.calls.length).toBe(pans)
    show(view.section)
    expect(infos[0]!.open).toHaveBeenLastCalledWith(view.map, storeMarkers()[1])
    expect(infos[0]!.content).toHaveTextContent('벨류피씨')
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.49, 126.726))
    expect(view.map.panTo.mock.calls.length).toBe(pans + 1)
  })

  it('같은 선택으로 숨김 → 다시 보임(화면 전환)·mobile → tablet → desktop 크기 변경: 정보창은 보일 때 다시 열고, 다시 옮기거나 지도·마커를 새로 만들지 않는다', async () => {
    const view = await mount(props({ stores: STORES, activeStoreId: 'a' }), { w: 375, h: 566 })
    const markers = vi.mocked(fakeSdk.Marker).mock.calls.length
    const pans = view.map.panTo.mock.calls.length
    hide(view.section)
    show(view.section)
    expect(infos[0]!.open).toHaveBeenCalledTimes(2)
    show(view.section, 970, 320)                                               // tablet
    show(view.section, 815, 744)                                               // desktop
    expect(infos[0]!.open).toHaveBeenCalledTimes(2)                             // 보이는 동안 크기만 바뀌면 다시 열지 않는다
    expect(infos).toHaveLength(1)
    expect(view.map.panTo.mock.calls.length).toBe(pans)
    expect(vi.mocked(fakeSdk.Marker).mock.calls.length).toBe(markers)
    expect(maps).toHaveLength(1)
    expect(view.map.destroy).not.toHaveBeenCalled()
  })

  it('크기 알림(ResizeObserver)이 아직 오지 않았어도 열기 직전 실제 크기가 0이면 열지 않는다', async () => {
    const view = await mount(props({ stores: STORES }))
    layout.set(view.section, { w: 0, h: 0 })                                   // 숨겨졌지만 알림 전(같은 프레임)
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
    expect(infos).toHaveLength(0)
    expect(view.map.panTo).not.toHaveBeenCalled()
    resize()                                                                    // 다음 프레임: 0×0 알림
    show(view.section)
    expect(infos[0]!.open).toHaveBeenCalledTimes(1)
    expect(view.map.panTo).toHaveBeenCalledTimes(1)
  })

  describe('0×0 알림 없이 실제 크기 0에서 고른 뒤 양수 크기 알림 (6-4 보완: sized가 계속 true인 경로)', () => {
    /** 보이는 지도(sized=true) → 같은 프레임에 숨겨짐(알림 없음) */
    async function hiddenWithoutNotice(initial: Partial<MapViewProps> = {}) {
      const view = await mount(props({ stores: STORES, ...initial }))
      layout.set(view.section, { w: 0, h: 0 })
      return view
    }

    it('그 사이 고른 점포는 크기 맞춤(setSize) 뒤 한 번 열고 한 번 옮긴다', async () => {
      const view = await hiddenWithoutNotice()
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
      expect(infos).toHaveLength(0)
      expect(view.map.panTo).not.toHaveBeenCalled()
      show(view.section)                                                        // 0×0 알림 없이 바로 양수 크기
      expect(view.map.setSize).toHaveBeenLastCalledWith(new FakeSize(375, 566))
      expect(infos).toHaveLength(1)
      const info = infos[0]!
      expect(info.open).toHaveBeenCalledTimes(1)
      expect(info.open).toHaveBeenCalledWith(view.map, storeMarkers()[0])
      expect(view.map.setSize.mock.invocationCallOrder.at(-1)!).toBeLessThan(info.open.mock.invocationCallOrder[0]!)
      expect(info.content).toHaveTextContent('라네이즈PC방')
      expect(view.map.panTo).toHaveBeenCalledTimes(1)
      expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))

      show(view.section, 970, 320)                                              // 이후 크기 변경: 다시 열거나 옮기지 않는다
      expect(info.open).toHaveBeenCalledTimes(1)
      expect(view.map.panTo).toHaveBeenCalledTimes(1)
      expect(maps).toHaveLength(1)
      expect(view.map.setZoom).not.toHaveBeenCalled()
    })

    it('양수 크기 알림 전에 선택을 지우면 열지 않는다', async () => {
      const view = await hiddenWithoutNotice()
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: null })} />)
      show(view.section)
      expect(infos).toHaveLength(0)
      expect(view.map.panTo).not.toHaveBeenCalled()
    })

    it('양수 크기 알림 전에 다른 점포로 바꾸면 그 점포로 연다(이전 점포를 복원하지 않는다)', async () => {
      const view = await hiddenWithoutNotice()
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a' })} />)
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'b' })} />)
      show(view.section)
      expect(infos).toHaveLength(1)
      expect(infos[0]!.open).toHaveBeenCalledTimes(1)
      expect(infos[0]!.open).toHaveBeenCalledWith(view.map, storeMarkers()[1])
      expect(infos[0]!.content).toHaveTextContent('벨류피씨')
      expect(view.map.panTo).toHaveBeenCalledTimes(1)
      expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.49, 126.726))
    })

    it('양수 크기 알림 전에 위치를 바꿔 점포 목록이 없어지면 열지 않는다', async () => {
      const view = await hiddenWithoutNotice({ activeStoreId: 'a' })
      const opens = infos[0]!.open.mock.calls.length                          // 보이는 동안 연 1회
      view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'b' })} />)   // 숨김 중 다른 점포(미룸)
      view.rerender(<MapView {...props({ stores: null, activeStoreId: null, selected: { lat: 37.4475, lng: 126.7015 } })} />)
      show(view.section)
      expect(infos[0]!.open.mock.calls.length).toBe(opens)
      expect(screen.queryByRole('group', { name: '선택한 점포' })).not.toBeInTheDocument()
    })
  })

  describe('화면 전환 신호(layoutKey)만으로 — ResizeObserver 콜백 없이 같은 크기로 패널 → 점포 선택 → 지도 (6-4 마지막 보완)', () => {
    const at = (screenKey: string, over: Partial<MapViewProps> = {}) => props({ stores: STORES, layoutKey: screenKey, ...over })

    /** 지도 화면(955×365, mount 때 한 번 맞춤) → 패널(숨김) 전환. 이 describe에서는 resize()를 한 번도 부르지 않는다 */
    async function toPanel(over: Partial<MapViewProps> = {}) {
      const view = await mount(at('map', over))
      layout.set(view.section, { w: 0, h: 0 })
      view.rerender(<MapView {...at('panel', over)} />)
      return view
    }
    const backToMap = (view: Awaited<ReturnType<typeof toPanel>>, over: Partial<MapViewProps> = {}) => {
      layout.set(view.section, { w: 955, h: 365 })                              // 같은 크기 — 크기 알림은 없다
      view.rerender(<MapView {...at('map', over)} />)
    }

    it('패널에서 고른 점포는 지도 화면 신호 뒤 setSize 다음에 한 번 열고 한 번 옮긴다', async () => {
      const view = await toPanel()
      view.map.setSize.mockClear()
      view.rerender(<MapView {...at('panel', { activeStoreId: 'a' })} />)
      expect(infos).toHaveLength(0)
      backToMap(view, { activeStoreId: 'a' })
      expect(view.map.setSize).toHaveBeenCalledWith(new FakeSize(955, 365))
      expect(infos).toHaveLength(1)
      const info = infos[0]!
      expect(info.open).toHaveBeenCalledTimes(1)
      expect(info.open).toHaveBeenCalledWith(view.map, storeMarkers()[0])
      expect(view.map.setSize.mock.invocationCallOrder.at(-1)!).toBeLessThan(info.open.mock.invocationCallOrder[0]!)
      expect(view.map.panTo).toHaveBeenCalledTimes(1)
      expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))

      view.rerender(<MapView {...at('map', { activeStoreId: 'a' })} />)          // 같은 화면 다시 그림: 중복 열기 없음
      expect(info.open).toHaveBeenCalledTimes(1)
      expect(maps).toHaveLength(1)
      expect(view.map.setZoom).not.toHaveBeenCalled()
    })

    it('화면 신호 없이 숨겨진 채(sized 그대로) 고른 경우도 지도 화면 신호에서 연다', async () => {
      const view = await mount(at('map'))
      layout.set(view.section, { w: 0, h: 0 })                                   // 숨김 알림도 화면 신호도 아직 없음
      view.rerender(<MapView {...at('map', { activeStoreId: 'a' })} />)
      expect(infos).toHaveLength(0)
      layout.set(view.section, { w: 955, h: 365 })
      view.rerender(<MapView {...at('panel', { activeStoreId: 'a' })} />)        // 신호가 바뀌는 렌더(값과 무관하게 다시 맞춤)
      expect(infos[0]!.open).toHaveBeenCalledTimes(1)
    })

    it('지도로 돌아오기 전에 선택 해제·위치 변경이면 열지 않고, 다른 점포면 그 점포로 연다', async () => {
      const cleared = await toPanel()
      cleared.rerender(<MapView {...at('panel', { activeStoreId: 'a' })} />)
      cleared.rerender(<MapView {...at('panel', { activeStoreId: null })} />)
      backToMap(cleared)
      expect(infos).toHaveLength(0)
      cleared.unmount()

      maps = []
      observed = []
      const moved = await toPanel()
      moved.rerender(<MapView {...at('panel', { activeStoreId: 'a' })} />)
      moved.rerender(<MapView {...at('panel', { stores: null, activeStoreId: null, selected: { lat: 37.4475, lng: 126.7015 } })} />)
      backToMap(moved, { stores: null, activeStoreId: null, selected: { lat: 37.4475, lng: 126.7015 } })
      expect(infos).toHaveLength(0)
      moved.unmount()

      maps = []
      observed = []
      const other = await toPanel()
      other.rerender(<MapView {...at('panel', { activeStoreId: 'a' })} />)
      other.rerender(<MapView {...at('panel', { activeStoreId: 'b' })} />)
      backToMap(other, { activeStoreId: 'b' })
      expect(infos).toHaveLength(1)
      expect(infos[0]!.open).toHaveBeenCalledTimes(1)
      expect(infos[0]!.content).toHaveTextContent('벨류피씨')
      expect(other.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.49, 126.726))
    })

    it('지도에서 연 정보창: 패널 → 지도 왕복 뒤 다시 열되 다시 옮기지 않고, 닫기 포커스 규칙은 그대로', async () => {
      const onStoreSelect = vi.fn()
      const view = await mount(at('map', { activeStoreId: 'a', onStoreSelect }))
      const pans = view.map.panTo.mock.calls.length
      layout.set(view.section, { w: 0, h: 0 })
      view.rerender(<MapView {...at('panel', { activeStoreId: 'a', onStoreSelect })} />)
      expect(infos[0]!.close).toHaveBeenCalled()
      backToMap(view, { activeStoreId: 'a', onStoreSelect })
      expect(infos[0]!.open).toHaveBeenCalledTimes(2)
      expect(view.map.panTo.mock.calls.length).toBe(pans)
      screen.getByRole('button', { name: '정보창 닫기' }).focus()
      fireEvent.click(screen.getByRole('button', { name: '정보창 닫기' }))
      expect(onStoreSelect).toHaveBeenCalledWith(null)
      expect(document.activeElement).toBe(view.section)
    })
  })

  it('보이는 지도에서는 목록 선택·마커 클릭 즉시 연다 (기존 그대로)', async () => {
    const onStoreSelect = vi.fn()
    const view = await mount(props({ stores: STORES, onStoreSelect }))
    listeners.filter((l) => l.type === 'click' && l.target !== maps[0])[1]!.handler()
    expect(onStoreSelect).toHaveBeenCalledWith('b')
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'b', onStoreSelect })} />)
    expect(infos[0]!.open).toHaveBeenCalledWith(view.map, storeMarkers()[1])
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.49, 126.726))
  })
})

describe('MapView — 두 위치 비교 A/B 표시 (5차-B4, COMPARE_DESIGN.md 4.2)', () => {
  const A = { lat: 37.4894, lng: 126.7246 }
  const A_DONG = { guCode: '28237', dongName: '부평1동' }
  const B1 = { lat: 37.4475, lng: 126.7015 }
  const B2 = { lat: 37.392512, lng: 126.639034 }
  const GUIDE = 'B 위치를 고르세요 · A: 부평구 부평1동'
  const cmp = (over: Partial<MapCompare> = {}): MapCompare => ({ location: null, tone: 'selected', dong: null, guide: GUIDE, ...over })
  const base = (compare: MapCompare | null) => props({ selected: A, dong: A_DONG, compare })

  type Opts = { icon?: { content: string }; strokeStyle?: string; radius?: number; clickable?: boolean; position?: FakeLatLng }
  const markerOpts = () => vi.mocked(fakeSdk.Marker).mock.calls.map(([o]) => o as Opts)
  const markerObjs = () => vi.mocked(fakeSdk.Marker).mock.results.map((r) => r.value)
  const circleOpts = () => vi.mocked(fakeSdk.Circle).mock.calls.map(([o]) => o as Opts)
  const circleObjs = () => vi.mocked(fakeSdk.Circle).mock.results.map((r) => r.value)
  const polygonObjs = () => vi.mocked(fakeSdk.Polygon).mock.results.map((r) => r.value)
  const lastIcon = (m: { setIcon: Mock }) => (m.setIcon.mock.calls.at(-1)![0] as { content: string }).content
  /** 마커 i의 지금 아이콘: 마지막 setIcon, 없으면 만들 때 아이콘 */
  const currentIcon = (i: number) =>
    markerObjs()[i]!.setIcon.mock.calls.length > 0 ? lastIcon(markerObjs()[i]!) : markerOpts()[i]!.icon!.content

  beforeEach(() => {
    vi.mocked(fakeSdk.Circle).mockClear()
    vi.mocked(fakeSdk.Polygon).mockClear()
    vi.mocked(findDongRings).mockClear()
  })

  async function mountA(compare: MapCompare | null = null) {
    const view = await mount(base(compare))
    await waitFor(() => expect(polygonObjs().length).toBeGreaterThanOrEqual(1))   // A 행정동 경계
    return { ...view, show: (c: MapCompare | null) => view.rerender(<MapView {...base(c)} />) }
  }

  it('비교를 시작하면(B를 고르기 전에도) A는 글자 "A" 마커가 되고, 범례·안내가 비교용으로 바뀐다', async () => {
    const view = await mountA()
    expect(markerOpts()[0]!.icon!.content).toBe('<div class="map-marker map-marker--selected"></div>')
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('선택 지점')

    view.show(cmp())
    expect(currentIcon(0)).toBe('<div class="map-marker map-marker--letter map-marker--a">A</div>')
    expect(markerOpts()).toHaveLength(1)                              // B 마커는 아직 없다
    expect(circleOpts()).toHaveLength(1)                              // A 반경만
    const legend = screen.getByRole('list', { name: '지도 범례' })
    expect([...legend.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'A 기준 위치',
      'B 비교 위치',
      'A 반경 500m',
      'B 반경 500m',
      '분석된 행정동 경계',
    ])
    expect(screen.getByText(GUIDE)).toHaveClass('map__guide')
    expect(maps).toHaveLength(1)
  })

  it('B를 고르면 흰 채움 "B" 마커와 점선 반경 500m를 만들고 B 쪽을 맞춘다(8-B2 순위 5). 다시 고르면 같은 오버레이를 옮긴다', async () => {
    const view = await mountA(cmp())
    view.show(cmp({ location: B1 }))

    expect(markerOpts()).toHaveLength(2)
    const b = markerOpts()[1]!
    expect(b.icon!.content).toBe('<div class="map-marker map-marker--letter map-marker--b">B</div>')
    expect(b.clickable).toBe(false)                                    // 지도 클릭(B 다시 고르기)을 막지 않는다
    expect(circleOpts().map((c) => [c.strokeStyle, c.radius])).toEqual([
      ['shortdash', 500],                                              // A
      ['dot', 500],                                                    // B — 선 모양으로 구분
    ])
    expect(compareDone(view.map, A, B1)).not.toBe(false)                // 두 원 ⊂ U(래스터 ≥ 13) 또는 B 원 단일 조건

    view.show(cmp({ location: B2 }))
    expect(markerOpts()).toHaveLength(2)                               // 새로 만들지 않는다
    expect(circleOpts()).toHaveLength(2)
    expect(markerObjs()[1]!.setPosition).toHaveBeenLastCalledWith(new FakeLatLng(B2.lat, B2.lng))
    expect(circleObjs()[1]!.setCenter).toHaveBeenLastCalledWith(new FakeLatLng(B2.lat, B2.lng))
    expect(compareDone(view.map, A, B2)).toBe('B')                     // 송도(약 12km): B 원만
    expect(view.map.setCenter).toHaveBeenLastCalledWith(new FakeLatLng(B2.lat, B2.lng))
    expect(maps).toHaveLength(1)
  })

  it('B 분석이 끝나 행정동이 생겨도 좌표가 같으면 다시 옮기지 않는다', async () => {
    const view = await mountA(cmp({ location: B1 }))
    const pans = view.map.panTo.mock.calls.length
    view.show(cmp({ location: B1, dong: { guCode: '28200', dongName: '구월3동' }, guide: null }))
    expect(view.map.panTo.mock.calls.length).toBe(pans)
  })

  it('분석 불가 위치(tone invalid)는 회색 B 마커·반경 없음, 위치 문제가 아니면(selected) 반경을 다시 보인다', async () => {
    const view = await mountA(cmp({ location: B2, tone: 'invalid' }))
    expect(markerOpts()[1]!.icon!.content).toBe('<div class="map-marker map-marker--letter map-marker--b map-marker--invalid">B</div>')
    expect(circleOpts()).toHaveLength(1)                               // B 반경을 만들지 않는다

    view.show(cmp({ location: B2, tone: 'selected' }))
    expect(currentIcon(1)).toBe('<div class="map-marker map-marker--letter map-marker--b">B</div>')
    expect(circleOpts()).toHaveLength(2)

    view.show(cmp({ location: B2, tone: 'invalid' }))
    expect(circleObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)
  })

  it('B 다시 고르기(위치 없음)면 B 마커·반경을 지우고 지도는 옮기지 않는다', async () => {
    const view = await mountA(cmp({ location: B1 }))
    const pans = view.map.panTo.mock.calls.length
    view.show(cmp({ location: null }))
    expect(markerObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)
    expect(circleObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)
    expect(view.map.panTo.mock.calls.length).toBe(pans)
    expect(currentIcon(0)).toContain('map-marker--a')                  // A 글자 마커는 그대로
  })

  it('비교를 끝내면 B를 지우고 A는 단일 분석 마커로 돌아가며 A로 옮긴다(순위 6: 조건을 만족하면 panTo, 아니면 맞춤)', async () => {
    const view = await mountA(cmp({ location: B1, dong: { guCode: '28200', dongName: '구월3동' } }))
    await waitFor(() => expect(polygonObjs()).toHaveLength(2))
    view.show(null)

    expect(markerObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)
    expect(circleObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)
    expect(polygonObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)    // B 경계
    expect(polygonObjs()[0]!.setMap).not.toHaveBeenCalledWith(null)    // A 경계는 그대로
    expect(currentIcon(0)).toBe('<div class="map-marker map-marker--selected"></div>')
    expect(singleDone(view.map, A)).toBe(true)                          // A 원이 다시 단일 완료 조건
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('선택 지점')
    expect(screen.queryByText(GUIDE)).not.toBeInTheDocument()
    expect(maps).toHaveLength(1)
  })

  it('B 행정동 경계: 같은 동이면 다시 그리지 않고, 같은 구의 다른 동은 그리며, 바뀌거나 지우면 이전 B 경계를 지운다', async () => {
    const view = await mountA(cmp({ location: B1 }))

    view.show(cmp({ location: B1, dong: { ...A_DONG } }))             // 같은 동
    await Promise.resolve()
    expect(vi.mocked(findDongRings).mock.calls).toEqual([['28237', '부평1동']])
    expect(polygonObjs()).toHaveLength(1)

    view.show(cmp({ location: B1, dong: { guCode: '28237', dongName: '산곡2동' } }))   // 같은 구 다른 동
    await waitFor(() => expect(polygonObjs()).toHaveLength(2))
    expect(vi.mocked(findDongRings)).toHaveBeenLastCalledWith('28237', '산곡2동')

    view.show(cmp({ location: B2, dong: { guCode: '28185', dongName: '송도2동' } }))   // B 바뀜
    await waitFor(() => expect(polygonObjs()).toHaveLength(3))
    expect(polygonObjs()[1]!.setMap).toHaveBeenLastCalledWith(null)    // 이전 B 경계

    view.show(cmp({ location: null }))                                 // 다시 고르기
    expect(polygonObjs()[2]!.setMap).toHaveBeenLastCalledWith(null)
    expect(polygonObjs()[0]!.setMap).not.toHaveBeenCalledWith(null)
  })

  it('B 표시가 바뀌어도 포커스를 옮기지 않는다 (패널 포커스를 빼앗지 않음)', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const view = await mountA(cmp())
    outside.focus()
    view.show(cmp({ location: B1 }))
    view.show(cmp({ location: B1, dong: { guCode: '28200', dongName: '구월3동' }, guide: null }))
    view.show(null)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('비교 중 지도 클릭은 onSelect로 넘기고(App이 B로 해석), interactive=false(B 분석 중)면 무시한다', async () => {
    const onSelect = vi.fn()
    const view = await mount(props({ selected: A, dong: A_DONG, compare: cmp(), onSelect }))
    const click = listeners.find((l) => l.target === view.map && l.type === 'click')!.handler as unknown as (e: unknown) => void
    click({ coord: new FakeLatLng(37.4475004, 126.7015004) })
    expect(onSelect).toHaveBeenCalledWith({ lat: 37.4475, lng: 126.7015 })

    view.rerender(<MapView {...props({ selected: A, dong: A_DONG, compare: cmp({ location: B1, guide: 'B 위치 분석 중…' }), onSelect, interactive: false })} />)
    expect(screen.getByText('B 위치 분석 중…')).toBeInTheDocument()
    onSelect.mockClear()
    click({ coord: new FakeLatLng(37.39, 126.63) })
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('MapView — 비교 중 선택한 점포 막대 (5차-B5)', () => {
  const STORES: MapStore[] = [
    { id: 'a', name: '라네이즈PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 },
  ]

  it('막대에 기준 위치(storeContext)를 상호 앞에 붙이고, 막대가 있으면 지도에 map--store-active를 단다', async () => {
    const view = await mount(props({ stores: STORES }))
    expect(view.section).not.toHaveClass('map--store-active')
    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: 'a', storeContext: 'B 구월3동 주변' })} />)
    const bar = screen.getByRole('group', { name: '선택한 점포' })
    expect(bar).toHaveTextContent('B 구월3동 주변 · 라네이즈PC방')
    expect(view.section).toHaveClass('map--store-active')
    expect(screen.getByRole('button', { name: '정보창 닫기' })).toBeInTheDocument()

    view.rerender(<MapView {...props({ stores: STORES, activeStoreId: null, storeContext: 'B 구월3동 주변' })} />)
    expect(view.section).not.toHaveClass('map--store-active')
  })

  it('storeContext가 없으면(단일 분석) 막대는 상호만', async () => {
    await mount(props({ stores: STORES, activeStoreId: 'a' }))
    expect(screen.getByRole('group', { name: '선택한 점포' }).querySelector('.map__store-bar-name')).toHaveTextContent(/^라네이즈PC방$/)
  })
})

describe('MapView — SDK 상태 보고 onSdkState (7-B1, docs/ADDRESS_DESIGN.md §5.1)', () => {
  const fakeService = { geocode: () => {}, reverseGeocode: () => {}, Status: { OK: 200, ERROR: 500 } }
  const script = () => document.getElementById(NAVER_SCRIPT_ID)!

  /** 실제 첫 로드 경로(script 삽입 → load → callback)로 마운트한다. beforeEach의 미리 로드된 SDK는 치운다 */
  async function mountFresh(onSdkState: Mock) {
    delete window.naver
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'test-client-id')
    const view = render(<MapView {...props({ onSdkState })} />)
    expect(script()).toBeTruthy()
    window.naver = { maps: fakeSdk }
    script().dispatchEvent(new Event('load'))
    await waitFor(() => expect(observed).toHaveLength(1))
    return view
  }

  it('지도 준비(ready, geocoder loading) → callback 뒤 geocoder ready. 지도는 callback 전에도 동작한다', async () => {
    const onSdkState = vi.fn()
    await mountFresh(onSdkState)
    expect(onSdkState).toHaveBeenLastCalledWith({ status: 'ready', api: fakeSdk, geocoder: 'loading' })
    expect(maps).toHaveLength(1)
    window.naver = { maps: { ...fakeSdk, Service: fakeService } as unknown as NaverMapsApi }
    window.__naverMapsReady!()
    expect(onSdkState).toHaveBeenLastCalledWith({ status: 'ready', api: fakeSdk, geocoder: 'ready' })
    expect(onSdkState).toHaveBeenCalledTimes(2)
    expect(maps).toHaveLength(1)                                      // 지도를 다시 만들지 않는다
  })

  it('callback이 왔지만 Service가 없으면 geocoder unavailable — 지도는 그대로', async () => {
    const onSdkState = vi.fn()
    await mountFresh(onSdkState)
    window.__naverMapsReady!()
    expect(onSdkState).toHaveBeenLastCalledWith({ status: 'ready', api: fakeSdk, geocoder: 'unavailable' })
    expect(maps).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('뒤늦은 인증 실패 뒤에 온 callback은 상태를 ready로 되돌리지 못한다', async () => {
    const onSdkState = vi.fn()
    await mountFresh(onSdkState)
    window.navermap_authFailure!()
    expect(onSdkState).toHaveBeenLastCalledWith({ status: 'failed', kind: 'auth' })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    const calls = onSdkState.mock.calls.length
    window.naver = { maps: { ...fakeSdk, Service: fakeService } as unknown as NaverMapsApi }
    window.__naverMapsReady!()
    expect(onSdkState).toHaveBeenCalledTimes(calls)
    expect(onSdkState.mock.calls.at(-1)![0]).toEqual({ status: 'failed', kind: 'auth' })
  })

  it('이미 로드된 SDK에 Service가 있으면 바로 ready·geocoder ready', async () => {
    window.naver = { maps: { ...fakeSdk, Service: fakeService } as unknown as NaverMapsApi }
    const onSdkState = vi.fn()
    await mount(props({ onSdkState }))
    expect(onSdkState).toHaveBeenCalledExactlyOnceWith({ status: 'ready', api: window.naver.maps, geocoder: 'ready' })
  })

  it('언마운트 뒤에는 알리지 않는다 (구독 해제)', async () => {
    const onSdkState = vi.fn()
    const view = await mountFresh(onSdkState)
    view.unmount()
    const calls = onSdkState.mock.calls.length
    window.naver = { maps: { ...fakeSdk, Service: fakeService } as unknown as NaverMapsApi }
    window.__naverMapsReady!()
    expect(onSdkState).toHaveBeenCalledTimes(calls)
  })

  it('지도 로드 실패(config)는 failed로 알린다', async () => {
    delete window.naver
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '')
    const onSdkState = vi.fn()
    render(<MapView {...props({ onSdkState })} />)
    await waitFor(() => expect(onSdkState).toHaveBeenCalledWith({ status: 'failed', kind: 'config' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('MapView — 8-B1 맞춤은 단일 전용: 비교 진입·정보창 (Codex 검수 회귀)', () => {
  const A = { lat: 37.4894, lng: 126.7246 }
  const PICKING: MapCompare = { location: null, tone: 'selected', dong: null, guide: 'B 위치를 고르세요 · A: 부평구 부평1동' }
  const STORES: MapStore[] = [{ id: 'a', name: '라네이즈PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 }]
  const idleListeners = () => listeners.filter((l) => l.type === 'idle' && l.target === maps[0])

  it('숨김 중 미룬 단일 맞춤: 비교 시작과 지도 표시(layoutKey=map)가 같은 렌더여도 맞추지 않는다', async () => {
    const view = await mount(props({ selected: A, layoutKey: 'panel' }), null)
    expect(view.map.setZoom).not.toHaveBeenCalled()                    // 0×0: 단일 auto 맞춤 대기
    layout.set(view.section, { w: 375, h: 566 })
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'map', compare: PICKING })} />)
    resize()
    expect(view.map.setSize).toHaveBeenLastCalledWith(new FakeSize(375, 566))
    expect(view.map.setZoom).not.toHaveBeenCalled()
    expect(view.map.setCenter).not.toHaveBeenCalled()
    expect(view.map.panBy).not.toHaveBeenCalled()
  })

  it('비교 상태가 먼저 바뀌고 다른 렌더에서 지도를 보여도 맞추지 않는다', async () => {
    const view = await mount(props({ selected: A, layoutKey: 'panel' }), null)
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'panel', compare: PICKING })} />)
    layout.set(view.section, { w: 375, h: 566 })
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'map', compare: PICKING })} />)
    resize()
    expect(view.map.setZoom).not.toHaveBeenCalled()
  })

  it('init 대기 중 비교에 들어가면 init 뒤에도 맞추지 않는다', async () => {
    const view = await mount(props({ selected: A }), { w: 955, h: 365 }, { init: false })
    view.rerender(<MapView {...props({ selected: A, compare: PICKING })} />)
    fireMap('init')
    expect(view.map.getBounds).not.toHaveBeenCalled()
    expect(view.map.setZoom).not.toHaveBeenCalled()
  })

  it('비교 종료 뒤: 버려진 단일 대기 맞춤은 되살아나지 않고, 비교 종료(순위 6)로 A를 한 번만 맞춘다. "범위에 맞추기"·새 위치는 다시 동작', async () => {
    const view = await mount(props({ selected: A, layoutKey: 'panel' }), null)
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'panel', compare: PICKING })} />)
    layout.set(view.section, { w: 955, h: 365 })
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'map', compare: PICKING })} />)
    expect(view.map.setZoom).not.toHaveBeenCalled()                    // 비교 진입으로 단일 맞춤이 실행되지 않는다
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'map' })} />)            // 비교 종료 → A
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)                  // z11에서는 A 원이 작아 panTo로는 조건 미달 → 맞춤 1회
    expect(singleDone(view.map, A)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '범위에 맞추기' }))
    expect(view.map.setZoom).toHaveBeenCalledTimes(2)
    view.rerender(<MapView {...props({ selected: { lat: 37.4482, lng: 126.7035 }, layoutKey: 'map' })} />)
    expect(view.map.setZoom).toHaveBeenCalledTimes(3)
  })

  it('비교 중 점포 선택도 정보창 배치를 쓴다(8-B2: A·B 핀 기준) — 기본 위치로 다시 열고 이동이 끝난 뒤(idle) 잰다', async () => {
    const view = await mount(props({ selected: A, compare: PICKING, stores: STORES }))
    const idle = idleListeners().length
    view.rerender(<MapView {...props({ selected: A, compare: PICKING, stores: STORES, activeStoreId: 'a' })} />)
    expect(infos[0]!.open).toHaveBeenCalledTimes(1)
    expect(infos[0]!.setOptions).toHaveBeenCalledWith({ pixelOffset: new FakePoint(0, 0), disableAnchor: false, anchorSkew: false })
    expect(idleListeners()).toHaveLength(idle + 1)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4888, 126.7235))
  })

  it('단일 점포 선택은 기본 위치로 다시 열고 이동이 끝난 뒤(idle) 배치를 잰다', async () => {
    const view = await mount(props({ selected: A, stores: STORES }))
    const idle = idleListeners().length
    view.rerender(<MapView {...props({ selected: A, stores: STORES, activeStoreId: 'a' })} />)
    expect(infos[0]!.setOptions).toHaveBeenCalledWith({ pixelOffset: new FakePoint(0, 0), disableAnchor: false, anchorSkew: false })
    expect(idleListeners()).toHaveLength(idle + 1)
  })
})

describe('MapView — 비교 지도 맞춤 (8-B2, D-022 순위 1·5·6·7·8)', () => {
  const A = { lat: 37.4894, lng: 126.7246 }
  const B1 = { lat: 37.4475, lng: 126.7015 }
  const B2 = { lat: 37.392512, lng: 126.639034 }
  const GUIDE = 'B 위치를 고르세요 · A: 부평구 부평1동'
  const cmp = (over: Partial<MapCompare> = {}): MapCompare => ({ location: null, tone: 'selected', dong: null, guide: GUIDE, ...over })
  const STORES: MapStore[] = [{ id: 'a', name: '라네이즈PC방', address: '인천 부평구 1', distance: '직선거리 115m', lat: 37.4888, lng: 126.7235 }]
  const NEAR = { lat: A.lat - 0.012, lng: A.lng + 0.008 }           // 약 1.6km
  const FAR_WEST = { lat: A.lat, lng: A.lng - 0.2 }                  // 약 17.7km 서쪽: 함께 맞춘 zoom이 12
  /** 실제 흐름처럼 단일 A를 맞춘 뒤(순위 2) 비교를 시작한다 */
  const start = async (renderMode?: number) => {
    const view = await mount(props({ selected: A }), undefined, { init: false })
    if (renderMode) view.map.renderMode = renderMode
    fireMap('init')
    view.rerender(<MapView {...props({ selected: A })} />)
    expect(singleDone(view.map, A)).toBe(true)
    view.map.setZoom.mockClear()
    view.map.setCenter.mockClear()
    view.map.panTo.mockClear()
    view.map.panBy.mockClear()
    view.rerender(<MapView {...props({ selected: A, compare: cmp() })} />)
    return view
  }
  const show = (view: Awaited<ReturnType<typeof mount>>, compare: MapCompare | null, over: Partial<MapViewProps> = {}) =>
    view.rerender(<MapView {...props({ selected: A, compare, ...over })} />)

  it('가까운 B는 A∪B를 맞추고, 버튼 "두 위치 모두 보기"가 보인다', async () => {
    const view = await start()
    expect(screen.queryByRole('button', { name: '두 위치 모두 보기' })).not.toBeInTheDocument()   // B 전에는 없다
    show(view, cmp({ location: NEAR }))
    expect(compareDone(view.map, A, NEAR)).toBe('union')
    expect(screen.getByRole('button', { name: '두 위치 모두 보기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '범위에 맞추기' })).not.toBeInTheDocument()
  })

  it('A 단일 맞춤 없이(mobile: 숨긴 채 A 선택 → 바로 비교) 넓은 기본 zoom에서 고른 가까운 B도 A∪B로 맞춘다(작은 두 원 ⊂ U는 완료가 아님)', async () => {
    const view = await mount(props({ selected: A, layoutKey: 'panel' }), null)
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'panel', compare: cmp() })} />)
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'panel', compare: cmp({ location: NEAR }) })} />)
    expect(view.map.setZoom).not.toHaveBeenCalled()
    layout.set(view.section, { w: 375, h: 566 })
    view.rerender(<MapView {...props({ selected: A, layoutKey: 'map', compare: cmp({ location: NEAR }) })} />)
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    expect(view.map.zoom).toBeGreaterThan(11)
    expect(compareDone(view.map, A, NEAR)).toBe('union')
  })

  it('먼 B는 B 원만 맞추고, "두 위치 모두 보기"를 누르면 기준 zoom 미만이어도 두 원을 모두 넣는다(순위 1)', async () => {
    const view = await start()
    show(view, cmp({ location: B2 }))
    expect(compareDone(view.map, A, B2)).toBe('B')
    fireMap('zooming')                                                  // 잠가도 버튼은 맞춘다
    fireEvent.click(screen.getByRole('button', { name: '두 위치 모두 보기' }))
    const v = viewOf(view.map)
    expect(insideUsable(v.rectOf(A), v.u) && insideUsable(v.rectOf(B2), v.u)).toBe(true)
  })

  it('기준 zoom 13은 래스터 기준: 래스터 z12에서 함께 들어가는 B는 B만 맞춘다', async () => {
    const raster = await start()
    show(raster, cmp({ location: FAR_WEST }))
    expect(compareDone(raster.map, A, FAR_WEST)).toBe('B')
  })

  it('GL(renderMode 2)은 같은 축척에서 zoom이 1 낮으므로 같은 B를 A∪B로 맞춘다(z12 → 래스터 13)', async () => {
    const gl = await start(2)
    show(gl, cmp({ location: FAR_WEST }))
    expect(gl.map.zoom).toBe(12)
    expect(compareDone(gl.map, A, FAR_WEST)).toBe('union')
  })

  it('점포 기준 A↔B 전환(순위 6): 조건을 만족하면 panTo, 아니면 맞춤, 잠금 중이면 panTo만. 처음 생기는 기준(null→A)은 움직이지 않는다', async () => {
    const view = await start()
    show(view, cmp({ location: B2 }))                                   // 먼 B: B 원 맞춤(단일 조건 만족 zoom)
    const zooms = view.map.setZoom.mock.calls.length
    const pans = view.map.panTo.mock.calls.length
    show(view, cmp({ location: B2, focus: 'B' }))                       // null → B: 이동 없음
    expect(view.map.setZoom.mock.calls.length).toBe(zooms)
    expect(view.map.panTo.mock.calls.length).toBe(pans)

    show(view, cmp({ location: B2, focus: 'A' }))                       // 같은 zoom에서 A도 조건 만족 → panTo
    expect(view.map.setZoom.mock.calls.length).toBe(zooms)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(A.lat, A.lng))
    expect(singleDone(view.map, A)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '두 위치 모두 보기' }))   // 작게 만든 뒤
    const small = view.map.setZoom.mock.calls.length
    show(view, cmp({ location: B2, focus: 'B' }))                       // 조건 미달 → 맞춤
    expect(view.map.setZoom.mock.calls.length).toBe(small + 1)
    expect(singleDone(view.map, B2)).toBe(true)

    fireMap('dragstart')                                                // 사용자가 직접 조정 → 잠금
    fireEvent.click(screen.getByRole('button', { name: '두 위치 모두 보기' }))
    fireMap('zooming')
    const locked = view.map.setZoom.mock.calls.length
    show(view, cmp({ location: B2, focus: 'A' }))
    expect(view.map.setZoom.mock.calls.length).toBe(locked)            // panTo만
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(A.lat, A.lng))
  })

  it('숨김 중 B 선택은 미뤘다가 돌아오면 한 번만 맞추고, 숨김 중 비교를 끝내면 B 맞춤은 버리고 A만 맞춘다', async () => {
    const view = await start()
    layout.set(view.section, { w: 0, h: 0 })
    resize()
    show(view, cmp({ location: NEAR }))
    expect(view.map.setZoom).not.toHaveBeenCalled()
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)
    expect(compareDone(view.map, A, NEAR)).toBe('union')
    resize()
    expect(view.map.setZoom).toHaveBeenCalledTimes(1)                  // 다시 돌지 않는다

    layout.set(view.section, { w: 0, h: 0 })
    resize()
    show(view, cmp({ location: B2 }))                                   // 대기: b-select
    show(view, null)                                                    // 숨김 중 비교 종료 → 대기는 A로
    const centers = view.map.setCenter.mock.calls.length
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect(view.map.setCenter.mock.calls.slice(centers).every(([c]) => (c as FakeLatLng).lat() === A.lat)).toBe(true)
    expect(singleDone(view.map, A)).toBe(true)
  })

  it('숨김 중 미룬 B 맞춤은 그 사이 사용자가 잠그면(zooming) 지도 복귀 때 실행하지 않는다(순위 4, 검수 회귀)', async () => {
    const view = await start()
    layout.set(view.section, { w: 0, h: 0 })
    resize()
    show(view, cmp({ location: NEAR }))                                 // 대기: b-select
    fireMap('zooming')                                                  // 사용자 조작 → 잠금
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect(view.map.setZoom).not.toHaveBeenCalled()
    expect(view.map.setCenter).not.toHaveBeenCalled()
    expect(view.map.panBy).not.toHaveBeenCalled()
  })

  it('숨김 중 기준 B→A 전환 뒤 B를 다시 고르면(B 지움) 미룬 A 이동을 버린다(검수 회귀)', async () => {
    const view = await start()
    show(view, cmp({ location: B2 }))
    show(view, cmp({ location: B2, focus: 'B' }))                       // 분석 완료: 기준 생김(이동 없음)
    layout.set(view.section, { w: 0, h: 0 })
    resize()
    show(view, cmp({ location: B2, focus: 'A' }))                       // 대기: focus A
    show(view, cmp({ location: null, focus: null }))                    // B 다시 고르기
    const calls = [view.map.setZoom, view.map.setCenter, view.map.panTo, view.map.panBy].map((f) => f.mock.calls.length)
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    expect([view.map.setZoom, view.map.setCenter, view.map.panTo, view.map.panBy].map((f) => f.mock.calls.length)).toEqual(calls)
  })

  it('숨김 중 기준 전환 대기는 기준이 다시 바뀌면 새 기준으로만 실행한다(B→A→B: A 이동 없음)', async () => {
    const view = await start()
    show(view, cmp({ location: B2 }))
    show(view, cmp({ location: B2, focus: 'B' }))
    layout.set(view.section, { w: 0, h: 0 })
    resize()
    show(view, cmp({ location: B2, focus: 'A' }))
    show(view, cmp({ location: B2, focus: 'B' }))
    layout.set(view.section, { w: 375, h: 566 })
    resize()
    const targets = [...view.map.setCenter.mock.calls, ...view.map.panTo.mock.calls].map(([c]) => (c as FakeLatLng).lat())
    expect(targets).not.toContain(A.lat)
    expect(singleDone(view.map, B2)).toBe(true)
  })

  it('비교 중 크기 변경·점포 선택 20번 반복에도 zoom은 그대로(순위 8)', async () => {
    const view = await start()
    show(view, cmp({ location: B1 }), { stores: STORES })
    const zooms = view.map.setZoom.mock.calls.length
    const z = view.map.zoom
    for (let i = 0; i < 20; i++) {
      layout.set(view.section, i % 2 ? { w: 955, h: 365 } : { w: 800, h: 600 })
      resize()
      show(view, cmp({ location: B1 }), { stores: STORES, activeStoreId: i % 2 ? 'a' : null })
    }
    expect(view.map.setZoom.mock.calls.length).toBe(zooms)
    expect(view.map.zoom).toBe(z)
  })
})

describe('MapView — 분석 반경 (8-D3, D-022 순위 3)', () => {
  const A = { lat: 37.4894, lng: 126.7246 }
  const B = { lat: 37.4475, lng: 126.7015 }
  const circles = () => vi.mocked(fakeSdk.Circle).mock.results.map((r) => r.value as { setRadius: Mock })
  const circleRadii = () => vi.mocked(fakeSdk.Circle).mock.calls.map(([o]) => (o as { radius: number }).radius)
  const cmp = (location: { lat: number; lng: number } | null): MapCompare => ({
    location,
    tone: 'selected',
    dong: null,
    guide: 'B 위치를 고르세요',
  })
  /** 원 하나가 단일 완료 조건(원 ⊂ U, 지름 ≥ U 짧은 변 절반)인지 — 반경 r 로 잰다 */
  const singleDoneAt = (map: FakeMap, p: { lat: number; lng: number }, r: number) => {
    const b = map.getBounds()
    const bounds = { s: b.getSW().lat(), n: b.getNE().lat(), w: b.getSW().lng(), e: b.getNE().lng() }
    const rect = boxToRect(circleBox(p.lat, p.lng, r), { bounds, w: map.size.w, h: map.size.h })
    const u = usableArea(map.size, [
      { x: map.size.w - 60, y: 10, w: 50, h: 79 },
      { x: map.size.w - 168, y: map.size.h - 27, w: 158, h: 17 },
    ])
    return satisfiesSingle(rect, u)
  }

  it('원은 radiusM 으로 만들고(생략하면 500), 범례에 그 반경을 쓴다', async () => {
    await mount(props({ selected: A, radiusM: 1000 }))
    expect(circleRadii()).toEqual([1000])
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('반경 1km')
  })

  it('반경을 바꾸면 있는 원의 반경을 바로 바꾸고, 잠금을 풀고 새 원에 맞춘다(새 위치와 같은 규칙)', async () => {
    const view = await mount(props({ selected: A, radiusM: 500 }))
    expect(singleDoneAt(view.map, A, 500)).toBe(true)
    fireMap('zooming')                                                  // 사용자 조작 → 잠금
    view.rerender(<MapView {...props({ selected: A, radiusM: 1000 })} />)
    expect(circles()[0]!.setRadius).toHaveBeenLastCalledWith(1000)
    expect(circleRadii()).toHaveLength(1)                               // 새로 만들지 않는다
    expect(singleDoneAt(view.map, A, 1000)).toBe(true)                  // 잠금이어도 반경 변경은 맞춘다(순위 3 > 7)
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('반경 1km')
  })

  it('같은 반경으로 다시 그리면 움직이지 않는다', async () => {
    const view = await mount(props({ selected: A, radiusM: 300 }))
    const zooms = view.map.setZoom.mock.calls.length
    view.rerender(<MapView {...props({ selected: A, radiusM: 300 })} />)
    expect(view.map.setZoom.mock.calls.length).toBe(zooms)
    expect(circles()[0]!.setRadius).not.toHaveBeenCalled()
  })

  it('비교 중이면 A·B 원을 모두 바꾸고 B 선택과 같은 규칙(순위 5)으로 맞춘다', async () => {
    const view = await mount(props({ selected: A, compare: cmp(B), radiusM: 500 }))
    view.rerender(<MapView {...props({ selected: A, compare: cmp(B), radiusM: 300 })} />)
    expect(circles()[0]!.setRadius).toHaveBeenLastCalledWith(300)
    expect(circles()[1]!.setRadius).toHaveBeenLastCalledWith(300)
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('A 반경 300m')
    expect(screen.getByRole('list', { name: '지도 범례' })).toHaveTextContent('B 반경 300m')
    expect(view.map.setZoom).toHaveBeenCalled()
  })
})

describe('MapView — A3 다크 지도 스타일과 밝은 지도 복구 (8-DK, DESIGN.md §19.3.1)', () => {
  const A = { lat: 37.4894, lng: 126.7246 }
  /** 스타일 요청 기록(PerformanceResourceTiming 대역). 지도를 만든 뒤에 시작한 것만 그 세대의 결과다 */
  let entries: { name: string; startTime: number; responseStatus?: number }[] = []
  let observerCallbacks: (() => void)[] = []
  const styleResponse = (status: number) => {
    entries.push({ name: 'https://oapi.map.naver.com/v3/styler/props?id=x', startTime: performance.now() + 1, responseStatus: status })
    act(() => observerCallbacks.forEach((cb) => cb()))
  }
  const fireOn = (map: FakeMap, type: string) =>
    act(() => listeners.filter((l) => l.type === type && l.target === map).forEach((l) => l.handler()))
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
  let visibility: DocumentVisibilityState = 'visible'

  beforeEach(() => {
    entries = []
    observerCallbacks = []
    visibility = 'visible'
    vi.mocked(fakeSdk.Circle).mockClear()
    vi.stubEnv('VITE_NAVER_MAP_STYLE_ID', 'test-style-id')
    // 대기 tick(setInterval)과 그리기 확인(requestAnimationFrame)만 가짜로 — SDK 로드 Promise·waitFor는 그대로
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.spyOn(performance, 'getEntriesByType').mockImplementation(() => entries as unknown as PerformanceEntryList)
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        constructor(cb: () => void) {
          observerCallbacks.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    delete document.documentElement.dataset.mapTone
  })

  /** 스타일 지도를 만든다(아직 내놓지 않음). 지도 영역은 보이는 크기 */
  async function mountStyled(p: Partial<MapViewProps> = {}, size: { w: number; h: number } | null = { w: 955, h: 365 }) {
    const onSdkState = vi.fn()
    const view = render(<MapView {...props({ onSdkState, ...p })} />)
    const section = view.container.querySelector<HTMLElement>('section.map')!
    if (size) layout.set(section, size)
    await act(async () => {})                                           // SDK 로드(이미 로드된 fake) → 지도 생성
    return { ...view, section, onSdkState }
  }

  it('스타일 ID가 있으면 GL + customStyleId로 만들고, init과 그 지도의 스타일 요청 200을 확인한 뒤에만 다크로 내놓는다', async () => {
    const view = await mountStyled({ selected: A })
    expect(maps).toHaveLength(1)
    expect(maps[0]!.options).toMatchObject({ gl: true, customStyleId: 'test-style-id', mapDataControl: true })
    // 판정 전: 지도를 내놓지 않는다(로딩 표시, 오버레이 없음, ready 알림 없음)
    expect(screen.getByText('지도를 불러오는 중…')).toBeInTheDocument()
    expect(fakeSdk.Circle).not.toHaveBeenCalled()
    expect(view.onSdkState).not.toHaveBeenCalled()

    styleResponse(200)
    fireOn(maps[0]!, 'init')
    expect(document.documentElement.dataset.mapTone).toBe('dark')
    expect(view.section.dataset.mapTone).toBe('dark')
    expect(view.section.dataset.renderMode).toBe('2')
    expect(screen.queryByText('지도를 불러오는 중…')).not.toBeInTheDocument()
    expect(fakeSdk.Circle).toHaveBeenCalled()                           // 선택 지점 반경 원을 이 지도에 그린다
    expect(view.onSdkState).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }))
    expect(maps).toHaveLength(1)
  })

  it('스타일 요청이 200이 아니면(잘못된 ID → 400) init을 기다리지 않고 지도를 정리한 뒤 밝은 지도를 한 번만 다시 만든다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = await mountStyled({ selected: A })
    const firstCanvas = view.section.querySelector('.map__canvas')
    styleResponse(400)
    expect(maps).toHaveLength(2)
    expect(maps[0]!.destroy).toHaveBeenCalled()
    expect(firstCanvas!.isConnected).toBe(false)                        // 실패한 지도 요소는 새 요소로 바꾼다
    expect(view.section.querySelectorAll('.map__canvas')).toHaveLength(1)
    expect(maps[1]!.options.gl).toBeUndefined()
    expect(maps[1]!.options.customStyleId).toBeUndefined()
    // 밝은 팔레트는 밝은 지도의 init 뒤에
    expect(document.documentElement.dataset.mapTone).toBeUndefined()
    fireOn(maps[1]!, 'init')
    expect(document.documentElement.dataset.mapTone).toBe('light')
    expect(fakeSdk.Circle).toHaveBeenCalled()
    // 이전 세대의 늦은 init·스타일 결과는 버린다
    fireOn(maps[0]!, 'init')
    styleResponse(200)
    expect(document.documentElement.dataset.mapTone).toBe('light')
    expect(maps).toHaveLength(2)
  })

  it('init은 왔지만 스타일 200을 확인하지 못하면(상태 미확인) 다크로 보지 않고 밝은 지도로 바꾼다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountStyled()
    fireOn(maps[0]!, 'init')
    expect(maps).toHaveLength(2)
    expect(document.documentElement.dataset.mapTone).toBeUndefined()
    fireOn(maps[1]!, 'init')
    expect(document.documentElement.dataset.mapTone).toBe('light')
  })

  it('스타일 지도 init 시간 초과(8초, 보이는 동안만)도 밝은 지도로 복구한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountStyled()
    tick(7_750)
    expect(maps).toHaveLength(1)
    tick(250)
    expect(maps).toHaveLength(2)
    expect(maps[0]!.destroy).toHaveBeenCalled()
  })

  it('문서가 숨겨진 동안은 세지 않고, 다시 보이면 8초를 처음부터 센다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountStyled()
    tick(5_000)
    visibility = 'hidden'
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    tick(30_000)
    expect(maps).toHaveLength(1)                                        // 숨김 중 조기 시간 초과 없음
    visibility = 'visible'
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    tick(7_750)
    expect(maps).toHaveLength(1)                                        // 숨기기 전 5초를 이어 세지 않는다
    tick(250)
    expect(maps).toHaveLength(2)
  })

  it('문서가 visible이어도 프레임을 그리지 않는 동안(앞에 나와 있지 않은 탭)은 세지 않는다 — GL init이 올 수 없으므로', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let pending: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    await mountStyled()
    tick(30_000)
    expect(maps).toHaveLength(1)                                        // 그리기가 멈춘 동안 조기 시간 초과 없음
    const painted = (ms: number) => {
      for (let t = 0; t < ms; t += 250) {
        const cb = pending
        pending = null
        cb?.(0)                                                         // 프레임 하나를 그렸다
        tick(250)
      }
    }
    painted(7_750)
    expect(maps).toHaveLength(1)
    painted(250)
    expect(maps).toHaveLength(2)
  })

  it('지도 영역이 0×0(mobile 패널 화면)이면 세지 않고, 보이면 그 크기로 setSize 한 뒤 센다', async () => {
    const view = await mountStyled({}, null)
    tick(20_000)
    expect(maps).toHaveLength(1)
    expect(maps[0]!.setSize).not.toHaveBeenCalled()
    layout.set(view.section, { w: 375, h: 400 })
    tick(250)
    expect(maps[0]!.setSize).toHaveBeenLastCalledWith(new FakeSize(375, 400))
    styleResponse(200)
    fireOn(maps[0]!, 'init')
    expect(document.documentElement.dataset.mapTone).toBe('dark')
  })

  it('밝은 대체 지도도 준비되지 않으면 지도 오류로 끝내고 다시 시도하지 않는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = await mountStyled()
    styleResponse(400)
    tick(8_000)
    expect(maps).toHaveLength(2)
    expect(maps[1]!.destroy).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('지도를 준비하지 못했습니다')
    expect(view.onSdkState).toHaveBeenLastCalledWith({ status: 'failed', kind: 'init' })
    tick(60_000)
    expect(maps).toHaveLength(2)
    expect(document.documentElement.dataset.mapTone).toBeUndefined()
  })

  it('언마운트하면 대기 타이머·지도를 정리하고 지도 톤을 지운다', async () => {
    const view = await mountStyled()
    view.unmount()
    expect(maps[0]!.destroy).toHaveBeenCalled()
    tick(60_000)
    expect(maps).toHaveLength(1)
    expect(document.documentElement.dataset.mapTone).toBeUndefined()
  })

  it('스타일 ID가 없으면 지금처럼 바로 밝은 지도로 내놓고, 저작권 표기를 로고·축척과 같은 오른쪽 아래에 켠다', async () => {
    vi.stubEnv('VITE_NAVER_MAP_STYLE_ID', '')
    const view = await mountStyled({ selected: A })
    expect(maps[0]!.options.gl).toBeUndefined()
    expect(maps[0]!.options.customStyleId).toBeUndefined()
    expect(maps[0]!.options).toMatchObject({ mapDataControl: true, mapDataControlOptions: { position: 'BOTTOM_RIGHT' } })
    expect(document.documentElement.dataset.mapTone).toBe('light')
    expect(view.onSdkState).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }))
    expect(fakeSdk.Circle).toHaveBeenCalled()
  })
})
