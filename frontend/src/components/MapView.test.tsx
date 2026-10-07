import { cleanup, render, waitFor } from '@testing-library/react'
import { resetNaverMapsLoaderForTest, type NaverMapsApi } from '../map/naverMaps.ts'
import { MapView, type MapViewProps } from './MapView.tsx'

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

const fakeSdk = {
  Map: FakeMap,
  LatLng: FakeLatLng,
  Point: class {},
  Size: FakeSize,
  Marker: vi.fn(overlay),
  Circle: vi.fn(overlay),
  Polygon: vi.fn(overlay),
  Position: { TOP_RIGHT: 'TOP_RIGHT' },
  Event: { addListener: vi.fn(() => ({})), removeListener: vi.fn() },
} as unknown as NaverMapsApi

// jsdom에는 ResizeObserver·레이아웃이 없다 — 관찰 대상과 콜백을 잡아 두고 크기는 직접 정한다
let observed: Element[] = []
let resize: () => void = () => {}
const layout = new Map<Element, { w: number; h: number }>()

beforeEach(() => {
  maps = []
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
