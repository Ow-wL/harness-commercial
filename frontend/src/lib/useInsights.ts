/**
 * 시간대·인구 카드 자료 요청 (R1 13-15): 결과의 좌표·업종으로 POST /insights. /analyze 응답에 싣지 않는 이유는 backend
 * InsightsResponse(열린 이전 화면의 strict 스키마, Codex R1-3). 이전 서버(복구 전환)는 404 — 카드만 빠진다.
 */
import { fetchInsights } from '../api/client.ts'
import type { InsightsResponse } from '../api/schemas.ts'
import { SideCache, useSideRequest, type SideState } from './useSideRequest.ts'

export type InsightsRequest = { lat: number; lng: number; biz_code: string }
export type InsightsState = SideState<InsightsResponse>

const cache = new SideCache<InsightsResponse>(32)
const keyOf = (r: InsightsRequest, version: string) => `${JSON.stringify({ lat: r.lat, lng: r.lng, biz_code: r.biz_code })}|${version}`
const bodyOf = (key: string): InsightsRequest => JSON.parse(key.slice(0, key.lastIndexOf('|'))) as InsightsRequest

/** 테스트용 */
export function clearInsightsCache() {
  cache.clear()
}

export function useInsights(request: InsightsRequest | null, version = '', token: unknown = null) {
  return useSideRequest(request ? keyOf(request, version) : null, bodyOf, fetchInsights, cache, token)
}
