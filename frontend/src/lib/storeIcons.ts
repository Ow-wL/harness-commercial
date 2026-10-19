/**
 * 업종별 점포 아이콘 (묶음 B, docs/IMPROVEMENT_PLAN_2026-10.md 2-3, DESIGN.md §8.11·§13, D-026).
 *
 * - 29업종(엔진 config.BIZ_GROUP)을 12개 글리프로 묶는다(폴백 `store` 1개). 표는 여기 한 곳이고 테스트가 29코드 전부를 대조한다.
 * - 글리프는 Lucide(ISC) 아이콘의 24 grid path를 inline SVG로 둔 것이다 — 라이브러리 의존성은 넣지 않는다(§13 "세트 하나만").
 *   원본: lucide-static v0.544.0 (https://lucide.dev), 라이선스 전문 `frontend/THIRD_PARTY_NOTICES.md`.
 *   stroke 굵기는 지도 마커 크기에 맞춰 CSS(`MapView.css`)가 정한다(§13 "stroke 조정 가능").
 * - 표현 전환(줌·개수, 2-3): 래스터 기준 줌 ≥15 아이콘 24px / 13~14 아이콘 16px / ≤12 점. 같은 줌에서 N ≥ 80이면 점.
 *   클러스터링은 하지 않는다(단순 임계).
 *
 * ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2023 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2025.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted,
 * provided that the above copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR
 * CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/** 글리프 이름 = Lucide 아이콘 이름 */
export type StoreGlyph =
  | 'coffee'
  | 'croissant'
  | 'utensils'
  | 'pizza'
  | 'beer'
  | 'shopping-basket'
  | 'scissors'
  | 'book-open'
  | 'gamepad-2'
  | 'dumbbell'
  | 'washing-machine'
  | 'pill'
  | 'store'

/** 표에 없는 업종코드의 글리프 */
export const STORE_GLYPH_FALLBACK: StoreGlyph = 'store'

/** 글리프 묶음 이름(문서·테스트용 — 화면 범례는 "같은 업종 점포" 그대로) */
export const STORE_GLYPH_LABEL: Readonly<Record<StoreGlyph, string>> = {
  coffee: '카페',
  croissant: '빵·디저트',
  utensils: '식당',
  pizza: '치킨·피자·버거',
  beer: '주점',
  'shopping-basket': '편의점·슈퍼',
  scissors: '미용·네일·피부',
  'book-open': '학원·독서실',
  'gamepad-2': '오락',
  dumbbell: '운동',
  'washing-machine': '세탁',
  pill: '약국',
  store: '기타',
}

/** 업종코드(소상공인시장진흥공단 상가정보 소분류, 엔진 config.CODE_NAME의 29개) → 글리프 */
export const STORE_GLYPH_BY_CODE: Readonly<Record<string, StoreGlyph>> = {
  // 카페
  I21201: 'coffee',                                        // 카페
  // 빵·디저트
  I21001: 'croissant',                                     // 빵/도넛
  I21005: 'croissant',                                     // 토스트/샌드위치/샐러드
  I21008: 'croissant',                                     // 아이스크림/빙수
  // 식당
  I21007: 'utensils',                                      // 김밥/만두/분식
  I20101: 'utensils',                                      // 백반/한정식
  I20201: 'utensils',                                      // 중국집
  I20301: 'utensils',                                      // 일식 회/초밥
  I20401: 'utensils',                                      // 양식
  // 치킨·피자·버거
  I21004: 'pizza',                                         // 버거
  I21006: 'pizza',                                         // 치킨
  I21003: 'pizza',                                         // 피자
  // 주점
  I21103: 'beer',                                          // 생맥주 전문
  I21101: 'beer',                                          // 일반 유흥 주점
  I21104: 'beer',                                          // 요리 주점
  // 편의점·슈퍼
  G20405: 'shopping-basket',                               // 편의점
  G20404: 'shopping-basket',                               // 슈퍼마켓
  // 미용·네일·피부
  S20701: 'scissors',                                      // 미용실
  S20702: 'scissors',                                      // 피부 관리실
  S20703: 'scissors',                                      // 네일숍
  // 학원·독서실
  P10501: 'book-open',                                     // 입시·교과학원
  R10202: 'book-open',                                     // 독서실/스터디 카페
  // 오락
  R10406: 'gamepad-2',                                     // PC방
  R10404: 'gamepad-2',                                     // 전자 게임장
  R10310: 'gamepad-2',                                     // 당구장
  R10407: 'gamepad-2',                                     // 노래방
  // 운동
  P10603: 'dumbbell',                                      // 요가/필라테스 학원
  // 세탁
  S20901: 'washing-machine',                               // 세탁소
  // 약국
  G21501: 'pill',                                          // 약국
}

export function storeGlyphFor(bizCode: string | null | undefined): StoreGlyph {
  return (bizCode && STORE_GLYPH_BY_CODE[bizCode]) || STORE_GLYPH_FALLBACK
}

/**
 * Lucide 24 grid 내용(path·circle·rect·line만, 속성은 모두 상수). SVG 바깥 속성(stroke·fill·linecap)은 쓰는 쪽이 붙인다.
 * 문자열 그대로 마커 HTML에 들어가므로 여기 외의 값을 넣지 않는다
 */
export const STORE_GLYPH_SVG: Readonly<Record<StoreGlyph, string>> = {
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  croissant:
    '<path d="M10.2 18H4.774a1.5 1.5 0 0 1-1.352-.97 11 11 0 0 1 .132-6.487"/><path d="M18 10.2V4.774a1.5 1.5 0 0 0-.97-1.352 11 11 0 0 0-6.486.132"/><path d="M18 5a4 3 0 0 1 4 3 2 2 0 0 1-2 2 10 10 0 0 0-5.139 1.42"/><path d="M5 18a3 4 0 0 0 3 4 2 2 0 0 0 2-2 10 10 0 0 1 1.42-5.14"/><path d="M8.709 2.554a10 10 0 0 0-6.155 6.155 1.5 1.5 0 0 0 .676 1.626l9.807 5.42a2 2 0 0 0 2.718-2.718l-5.42-9.807a1.5 1.5 0 0 0-1.626-.676"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  pizza:
    '<path d="m12 14-1 1"/><path d="m13.75 18.25-1.25 1.42"/><path d="M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12"/><path d="M18.8 9.3a1 1 0 0 0 2.1 7.7"/><path d="M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z"/>',
  beer: '<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v6"/><path d="M13 12v6"/><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>',
  'shopping-basket':
    '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
  'book-open':
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'gamepad-2':
    '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
  dumbbell:
    '<path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/>',
  'washing-machine':
    '<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  store:
    '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
}

/** 점포 마커 표현: 아이콘 24px / 아이콘 16px / 점 10px(기존) */
export type StoreMarkerMode = 'icon' | 'icon-small' | 'dot'

/** 래스터 기준 줌 ≥15 아이콘 24px */
export const STORE_ICON_MIN_RASTER_ZOOM = 15
/** 래스터 기준 줌 13~14 아이콘 16px, 그 아래는 점 */
export const STORE_SMALL_ICON_MIN_RASTER_ZOOM = 13
/** 같은 줌에서 점포가 이 수 이상이면 점 */
export const STORE_DOT_MIN_COUNT = 80

export function storeMarkerMode(rasterZoom: number, count: number): StoreMarkerMode {
  if (count >= STORE_DOT_MIN_COUNT) return 'dot'
  if (rasterZoom >= STORE_ICON_MIN_RASTER_ZOOM) return 'icon'
  if (rasterZoom >= STORE_SMALL_ICON_MIN_RASTER_ZOOM) return 'icon-small'
  return 'dot'
}

/** 마커 바깥 크기(px, border 포함 — box-sizing: border-box). 앵커는 그 가운데 */
export const STORE_MARKER_SIZE: Readonly<Record<StoreMarkerMode, { normal: number; active: number }>> = {
  icon: { normal: 24, active: 24 },
  'icon-small': { normal: 16, active: 16 },
  dot: { normal: 10, active: 14 },
}

/** 글리프 SVG 요소 문자열(마커·범례 공용). 상수만 들어가므로 HTML로 넣어도 안전하다 */
export function storeGlyphSvg(glyph: StoreGlyph): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${STORE_GLYPH_SVG[glyph]}</svg>`
}

/**
 * 점포 마커 HtmlIcon 내용. 점(dot)은 기존 `.map-store-marker` 그대로, 아이콘은 같은 원 안에 글리프(색은 토큰, MapView.css).
 * 선택 점포는 `--active` (바깥 링, 점이면 14px). A·B 핀은 다른 모양(글자 마커)이라 색만으로 구분하지 않는다
 */
export function storeMarkerHtml(mode: StoreMarkerMode, glyph: StoreGlyph, active: boolean): string {
  const classes = ['map-store-marker']
  if (mode !== 'dot') classes.push('map-store-marker--icon')
  if (mode === 'icon-small') classes.push('map-store-marker--icon-small')
  if (active) classes.push('map-store-marker--active')
  const inner = mode === 'dot' ? '' : storeGlyphSvg(glyph)
  return `<div class="${classes.join(' ')}">${inner}</div>`
}
