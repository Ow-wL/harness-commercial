/**
 * 이 자리 업종 순위 요청 (R1 13-16): 단일 결과의 좌표·반경으로 POST /rank. 공통 동작(캐시 상한·버전 키·실패 뒤 "다시 시도")은
 * lib/useSideRequest. 분석 결과와 독립 — 실패해도 분석 화면은 그대로다.
 */
import { fetchRank } from '../api/client.ts'
import type { RankResponse } from '../api/schemas.ts'
import { SideCache, useSideRequest, type SideState } from './useSideRequest.ts'

export type RankRequest = { lat: number; lng: number; radius_m?: number }
export type RankState = SideState<RankResponse>

const RANK_CACHE_MAX = 32
const cache = new SideCache<RankResponse>(RANK_CACHE_MAX)
/** version: 분석 응답의 엔진·데이터 버전 — 바뀌면 같은 좌표라도 다시 받는다 */
export const rankKey = (r: RankRequest, version = '') =>
  `${JSON.stringify({ lat: r.lat, lng: r.lng, ...(r.radius_m !== undefined ? { radius_m: r.radius_m } : {}) })}|${version}`
const bodyOf = (key: string): RankRequest => JSON.parse(key.slice(0, key.lastIndexOf('|'))) as RankRequest

/** 테스트용 */
export function clearRankCache() {
  cache.clear()
}

export function useRank(request: RankRequest | null, version = '', token: unknown = null) {
  return useSideRequest(request ? rankKey(request, version) : null, bodyOf, fetchRank, cache, token)
}
