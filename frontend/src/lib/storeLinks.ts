/**
 * 점포의 네이버·구글 지도 연결 (묶음 B, docs/IMPROVEMENT_PLAN_2026-10.md 2-4, D-026).
 *
 * 데이터에는 상가업소번호·상호·주소·좌표만 있고 네이버·구글 장소 ID가 없다 — 상가업소번호는 두 서비스의 ID가 아니다(간주 금지).
 * 그래서 정확한 상세 페이지가 아니라 **검색 결과** 링크를 만든다. 화면 문구: "검색 결과로 열립니다(같은 가게가 아닐 수 있음)".
 *
 * - Google: https://www.google.com/maps/search/?api=1&query=<상호>,<주소> (Maps URLs 공식, 키 불필요, URL 인코딩, 2,048자 제한)
 * - NAVER: 공식은 앱 URL Scheme `nmap://search?query=…&appname=…`(앱 설치 필요)뿐이다. 웹 `map.naver.com/p/search/<검색어>`는
 *   비공식이라 **사용자가 브라우저에서 실측한 뒤에만** 쓴다 — `NAVER_WEB_SEARCH_VERIFIED`를 true로 바꾼다(기본 false = 앱 스킴만).
 * - 상호가 없으면 주소만, 주소도 없으면 링크를 만들지 않는다(검색어가 없다). 좌표로 검색하지 않는다(좌표는 데이터 라벨과 다를 수 있다).
 */

export type StoreLinks = { naver: string; google: string }

export type LinkableStore = { name: string | null; road_address: string | null; jibun_address: string | null }

/** 네이버 웹 검색 URL(비공식) 실측 통과 여부 — 사용자 확인 전에는 false (TASKS 9-B, D-026) */
export const NAVER_WEB_SEARCH_VERIFIED = false

/** Google Maps URLs 길이 제한 */
export const GOOGLE_MAPS_URL_MAX = 2048

const GOOGLE_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query='
const NAVER_WEB_SEARCH_BASE = 'https://map.naver.com/p/search/'
const NAVER_APP_SEARCH_BASE = 'nmap://search?query='

/** 공식 안내의 appname = 호출하는 서비스 식별자(웹은 URL). 브라우저 밖(테스트 등)에서는 고정 문자열 */
export function naverAppName(): string {
  return typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : 'harness-commercial'
}

/** 검색어 조각: 상호 → 주소(도로명 우선) 순. 둘 다 없으면 빈 배열 */
export function storeQueryParts(store: LinkableStore): string[] {
  const name = store.name?.trim()
  const address = (store.road_address ?? store.jibun_address)?.trim()
  return [name, address].filter((s): s is string => !!s)
}

/**
 * base + encodeURIComponent(text)가 max를 넘지 않게 text 끝을 자른다(인코딩 길이 기준 — 한글은 글자당 9자).
 * 잘려도 검색어로는 쓸 수 있다(앞부분이 상호·주소 앞머리)
 */
export function fitEncoded(base: string, text: string, max: number, suffix = ''): string {
  let t = text
  while (t.length > 0 && base.length + encodeURIComponent(t).length + suffix.length > max) t = t.slice(0, -1)
  return base + encodeURIComponent(t) + suffix
}

/** 선택 점포의 네이버·구글 검색 링크. 검색어가 없으면(상호·주소 모두 없음) null */
export function buildStoreLinks(store: LinkableStore): StoreLinks | null {
  const parts = storeQueryParts(store)
  if (parts.length === 0) return null
  const google = fitEncoded(GOOGLE_SEARCH_BASE, parts.join(','), GOOGLE_MAPS_URL_MAX)
  const query = parts.join(' ')
  const naver = NAVER_WEB_SEARCH_VERIFIED
    ? NAVER_WEB_SEARCH_BASE + encodeURIComponent(query)
    : `${NAVER_APP_SEARCH_BASE}${encodeURIComponent(query)}&appname=${encodeURIComponent(naverAppName())}`
  return { naver, google }
}

/** 두 링크 아래 안내 문구 (정보창·목록 공통) */
export const STORE_LINKS_NOTE = '검색 결과로 열립니다(같은 가게가 아닐 수 있음)'
