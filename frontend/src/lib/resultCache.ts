/**
 * 분석 결과 캐시 (8-D3, docs/UX_REDESIGN.md 4.3). frontend 세션 메모리 — 새로고침하면 없어진다.
 *
 * - 조건 키 K = (lat, lng, biz_code, radius_m). radius_m 은 요청 반경(없으면 500)
 * - 항목 {analyze, nearby | null}, LRU 12. 적중이면 요청하지 않는다. 점포만 실패한 항목은 nearby = null(부분 캐시)
 * - 저장은 활성 요청의 성공 응답만 — 호출하는 쪽(App)이 요청 번호를 확인한 뒤에만 put 한다
 * - 응답 엔진버전 또는 데이터 버전(9-C4, 응답 헤더 X-Data-Version)이 이 캐시의 첫 응답과 다르면 전체 폐기 뒤 새 버전으로 시작한다
 * - 서버가 바뀌어 반경 선택을 잃으면(4.6 R1·R2) 반경 ≠ 500 항목을 모두 버린다
 */
import { requestRadius, type AnalyzeRequest } from '../api/client.ts'
import type { AnalyzeResponse, NearbyStoresResponse } from '../api/schemas.ts'
import { dataVersionOf } from './dataVersion.ts'

export const RESULT_CACHE_SIZE = 12

export type CacheEntry = { analyze: AnalyzeResponse; nearby: NearbyStoresResponse | null }

export const cacheKey = (req: AnalyzeRequest): string => `${req.lat},${req.lng},${req.biz_code},${requestRadius(req)}`

export class ResultCache {
  private entries = new Map<string, CacheEntry>()     // 삽입 순서 = 최근 사용 순서(뒤가 최신)
  private version: string | null = null
  private data: string | null = null

  constructor(private readonly size = RESULT_CACHE_SIZE) {}

  /** 읽기만 — 최근 사용 순서를 바꾸지 않는다 (반경별 비교 표가 매 렌더 읽는다, 12-26) */
  peek(req: AnalyzeRequest): CacheEntry | undefined {
    return this.entries.get(cacheKey(req))
  }

  get(req: AnalyzeRequest): CacheEntry | undefined {
    const key = cacheKey(req)
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    return entry
  }

  /** 분석 성공 응답 저장. 같은 키에 점포가 있었으면 지운다(새 분석과 짝이 아닐 수 있다) */
  putAnalyze(req: AnalyzeRequest, analyze: AnalyzeResponse): void {
    const v = analyze.result.meta.엔진버전
    const d = dataVersionOf(analyze)
    // 엔진버전·데이터 버전이 바뀌면 전체 폐기 — 다른 버전의 결과를 섞어 보이지 않는다
    if (this.version !== null && (this.version !== v || this.data !== d)) this.entries.clear()
    this.version = v
    this.data = d
    const key = cacheKey(req)
    this.entries.delete(key)
    this.entries.set(key, { analyze, nearby: null })
    while (this.entries.size > this.size) this.entries.delete(this.entries.keys().next().value!)
  }

  /** 점포 성공 응답을 그 분석 항목에 채운다. 분석 항목이 없으면(밀려났거나 폐기) 저장하지 않는다 */
  putNearby(req: AnalyzeRequest, nearby: NearbyStoresResponse): void {
    const entry = this.entries.get(cacheKey(req))
    if (entry) entry.nearby = nearby
  }

  /** 반경 ≠ keep 항목을 모두 버린다 (4.6 공통 복구) */
  dropRadiusOtherThan(keep: number): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.analyze.result.meta.분석반경_m !== keep) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
    this.version = null
    this.data = null
  }

  /** 이 캐시 항목들의 엔진버전 (아직 없으면 null) — 반경 복구 때 /health 광고 버전과 대조한다 */
  get engineVersion(): string | null {
    return this.version
  }

  /** 이 캐시 항목들의 데이터 버전 (응답 헤더가 없었으면 null) — 반경 복구 때 /health data.version 과 대조한다 */
  get dataVersion(): string | null {
    return this.data
  }

  get sizeNow(): number {
    return this.entries.size
  }
}
