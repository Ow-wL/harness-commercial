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
    expect(src).toBe('https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=test-client-id')

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
