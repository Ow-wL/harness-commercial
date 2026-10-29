/**
 * 조건 공유 링크 (12-3, 계획 1-1): 분석 조건(좌표·업종·반경, 비교 B 좌표)을 URL 쿼리에 싣고, 그 링크로 열면
 * **같은 조건으로 다시 분석**한다. 저장된 점수는 링크에 없다 — 데이터 묶음·엔진 버전이 바뀌면 결과가 달라질 수 있어
 * 점수를 싣지 않고, 링크를 만든 시점의 데이터 묶음·엔진만 함께 실어 지금 서버와 다르면 안내한다(App).
 *
 * - 쿼리 키: lat · lng · biz · r(반경 m, 서버 기본이면 생략) · blat · blng(비교 B) · data(데이터 묶음) · engine(엔진 버전)
 * - 값 검증: 좌표는 유한한 숫자·범위 안, 업종은 코드 형식(영문 1 + 숫자 5), 반경은 양의 정수. 하나라도 어긋나면 링크 전체를
 *   무시한다(null) — 잘못된 링크로 엉뚱한 조건을 분석하지 않는다. B·data·engine 은 선택이며 어긋나면 그 값만 뺀다.
 * - 좌표는 쓴 숫자 그대로(반올림·변환 없음). 분석 요청 좌표도 이 값이다.
 */

export type SharePoint = { lat: number; lng: number }

export type ShareConditions = {
  lat: number
  lng: number
  biz: string
  /** 요청 반경 m. null = 링크에 없음(서버 기본) */
  radius: number | null
  /** 비교 B 좌표. null = 비교 없음 */
  b: SharePoint | null
  /** 링크를 만든 시점의 데이터 묶음 id (모르면 null) */
  data: string | null
  /** 링크를 만든 시점의 엔진 버전 (모르면 null) */
  engine: string | null
}

const BIZ_CODE = /^[A-Z]\d{5}$/
const VERSION_TAG = /^[\w.-]{1,32}$/

function number(value: string | null): number | null {
  if (value === null || value.trim() === '' || !/^-?\d+(\.\d+)?$/.test(value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function point(lat: string | null, lng: string | null): SharePoint | null {
  const la = number(lat)
  const ln = number(lng)
  if (la === null || ln === null || la < -90 || la > 90 || ln < -180 || ln > 180) return null
  return { lat: la, lng: ln }
}

/** `location.search`(또는 "?lat=…" 문자열) → 조건. 조건이 없거나(필수 키 없음) 어긋나면 null */
export function parseShareQuery(search: string): ShareConditions | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (!params.has('lat') && !params.has('lng') && !params.has('biz')) return null
  const a = point(params.get('lat'), params.get('lng'))
  const biz = params.get('biz') ?? ''
  if (!a || !BIZ_CODE.test(biz)) return null
  const r = params.get('r')
  let radius: number | null = null
  if (r !== null) {
    if (!/^\d+$/.test(r) || Number(r) <= 0) return null
    radius = Number(r)
  }
  const b = params.has('blat') || params.has('blng') ? point(params.get('blat'), params.get('blng')) : null
  const tag = (key: string) => {
    const v = params.get(key)
    return v !== null && VERSION_TAG.test(v) ? v : null
  }
  return { ...a, biz, radius, b, data: tag('data'), engine: tag('engine') }
}

/** 조건 → 쿼리 문자열("lat=…&lng=…", 앞 "?" 없음). 반경 null·B null·버전 null 은 키를 만들지 않는다 */
export function shareQuery(c: ShareConditions): string {
  const params = new URLSearchParams()
  params.set('lat', String(c.lat))
  params.set('lng', String(c.lng))
  params.set('biz', c.biz)
  if (c.radius !== null) params.set('r', String(c.radius))
  if (c.b) {
    params.set('blat', String(c.b.lat))
    params.set('blng', String(c.b.lng))
  }
  if (c.data) params.set('data', c.data)
  if (c.engine) params.set('engine', c.engine)
  return params.toString()
}

/** 지금 페이지 주소(경로까지) + 조건 쿼리. 해시는 싣지 않는다 */
export function shareUrl(c: ShareConditions, base: string = `${window.location.origin}${window.location.pathname}`): string {
  return `${base}?${shareQuery(c)}`
}

/**
 * 링크를 만든 시점과 지금 서버의 버전이 다른지 — 링크에 버전이 있고 지금 서버의 값을 알며 다를 때만 true.
 * (둘 중 하나를 모르면 비교하지 않는다: 안내를 지어내지 않는다)
 */
export function versionsDiffer(link: Pick<ShareConditions, 'data' | 'engine'>, now: { data: string | null; engine: string | null }): boolean {
  return (link.data !== null && now.data !== null && link.data !== now.data) ||
    (link.engine !== null && now.engine !== null && link.engine !== now.engine)
}
