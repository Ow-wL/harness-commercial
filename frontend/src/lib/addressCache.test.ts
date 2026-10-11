import reverseFixture from '../fixtures/geocoder-reverse-bupyeong-station.json'
import type { NaverMapsApi, NaverServiceCallback } from '../map/naverMaps.ts'
import {
  ADDRESS_CACHE_MAX,
  ADDRESS_ERROR_TTL_MS,
  addressCacheSizeForTest,
  addressKey,
  lookupAddress,
  peekAddress,
  resetAddressCacheForTest,
} from './addressCache.ts'

/** SDK Service mock: 콜백을 잡아 두고 테스트가 응답을 보낸다 */
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

const okResponse = reverseFixture.response
const noneResponse = { v2: { status: { code: 3, name: 'no results', message: '' }, results: [] } }
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  calls = []
  resetAddressCacheForTest()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('addressKey', () => {
  it('좌표 숫자를 그대로 쓴다 — 반올림·자릿수 정리 없음', () => {
    expect(addressKey({ lat: 37.4894, lng: 126.7246 })).toBe('37.4894,126.7246')
    expect(addressKey({ lat: 37.489400001, lng: 126.7246 })).toBe('37.489400001,126.7246')
    expect(addressKey({ lat: 37.4894, lng: 126.7246 })).not.toBe(addressKey({ lat: 37.48940001, lng: 126.7246 }))
  })
})

describe('lookupAddress', () => {
  it('처음은 SDK를 1회 부르고 ok를 기록한다. 같은 좌표(새 객체)는 다시 부르지 않는다', async () => {
    const p = lookupAddress(api, { lat: 37.4894, lng: 126.7246 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toEqual({ coords: '126.7246,37.4894', orders: 'roadaddr,addr' })
    calls[0]!.callback(200, okResponse)
    await expect(p).resolves.toEqual({ status: 'ok', roadAddress: '인천광역시 부평구 광장로 16 부평민자역사', jibunAddress: '인천광역시 부평구 부평동 738-21' })
    await expect(lookupAddress(api, { lat: 37.4894, lng: 126.7246 })).resolves.toMatchObject({ status: 'ok' })
    expect(calls).toHaveLength(1)
    expect(peekAddress('37.4894,126.7246')).toMatchObject({ status: 'ok' })
  })

  it('같은 좌표의 진행 중 조회는 Promise를 공유한다 (여러 자리·StrictMode → 호출 1회)', async () => {
    const a = lookupAddress(api, { lat: 37.4894, lng: 126.7246 })
    const b = lookupAddress(api, { lat: 37.4894, lng: 126.7246 })
    expect(b).toBe(a)
    expect(calls).toHaveLength(1)
    calls[0]!.callback(200, okResponse)
    await expect(Promise.all([a, b])).resolves.toHaveLength(2)
  })

  it('none은 세션 동안 유지한다 (다시 부르지 않음)', async () => {
    const p = lookupAddress(api, { lat: 37.4, lng: 126.3 })
    calls[0]!.callback(200, noneResponse)
    await expect(p).resolves.toEqual({ status: 'none' })
    await expect(lookupAddress(api, { lat: 37.4, lng: 126.3 })).resolves.toEqual({ status: 'none' })
    expect(calls).toHaveLength(1)
  })

  it('error는 60초까지 재사용하고, 만료 뒤 다음 조회 때만 다시 부른다 (타이머 없음)', async () => {
    let now = 1_000_000
    const clock = () => now
    const p = lookupAddress(api, { lat: 37.4, lng: 126.3 }, clock)
    calls[0]!.callback(500, undefined)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'unknown', expiresAt: now + ADDRESS_ERROR_TTL_MS })
    now += ADDRESS_ERROR_TTL_MS - 1
    await expect(lookupAddress(api, { lat: 37.4, lng: 126.3 }, clock)).resolves.toMatchObject({ status: 'error' })
    expect(calls).toHaveLength(1)                              // 만료 전: 재사용, 호출 없음
    now += 1
    expect(peekAddress('37.4,126.3', now)).toBeUndefined()       // 만료: 없는 것으로
    const retry = lookupAddress(api, { lat: 37.4, lng: 126.3 }, clock)
    expect(calls).toHaveLength(2)                              // 다음 조회 때 1회 다시
    calls[1]!.callback(200, okResponse)
    await expect(retry).resolves.toMatchObject({ status: 'ok' })
  })

  it('늦게 온 응답은 자기 좌표 키에만 기록된다', async () => {
    const a = lookupAddress(api, { lat: 37.1, lng: 126.1 })
    const b = lookupAddress(api, { lat: 37.2, lng: 126.2 })
    calls[1]!.callback(200, okResponse)                        // 두 번째 좌표가 먼저 온다
    await b
    expect(peekAddress('37.2,126.2')).toMatchObject({ status: 'ok' })
    expect(peekAddress('37.1,126.1')).toBeUndefined()
    calls[0]!.callback(200, noneResponse)
    await a
    expect(peekAddress('37.1,126.1')).toEqual({ status: 'none' })
    expect(peekAddress('37.2,126.2')).toMatchObject({ status: 'ok' })
  })

  it('완료 결과는 LRU 100개 — 넘치면 가장 오래 안 쓴 것부터 버린다', async () => {
    for (let i = 0; i < ADDRESS_CACHE_MAX; i++) {
      const p = lookupAddress(api, { lat: 37, lng: i })
      calls[i]!.callback(200, noneResponse)
      await p
    }
    expect(addressCacheSizeForTest()).toBe(ADDRESS_CACHE_MAX)
    expect(peekAddress('37,0')).toEqual({ status: 'none' })      // 0번을 읽어 최신으로
    const extra = lookupAddress(api, { lat: 37, lng: 999 })
    calls.at(-1)!.callback(200, noneResponse)
    await extra
    expect(addressCacheSizeForTest()).toBe(ADDRESS_CACHE_MAX)
    expect(peekAddress('37,0')).toEqual({ status: 'none' })      // 최근에 읽은 것은 남고
    expect(peekAddress('37,1')).toBeUndefined()                  // 가장 오래 안 쓴 1번이 빠졌다
    await flush()
  })
})
