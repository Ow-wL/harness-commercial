/**
 * AI 요약 요청 (R2 13-23): 결과의 좌표·업종·반경으로 POST /summary. 공통 동작(버전 대조·캐시 상한·실패 뒤 다시 시도)은 lib/useSideRequest.
 * 서버가 AI 를 광고할 때만(request 가 null 이면 부르지 않는다). 실패해도 R1 한 줄 결론(템플릿)은 그대로 보인다.
 */
import { fetchSummary } from '../api/client.ts'
import type { SummaryResponse } from '../api/schemas.ts'
import { SideCache, useSideRequest, type SideState, type SideVersion } from './useSideRequest.ts'

export type SummaryRequest = { lat: number; lng: number; biz_code: string; radius_m?: number }
export type SummaryState = SideState<SummaryResponse>

const cache = new SideCache<SummaryResponse>(32)
const keyOf = (r: SummaryRequest, version: string) =>
  `${JSON.stringify({ lat: r.lat, lng: r.lng, biz_code: r.biz_code, ...(r.radius_m !== undefined ? { radius_m: r.radius_m } : {}) })}|${version}`
const bodyOf = (key: string): SummaryRequest => JSON.parse(key.slice(0, key.lastIndexOf('|'))) as SummaryRequest
const engineOf = (d: SummaryResponse) => d.engine_version
const tag = (v: SideVersion | null) => (v ? `${v.engine}/${v.data ?? ''}` : '')

/** 테스트용 */
export function clearSummaryCache() {
  cache.clear()
}

export function useSummary(request: SummaryRequest | null, expected: SideVersion | null = null, token: unknown = null) {
  return useSideRequest(request ? keyOf(request, tag(expected)) : null, bodyOf, fetchSummary, cache, token, expected, engineOf)
}
