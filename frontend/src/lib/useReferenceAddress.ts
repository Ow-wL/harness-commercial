import { useEffect, useReducer } from 'react'
import type { LatLngPoint } from '../map/geocoder.ts'
import type { SdkState } from '../map/naverMaps.ts'
import { addressKey, lookupAddress, peekAddress } from './addressCache.ts'

export type ReferenceAddress = { roadAddress: string | null; jibunAddress: string | null }

/**
 * 좌표 하나의 참고 주소 (docs/ADDRESS_DESIGN.md §5.3, 7-B2). 성공(`ok`)일 때만 값을 돌려주고, 로딩·오류·주소 없음·SDK 미준비는 null.
 *
 * - `sdk`가 `ready`이고 `geocoder: 'ready'`일 때만 조회한다. 준비 전·`unavailable`·`failed`에서는 조회하지 않고 **캐시된 주소도 보이지 않는다**
 *   (인증 실패 뒤 이전 api로 호출하지 않고, 진행 중이던 응답도 화면에 돌아오지 못한다).
 * - 화면에 보이는 값은 항상 "현재 키"의 캐시에서 읽는다. 좌표가 바뀐 첫 렌더부터 이전 좌표의 주소는 보이지 않고,
 *   늦게 온 응답은 자기 키의 캐시에만 들어가므로 다른 좌표의 화면에 나타나지 않는다.
 * - 의존성은 좌표 객체가 아니라 키 문자열이다 — 같은 좌표를 담은 새 객체가 매번 와도 다시 조회하지 않는다.
 * - 조회 1회의 공유(StrictMode·여러 자리)·LRU·오류 60초 재사용은 addressCache가 맡는다. 여기에는 타이머가 없다.
 */
export function useReferenceAddress(sdk: SdkState, point: LatLngPoint | null): ReferenceAddress | null {
  const enabled = sdk.status === 'ready' && sdk.geocoder === 'ready' && point !== null
  const api = sdk.status === 'ready' ? sdk.api : null
  const key = point ? addressKey(point) : null
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!enabled || !api || !key || !point) return
    if (peekAddress(key)) return                                  // ok·none·아직 유효한 error → 조회 없음
    let active = true
    lookupAddress(api, point).then(() => {
      if (active) rerender()                                      // 같은 키·같은 SDK 상태로 아직 떠 있을 때만 다시 그린다
    })
    return () => {
      active = false
    }
    // point 객체가 아니라 key(좌표 숫자 그대로)로 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, api, key])

  if (!enabled || !key) return null
  const entry = peekAddress(key)
  return entry?.status === 'ok' ? { roadAddress: entry.roadAddress, jibunAddress: entry.jibunAddress } : null
}
