import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearRankCache, useRank } from './useRank.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const RANK = {
  lat: 37.4894, lng: 126.7246, radius_m: 500, gu_name: '부평구', dong_name: '부평1동', count: 1,
  items: [{ biz_code: 'R10406', name: 'PC방', group: '목적방문형', overall: 62.3, weakest: null, coverage: 1, regulated: false, warnings: 0 }],
}

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
