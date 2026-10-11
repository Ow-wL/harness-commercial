/**
 * 참고 주소 캐시 (docs/ADDRESS_DESIGN.md §5.3, 7-B2). 좌표 키 → 역지오코딩 결과를 모듈 수준에 둔다.
 *
 * - 키는 요청에 쓴 숫자 그대로 `${lat},${lng}` — 추가 반올림 없음(지도 클릭은 이미 6자리, 입력값은 사용자가 쓴 그대로).
 *   같은 좌표면 분석 전 위치 필드·mobile sheet·분석 후 결과 패널(context 좌표 = 요청 좌표)이 모두 같은 키다.
 * - 완료 결과는 LRU 100개. `ok`·`none`은 세션 동안 유지, `error`는 기록 뒤 60초까지 재사용하고 만료 뒤 **다음 조회 때만** 다시
 *   부른다 — 타이머·자동 재시도는 없다.
 * - 같은 키의 진행 중 조회는 Promise를 공유한다(StrictMode 두 번 실행, 여러 표시 자리 → SDK 호출 1회).
 * - 늦게 온 응답은 자기 키에만 기록된다. "지금 화면에 보일지"는 hook(useReferenceAddress)이 현재 키·SDK 상태로 정한다.
 */
import { reverseGeocode, type AddressResult, type LatLngPoint } from '../map/geocoder.ts'
import type { NaverMapsApi } from '../map/naverMaps.ts'

export type AddressEntry =
  | { status: 'ok'; roadAddress: string | null; jibunAddress: string | null }
  | { status: 'none' }
  | { status: 'error'; kind: string; expiresAt: number }

export const ADDRESS_CACHE_MAX = 100
export const ADDRESS_ERROR_TTL_MS = 60_000

const entries = new Map<string, AddressEntry>()
const inflight = new Map<string, Promise<AddressEntry>>()

export function addressKey(point: LatLngPoint): string {
  return `${point.lat},${point.lng}`
}

/** 쓸 수 있는 캐시 항목. 만료된 error는 없는 것으로 본다(다음 조회가 다시 부른다) */
export function peekAddress(key: string, now: number = Date.now()): AddressEntry | undefined {
  const entry = entries.get(key)
  if (!entry) return undefined
  if (entry.status === 'error' && entry.expiresAt <= now) {
    entries.delete(key)
    return undefined
  }
  entries.delete(key)                                  // LRU: 읽어도 최신으로
  entries.set(key, entry)
  return entry
}

function store(key: string, entry: AddressEntry): void {
  entries.delete(key)
  entries.set(key, entry)
  while (entries.size > ADDRESS_CACHE_MAX) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

function toEntry(result: AddressResult, now: number): AddressEntry {
  if (result.status === 'ok') return { status: 'ok', roadAddress: result.roadAddress, jibunAddress: result.jibunAddress }
  if (result.status === 'none') return { status: 'none' }
  return { status: 'error', kind: result.kind, expiresAt: now + ADDRESS_ERROR_TTL_MS }
}

/**
 * 좌표의 참고 주소를 돌려준다 — 캐시에 있으면 바로, 진행 중이면 그 Promise, 아니면 1회 조회해 기록한다.
 * api는 호출 시점의 SDK다. 결과를 "지금 보여도 되는지"는 부르는 쪽이 판단한다.
 */
export function lookupAddress(api: NaverMapsApi, point: LatLngPoint, now: () => number = Date.now): Promise<AddressEntry> {
  const key = addressKey(point)
  const cached = peekAddress(key, now())
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = reverseGeocode(api, point).then((result) => {
    const entry = toEntry(result, now())
    store(key, entry)                                  // 늦게 와도 자기 키에만
    inflight.delete(key)
    return entry
  })
  inflight.set(key, promise)
  return promise
}

/** 테스트 전용 */
export function resetAddressCacheForTest(): void {
  entries.clear()
  inflight.clear()
}

/** 테스트 전용: 완료 결과 수 */
export function addressCacheSizeForTest(): number {
  return entries.size
}
