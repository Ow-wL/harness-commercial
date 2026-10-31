/**
 * 분석 결과 옆에 붙는 보조 요청(업종 순위 /rank 13-16, 시간대 자료 /insights 13-15)의 공통 훅.
 * - 요청 본문은 JSON 키 하나로 받는다(렌더마다 새 객체여도 같은 키면 다시 요청하지 않는다 — 무한 재요청 방지).
 * - 성공은 모듈 캐시(크기 상한, 오래된 것부터 버림)에 둔다. 키에 엔진·데이터 버전을 넣어 버전이 바뀌면 다시 받는다(Codex R1 개발자 2).
 * - 받은 응답의 **실제** 엔진·데이터 버전이 분석 결과와 다르면 표시도 캐시도 하지 않고 `stale` 로 둔다(Codex R1-9) — 키는 요청
 *   당시 분석의 버전이라, 그 사이 서버가 바뀌면 다른 자료가 한 화면에 섞이고 새 응답이 옛 버전 키 아래 남는다. 복구는 다시 분석
 *   (새 버전의 분석 → 새 키 → 같은 버전의 보조 응답).
 * - 실패는 자동으로 다시 요청하지 않는다. `retry()`(화면의 "다시 시도")나 새 분석 응답(`token` 이 바뀜)으로 다시 받는다(Codex R1-6).
 * - 조건이 바뀌면 이전 요청을 취소하고 늦게 온 응답은 버린다.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ApiFailure, ApiResult } from '../api/client.ts'
import { dataVersionOf } from './dataVersion.ts'

export type SideState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; failure: ApiFailure }
  /** 응답이 분석 결과와 다른 엔진·데이터 버전 — 보이지 않는다. 다시 분석하면 맞춰진다 */
  | { status: 'stale' }
  | { status: 'success'; data: T }

/** 분석 결과의 버전(대조 기준). data 는 X-Data-Version(모르면 null — 헤더 없는 서버·테스트) */
export type SideVersion = { engine: string; data: string | null }

/** 보조 응답이 기준과 같은 버전인가. 기준의 data 가 null(헤더 없는 서버)이면 데이터 버전은 대조하지 않는다 */
export function sameVersion(expected: SideVersion, got: { engine: string; data: string | null }): boolean {
  return got.engine === expected.engine && (expected.data === null || got.data === expected.data)
}

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

type Held = { key: string; token: unknown } & ({ kind: 'failure'; failure: ApiFailure } | { kind: 'stale' })

/**
 * key: JSON.stringify(body) + 버전 꼬리표 (null = 요청 없음). body 는 키에서 다시 읽는다(`bodyOf`).
 * token: 이 키의 실패·버전 불일치를 잊게 하는 값(새 분석 응답 객체) — 같은 키라도 token 이 바뀌면 다시 요청한다.
 * expected·engineOf: 응답의 엔진(본문)·데이터(헤더) 버전을 분석 결과와 대조한다. expected 가 null 이면 대조하지 않는다.
 */
export function useSideRequest<B, T extends object>(
  key: string | null,
  bodyOf: (key: string) => B,
  run: (body: B, signal: AbortSignal) => Promise<ApiResult<T>>,
  cache: SideCache<T>,
  token: unknown = null,
  expected: SideVersion | null = null,
  engineOf: (data: T) => string = () => '',
): SideState<T> & { retry: () => void } {
  const [held, setHeld] = useState<Held | null>(null)
  const [, bump] = useState(0)
  const heldHere = held !== null && held.key === key && held.token === token ? held : null
  const expEngine = expected?.engine ?? null
  const expData = expected?.data ?? null
  useEffect(() => {
    if (!key || cache.has(key) || heldHere) return
    const ac = new AbortController()
    run(bodyOf(key), ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        if (!r.ok) {
          setHeld({ key, token, kind: 'failure', failure: r.failure })
        } else if (expEngine !== null && !sameVersion({ engine: expEngine, data: expData }, { engine: engineOf(r.data), data: dataVersionOf(r.data) })) {
          setHeld({ key, token, kind: 'stale' })                    // 저장하지 않는다 — 옛 버전 키 아래 새 응답이 남지 않게
        } else {
          cache.set(key, r.data)
          bump((n) => n + 1)
        }
      })
      .catch(() => {})                                     // 취소
    return () => ac.abort()
  }, [key, token, heldHere, cache, run, bodyOf, expEngine, expData, engineOf])
  const retry = useCallback(() => setHeld(null), [])
  if (!key) return { status: 'idle', retry }
  const data = cache.get(key)
  if (data !== undefined) return { status: 'success', data, retry }
  if (heldHere?.kind === 'failure') return { status: 'error', failure: heldHere.failure, retry }
  if (heldHere?.kind === 'stale') return { status: 'stale', retry }
  return { status: 'loading', retry }
}
