import fixture from '../fixtures/bupyeong-pcbang.json'
import nearbyFixture from '../fixtures/bupyeong-pcbang-nearby.json'
import type { AnalyzeRequest } from '../api/client.ts'
import type { AnalyzeResponse, NearbyStoresResponse } from '../api/schemas.ts'
import { cacheKey, RESULT_CACHE_SIZE, ResultCache } from './resultCache.ts'

/** 8-D3 결과 캐시 (docs/UX_REDESIGN.md 4.3) */
const req = (lat: number, radius_m?: number): AnalyzeRequest =>
  radius_m === undefined ? { lat, lng: 126.7246, biz_code: 'R10406' } : { lat, lng: 126.7246, biz_code: 'R10406', radius_m }
const response = (radius: number, version = 'mvp-0.4'): AnalyzeResponse => {
  const c = structuredClone(fixture) as unknown as AnalyzeResponse
  ;(c.result.meta as { 분석반경_m: number }).분석반경_m = radius
  ;(c.result.meta as { 엔진버전: string }).엔진버전 = version
  return c
}
const nearby = nearbyFixture as unknown as NearbyStoresResponse

describe('ResultCache', () => {
  it('키는 (lat, lng, 업종, 반경) — radius_m 이 없으면 500 과 같은 키', () => {
    expect(cacheKey(req(37.4894))).toBe(cacheKey(req(37.4894, 500)))
    expect(cacheKey(req(37.4894, 300))).not.toBe(cacheKey(req(37.4894, 500)))
  })

  it('분석만 있으면 부분 캐시(nearby null), 점포를 채우면 짝으로 돌려준다. 분석 항목이 없으면 점포는 저장하지 않는다', () => {
    const c = new ResultCache()
    c.putNearby(req(37.4894, 300), nearby)
    expect(c.get(req(37.4894, 300))).toBeUndefined()
    c.putAnalyze(req(37.4894, 300), response(300))
    expect(c.get(req(37.4894, 300))?.nearby).toBeNull()
    c.putNearby(req(37.4894, 300), nearby)
    expect(c.get(req(37.4894, 300))?.nearby).toBe(nearby)
    c.putAnalyze(req(37.4894, 300), response(300))                     // 새 분석이면 이전 점포는 버린다
    expect(c.get(req(37.4894, 300))?.nearby).toBeNull()
  })

  it(`LRU ${RESULT_CACHE_SIZE}: 가장 오래 쓰지 않은 항목부터 밀려난다(get 은 최근 사용으로 올린다)`, () => {
    const c = new ResultCache()
    for (let i = 0; i < RESULT_CACHE_SIZE; i++) c.putAnalyze(req(37 + i / 100, 500), response(500))
    c.get(req(37, 500))                                                 // 가장 오래된 것을 다시 사용
    c.putAnalyze(req(38, 500), response(500))
    expect(c.sizeNow).toBe(RESULT_CACHE_SIZE)
    expect(c.get(req(37, 500))).toBeDefined()
    expect(c.get(req(37.01, 500))).toBeUndefined()                      // 그다음으로 오래된 것이 밀려남
  })

  it('응답 엔진버전이 캐시의 버전과 다르면 전체를 버리고 새 버전으로 시작한다', () => {
    const c = new ResultCache()
    c.putAnalyze(req(37.4894, 300), response(300, 'mvp-0.4'))
    c.putAnalyze(req(37.4894, 500), response(500, 'mvp-0.4'))
    c.putAnalyze(req(37.5, 500), response(500, 'mvp-0.3'))
    expect(c.sizeNow).toBe(1)
    expect(c.get(req(37.4894, 500))).toBeUndefined()
  })

  it('반경 복구(4.6): 반경 ≠ 500 항목만 버린다', () => {
    const c = new ResultCache()
    for (const r of [300, 500, 1000]) c.putAnalyze(req(37.4894, r), response(r))
    c.dropRadiusOtherThan(500)
    expect(c.get(req(37.4894, 500))).toBeDefined()
    expect(c.get(req(37.4894, 300))).toBeUndefined()
    expect(c.get(req(37.4894, 1000))).toBeUndefined()
  })
})
