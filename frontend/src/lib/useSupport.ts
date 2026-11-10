/**
 * 지원사업 "조건에 맞는 공고" 요청 (R3 13-33): 분석 업종·구·내 상황(프로필)으로 POST /support/match.
 * 공통 동작(캐시 상한·실패 뒤 다시 시도·늦은 응답 버림)은 lib/useSideRequest. 공고는 엔진·데이터 버전과 무관한 외부 자료라
 * 버전 대조는 하지 않는다(expected null). 서버가 광고할 때만(request 가 null 이면 부르지 않는다).
 */
import { fetchSupportMatch, type SupportMatchBody } from '../api/client.ts'
import type { SupportMatchResponse } from '../api/schemas.ts'
import { SideCache, useSideRequest, type SideState } from './useSideRequest.ts'

export type SupportState = SideState<SupportMatchResponse>

const cache = new SideCache<SupportMatchResponse>(32)
const bodyOf = (key: string) => JSON.parse(key) as SupportMatchBody
const run = (body: SupportMatchBody, signal: AbortSignal) => fetchSupportMatch(body, signal)

/** 테스트용 */
export function clearSupportCache() {
  cache.clear()
}

/** body 의 키 순서를 고정해 같은 조건이면 같은 캐시 키 */
export function supportKey(b: SupportMatchBody): string {
  return JSON.stringify({ biz_code: b.biz_code, ...(b.gu ? { gu: b.gu } : {}), profile: b.profile, ...(b.limit !== undefined ? { limit: b.limit } : {}) })
}

export function useSupport(request: SupportMatchBody | null, token: unknown = null) {
  return useSideRequest(request ? supportKey(request) : null, bodyOf, run, cache, token)
}
