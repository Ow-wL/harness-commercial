import forwardFixture from '../fixtures/geocoder-forward-bupyeong-daero.json'
import reverseFixture from '../fixtures/geocoder-reverse-bupyeong-station.json'
import {
  GEOCODER_CALL_TIMEOUT_MS,
  geocode,
  normalizeAddress,
  parseCoordinate,
  reverseGeocode,
  REVERSE_ORDERS,
} from './geocoder.ts'
import type { NaverMapsApi, NaverServiceCallback } from './naverMaps.ts'

/**
 * adapter 계약 (docs/ADDRESS_DESIGN.md §5.1·§8-1). SDK의 naver.maps.Service를 vi.fn으로 대체하고,
 * 7-B0 재검증에서 받은 실제 응답(fixture의 response)을 입력으로 쓴다 — fixture의 http_status는 adapter가 받는 값이 아니다(SDK 콜백 status만).
 */
const OK = 200
const ERROR = 500

type Call = { options: Record<string, unknown>; callback: NaverServiceCallback }
let geocodeCalls: Call[] = []
let reverseCalls: Call[] = []

function fakeApi(overrides: Partial<{ geocode: unknown; reverseGeocode: unknown }> = {}): NaverMapsApi {
  return {
    Service: {
      Status: { OK, ERROR },
      geocode: vi.fn((options: Record<string, unknown>, callback: NaverServiceCallback) => {
        geocodeCalls.push({ options, callback })
      }),
      reverseGeocode: vi.fn((options: Record<string, unknown>, callback: NaverServiceCallback) => {
        reverseCalls.push({ options, callback })
      }),
      ...overrides,
    },
  } as unknown as NaverMapsApi
}

/** 콜백을 다음 틱에 보낸다 (SDK처럼 비동기) */
async function reply(call: Call | undefined, status: number, response?: unknown) {
  await Promise.resolve()
  call?.callback(status, response)
}

beforeEach(() => {
  geocodeCalls = []
  reverseCalls = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('normalizeAddress / parseCoordinate', () => {
  it('trim + 연속 공백 1칸, 빈 값·문자열 아님은 null', () => {
    expect(normalizeAddress('인천광역시 부평구 광장로  16 부평민자역사')).toBe('인천광역시 부평구 광장로 16 부평민자역사')
    expect(normalizeAddress('  a \t b\n c ')).toBe('a b c')
    expect(normalizeAddress('')).toBeNull()
    expect(normalizeAddress('   ')).toBeNull()
    expect(normalizeAddress(undefined)).toBeNull()
    expect(normalizeAddress(null)).toBeNull()
    expect(normalizeAddress(12)).toBeNull()
  })

  it('좌표 문자열은 숫자 형식·유한성·범위만 본다 — 빈 문자열·공백·글자는 0이 아니라 null', () => {
    expect(parseCoordinate('126.7227259', 'lng')).toBe(126.7227259)
    expect(parseCoordinate(' 37.4918321 ', 'lat')).toBe(37.4918321)
    expect(parseCoordinate('-33.5', 'lat')).toBe(-33.5)
    expect(parseCoordinate('', 'lat')).toBeNull()
    expect(parseCoordinate('   ', 'lng')).toBeNull()
    expect(parseCoordinate('abc', 'lat')).toBeNull()
    expect(parseCoordinate('1e3', 'lng')).toBeNull()
    expect(parseCoordinate('Infinity', 'lat')).toBeNull()
    expect(parseCoordinate(undefined, 'lat')).toBeNull()
    expect(parseCoordinate('95', 'lat')).toBeNull()             // 위도 범위 밖
    expect(parseCoordinate('181', 'lng')).toBeNull()
    expect(parseCoordinate('37.5', 'lat')).toBe(37.5)            // 인천 밖(서울)이라도 거부하지 않는다 — backend가 판정
  })
})

describe('geocode (정방향)', () => {
  it('실제 fixture 응답을 설계 결과 객체로 바꾼다: 좌표 숫자, 주소 정규화, SIDO, 거리', async () => {
    const api = fakeApi()
    const p = geocode(api, '인천광역시 부평구 부평대로 1', { coordinate: { lat: 37.4563, lng: 126.7052 }, count: 5 })
    // SDK에 넘기는 옵션: query 그대로, coordinate는 'lng,lat', count
    expect(geocodeCalls[0]!.options).toEqual({ query: '인천광역시 부평구 부평대로 1', coordinate: '126.7052,37.4563', count: 5 })
    await reply(geocodeCalls[0], forwardFixture.status, forwardFixture.response)
    await expect(p).resolves.toEqual({
      status: 'ok',
      items: [
        {
          roadAddress: '인천광역시 부평구 부평대로 3',
          jibunAddress: '인천광역시 부평구 부평동 549-39',
          lat: 37.4918321,
          lng: 126.7227259,
          sido: '인천광역시',
          distanceM: 4240.06,
        },
      ],
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('coordinate·count를 주지 않으면 query만 넘기고, 거리가 없으면 null', async () => {
    const api = fakeApi()
    const p = geocode(api, '부평대로 1')
    expect(geocodeCalls[0]!.options).toEqual({ query: '부평대로 1' })
    const address = { ...forwardFixture.response.v2.addresses[0]!, distance: undefined, addressElements: undefined }
    await reply(geocodeCalls[0], OK, { v2: { status: 'OK', meta: { totalCount: 1 }, addresses: [address], errorMessage: '' } })
    const r = await p
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.items[0]).toMatchObject({ distanceM: null, sido: null })
  })

  it('검색 결과 없음(OK, addresses 비어 있음)은 empty', async () => {
    const api = fakeApi()
    const p = geocode(api, '없는 주소')
    await reply(geocodeCalls[0], OK, { v2: { status: 'OK', meta: { totalCount: 0, page: 1, count: 0 }, addresses: [], errorMessage: '' } })
    await expect(p).resolves.toEqual({ status: 'empty' })
  })

  it('SDK ERROR + 응답 없음은 unknown (원인을 추정하지 않는다)', async () => {
    const api = fakeApi()
    const p = geocode(api, 'x')
    await reply(geocodeCalls[0], ERROR, undefined)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'unknown' })
    expect(console.warn).toHaveBeenCalledWith('[geocoder] geocode 실패', { kind: 'unknown', status: ERROR })
  })

  it('v2.status로 invalid / system을 나누고, 모르는 값은 unknown', async () => {
    for (const [status, kind] of [
      ['INVALID_REQUEST', 'invalid'],
      ['SYSTEM_ERROR', 'system'],
      ['SOMETHING_NEW', 'unknown'],
    ] as const) {
      geocodeCalls = []
      const p = geocode(fakeApi(), 'x')
      await reply(geocodeCalls[0], ERROR, { v2: { status, meta: { totalCount: 0 }, addresses: [], errorMessage: 'e' } })
      await expect(p).resolves.toEqual({ status: 'error', kind })
    }
    // 콜백 status가 OK여도 v2.status가 OK가 아니면 그 값으로 분류한다
    geocodeCalls = []
    const p = geocode(fakeApi(), 'x')
    await reply(geocodeCalls[0], OK, { v2: { status: 'INVALID_REQUEST', addresses: [] } })
    await expect(p).resolves.toEqual({ status: 'error', kind: 'invalid' })
  })

  it('응답 구조가 다르면 schema', async () => {
    const p = geocode(fakeApi(), 'x')
    await reply(geocodeCalls[0], OK, { result: { items: [] } })      // v2 없음(deprecated 구조만)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'schema' })
  })

  it('좌표가 빈 문자열·글자·범위 밖이면 schema — Number()로 0을 만들지 않는다', async () => {
    const base = forwardFixture.response.v2.addresses[0]!
    for (const bad of [{ x: '', y: base.y }, { x: base.x, y: 'abc' }, { x: base.x, y: '95' }, { x: undefined, y: base.y }]) {
      geocodeCalls = []
      const p = geocode(fakeApi(), 'x')
      await reply(geocodeCalls[0], OK, { v2: { status: 'OK', addresses: [{ ...base, ...bad }] } })
      await expect(p).resolves.toEqual({ status: 'error', kind: 'schema' })
    }
  })

  it('주소 문자열은 정규화하고 빈 주소는 null', async () => {
    const base = forwardFixture.response.v2.addresses[0]!
    const p = geocode(fakeApi(), 'x')
    await reply(geocodeCalls[0], OK, { v2: { status: 'OK', addresses: [{ ...base, roadAddress: '  인천광역시   부평구  부평대로 3 ', jibunAddress: '' }] } })
    const r = await p
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.items[0]).toMatchObject({ roadAddress: '인천광역시 부평구 부평대로 3', jibunAddress: null })
  })

  it('8초 안에 콜백이 없으면 timeout이고, 그 뒤 온 콜백은 무시한다', async () => {
    vi.useFakeTimers()
    const p = geocode(fakeApi(), 'x')
    await vi.advanceTimersByTimeAsync(GEOCODER_CALL_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'timeout' })
    geocodeCalls[0]!.callback(OK, forwardFixture.response)              // 늦은 콜백 — 결과는 이미 정해졌다
    await expect(p).resolves.toEqual({ status: 'error', kind: 'timeout' })
  })

  it('첫 콜백만 반영하고 두 번째 콜백은 무시한다', async () => {
    const p = geocode(fakeApi(), 'x')
    await reply(geocodeCalls[0], OK, { v2: { status: 'OK', addresses: [] } })
    geocodeCalls[0]!.callback(ERROR, undefined)
    await expect(p).resolves.toEqual({ status: 'empty' })
  })

  it('SDK 호출 중 동기 예외는 unknown 결과 객체로 (throw하지 않는다)', async () => {
    const api = fakeApi({
      geocode: vi.fn(() => {
        throw new Error('boom')
      }),
    })
    await expect(geocode(api, 'x')).resolves.toEqual({ status: 'error', kind: 'unknown' })
  })

  it('Service가 없으면(서브모듈 미준비·실패) 부르지 않고 unavailable', async () => {
    const api = fakeApi()
    delete (api as { Service?: unknown }).Service
    await expect(geocode(api, 'x')).resolves.toEqual({ status: 'error', kind: 'unavailable' })
    await expect(geocode(null, 'x')).resolves.toEqual({ status: 'error', kind: 'unavailable' })
    expect(geocodeCalls).toHaveLength(0)
  })
})

describe('reverseGeocode (역방향)', () => {
  it('실제 fixture 응답: coords는 "lng,lat", orders는 roadaddr,addr, 주소는 이중 공백을 정규화한다', async () => {
    const api = fakeApi()
    const p = reverseGeocode(api, { lat: 37.4894, lng: 126.7246 })
    expect(reverseCalls[0]!.options).toEqual({ coords: '126.7246,37.4894', orders: REVERSE_ORDERS })
    await reply(reverseCalls[0], reverseFixture.status, reverseFixture.response)
    await expect(p).resolves.toEqual({
      status: 'ok',
      roadAddress: '인천광역시 부평구 광장로 16 부평민자역사',
      jibunAddress: '인천광역시 부평구 부평동 738-21',
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('code 3(no results)은 none', async () => {
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], OK, { v2: { status: { code: 3, name: 'no results', message: '' }, results: [] } })
    await expect(p).resolves.toEqual({ status: 'none' })
  })

  it('code 0이어도 도로명·지번이 모두 비면 none (성공 응답에 보여 줄 주소가 없다)', async () => {
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], OK, {
      v2: { status: { code: 0, name: 'ok', message: 'done' }, results: [], address: { roadAddress: '  ', jibunAddress: '' } },
    })
    await expect(p).resolves.toEqual({ status: 'none' })
    // address 자체가 없어도 none
    reverseCalls = []
    const q = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], OK, { v2: { status: { code: 0, name: 'ok', message: 'done' }, results: [] } })
    await expect(q).resolves.toEqual({ status: 'none' })
  })

  it('도로명만 비면 지번만 있는 ok', async () => {
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], OK, {
      v2: { status: { code: 0, name: 'ok', message: 'done' }, address: { roadAddress: '', jibunAddress: '인천광역시 부평구 부평동  738-21' } },
    })
    await expect(p).resolves.toEqual({ status: 'ok', roadAddress: null, jibunAddress: '인천광역시 부평구 부평동 738-21' })
  })

  it('SDK ERROR + 응답 없음은 unknown', async () => {
    const p = reverseGeocode(fakeApi(), { lat: 37.4894, lng: 126.7246 })
    await reply(reverseCalls[0], ERROR, undefined)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'unknown' })
    expect(console.warn).toHaveBeenCalledWith('[geocoder] reverseGeocode 실패', { kind: 'unknown', status: ERROR })
  })

  it('status.code로 invalid(100) / system(900) / 그 밖은 unknown', async () => {
    for (const [code, kind] of [
      [100, 'invalid'],
      [900, 'system'],
      [42, 'unknown'],
    ] as const) {
      reverseCalls = []
      const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
      await reply(reverseCalls[0], OK, { v2: { status: { code, name: 'x', message: 'y' }, results: [] } })
      await expect(p).resolves.toEqual({ status: 'error', kind })
    }
    // 콜백 status가 ERROR인데 응답이 함께 오면 그 code로
    reverseCalls = []
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], ERROR, { v2: { status: { code: 100, name: 'invalid request', message: '' } } })
    await expect(p).resolves.toEqual({ status: 'error', kind: 'invalid' })
  })

  it('응답 구조가 다르면 schema', async () => {
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await reply(reverseCalls[0], OK, { v2: { status: 'ok' } })       // status가 객체가 아님
    await expect(p).resolves.toEqual({ status: 'error', kind: 'schema' })
  })

  it('timeout 뒤 늦은 콜백·중복 콜백은 무시하고, 동기 예외는 unknown, Service 없으면 unavailable', async () => {
    vi.useFakeTimers()
    const p = reverseGeocode(fakeApi(), { lat: 37.4, lng: 126.3 })
    await vi.advanceTimersByTimeAsync(GEOCODER_CALL_TIMEOUT_MS)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'timeout' })
    reverseCalls[0]!.callback(OK, reverseFixture.response)
    reverseCalls[0]!.callback(OK, reverseFixture.response)
    await expect(p).resolves.toEqual({ status: 'error', kind: 'timeout' })
    vi.useRealTimers()

    const throwing = fakeApi({
      reverseGeocode: vi.fn(() => {
        throw new Error('boom')
      }),
    })
    await expect(reverseGeocode(throwing, { lat: 37.4, lng: 126.3 })).resolves.toEqual({ status: 'error', kind: 'unknown' })
    await expect(reverseGeocode(undefined, { lat: 37.4, lng: 126.3 })).resolves.toEqual({ status: 'error', kind: 'unavailable' })
  })
})
