/**
 * NAVER Geocoder adapter (docs/ADDRESS_DESIGN.md §5.1, 7-B1). naver.maps.Service의 콜백 API를 Promise + 결과 객체로 바꾼다.
 *
 * - 분석 상태를 모른다. 어떤 실패도 throw하지 않고 결과 객체(`status: 'error'`)로만 돌려준다 — SDK 호출 중 동기 예외 포함.
 * - 오류 분류는 SDK가 실제로 준 정보 안에서만 한다. 콜백 status가 ERROR이고 응답이 없으면 `unknown`(원인 불명) —
 *   HTTP 403/429/네트워크를 구별하거나 추정하지 않는다.
 * - 콜백이 8초 안에 오지 않으면 `timeout`. 그 뒤(또는 두 번째로) 온 콜백은 무시한다.
 * - 좌표: SDK는 x(경도)·y(위도)를 문자열로 준다. 숫자 형식·유한성·위경도 범위만 검사한다(빈 문자열·공백을 0으로 만들지 않는다).
 *   인천 밖이라는 이유로 거부하지 않는다 — 분석 가능 여부는 backend가 판정한다.
 * - 주소 문자열은 trim + 연속 공백 1칸(실제 응답에 이중 공백이 있다, §11.3). 빈 문자열은 null.
 * - 인증값은 다루지 않는다(Client ID는 SDK script URL에만 있고 여기서는 모른다). 로그에는 분류·status만 남긴다.
 */
import { z } from 'zod'
import { isGeocoderAvailable, type NaverMapsApi, type NaverServiceCallback } from './naverMaps.ts'

export type LatLngPoint = { lat: number; lng: number }

export type GeocoderErrorKind =
  | 'unavailable'   // Service가 없다 (서브모듈 미준비·실패) — 부르기 전에 걸러진다
  | 'invalid'       // SDK: INVALID_REQUEST / reverse code 100
  | 'system'        // SDK: SYSTEM_ERROR / reverse code 900
  | 'unknown'       // SDK ERROR + 응답 없음, 알 수 없는 status, 동기 예외
  | 'timeout'       // 콜백이 GEOCODER_CALL_TIMEOUT_MS 안에 안 옴
  | 'schema'        // 응답이 있으나 구조·좌표가 계약과 다름

export type GeocodeItem = {
  roadAddress: string | null
  jibunAddress: string | null
  lat: number
  lng: number
  /** addressElements의 SIDO (정렬·표시 보조용. 분석 가능 여부 판정에 쓰지 않는다) */
  sido: string | null
  /** 요청 coordinate 기준 거리(m). coordinate를 주지 않으면 null */
  distanceM: number | null
}

export type GeocodeResult =
  | { status: 'ok'; items: GeocodeItem[] }
  | { status: 'empty' }
  | { status: 'error'; kind: GeocoderErrorKind }

export type AddressResult =
  | { status: 'ok'; roadAddress: string | null; jibunAddress: string | null }
  | { status: 'none' }
  | { status: 'error'; kind: GeocoderErrorKind }

export type GeocodeOptions = {
  /** 결과 정렬 기준점 (가까운 순). SDK에는 'lng,lat' 문자열로 넘긴다 */
  coordinate?: LatLngPoint
  /** 1~100, SDK 기본 10 */
  count?: number
}

export const GEOCODER_CALL_TIMEOUT_MS = 8_000
export const REVERSE_ORDERS = 'roadaddr,addr'

// ─── 응답 schema (쓰는 필드만, 나머지는 통과) ──────────────────────────
const addressElementSchema = z.looseObject({
  types: z.array(z.string()).optional(),
  longName: z.string().optional(),
  shortName: z.string().optional(),
})

const geocodeAddressSchema = z.looseObject({
  roadAddress: z.string().nullish(),
  jibunAddress: z.string().nullish(),
  addressElements: z.array(addressElementSchema).optional(),
  x: z.unknown(),
  y: z.unknown(),
  distance: z.unknown().optional(),
})

const geocodeResponseSchema = z.looseObject({
  v2: z.looseObject({
    status: z.string(),
    meta: z.looseObject({ totalCount: z.number().optional() }).optional(),
    addresses: z.array(geocodeAddressSchema).optional(),
    errorMessage: z.string().optional(),
  }),
})

const reverseResponseSchema = z.looseObject({
  v2: z.looseObject({
    status: z.looseObject({ code: z.number(), name: z.string().optional(), message: z.string().optional() }),
    address: z.looseObject({ roadAddress: z.string().nullish(), jibunAddress: z.string().nullish() }).optional(),
  }),
})

// ─── 값 변환 ─────────────────────────────────────────────────────
/** trim + 연속 공백 1칸. 문자열이 아니거나 비면 null */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text === '' ? null : text
}

const DECIMAL = /^-?\d+(\.\d+)?$/

/** SDK 좌표 문자열 → 숫자. 형식·유한성·범위만 본다 (빈 문자열·공백·'abc'는 null, 0이 아니다) */
export function parseCoordinate(value: unknown, kind: 'lat' | 'lng'): number | null {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!DECIMAL.test(text)) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const limit = kind === 'lat' ? 90 : 180
  return Math.abs(n) <= limit ? n : null
}

function sidoOf(elements: z.infer<typeof addressElementSchema>[] | undefined): string | null {
  const el = elements?.find((e) => e.types?.includes('SIDO'))
  return normalizeAddress(el?.longName) ?? normalizeAddress(el?.shortName)
}

function distanceOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function warn(method: string, kind: GeocoderErrorKind, status?: number): void {
  console.warn(`[geocoder] ${method} 실패`, { kind, status })
}

// ─── SDK 콜백 → Promise ───────────────────────────────────────────
type Outcome = { status: number; response: unknown } | { timedOut: true } | { threw: true }

/**
 * SDK 메서드를 한 번 부르고 첫 콜백만 받는다. 8초 안에 콜백이 없으면 timeout.
 * 두 번째 콜백·timeout 뒤 콜백은 무시한다. invoke가 동기 예외를 던지면 타이머를 바로 지우고 그 호출을 종료 상태로
 * 두며(`threw`), 그 뒤 도착하는 콜백도 무시한다. 이 Promise는 reject하지 않는다 — 정방향·역방향이 같은 규칙을 쓴다.
 */
function callOnce(invoke: (callback: NaverServiceCallback) => void): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ timedOut: true })
    }, GEOCODER_CALL_TIMEOUT_MS)
    const settle = (outcome: Outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    try {
      invoke((status, response) => settle({ status, response }))
    } catch {
      settle({ threw: true })
    }
  })
}

// ─── 정방향 ──────────────────────────────────────────────────────
export async function geocode(api: NaverMapsApi | null | undefined, query: string, options: GeocodeOptions = {}): Promise<GeocodeResult> {
  if (!isGeocoderAvailable(api)) return { status: 'error', kind: 'unavailable' }
  const service = api!.Service!
  const sdkOptions: Record<string, unknown> = { query }
  if (options.coordinate) sdkOptions.coordinate = `${options.coordinate.lng},${options.coordinate.lat}`
  if (options.count !== undefined) sdkOptions.count = options.count

  const outcome = await callOnce((cb) => service.geocode(sdkOptions, cb))
  if ('threw' in outcome) {
    warn('geocode', 'unknown')                                 // SDK가 동기 예외 — 원인 불명으로 둔다
    return { status: 'error', kind: 'unknown' }
  }
  if ('timedOut' in outcome) {
    warn('geocode', 'timeout')
    return { status: 'error', kind: 'timeout' }
  }

  const parsed = geocodeResponseSchema.safeParse(outcome.response)
  if (outcome.status !== service.Status.OK) {
    // 실패 콜백: SDK가 v2.status를 함께 줬을 때만 그 값으로 나눈다. 응답이 없으면 원인 불명
    const kind = parsed.success ? kindOfGeocodeStatus(parsed.data.v2.status) : 'unknown'
    warn('geocode', kind, outcome.status)
    return { status: 'error', kind }
  }
  if (!parsed.success) {
    warn('geocode', 'schema', outcome.status)
    return { status: 'error', kind: 'schema' }
  }
  const { v2 } = parsed.data
  if (v2.status !== 'OK') {
    const kind = kindOfGeocodeStatus(v2.status)
    warn('geocode', kind, outcome.status)
    return { status: 'error', kind }
  }
  // 성공 응답(OK + v2.status OK)에는 addresses 배열이 있어야 한다. 없으면 "결과 없음"이 아니라 계약 위반(schema).
  // 형식이 잘못된 addresses(배열 아님·항목 구조 다름)는 위 safeParse에서 이미 schema로 걸러졌다. 정상적인 []만 empty
  const addresses = v2.addresses
  if (addresses === undefined) {
    warn('geocode', 'schema', outcome.status)
    return { status: 'error', kind: 'schema' }
  }
  if (addresses.length === 0) return { status: 'empty' }

  const items: GeocodeItem[] = []
  for (const a of addresses) {
    const lat = parseCoordinate(a.y, 'lat')
    const lng = parseCoordinate(a.x, 'lng')
    if (lat === null || lng === null) {
      warn('geocode', 'schema', outcome.status)                // 좌표 없는 결과는 계약 위반 — 0으로 만들지 않는다
      return { status: 'error', kind: 'schema' }
    }
    items.push({
      roadAddress: normalizeAddress(a.roadAddress),
      jibunAddress: normalizeAddress(a.jibunAddress),
      lat,
      lng,
      sido: sidoOf(a.addressElements),
      distanceM: distanceOf(a.distance),
    })
  }
  return { status: 'ok', items }
}

function kindOfGeocodeStatus(status: string): GeocoderErrorKind {
  if (status === 'INVALID_REQUEST') return 'invalid'
  if (status === 'SYSTEM_ERROR') return 'system'
  return 'unknown'
}

// ─── 역방향 ──────────────────────────────────────────────────────
export async function reverseGeocode(api: NaverMapsApi | null | undefined, point: LatLngPoint): Promise<AddressResult> {
  if (!isGeocoderAvailable(api)) return { status: 'error', kind: 'unavailable' }
  const service = api!.Service!
  const sdkOptions = { coords: `${point.lng},${point.lat}`, orders: REVERSE_ORDERS }

  const outcome = await callOnce((cb) => service.reverseGeocode(sdkOptions, cb))
  if ('threw' in outcome) {
    warn('reverseGeocode', 'unknown')
    return { status: 'error', kind: 'unknown' }
  }
  if ('timedOut' in outcome) {
    warn('reverseGeocode', 'timeout')
    return { status: 'error', kind: 'timeout' }
  }

  const parsed = reverseResponseSchema.safeParse(outcome.response)
  if (outcome.status !== service.Status.OK) {
    const kind = parsed.success ? kindOfReverseCode(parsed.data.v2.status.code) : 'unknown'
    warn('reverseGeocode', kind, outcome.status)
    return { status: 'error', kind }
  }
  if (!parsed.success) {
    warn('reverseGeocode', 'schema', outcome.status)
    return { status: 'error', kind: 'schema' }
  }
  const { v2 } = parsed.data
  if (v2.status.code === 3) return { status: 'none' }
  if (v2.status.code !== 0) {
    const kind = kindOfReverseCode(v2.status.code)
    warn('reverseGeocode', kind, outcome.status)
    return { status: 'error', kind }
  }
  const roadAddress = normalizeAddress(v2.address?.roadAddress)
  const jibunAddress = normalizeAddress(v2.address?.jibunAddress)
  if (roadAddress === null && jibunAddress === null) return { status: 'none' }   // 성공이어도 보여 줄 주소가 없다
  return { status: 'ok', roadAddress, jibunAddress }
}

function kindOfReverseCode(code: number): GeocoderErrorKind {
  if (code === 100) return 'invalid'
  if (code === 900) return 'system'
  return 'unknown'
}
