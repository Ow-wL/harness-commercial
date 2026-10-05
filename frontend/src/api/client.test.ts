import fixture from '../fixtures/bupyeong-pcbang.json'
import { analyze, fetchBusinesses } from './client.ts'

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

const REQUEST = { lat: 37.4894, lng: 126.7246, biz_code: 'R10406' }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('api client', () => {
  it('성공 응답은 AnalyzeResponseSchema를 통과한 값 그대로', async () => {
    stubFetch(respond(200, fixture))
    const r = await analyze(REQUEST)
    expect(r).toEqual({ ok: true, data: fixture })
  })

  it('backend 오류 계약 응답은 status와 error를 그대로 돌려준다', async () => {
    const body = { error: { code: 'no_data_nearby', message: '…' } }
    stubFetch(respond(422, body))
    expect(await analyze(REQUEST)).toEqual({ ok: false, failure: { kind: 'api', status: 422, error: body.error } })
  })

  it('fetch 실패와 JSON이 아닌 5xx(프록시가 backend에 연결 못 함)는 network', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await analyze(REQUEST)).toEqual({ ok: false, failure: { kind: 'network' } })
    stubFetch(respond(502, 'Bad Gateway'))
    expect(await analyze(REQUEST)).toEqual({ ok: false, failure: { kind: 'network' } })
  })

  it.each([
    ['계약과 다른 성공 응답', 200, { context: fixture.context }],
    ['계약과 다른 오류 응답', 422, { detail: [] }],
    ['JSON이 아닌 4xx', 404, 'Not Found'],
  ])('%s는 schema 실패 + console.error', async (_, status, body) => {
    stubFetch(respond(status, body))
    const r = await fetchBusinesses()
    expect(r).toEqual({ ok: false, failure: { kind: 'schema', endpoint: '/businesses', status } })
    expect(console.error).toHaveBeenCalled()
  })

  it('호출한 쪽이 취소한 요청은 결과로 바꾸지 않고 그대로 던진다', async () => {
    stubFetch(() => Promise.reject(new DOMException('aborted', 'AbortError')))
    await expect(analyze(REQUEST)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
