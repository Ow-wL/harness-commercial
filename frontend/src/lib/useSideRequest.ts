/**
 * 분석 결과 옆에 붙는 보조 요청(업종 순위 /rank 13-16, 시간대 자료 /insights 13-15)의 공통 훅.
 * - 요청 본문은 JSON 키 하나로 받는다(렌더마다 새 객체여도 같은 키면 다시 요청하지 않는다 — 무한 재요청 방지).
 * - 성공은 모듈 캐시(크기 상한, 오래된 것부터 버림)에 둔다. 키에 엔진·데이터 버전을 넣어 버전이 바뀌면 다시 받는다(Codex R1 개발자 2).
 * - 실패는 자동으로 다시 요청하지 않는다. `retry()`(화면의 "다시 시도")나 새 분석 응답(`token` 이 바뀜)으로 다시 받는다(Codex R1-6).
 * - 조건이 바뀌면 이전 요청을 취소하고 늦게 온 응답은 버린다.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ApiFailure, ApiResult } from '../api/client.ts'

export type SideState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; failure: ApiFailure }
  | { status: 'success'; data: T }

/** 크기 상한이 있는 LRU (Map 삽입 순서) */
export class SideCache<T> {
  private readonly map = new Map<string, T>()
  constructor(private readonly max: number) {}
  get(key: string): T | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }
  has(key: string): boolean {
    return this.map.has(key)
  }
  set(key: string, value: T) {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!)
  }
  clear() {
    this.map.clear()
  }
  get size() {
    return this.map.size
  }
}

/**
 * key: JSON.stringify(body) + 버전 꼬리표 (null = 요청 없음). body 는 키에서 다시 읽는다(`bodyOf`).
 * token: 이 키의 실패를 잊게 하는 값(새 분석 응답 객체) — 같은 키라도 token 이 바뀌면 실패를 다시 시도한다.
 */
export function useSideRequest<B, T>(
  key: string | null,
  bodyOf: (key: string) => B,
  run: (body: B, signal: AbortSignal) => Promise<ApiResult<T>>,
  cache: SideCache<T>,
  token: unknown = null,
): SideState<T> & { retry: () => void } {
  const [failed, setFailed] = useState<{ key: string; token: unknown; failure: ApiFailure } | null>(null)
  const [, bump] = useState(0)
  const failedHere = failed !== null && failed.key === key && failed.token === token
  useEffect(() => {
    if (!key || cache.has(key) || failedHere) return
    const ac = new AbortController()
    run(bodyOf(key), ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        if (r.ok) {
          cache.set(key, r.data)
          bump((n) => n + 1)
        } else {
          setFailed({ key, token, failure: r.failure })
        }
      })
      .catch(() => {})                                     // 취소
    return () => ac.abort()
  }, [key, token, failedHere, cache, run, bodyOf])
  const retry = useCallback(() => setFailed(null), [])
  if (!key) return { status: 'idle', retry }
  const data = cache.get(key)
  if (data !== undefined) return { status: 'success', data, retry }
  if (failedHere) return { status: 'error', failure: failed.failure, retry }
  return { status: 'loading', retry }
}
