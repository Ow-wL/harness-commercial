import { useCallback, useRef, useState } from 'react'
import { fetchNearbyStores, type AnalyzeRequest } from '../api/client.ts'
import type { NearbyState } from '../components/NearbyStores.tsx'

/**
 * 반경 안 동종 점포 조회 1벌 (POST /nearby-stores, D-019). A 분석과 B 분석(5차-B5)이 각자 하나씩 쓴다 —
 * AbortController·요청 번호가 서로 섞이지 않는다.
 * - load: 이전 요청을 취소하고 새로 조회한다. 응답이 늦게 오면(요청 번호가 다르면) 버린다.
 *   응답 조건(좌표·업종)이 요청과 다르면 계약 오류로 다룬다.
 * - cancel: 진행 중인 요청을 취소하고 상태를 지운다(null). 그 뒤 도착한 응답은 버린다.
 * 실패는 이 상태에만 남는다 — 분석 결과는 건드리지 않는다.
 */
export function useNearbyRequest() {
  const [state, setState] = useState<NearbyState | null>(null)
  const inflight = useRef<{ seq: number; controller: AbortController } | null>(null)
  const seq = useRef(0)

  const cancel = useCallback(() => {
    inflight.current?.controller.abort()
    inflight.current = null
    setState(null)
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
        } else if (r.data.lat !== request.lat || r.data.lng !== request.lng || r.data.biz_code !== request.biz_code) {
          console.error('[api] /nearby-stores 응답 조건이 요청과 다릅니다', { request, data: r.data })
          setState({ status: 'error', failure: { kind: 'schema', endpoint: '/nearby-stores', status: 200 } })
        } else {
          setState({ status: 'success', data: r.data })
        }
      })
      .catch(() => {})                                     // 취소된 요청
  }, [])

  return { state, load, cancel }
}
