import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearRankCache, useRank } from './useRank.ts'

const json = (status: number, body: unknown, dataVersion?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(dataVersion ? { 'X-Data-Version': dataVersion } : {}) },
  })
const RANK = {
  lat: 37.4894, lng: 126.7246, radius_m: 500, gu_name: '부평구', dong_name: '부평1동', count: 1,
  items: [{ biz_code: 'R10406', name: 'PC방', group: '목적방문형', overall: 62.3, weakest: null, coverage: 1, regulated: false, warnings: 0 }],
  engine_version: 'mvp-0.5.1',
}
const V1 = { engine: 'mvp-0.5.1', data: '2026-06' }
const V2 = { engine: 'mvp-0.5.1', data: '2099-01' }
const REQ = { lat: 37.4894, lng: 126.7246, radius_m: 500 }

describe('useRank — /rank 요청 (13-16)', () => {
  afterEach(() => {
    clearRankCache()
    vi.unstubAllGlobals()
  })

  it('성공하면 캐시에 두고, 같은 키의 재렌더·재마운트는 다시 요청하지 않는다', async () => {
    const fetchMock = vi.fn(async () => json(200, RANK))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender, unmount } = renderHook(({ r }) => useRank(r), { initialProps: { r: { lat: 37.4894, lng: 126.7246, radius_m: 500 } } })
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('success'))
    rerender({ r: { lat: 37.4894, lng: 126.7246, radius_m: 500 } })              // 새 객체, 같은 키
    unmount()
    renderHook(() => useRank({ lat: 37.4894, lng: 126.7246, radius_m: 500 }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('실패 뒤 retry() 로 같은 키를 다시 요청해 복구한다(Codex R1-6) — 자동 반복은 없다', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => (++n === 1 ? json(503, { error: { code: 'internal_error', message: '잠시' } }) : json(200, RANK)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useRank({ lat: 37.4894, lng: 126.7246, radius_m: 500 }))
    await waitFor(() => expect(result.current.status).toBe('error'))
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('새 분석 응답(token 이 바뀜)이면 같은 키의 실패를 다시 시도하고, 엔진·데이터 버전이 바뀌면 캐시가 있어도 다시 받는다', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => (++n === 1 ? json(503, { error: { code: 'internal_error', message: '잠시' } }) : json(200, RANK)))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ v, t }) => useRank(REQ, v, t), { initialProps: { v: { engine: 'mvp-0.5.1', data: null } as typeof V1 | { engine: string; data: null }, t: {} as object } })
    await waitFor(() => expect(result.current.status).toBe('error'))
    rerender({ v: { engine: 'mvp-0.5.1', data: null }, t: {} })                     // 같은 조건 재분석 → 새 응답 객체
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    rerender({ v: V2 as never, t: {} })                                              // 데이터 묶음이 바뀜 → 새 키로 다시 받는다
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })

  describe('받은 응답의 실제 버전 대조 (Codex R1-9)', () => {
    const T = {}                                                                   // 분석 응답 객체처럼 렌더마다 같은 token
    it('분석 V1 → 응답 X-Data-Version V2: 보이지 않고(stale) 캐시에도 남지 않는다 — 같은 V1 키로 다시 열면 다시 요청한다', async () => {
      const fetchMock = vi.fn(async () => json(200, RANK, V2.data))
      vi.stubGlobal('fetch', fetchMock)
      const first = renderHook(() => useRank(REQ, V1, T))
      await waitFor(() => expect(first.result.current.status).toBe('stale'))
      first.unmount()
      const again = renderHook(() => useRank(REQ, V1, T))
      await waitFor(() => expect(again.result.current.status).toBe('stale'))
      expect(fetchMock).toHaveBeenCalledTimes(2)                                 // V2 응답이 V1 키에 저장됐다면 1회였다
    })

    it('반대 순서(분석 V2 → 응답 V1)도 stale, 엔진이 다르면(데이터 같아도) stale', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json(200, RANK, V1.data)))
      const back = renderHook(() => useRank(REQ, V2, T))
      await waitFor(() => expect(back.result.current.status).toBe('stale'))
      clearRankCache()
      vi.stubGlobal('fetch', vi.fn(async () => json(200, { ...RANK, engine_version: 'mvp-0.5' }, V1.data)))
      const engine = renderHook(() => useRank({ ...REQ, radius_m: 300 }, V1, T))
      await waitFor(() => expect(engine.result.current.status).toBe('stale'))
    })

    it('같은 엔진·데이터면 성공·캐시, 분석이 데이터 버전을 모르면(헤더 없는 서버) 엔진만 대조한다', async () => {
      const fetchMock = vi.fn(async () => json(200, RANK, V1.data))
      vi.stubGlobal('fetch', fetchMock)
      const ok = renderHook(() => useRank(REQ, V1, T))
      await waitFor(() => expect(ok.result.current.status).toBe('success'))
      renderHook(() => useRank(REQ, V1, T))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      vi.stubGlobal('fetch', vi.fn(async () => json(200, RANK)))
      const unknown = renderHook(() => useRank({ ...REQ, radius_m: 1000 }, { engine: 'mvp-0.5.1', data: null }, T))
      await waitFor(() => expect(unknown.result.current.status).toBe('success'))
    })

    it('stale 뒤 다시 분석(새 버전의 분석 → 새 키·새 token)이면 같은 버전 응답을 받아 보인다', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json(200, RANK, V2.data)))
      const { result, rerender } = renderHook(({ v, t }) => useRank(REQ, v, t), { initialProps: { v: V1, t: {} as object } })
      await waitFor(() => expect(result.current.status).toBe('stale'))
      rerender({ v: V2, t: {} })
      await waitFor(() => expect(result.current.status).toBe('success'))
    })

    it('조건이 바뀐 뒤 늦게 온 이전 응답은 버린다 — 이전 키에도 저장하지 않는다', async () => {
      let resolveA: (r: Response) => void = () => {}
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(() => new Promise<Response>((r) => (resolveA = r)))
        .mockImplementation(async () => json(200, RANK, V1.data))
      vi.stubGlobal('fetch', fetchMock)
      const { result, rerender } = renderHook(({ r }) => useRank(r, V1, null), { initialProps: { r: REQ } })
      rerender({ r: { ...REQ, radius_m: 300 } })
      await waitFor(() => expect(result.current.status).toBe('success'))
      resolveA(json(200, RANK, V1.data))
      await new Promise((r) => setTimeout(r, 20))
      renderHook(() => useRank(REQ, V1, null))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))            // 늦은 A 응답이 캐시에 있었다면 2회
    })
  })

  it('실패(404)는 오류 상태로 끝나고 같은 키를 다시 요청하지 않는다 — 렌더마다 재요청하는 루프가 없다', async () => {
    const fetchMock = vi.fn(async () => json(404, { error: { code: 'not_found', message: '없음' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ r }) => useRank(r), { initialProps: { r: { lat: 1, lng: 2, radius_m: 500 } } })
    await waitFor(() => expect(result.current.status).toBe('error'))
    rerender({ r: { lat: 1, lng: 2, radius_m: 500 } })
    rerender({ r: { lat: 1, lng: 2, radius_m: 500 } })
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(renderHook(() => useRank(null)).result.current.status).toBe('idle')
  })
})
