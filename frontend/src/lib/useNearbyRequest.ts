import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fetchNearbyStores, requestRadius, type AnalyzeRequest } from '../api/client.ts'
import type { NearbyStoresResponse } from '../api/schemas.ts'
import type { NearbyState } from '../components/NearbyStores.tsx'

/** 반경 문제 (8-D3, docs/UX_REDESIGN.md 4.6): 응답 반경이 요청과 다름(R1) · 서버가 반경을 받지 않음(R2, invalid_radius) */
export type RadiusProblem = 'mismatch' | 'invalid'

type Options = {
  /** 활성 요청의 성공 응답 — 결과 캐시에 넣는다(8-D3) */
  onSuccess?: (request: AnalyzeRequest, data: NearbyStoresResponse) => void
  /** 반경 문제 — App이 /health 를 다시 보고 복구할지 정한다. 이 상태는 오류로 둔다 */
  onRadiusProblem?: (request: AnalyzeRequest, problem: RadiusProblem) => void
}

/**
 * 반경 안 동종 점포 조회 1벌 (POST /nearby-stores, D-019). A 분석과 B 분석(5차-B5)이 각자 하나씩 쓴다 —
 * AbortController·요청 번호가 서로 섞이지 않는다.
 * - load: 이전 요청을 취소하고 새로 조회한다. 응답이 늦게 오면(요청 번호가 다르면) 버린다.
 *   응답 조건(좌표·업종·반경)이 요청과 다르면 계약 오류로 다룬다.
 * - prime: 캐시에 있는 응답으로 바로 채운다(요청 없음, 8-D3). 진행 중 요청은 취소한다.
 * - cancel: 진행 중인 요청을 취소하고 상태를 지운다(null). 그 뒤 도착한 응답은 버린다.
 * 실패는 이 상태에만 남는다 — 분석 결과는 건드리지 않는다.
 */
export function useNearbyRequest(options: Options = {}) {
  const [state, setState] = useState<NearbyState | null>(null)
  const inflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const seq = useRef(0)
  const optionsRef = useRef(options)
  useLayoutEffect(() => {
    optionsRef.current = options
  })

  const cancel = useCallback(() => {
    inflight.current?.controller.abort()
    inflight.current = null
    setState(null)
  }, [])

  const prime = useCallback((data: NearbyStoresResponse) => {
    inflight.current?.controller.abort()
    inflight.current = null
    seq.current++
    setState({ status: 'success', data })
  }, [])

  const load = useCallback((request: AnalyzeRequest) => {
    inflight.current?.controller.abort()
    const current = { seq: ++seq.current, controller: new AbortController() }
    inflight.current = current
    setState({ status: 'loading' })

    fetchNearbyStores(request, current.controller.signal)
      .then((r) => {
        if (inflight.current?.seq !== current.seq) return
        inflight.current = null
        if (!r.ok) {
          setState({ status: 'error', failure: r.failure })
          if (r.failure.kind === 'api' && r.failure.error.code === 'invalid_radius') {
            optionsRef.current.onRadiusProblem?.(request, 'invalid')
          }
        } else if (r.data.lat !== request.lat || r.data.lng !== request.lng || r.data.biz_code !== request.biz_code) {
          console.error('[api] /nearby-stores 응답 조건이 요청과 다릅니다', { request, data: r.data })
          setState({ status: 'error', failure: { kind: 'schema', endpoint: '/nearby-stores', status: 200 } })
        } else if (r.data.radius_m !== requestRadius(request)) {
          console.error('[api] /nearby-stores 응답 반경이 요청과 다릅니다', { request, radius_m: r.data.radius_m })
          setState({ status: 'error', failure: { kind: 'schema', endpoint: '/nearby-stores', status: 200 } })
          optionsRef.current.onRadiusProblem?.(request, 'mismatch')
        } else {
          setState({ status: 'success', data: r.data })
          optionsRef.current.onSuccess?.(request, r.data)
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }, [])

  return { state, load, prime, cancel }
}
