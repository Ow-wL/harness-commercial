import {
  loadNaverMaps,
  MapLoadError,
  NAVER_SCRIPT_ID,
  onNaverAuthFailure,
  resetNaverMapsLoaderForTest,
  type NaverMapsApi,
} from './naverMaps.ts'

// jsdom은 외부 script를 내려받지 않는다 — load/error 이벤트를 직접 보내 SDK 로드를 흉내 낸다
const scripts = () => document.querySelectorAll(`script#${NAVER_SCRIPT_ID}`)
const fakeMaps = {} as NaverMapsApi

afterEach(() => resetNaverMapsLoaderForTest())

describe('loadNaverMaps', () => {
  it('Client ID가 없으면 script를 붙이지 않고 config 오류', async () => {
    await expect(loadNaverMaps(undefined)).rejects.toMatchObject({ kind: 'config' })
    await expect(loadNaverMaps('')).rejects.toBeInstanceOf(MapLoadError)
    expect(scripts()).toHaveLength(0)
  })

  it('여러 번 불러도 script는 하나만 붙고(singleton) 같은 Promise를 돌려준다', async () => {
    const a = loadNaverMaps('test-client-id')
    const b = loadNaverMaps('test-client-id')
    expect(a).toBe(b)
    expect(scripts()).toHaveLength(1)
    const src = (scripts()[0] as HTMLScriptElement).src
    expect(src).toBe('https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=test-client-id&submodules=geocoder&callback=__naverMapsReady')   // 7-B1: Geocoder 서브모듈·준비 callback

    window.naver = { maps: fakeMaps }
    scripts()[0]!.dispatchEvent(new Event('load'))
    await expect(a).resolves.toBe(fakeMaps)
    // 로드된 뒤에는 script를 더 붙이지 않는다
    await expect(loadNaverMaps('test-client-id')).resolves.toBe(fakeMaps)
    expect(scripts()).toHaveLength(1)
  })

  it('script 로드 실패는 load 오류이고, 다음 호출에서 다시 시도한다', async () => {
    const first = loadNaverMaps('test-client-id')
    scripts()[0]!.dispatchEvent(new Event('error'))
    await expect(first).rejects.toMatchObject({ kind: 'load' })
    expect(scripts()).toHaveLength(0)

    const second = loadNaverMaps('test-client-id')
    expect(second).not.toBe(first)
    expect(scripts()).toHaveLength(1)
    second.catch(() => {})
  })

  it('NAVER 인증 실패 콜백은 auth 오류로 알린다', async () => {
    const listener = vi.fn()
    onNaverAuthFailure(listener)
    const p = loadNaverMaps('wrong-client-id')
    window.navermap_authFailure?.()
    await expect(p).rejects.toMatchObject({ kind: 'auth' })
    expect(listener).toHaveBeenCalledOnce()
  })
})

// ─── 7-B1: Geocoder 서브모듈 준비 상태 (docs/ADDRESS_DESIGN.md §5.1·§8-2) ─────────────
import {
  GEOCODER_TIMEOUT_MS,
  getGeocoderAvailability,
  isGeocoderAvailable,
  NAVER_READY_CALLBACK,
  onGeocoderAvailability,
  reduceSdkState,
  type SdkState,
} from './naverMaps.ts'

const fakeService = { geocode: () => {}, reverseGeocode: () => {}, Status: { OK: 200, ERROR: 500 } }
const withService = { Service: fakeService } as unknown as NaverMapsApi

describe('loadNaverMaps — Geocoder 서브모듈 (7-B1)', () => {
  afterEach(() => vi.useRealTimers())

  it('script URL에 submodules=geocoder와 callback을 붙이고, 여전히 script는 하나다', () => {
    const p = loadNaverMaps('test-client-id')
    loadNaverMaps('test-client-id')
    expect(scripts()).toHaveLength(1)
    expect((scripts()[0] as HTMLScriptElement).src).toBe(
      `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=test-client-id&submodules=geocoder&callback=${NAVER_READY_CALLBACK}`,
    )
    expect(typeof window[NAVER_READY_CALLBACK]).toBe('function')
    expect(getGeocoderAvailability()).toBe('loading')
    p.catch(() => {})
  })

  it('load 뒤 callback: 지도는 load에서 준비되고(Service 없음), callback이 오면 Geocoder ready', async () => {
    const p = loadNaverMaps('test-client-id')
    const seen: string[] = []
    onGeocoderAvailability((s) => seen.push(s))
    window.naver = { maps: { ...withService, Service: undefined } as unknown as NaverMapsApi }   // load 시점: 서브모듈 전
    scripts()[0]!.dispatchEvent(new Event('load'))
    await expect(p).resolves.toBe(window.naver.maps)
    expect(getGeocoderAvailability()).toBe('loading')
    window.naver = { maps: withService }                                                       // 서브모듈이 Service를 붙였다
    window[NAVER_READY_CALLBACK]!()
    expect(getGeocoderAvailability()).toBe('ready')
    expect(seen).toEqual(['ready'])
    // 이미 정해진 뒤 구독하면 바로 한 번 알려 준다
    const late = vi.fn()
    onGeocoderAvailability(late)
    expect(late).toHaveBeenCalledWith('ready')
  })

  it('callback이 load보다 먼저 와도 지도·Geocoder 모두 준비된다', async () => {
    const p = loadNaverMaps('test-client-id')
    window.naver = { maps: withService }
    window[NAVER_READY_CALLBACK]!()
    await expect(p).resolves.toBe(withService)
    expect(getGeocoderAvailability()).toBe('ready')
    scripts()[0]!.dispatchEvent(new Event('load'))          // 뒤늦은 load는 아무것도 바꾸지 않는다
    expect(getGeocoderAvailability()).toBe('ready')
  })

  it('callback이 오지 않으면 지도 준비 10초 뒤 Geocoder만 unavailable (지도 Promise는 그대로 성공)', async () => {
    vi.useFakeTimers()
    const p = loadNaverMaps('test-client-id')
    const listener = vi.fn()
    onGeocoderAvailability(listener)
    window.naver = { maps: fakeMaps }
    scripts()[0]!.dispatchEvent(new Event('load'))
    await expect(p).resolves.toBe(fakeMaps)
    await vi.advanceTimersByTimeAsync(GEOCODER_TIMEOUT_MS - 1)
    expect(getGeocoderAvailability()).toBe('loading')
    await vi.advanceTimersByTimeAsync(1)
    expect(getGeocoderAvailability()).toBe('unavailable')
    expect(listener).toHaveBeenCalledExactlyOnceWith('unavailable')
    window.naver = { maps: withService }
    window[NAVER_READY_CALLBACK]!()                          // 타임아웃 뒤 늦은 callback은 무시
    expect(getGeocoderAvailability()).toBe('unavailable')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('callback이 왔지만 Service가 없으면 unavailable', async () => {
    const p = loadNaverMaps('test-client-id')
    window.naver = { maps: fakeMaps }
    window[NAVER_READY_CALLBACK]!()
    await expect(p).resolves.toBe(fakeMaps)
    expect(getGeocoderAvailability()).toBe('unavailable')
    expect(isGeocoderAvailable(fakeMaps)).toBe(false)
    expect(isGeocoderAvailable(withService)).toBe(true)
  })

  it('script 로드 실패면 Geocoder도 unavailable이고, 재시도하면 처음부터 다시 본다', async () => {
    const first = loadNaverMaps('test-client-id')
    scripts()[0]!.dispatchEvent(new Event('error'))
    await expect(first).rejects.toMatchObject({ kind: 'load' })
    expect(getGeocoderAvailability()).toBe('unavailable')
    const second = loadNaverMaps('test-client-id')
    expect(getGeocoderAvailability()).toBe('loading')
    second.catch(() => {})
  })

  it('이미 로드된 SDK(window.naver.maps)를 그대로 쓸 때: Service가 있으면 바로 ready, 없으면 타임아웃을 기다린다', async () => {
    vi.useFakeTimers()
    window.naver = { maps: withService }
    await expect(loadNaverMaps('test-client-id')).resolves.toBe(withService)
    expect(getGeocoderAvailability()).toBe('ready')
    resetNaverMapsLoaderForTest()
    window.naver = { maps: fakeMaps }
    await expect(loadNaverMaps('test-client-id')).resolves.toBe(fakeMaps)
    expect(getGeocoderAvailability()).toBe('loading')
    await vi.advanceTimersByTimeAsync(GEOCODER_TIMEOUT_MS)
    expect(getGeocoderAvailability()).toBe('unavailable')
  })

  it('구독 해제 뒤에는 알리지 않는다', () => {
    const p = loadNaverMaps('test-client-id')
    const listener = vi.fn()
    const off = onGeocoderAvailability(listener)
    off()
    window.naver = { maps: withService }
    window[NAVER_READY_CALLBACK]!()
    expect(listener).not.toHaveBeenCalled()
    p.catch(() => {})
  })
})

describe('reduceSdkState — failed는 끝 상태', () => {
  const api = withService
  it('지도 준비 → Geocoder 준비 순서대로 상태가 바뀌고, 같은 값이면 같은 객체를 돌려준다', () => {
    const loading: SdkState = { status: 'loading' }
    const ready = reduceSdkState(loading, { type: 'map-ready', api, geocoder: 'loading' })
    expect(ready).toEqual({ status: 'ready', api, geocoder: 'loading' })
    expect(reduceSdkState(ready, { type: 'geocoder', geocoder: 'loading' })).toBe(ready)
    expect(reduceSdkState(ready, { type: 'geocoder', geocoder: 'ready' })).toEqual({ status: 'ready', api, geocoder: 'ready' })
    // loading 중에 온 geocoder 알림은 무시한다 (map-ready가 현재 값을 다시 읽는다)
    expect(reduceSdkState(loading, { type: 'geocoder', geocoder: 'ready' })).toBe(loading)
  })

  it('뒤늦은 인증 실패 뒤에는 Geocoder ready·map-ready가 와도 failed 그대로', () => {
    const ready: SdkState = { status: 'ready', api, geocoder: 'loading' }
    const failed = reduceSdkState(ready, { type: 'auth-failed' })
    expect(failed).toEqual({ status: 'failed', kind: 'auth' })
    expect(reduceSdkState(failed, { type: 'geocoder', geocoder: 'ready' })).toBe(failed)
    expect(reduceSdkState(failed, { type: 'map-ready', api, geocoder: 'ready' })).toBe(failed)
    expect(reduceSdkState({ status: 'loading' }, { type: 'map-failed', kind: 'load' })).toEqual({ status: 'failed', kind: 'load' })
  })
})
