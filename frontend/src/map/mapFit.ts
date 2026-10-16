/**
 * 지도 범위 맞춤 계산 (8-B1, D-022, docs/UX_REDESIGN.md 2.6). SDK를 부르지 않는 순수 함수만 둔다 — MapView가 SDK 값을 넣는다.
 *
 * - 사용 영역 U: 지도 사각형에서 우리 오버레이·SDK 컨트롤 사각형을 뺀다(장애물마다 가장 적게 잃는 변 쪽으로 밀고 pad만큼 띄운다).
 * - 원 사각형은 지도 bounds로 직접 계산한다(경도 선형, 위도 Web Mercator). GL 모드에서는 `Circle.getBounds()`가 오류를 내고
 *   SVG 요소도 없어서 쓰지 않는다(A3 NAVER 검수 스파이크, 2026-10-14).
 * - zoom은 지금 축척에서 잰 px 크기로 계산하므로 GL·래스터의 zoom 단위 차이(같은 축척에서 GL zoom = 래스터 zoom − 1)와
 *   무관하게 같은 화면 크기가 나온다. zoom 값을 기준과 비교할 때만(8-B2 비교 기준 13) `rasterZoom`으로 바꾼다.
 */

export type Rect = { x: number; y: number; w: number; h: number }
/** 위경도 사각형 (남·북 위도, 서·동 경도) */
export type GeoBox = { s: number; n: number; w: number; e: number }

/** 1도 위도의 길이(m). 원 bbox 계산용 — 500m 원에서 1m 미만 오차 */
const M_PER_DEG_LAT = 111_320

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** 중심·반경(m) 원을 감싸는 위경도 사각형 */
export function circleBox(lat: number, lng: number, radiusM: number): GeoBox {
  const dLat = radiusM / M_PER_DEG_LAT
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180))
  return { s: lat - dLat, n: lat + dLat, w: lng - dLng, e: lng + dLng }
}

/** 위경도 사각형의 화면 사각형(지도 컨테이너 기준 px). view = 지금 지도 bounds와 컨테이너 크기 */
export function boxToRect(box: GeoBox, view: { bounds: GeoBox; w: number; h: number }): Rect {
  const b = view.bounds
  const sx = view.w / (b.e - b.w)
  const sy = view.h / (mercY(b.n) - mercY(b.s))
  const x = (box.w - b.w) * sx
  const y = (mercY(b.n) - mercY(box.n)) * sy
  return { x, y, w: (box.e - box.w) * sx, h: (mercY(box.n) - mercY(box.s)) * sy }
}

/** 사용 영역 U. obstacles는 지도 컨테이너 기준 사각형(크기 0은 무시) */
export function usableArea(size: { w: number; h: number }, obstacles: readonly Rect[], pad = 8): Rect {
  const u = { top: 0, right: size.w, bottom: size.h, left: 0 }
  for (const o of obstacles) {
    if (o.w <= 0 || o.h <= 0) continue
    const overlaps = o.x < u.right && o.x + o.w > u.left && o.y < u.bottom && o.y + o.h > u.top
    if (!overlaps) continue
    const w = u.right - u.left
    const h = u.bottom - u.top
    const options = [
      { side: 'top', v: o.y + o.h, loss: (o.y + o.h - u.top) * w },
      { side: 'bottom', v: o.y, loss: (u.bottom - o.y) * w },
      { side: 'left', v: o.x + o.w, loss: (o.x + o.w - u.left) * h },
      { side: 'right', v: o.x, loss: (u.right - o.x) * h },
    ] as const
    let best: (typeof options)[number] | null = null
    for (const c of options) if (c.loss >= 0 && (!best || c.loss < best.loss)) best = c
    if (best) u[best.side] = best.v
  }
  return { x: u.left + pad, y: u.top + pad, w: Math.max(0, u.right - u.left - 2 * pad), h: Math.max(0, u.bottom - u.top - 2 * pad) }
}

/** 단일 완료 조건: 원 사각형 ⊂ U(±1px) 그리고 지름 ≥ 0.5 × min(U.w, U.h) */
export function satisfiesSingle(circle: Rect, u: Rect): boolean {
  const inside =
    circle.x >= u.x - 1 && circle.y >= u.y - 1 && circle.x + circle.w <= u.x + u.w + 1 && circle.y + circle.h <= u.y + u.h + 1
  return inside && Math.min(circle.w, circle.h) >= 0.5 * Math.min(u.w, u.h)
}

/**
 * 맞춤 zoom: 지금 zoom에서 대상 크기(px)가 U에 들어가는 가장 큰 정수 zoom. zoom이 1 오르면 크기가 2배다.
 * GL zoom은 소수일 수 있어 지금 zoom을 반올림한 정수에서 시작한다(맞춘 뒤 정수 zoom — 글자가 흐리지 않게).
 */
export function fitZoom(currentZoom: number, target: { w: number; h: number }, u: Rect, range: { min: number; max: number }): number {
  const base = Math.round(currentZoom)
  // 반올림으로 지금 축척과 달라진 만큼 대상 크기를 고친다(정수 zoom이면 그대로)
  const scale = 2 ** (base - currentZoom)
  const ratio = Math.min(u.w / (target.w * scale), u.h / (target.h * scale))
  const z = base + Math.floor(Math.log2(ratio))
  return Math.max(range.min, Math.min(range.max, z))
}

/** setCenter(대상 중심) → setZoom 뒤 대상 중심을 U 중심으로 옮기는 panBy 값. panBy(+x, +y)는 내용을 왼쪽·위로 옮긴다 */
export function panToUsable(size: { w: number; h: number }, u: Rect): { x: number; y: number } {
  return { x: size.w / 2 - (u.x + u.w / 2), y: size.h / 2 - (u.y + u.h / 2) }
}

/** NAVER renderMode: 1 래스터, 2 GL. 같은 축척에서 GL zoom은 래스터 zoom보다 1 작다(실측 z15: 래스터 3.791 m/px, GL 1.895 m/px) */
export function rasterZoom(zoom: number, renderMode: number | null | undefined): number {
  return renderMode === 2 ? zoom + 1 : zoom
}

/** 사각형이 겹치는지(경계만 닿으면 겹치지 않음) */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 점포 정보창 위치 후보 (D-022 정보창 배치, 8-B1 단일). 정보창이 분석 핀을 덮으면 피한다 — 우선순위 U 안 > 핀 가림 없음 > 이동 최소.
 * SDK 정보창은 마커 위에만 열리므로 공식 옵션(pixelOffset·disableAnchor·anchorSkew)으로 옮긴다:
 * default(그대로) → below(점포 아래, 꼬리 없음) → left/right(옆으로, 꼬리는 점포를 가리킨 채 기울임). 이동이 작은 쪽이 먼저다.
 * def = 기본 위치에서 잰 정보창 사각형, store = 점포 마커 사각형, pins = 분석 핀 사각형.
 */
export type InfoPlacement = {
  kind: 'default' | 'below' | 'left' | 'right'
  offset: { x: number; y: number }
  disableAnchor: boolean
  anchorSkew: boolean
}

export function infoPlacements(def: Rect, store: Rect, pins: readonly Rect[], gap = 8): InfoPlacement[] {
  const out: InfoPlacement[] = [{ kind: 'default', offset: { x: 0, y: 0 }, disableAnchor: false, anchorSkew: false }]
  const hit = pins.filter((p) => intersects(def, p))
  if (hit.length === 0) return out
  out.push({ kind: 'below', offset: { x: 0, y: store.y + store.h + gap - def.y }, disableAnchor: true, anchorSkew: false })
  const left = Math.min(...hit.map((p) => p.x)) - gap - (def.x + def.w)
  const right = Math.max(...hit.map((p) => p.x + p.w)) + gap - def.x
  const sides: InfoPlacement[] = [
    { kind: 'left', offset: { x: left, y: 0 }, disableAnchor: false, anchorSkew: true },
    { kind: 'right', offset: { x: right, y: 0 }, disableAnchor: false, anchorSkew: true },
  ]
  sides.sort((a, b) => Math.abs(a.offset.x) - Math.abs(b.offset.x))
  return [...out, ...sides]
}

/** 정보창 위치가 맞는지: U 안(±1px) 그리고 어떤 분석 핀과도 겹치지 않음 */
export function infoPlacementOk(rect: Rect, pins: readonly Rect[], u: Rect): boolean {
  const inside = rect.x >= u.x - 1 && rect.y >= u.y - 1 && rect.x + rect.w <= u.x + u.w + 1 && rect.y + rect.h <= u.y + u.h + 1
  return inside && !pins.some((p) => intersects(rect, p))
}

/** 비교 맞춤 기준 zoom(래스터 기준, D-022 순위 5): A∪B 맞춤 zoom이 이 값 이상이면 두 원을 함께 맞춘다 */
export const UNION_MIN_RASTER_ZOOM = 13

/** 두 위경도 사각형을 감싸는 사각형 (A∪B) */
export function unionBox(a: GeoBox, b: GeoBox): GeoBox {
  return { s: Math.min(a.s, b.s), n: Math.max(a.n, b.n), w: Math.min(a.w, b.w), e: Math.max(a.e, b.e) }
}

/** 사각형의 화면 중심이 되는 위경도(위도는 Web Mercator 중점) — setCenter에 넣는다 */
export function boxCenter(box: GeoBox): { lat: number; lng: number } {
  const y = (mercY(box.s) + mercY(box.n)) / 2
  return { lat: (Math.atan(Math.sinh(y)) * 180) / Math.PI, lng: (box.w + box.e) / 2 }
}

/** 사각형이 U 안에 있는지(±1px) — 비교(가까움) 완료 조건은 두 원 모두 ⊂ U */
export function insideUsable(rect: Rect, u: Rect): boolean {
  return rect.x >= u.x - 1 && rect.y >= u.y - 1 && rect.x + rect.w <= u.x + u.w + 1 && rect.y + rect.h <= u.y + u.h + 1
}

/** 지금 zoom 그대로 원을 지도 중심으로 옮겼을 때(panTo)의 화면 사각형 — 순위 6 "panTo 뒤 조건" 미리 판정 */
export function rectCenteredInMap(size: { w: number; h: number }, rect: Rect): Rect {
  return { x: size.w / 2 - rect.w / 2, y: size.h / 2 - rect.h / 2, w: rect.w, h: rect.h }
}
