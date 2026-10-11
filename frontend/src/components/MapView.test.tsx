import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { resetNaverMapsLoaderForTest, type NaverMapsApi } from '../map/naverMaps.ts'
import { MapView, type MapStore, type MapViewProps } from './MapView.tsx'

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

let maps: FakeMap[] = []
class FakeMap {
  setSize = vi.fn()
  panTo = vi.fn()
  setZoom = vi.fn()
  getZoom = vi.fn(() => 11)
  destroy = vi.fn()
  constructor() {
    maps.push(this)
  }
}
// SDK 오버레이는 `new`로 만든다 — 화살표 함수가 아닌 생성 가능한 함수
const overlay = function () {
  return { setMap: vi.fn(), setPosition: vi.fn(), setIcon: vi.fn(), setCenter: vi.fn() }
}
type FakeInfo = { open: Mock; close: Mock; setContent: Mock; content: HTMLElement }
let infos: FakeInfo[] = []
const infoWindow = function (opts: { content: HTMLElement }) {
  const info: FakeInfo = { open: vi.fn(), close: vi.fn(), setContent: vi.fn(), content: opts.content }
  info.setContent.mockImplementation((c: HTMLElement) => (info.content = c))
  infos.push(info)
  return info
}
// 마커 click 리스너를 잡아 두고 테스트에서 부른다
let listeners: { target: unknown; type: string; handler: () => void }[] = []

const fakeSdk = {
  Map: FakeMap,
  LatLng: FakeLatLng,
  Point: class {},
  Size: FakeSize,
  Marker: vi.fn(overlay),
  Circle: vi.fn(overlay),
  Polygon: vi.fn(overlay),
  InfoWindow: vi.fn(infoWindow),
  Position: { TOP_RIGHT: 'TOP_RIGHT' },
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
        resize = cb
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

async function mount(p: MapViewProps) {
  const view = render(<MapView {...p} />)
  // SDK 로드는 비동기 — 지도가 만들어지고 effect가 걸린 뒤(ResizeObserver 관찰 시작)부터 본다
  await waitFor(() => expect(observed).toHaveLength(1))
  return { ...view, map: maps[0]!, section: view.container.querySelector('section.map')! }
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
    const { map } = await mount(props())
    map.setSize.mockClear()
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

describe('MapView — 선택 위치로 이동 (B1)', () => {
  it('selected가 바뀌면 그 좌표로 panTo 하고 zoom은 바꾸지 않는다', async () => {
    const view = await mount(props())
    expect(view.map.panTo).not.toHaveBeenCalled()

    view.rerender(<MapView {...props({ selected: { lat: 37.4894, lng: 126.7246 } })} />)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4894, 126.7246))

    // 좌표 직접 입력으로 다른 위치 → 다시 이동
    view.rerender(<MapView {...props({ selected: { lat: 37.4482, lng: 126.7035 } })} />)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(37.4482, 126.7035))
    expect(view.map.panTo).toHaveBeenCalledTimes(2)
    expect(view.map.setZoom).not.toHaveBeenCalled()
  })

  it('분석 불가 지점(invalid)도 이동하고, 같은 좌표에서 tone·결과만 바뀌면 다시 이동하지 않는다', async () => {
    const outside = { lat: 37.5663, lng: 126.9779 }
    const view = await mount(props({ selected: outside }))
    expect(view.map.panTo).toHaveBeenCalledTimes(1)
    expect(view.map.panTo).toHaveBeenLastCalledWith(new FakeLatLng(outside.lat, outside.lng))

    // 사용자가 지도를 옮겨 둔 뒤 오류 응답(회색 마커)이 와도 같은 지점이면 끌어당기지 않는다
    view.rerender(<MapView {...props({ selected: { ...outside }, markerTone: 'invalid' })} />)
    expect(view.map.panTo).toHaveBeenCalledTimes(1)
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
