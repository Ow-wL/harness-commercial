import { act, configure, renderHook } from '@testing-library/react'
import reverseFixture from '../fixtures/geocoder-reverse-bupyeong-station.json'
import type { NaverMapsApi, NaverServiceCallback, SdkState } from '../map/naverMaps.ts'
import { resetAddressCacheForTest } from './addressCache.ts'
import { useReferenceAddress } from './useReferenceAddress.ts'

type Call = { options: Record<string, unknown>; callback: NaverServiceCallback }
let calls: Call[] = []
const api = {
  Service: {
    Status: { OK: 200, ERROR: 500 },
    geocode: vi.fn(),
    reverseGeocode: vi.fn((options: Record<string, unknown>, callback: NaverServiceCallback) => {
      calls.push({ options, callback })
    }),
  },
} as unknown as NaverMapsApi

const ready: SdkState = { status: 'ready', api, geocoder: 'ready' }
const geocoderLoading: SdkState = { status: 'ready', api, geocoder: 'loading' }
const unavailable: SdkState = { status: 'ready', api, geocoder: 'unavailable' }
const failed: SdkState = { status: 'failed', kind: 'auth' }
const loading: SdkState = { status: 'loading' }
const OK_RESPONSE = reverseFixture.response
const EXPECTED = { roadAddress: '인천광역시 부평구 광장로 16 부평민자역사', jibunAddress: '인천광역시 부평구 부평동 738-21' }
const P1 = { lat: 37.4894, lng: 126.7246 }
const P2 = { lat: 37.4563, lng: 126.7052 }

/** 잡아 둔 콜백으로 응답을 보내고 React 갱신을 기다린다 */
async function respond(call: Call | undefined, status: number, response?: unknown) {
  await act(async () => {
    call?.callback(status, response)
    await Promise.resolve()
  })
}

beforeEach(() => {
  calls = []
  resetAddressCacheForTest()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  configure({ reactStrictMode: false })
})

describe('useReferenceAddress', () => {
  it('ready + geocoder ready + 좌표가 있을 때만 조회하고, 성공하면 주소를 돌려준다', async () => {
    const { result } = renderHook(() => useReferenceAddress(ready, P1))
    expect(result.current).toBeNull()                           // 로딩 중: 줄 없음
    expect(calls).toHaveLength(1)
    await respond(calls[0], 200, OK_RESPONSE)
    expect(result.current).toEqual(EXPECTED)
  })

  it.each([
    ['loading', loading],
    ['geocoder loading', geocoderLoading],
    ['geocoder unavailable', unavailable],
    ['failed(auth)', failed],
  ])('SDK가 %s이면 조회하지 않고 null', (_label, sdk) => {
    const { result } = renderHook(() => useReferenceAddress(sdk, P1))
    expect(result.current).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('좌표가 없으면 조회하지 않는다', () => {
    const { result } = renderHook(() => useReferenceAddress(ready, null))
    expect(result.current).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('같은 좌표를 담은 새 객체로 다시 그려도 재조회하지 않는다 (키는 좌표 숫자 그대로)', async () => {
    const { result, rerender } = renderHook(({ p }) => useReferenceAddress(ready, p), { initialProps: { p: { ...P1 } } })
    await respond(calls[0], 200, OK_RESPONSE)
    rerender({ p: { ...P1 } })
    rerender({ p: { lat: 37.4894, lng: 126.7246 } })
    expect(result.current).toEqual(EXPECTED)
    expect(calls).toHaveLength(1)
  })

  it('캐시된 좌표는 마운트 즉시 보이고 조회가 없다 (분석 전 → 분석 후 같은 좌표)', async () => {
    const first = renderHook(() => useReferenceAddress(ready, P1))
    await respond(calls[0], 200, OK_RESPONSE)
    first.unmount()
    const second = renderHook(() => useReferenceAddress(ready, { lat: 37.4894, lng: 126.7246 }))
    expect(second.result.current).toEqual(EXPECTED)
    expect(calls).toHaveLength(1)
  })

  it('좌표가 바뀌면 첫 렌더부터 이전 주소가 사라지고, 이전 좌표의 늦은 응답은 화면에 오지 않는다', async () => {
    const { result, rerender } = renderHook(({ p }) => useReferenceAddress(ready, p), { initialProps: { p: P1 } })
    rerender({ p: P2 })                                          // P1 응답이 오기 전에 좌표 변경
    expect(result.current).toBeNull()
    expect(calls).toHaveLength(2)
    await respond(calls[0], 200, OK_RESPONSE)                    // P1의 늦은 응답
    expect(result.current).toBeNull()                            // 현재 키(P2)가 아니므로 표시 안 함
    await respond(calls[1], 200, { v2: { status: { code: 0, name: 'ok', message: 'done' }, address: { roadAddress: '인천광역시 남동구 정각로 29', jibunAddress: '' } } })
    expect(result.current).toEqual({ roadAddress: '인천광역시 남동구 정각로 29', jibunAddress: null })
    // P1로 돌아가면 캐시에서 바로(조회 없음)
    rerender({ p: P1 })
    expect(result.current).toEqual(EXPECTED)
    expect(calls).toHaveLength(2)
  })

  it('표시 중 SDK가 failed가 되면 캐시된 주소도 숨기고, 그 뒤 온 응답도 다시 보이지 않는다', async () => {
    const { result, rerender } = renderHook(({ sdk, p }: { sdk: SdkState; p: { lat: number; lng: number } }) => useReferenceAddress(sdk, p), {
      initialProps: { sdk: ready as SdkState, p: P1 },   // const 선언의 좁힘(ready 멤버)이 Props 추론에 번지지 않게
    })
    await respond(calls[0], 200, OK_RESPONSE)
    expect(result.current).toEqual(EXPECTED)
    rerender({ sdk: failed, p: P1 })
    expect(result.current).toBeNull()
    // 진행 중이던 다른 좌표 응답이 failed 뒤에 와도 화면은 null, 새 조회도 없다
    rerender({ sdk: failed, p: P2 })
    expect(calls).toHaveLength(1)
    expect(result.current).toBeNull()
  })

  it('실패·주소 없음은 null이고 같은 좌표를 다시 그려도 바로 재조회하지 않는다', async () => {
    const { result, rerender } = renderHook(({ p }) => useReferenceAddress(ready, p), { initialProps: { p: P1 } })
    await respond(calls[0], 500, undefined)                      // unknown → error 캐시(60초)
    expect(result.current).toBeNull()
    rerender({ p: { ...P1 } })
    expect(calls).toHaveLength(1)
    const none = renderHook(() => useReferenceAddress(ready, P2))
    await respond(calls[1], 200, { v2: { status: { code: 3, name: 'no results', message: '' }, results: [] } })
    expect(none.result.current).toBeNull()
  })

  it('StrictMode(effect 두 번)와 여러 자리에서 같은 좌표는 조회 1회', async () => {
    configure({ reactStrictMode: true })
    const a = renderHook(() => useReferenceAddress(ready, P1))
    const b = renderHook(() => useReferenceAddress(ready, { ...P1 }))
    expect(calls).toHaveLength(1)
    await respond(calls[0], 200, OK_RESPONSE)
    expect(a.result.current).toEqual(EXPECTED)
    expect(b.result.current).toEqual(EXPECTED)
  })

  it('언마운트 뒤 늦은 응답은 캐시에만 남고 오류 없이 끝난다', async () => {
    const { unmount } = renderHook(() => useReferenceAddress(ready, P1))
    unmount()
    await respond(calls[0], 200, OK_RESPONSE)
    const again = renderHook(() => useReferenceAddress(ready, P1))
    expect(again.result.current).toEqual(EXPECTED)
    expect(calls).toHaveLength(1)
  })
})
