/**
 * 이 자리 업종 순위 요청 (R1 13-16): 단일 결과의 좌표·반경으로 POST /rank. 같은 키는 세션 안에서 한 번만 받는다(모듈 캐시).
 * 결과가 바뀌면 이전 요청을 취소한다. 분석 결과와 독립 — 실패해도 분석 화면은 그대로이고, 같은 키의 실패는 다시 요청하지 않는다
 * (요청 객체가 아니라 좌표·반경 원시값을 의존성으로 — 렌더마다 재요청·무한 루프 방지).
 */
import { useEffect, useState } from 'react'
import { fetchRank, type ApiFailure } from '../api/client.ts'
import type { RankResponse } from '../api/schemas.ts'

export type RankRequest = { lat: number; lng: number; radius_m?: number }
export type RankState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; failure: ApiFailure }
  | { status: 'success'; data: RankResponse }

const cache = new Map<string, RankResponse>()
export const rankKey = (r: RankRequest) => `${r.lat},${r.lng},${r.radius_m ?? ''}`

/** 테스트·버전 전환용 */
export function clearRankCache() {
  cache.clear()
}

export function useRank(request: RankRequest | null): RankState {
  const lat = request?.lat ?? null
  const lng = request?.lng ?? null
  const radius = request?.radius_m
  const key = request ? rankKey(request) : null
  const [failed, setFailed] = useState<{ key: string; failure: ApiFailure } | null>(null)
  const [, bump] = useState(0)
  useEffect(() => {
    if (lat === null || lng === null || !key || cache.has(key) || failed?.key === key) return
    const ac = new AbortController()
    fetchRank({ lat, lng, ...(radius !== undefined ? { radius_m: radius } : {}) }, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        if (r.ok) {
          cache.set(key, r.data)
          bump((n) => n + 1)
        } else {
          setFailed({ key, failure: r.failure })
        }
      })
      .catch(() => {})                                     // 취소
    return () => ac.abort()
  }, [key, lat, lng, radius, failed])
  if (!key) return { status: 'idle' }
  const data = cache.get(key)
  if (data) return { status: 'success', data }
  if (failed && failed.key === key) return { status: 'error', failure: failed.failure }
  return { status: 'loading' }
}
