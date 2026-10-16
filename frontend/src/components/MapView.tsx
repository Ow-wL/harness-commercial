import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { findDongRings } from '../map/dongBoundary.ts'
import {
  boxToRect,
  circleBox,
  fitZoom,
  boxCenter,
  infoPlacementOk,
  infoPlacements,
  insideUsable,
  intersects,
  panToUsable,
  rasterZoom,
  rectCenteredInMap,
  satisfiesSingle,
  unionBox,
  usableArea,
  UNION_MIN_RASTER_ZOOM,
  type GeoBox,
  type Rect,
} from '../map/mapFit.ts'
import {
  getGeocoderAvailability,
  loadNaverMaps,
  MapLoadError,
  onGeocoderAvailability,
  onNaverAuthFailure,
  reduceSdkState,
  type MapLoadErrorKind,
  type SdkEvent,
  type SdkState,
  type NaverCircle,
  type NaverInfoWindow,
  type NaverMap,
  type NaverMapsApi,
  type NaverMarker,
  type NaverPolygon,
} from '../map/naverMaps.ts'
import { Icon } from './Icon.tsx'
import './MapView.css'

export type LatLng = { lat: number; lng: number }

/** 행정동 (backend context의 시군구 코드 + 행정동 이름) */
export type MapDong = { guCode: string; dongName: string }

/**
 * 두 위치 비교의 B (5차-B4, docs/COMPARE_DESIGN.md 4.2). 이 값이 있으면(비교 중) A 마커는 글자 "A" 마커가 된다.
 * - location: B 좌표. null이면 아직 고르지 않음(B 마커·반경 없음)
 * - tone: 'invalid' = 분석 불가 위치 오류(회색 B 마커, 반경 없음). 서버·네트워크 오류는 'selected'
 * - dong: 성공한 B 응답의 행정동. A와 같은 동이면 경계를 다시 그리지 않는다
 * - guide: 지도 위 안내 문구(B 선택·분석 중 상태)
 */
export type MapCompare = {
  location: LatLng | null
  tone: 'selected' | 'invalid'
  dong: MapDong | null
  guide: string | null
  /**
   * 지금 보이는 점포 기준(A/B, B 분석 성공 뒤). A↔B로 바뀌면 그 원으로 옮긴다(D-022 순위 6, 8-B2).
   * 생략·null이면 기준 없음 — 분석 완료로 처음 생기는 것(null → A/B)은 이동하지 않는다(순위 8)
   */
  focus?: 'A' | 'B' | null
}

/**
 * 범위 맞춤 동작 (D-022). single: 단일 원(auto = 이미 조건이면 이동 없음, force = 무조건) / union: "두 위치 모두 보기" /
 * b-select: B 선택(순위 5) / focus: A↔B 기준 전환·비교 종료(순위 6)
 */
type FitAction =
  | { t: 'single'; mode: 'auto' | 'force' }
  | { t: 'union' }
  | { t: 'b-select' }
  | { t: 'focus'; side: 'A' | 'B' }

/** 지도에 표시할 동종 점포 (4차). 문구는 표시용으로 만들어 넘긴다(App이 API 응답으로 만든다). */
export type MapStore = { id: string; name: string; address: string; distance: string; lat: number; lng: number }

export type MapViewProps = {
  /** 선택 지점. null이면 마커·반경 없음 */
  selected: LatLng | null
  /** 'invalid' = 분석 불가 지점(회색 마커, 반경 원 없음, DESIGN.md §8.11) */
  markerTone: 'selected' | 'invalid'
  /** 분석이 끝난 행정동 (backend context). 경계를 강조한다 */
  dong: MapDong | null
  /** false면 지도 클릭을 무시한다 (분석 중, §8.12) */
  interactive: boolean
  onSelect: (point: LatLng) => void
  /** 반경 안 동종 점포 마커. null·빈 배열이면 그리지 않는다 (DESIGN.md §8.11·§8.14) */
  stores?: readonly MapStore[] | null
  /** 정보창을 연 점포 id. null이면 닫는다 */
  activeStoreId?: string | null
  /** 점포 마커를 누르거나 정보창을 닫을 때 */
  onStoreSelect?: (id: string | null) => void
  /** 두 위치 비교 중이면 B 표시 (5차-B4). null·생략이면 단일 분석 표시 그대로 */
  compare?: MapCompare | null
  /** 선택한 점포 막대 앞에 붙는 기준 위치 (비교 중, 예: "B 구월3동 주변", 5차-B5) */
  storeContext?: string
  /**
   * SDK 상태 변화 (7-B1, docs/ADDRESS_DESIGN.md §5.1): 지도 준비(ready + Geocoder 준비 상태)·로드 실패·뒤늦은 인증 실패.
   * App이 주소 기능 on/off에 쓴다(7-B2). failed 뒤에는 어떤 알림도 ready로 되돌리지 않는다
   */
  onSdkState?: (state: SdkState) => void
  /**
   * 지도를 숨기거나 보이게 하는 바깥 화면 상태(App의 mobile 지도/패널 화면, 6-4). 바뀌면 DOM 반영 뒤 크기 맞춤을 다시 돈다 —
   * 같은 크기로 숨김 → 보임이 한 프레임 안에 끝나면 ResizeObserver가 알리지 않으므로 이 신호로 미룬 정보창을 처리한다
   */
  layoutKey?: string
}

/** 인천 중심 초기 화면 (인천광역시청 부근) */
const INCHEON_CENTER: LatLng = { lat: 37.4563, lng: 126.7052 }
const INITIAL_ZOOM = 11
/** 분석 반경 = 엔진 config.RADIUS_M (meta.분석반경_m) */
export const RADIUS_M = 500
/** GL 벡터 지도(검수용 선택, 기본 끔 — `VITE_NAVER_MAP_GL=1`). 커스텀 스타일은 제품에 아직 적용하지 않는다(8-B1) */
const MAP_GL = import.meta.env.VITE_NAVER_MAP_GL === '1'
/** 사용 영역 U의 여백 (D-022) */
const FIT_PAD = 8
/**
 * SDK 컨트롤 DOM을 못 찾을 때 대신 쓰는 사각형(8-B0 실측 크기, 지도 생성 직후 1/4회 아직 없었음):
 * 확대 컨트롤 SMALL 50×79(오른쪽 위), 로고·축척 158×17(오른쪽 아래)
 */
const SDK_CONTROL_FALLBACK = (w: number, h: number): Rect[] => [
  { x: w - 60, y: 10, w: 50, h: 79 },
  { x: w - 168, y: h - 27, w: 158, h: 17 },
]

/** 지도 클릭 좌표 자릿수: 소수 6자리 ≈ 0.1m. 이 값이 그대로 요청 body와 화면에 쓰인다 */
const COORD_DIGITS = 6

const round = (v: number) => Number(v.toFixed(COORD_DIGITS))

/**
 * 선택 지점 아이콘 (§8.11). 단일 분석은 16px 원, 비교 중에는 글자 마커 20px:
 * A = 채운 파랑 + 흰 "A", B = 흰 채움 + 파랑 테두리 + 파랑 "B" (모양·글자로 구분, 색만으로 구분하지 않는다).
 * 분석 불가 지점은 회색. content는 고정 문자열이다(사용자 입력을 넣지 않는다).
 */
function pointIcon(api: NaverMapsApi, kind: 'single' | 'A' | 'B', tone: 'selected' | 'invalid') {
  if (kind === 'single') return { content: `<div class="map-marker map-marker--${tone}"></div>`, anchor: new api.Point(8, 8) }
  const cls = `map-marker map-marker--letter map-marker--${kind.toLowerCase()}${tone === 'invalid' ? ' map-marker--invalid' : ''}`
  return { content: `<div class="${cls}">${kind}</div>`, anchor: new api.Point(10, 10) }
}

/** 반경 원 선 모양: A 짧은 대시, B 점 — 같은 반경을 선 모양으로 구분한다 (COMPARE_DESIGN.md 4.2) */
const RADIUS_STROKE = { A: 'shortdash', B: 'dot' } as const

/** 반경 500m 원 (§8.11) */
function radiusCircle(api: NaverMapsApi, map: NaverMap, center: unknown, which: 'A' | 'B'): NaverCircle {
  return new api.Circle({
    map,
    center,
    radius: RADIUS_M,
    fillColor: token('--color-map-radius-fill'),
    fillOpacity: 1,
    strokeColor: token('--color-map-radius-stroke'),
    strokeWeight: 1.5,
    strokeStyle: RADIUS_STROKE[which],
    clickable: false,
  })
}

/** 행정동 경계 강조 (A·B 공용). guCode·dongName이 없으면 그리지 않고, 바뀌면 이전 경계를 지운다 */
function useDongPolygons(api: NaverMapsApi | null, map: NaverMap | null, guCode?: string, dongName?: string) {
  useEffect(() => {
    if (!api || !map || !guCode || !dongName) return
    let cancelled = false
    const polygons: NaverPolygon[] = []
    findDongRings(guCode, dongName)
      .then((rings) => {
        if (cancelled || !rings) return
        for (const polygon of rings) {
          polygons.push(
            new api.Polygon({
              map,
              paths: polygon.map((ring) => ring.map((p) => new api.LatLng(p.lat, p.lng))),
              fillColor: token('--color-map-dong-fill'),
              fillOpacity: 1,
              strokeColor: token('--color-map-dong-stroke'),
              strokeWeight: 1.5,
              clickable: false,
            }),
          )
        }
      })
      .catch((e: unknown) => console.error('[map] 행정동 경계를 불러오지 못했습니다', e))
    return () => {
      cancelled = true
      polygons.forEach((p) => p.setMap(null))
    }
  }, [api, map, guCode, dongName])
}

/** 동종 점포 마커 아이콘 (지름 10px, 선택되면 14px + 테두리, §8.11) */
const storeIcon = (api: NaverMapsApi, active: boolean) => ({
  content: `<div class="map-store-marker${active ? ' map-store-marker--active' : ''}"></div>`,
  anchor: active ? new api.Point(7, 7) : new api.Point(5, 5),
})

/** 정보창 내용: 상호·주소·직선거리 + 닫기. 문자열 HTML이 아니라 textContent로 만든다(상호명 그대로 표시, 주입 방지) */
function storeInfoContent(store: MapStore, onClose: () => void): HTMLElement {
  const root = document.createElement('div')
  root.className = 'map-store-info'
  const line = (tag: 'strong' | 'p', text: string, className: string) => {
    const el = document.createElement(tag)
    el.className = className
    el.textContent = text
    root.appendChild(el)
  }
  line('strong', store.name, 'map-store-info__name')
  line('p', store.address, 'map-store-info__text')
  line('p', store.distance, 'map-store-info__text')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'map-store-info__close'
  close.textContent = '닫기'
  close.addEventListener('click', onClose)
  root.appendChild(close)
  return root
}

/**
 * 사용 영역 U의 장애물(지도 section 기준 사각형): 우리 오버레이(범례·안내 칩·점포 막대) + SDK 컨트롤.
 * SDK 컨트롤은 z-index 100인 요소 중 바깥쪽 것만 본다(8-B0 스파이크와 같은 방식). 못 찾으면 실측 크기로 대신한다
 */
function mapObstacles(section: HTMLElement, canvas: HTMLElement | null): Rect[] {
  const m = section.getBoundingClientRect()
  const rel = (b: DOMRect): Rect => ({ x: b.left - m.left, y: b.top - m.top, w: b.width, h: b.height })
  const out: Rect[] = []
  for (const el of section.querySelectorAll<HTMLElement>('.map__legend, .map__guide, .map__store-bar')) {
    const b = el.getBoundingClientRect()
    if (b.width > 0 && b.height > 0) out.push(rel(b))
  }
  let sdk = 0
  if (canvas) {
    for (const el of canvas.querySelectorAll<HTMLElement>('*')) {
      if (getComputedStyle(el).zIndex !== '100') continue
      if (el.parentElement && getComputedStyle(el.parentElement).zIndex === '100') continue
      const b = el.getBoundingClientRect()
      if (b.width < 1 || b.height < 1 || b.width >= m.width) continue
      out.push(rel(b))
      sdk++
    }
  }
  if (sdk === 0) out.push(...SDK_CONTROL_FALLBACK(section.clientWidth, section.clientHeight))
  return out
}

/**
 * 점포 정보창 배치 (D-022, 8-B1 단일): 기본 위치가 U 밖이거나 분석 핀(`.map-marker`)을 덮으면
 * 점포 아래 → 옆(이동이 작은 쪽) 순으로 SDK 공식 옵션을 바꿔 보고, 실제로 잰 사각형이 맞는 첫 위치에 둔다.
 * 맞는 위치가 없으면 기본 위치로 되돌린다. setOptions는 동기로 다시 배치된다(실측). 위치나 지도를 바꿨으면 true
 */
function placeStoreInfo(api: NaverMapsApi, map: NaverMap, info: NaverInfoWindow, section: HTMLElement, canvas: HTMLElement | null): boolean {
  const content = info.getContentElement?.()
  const store = section.querySelector('.map-store-marker--active')
  if (!info.setOptions || !content || !store || section.clientWidth === 0) return false
  const m = section.getBoundingClientRect()
  const rel = (b: DOMRect, grow = 0): Rect => ({ x: b.left - m.left - grow, y: b.top - m.top - grow, w: b.width + 2 * grow, h: b.height + 2 * grow })
  const box = () => rel(content.getBoundingClientRect(), 2)                     // SDK 테두리 포함
  const pins = [...section.querySelectorAll('.map-marker')].map((p) => rel(p.getBoundingClientRect()))
  const u = usableArea({ w: section.clientWidth, h: section.clientHeight }, mapObstacles(section, canvas), FIT_PAD)
  const def = box()
  if (infoPlacementOk(def, pins, u)) return false
  const storeRect = rel(store.getBoundingClientRect())
  // 1차: 지도는 그대로 두고 정보창 위치만 바꾼다. 2차 후보로 쓰려고 핀을 덮지 않는 위치와 U 안으로 넣는 데 필요한 이동을 모은다
  const fallback: { apply: () => void; shift: { x: number; y: number } }[] = []
  const shiftInto = (r: Rect) => ({
    x: r.x < u.x ? u.x - r.x : r.x + r.w > u.x + u.w ? u.x + u.w - (r.x + r.w) : 0,
    y: r.y < u.y ? u.y - r.y : r.y + r.h > u.y + u.h ? u.y + u.h - (r.y + r.h) : 0,
  })
  const resetInfo = () => info.setOptions!({ pixelOffset: new api.Point(0, 0), disableAnchor: false, anchorSkew: false })
  // 기본 위치가 핀을 덮지 않고 U 밖으로만 조금 나갔으면 그대로 두고 지도만 옮기는 것도 후보다
  if (!pins.some((p) => intersects(def, p)) && def.w <= u.w && def.h <= u.h) fallback.push({ apply: resetInfo, shift: shiftInto(def) })
  for (const c of infoPlacements(def, storeRect, pins).slice(1)) {
    let y = c.offset.y
    const set = () => info.setOptions!({ pixelOffset: new api.Point(c.offset.x, y), disableAnchor: c.disableAnchor, anchorSkew: c.anchorSkew })
    set()
    let r = box()
    if (c.kind === 'below') {
      // 꼬리를 끄면 꼬리 높이만큼 더 움직인다 — 한 번 재서 점포 바로 아래로 고친다
      const want = storeRect.y + storeRect.h + 8
      if (Math.abs(r.y - want) > 1) {
        y += want - r.y
        set()
        r = box()
      }
    }
    if (infoPlacementOk(r, pins, u)) return true
    if (!pins.some((p) => intersects(r, p)) && r.w <= u.w && r.h <= u.h) fallback.push({ apply: set, shift: shiftInto(r) })
  }
  // 2차: 핀을 덮지 않는 위치 중 지도 이동이 가장 작은 것 — 정보창·핀이 함께 움직이므로 겹침은 그대로 없다(zoom 불변)
  fallback.sort((a, b) => Math.hypot(a.shift.x, a.shift.y) - Math.hypot(b.shift.x, b.shift.y))
  const best = fallback[0]
  if (best) {
    best.apply()
    map.panBy(new api.Point(-best.shift.x, -best.shift.y))            // panBy(+x, +y)는 내용을 왼쪽·위로 옮긴다
    return true
  }
  resetInfo()
  return false
}

/** 지도 오버레이 색은 DESIGN 토큰(§2.6)에서 읽는다 — 컴포넌트에 색 값을 직접 쓰지 않는다 */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const MESSAGES: Record<MapLoadErrorKind, { title: string; body: string }> = {
  config: {
    title: '지도 설정이 필요합니다',
    body: 'frontend/.env에 VITE_NAVER_MAP_CLIENT_ID를 설정한 뒤 개발 서버를 다시 시작하세요. 그동안은 패널의 좌표 입력으로 위치를 고를 수 있습니다.',
  },
  load: {
    title: '지도를 불러오지 못했습니다',
    body: '네트워크 상태를 확인한 뒤 새로고침해 주세요. 패널의 좌표 입력으로도 위치를 고를 수 있습니다.',
  },
  auth: {
    title: '지도 인증에 실패했습니다',
    body: 'NAVER Cloud Platform 콘솔에서 Client ID와 서비스 URL(현재 주소)을 확인하세요. 패널의 좌표 입력으로도 위치를 고를 수 있습니다.',
  },
}

/**
 * NAVER 지도 (DESIGN.md §5.D, §8.11·§8.12). SDK는 map/naverMaps.ts 로더를 통해서만 쓴다.
 * 클릭 → onSelect(좌표). 선택 지점에 마커 + 반경 500m 원, 분석 후 행정동 경계 강조.
 */
export function MapView({
  selected,
  markerTone,
  dong,
  interactive,
  onSelect,
  stores = null,
  activeStoreId = null,
  onStoreSelect,
  compare = null,
  storeContext,
  onSdkState,
  layoutKey,
}: MapViewProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<NaverMapsApi | null>(null)
  const [map, setMap] = useState<NaverMap | null>(null)
  const [error, setError] = useState<MapLoadErrorKind | null>(null)
  // 지도가 보이고 유효한 크기를 가졌는지 (mobile 패널 화면에서는 .map이 숨겨져 0×0). 아래 크기 맞춤 흐름이 setSize 뒤에 정한다
  const [sized, setSized] = useState(false)
  // 정보창 열기를 숨김(크기 0) 때문에 미뤘는지 + 다시 처리 신호 (6-4 보완). `sized`가 이미 true인 채로 실제 크기가 0이어서
  // 미뤘다면(ResizeObserver가 0×0을 알리기 전) 다음 양수 크기 알림에서 `sized`는 그대로라 정보창 effect가 다시 돌지 않는다 —
  // 그래서 미룬 열기가 있으면 크기 맞춤 뒤 이 값을 올려 현재 선택을 다시 처리한다
  const infoDeferredRef = useRef(false)
  const [infoRetry, setInfoRetry] = useState(0)
  /** 아래 크기 맞춤 함수(fit). 화면 전환 신호(layoutKey)에서도 같은 흐름을 부른다 */
  const fitRef = useRef<() => void>(() => {})
  // 범위 맞춤 (8-B1, D-022). init 이벤트 전에는 지도 bounds를 믿을 수 없어(GL은 오류) 맞춤을 미룬다.
  // 잠금: 사용자가 휠·드래그·± 컨트롤로 직접 바꾸면 켠다(SDK `zooming`·`dragstart` — 우리 호출은 내지 않는다, 8-B0)
  const initedRef = useRef(false)
  const lockedRef = useRef(false)
  /** 숨김·init 전이라 미룬 맞춤(동작 단위). 실행할 때 최신 선택·비교 상태로 다시 검증한다 */
  const pendingFitRef = useRef<FitAction | null>(null)
  const runFitRef = useRef<(action: FitAction) => void>(() => {})
  /** 실제 그리기 방식(1 래스터 / 2 GL) — 비교 기준 zoom 13을 래스터 기준으로 환산할 때 쓴다 */
  const renderModeRef = useRef<number | null>(null)

  // 최신 콜백·상태를 클릭 핸들러가 읽는다 (지도를 다시 만들지 않기 위해)
  const onSelectRef = useRef(onSelect)
  const interactiveRef = useRef(interactive)
  const onStoreSelectRef = useRef(onStoreSelect)
  const onSdkStateRef = useRef(onSdkState)
  useEffect(() => {
    onSelectRef.current = onSelect
    interactiveRef.current = interactive
    onStoreSelectRef.current = onStoreSelect
    onSdkStateRef.current = onSdkState
  })

  // SDK 로드 + 지도 생성 (StrictMode에서 effect가 두 번 돌아도 script는 loader가 한 번만 붙인다)
  useEffect(() => {
    let cancelled = false
    let created: NaverMap | null = null
    let clickListener: unknown = null
    let maps: NaverMapsApi | null = null
    // SDK 상태를 App에 올린다 (7-B1). failed는 끝 상태 — 뒤늦은 인증 실패 뒤 Geocoder 준비 알림이 ready로 되돌리지 못한다
    let sdkState: SdkState = { status: 'loading' }
    const report = (event: SdkEvent) => {
      const next = reduceSdkState(sdkState, event)
      if (next === sdkState || cancelled) return
      sdkState = next
      onSdkStateRef.current?.(next)
    }
    let unsubscribeGeocoder: (() => void) | null = null
    const unsubscribe = onNaverAuthFailure(() => {
      setError('auth')
      report({ type: 'auth-failed' })
    })

    let mapListeners: unknown[] = []
    loadNaverMaps(import.meta.env.VITE_NAVER_MAP_CLIENT_ID, { gl: MAP_GL })
      .then((loaded) => {
        if (cancelled || !canvasRef.current) return
        maps = loaded
        created = new loaded.Map(canvasRef.current, {
          center: new loaded.LatLng(INCHEON_CENTER.lat, INCHEON_CENTER.lng),
          // GL은 같은 축척에서 zoom이 1 작다(래스터 11 = GL 10)
          zoom: MAP_GL ? INITIAL_ZOOM - 1 : INITIAL_ZOOM,
          ...(MAP_GL ? { gl: true } : {}),
          zoomControl: true,
          zoomControlOptions: { position: loaded.Position.TOP_RIGHT, style: loaded.ZoomControlStyle?.SMALL },
          scaleControl: true,
          mapDataControl: false,
        })
        const map = created
        clickListener = loaded.Event.addListener(created, 'click', (e) => {
          if (!interactiveRef.current) return
          onSelectRef.current({ lat: round(e.coord.lat()), lng: round(e.coord.lng()) })
        })
        mapListeners = [
          loaded.Event.addListener(created, 'init', () => {
            if (initedRef.current) return
            initedRef.current = true
            // 실제 그리기 방식(1 래스터 / 2 GL)을 남긴다 — GL을 요청해도 지원 안 되면 1. 검수·측정용
            const mode = map.get?.('renderMode')
            renderModeRef.current = typeof mode === 'number' ? mode : null
            if (sectionRef.current && mode != null) sectionRef.current.dataset.renderMode = String(mode)
            const pending = pendingFitRef.current
            pendingFitRef.current = null
            if (pending) runFitRef.current(pending)
          }),
          loaded.Event.addListener(created, 'zooming', () => (lockedRef.current = true)),
          loaded.Event.addListener(created, 'dragstart', () => (lockedRef.current = true)),
        ]
        setApi(loaded)
        setMap(created)
        // 지도는 준비됐다. Geocoder는 지금 상태를 올리고, 뒤에 정해지면(ready/unavailable) 다시 올린다
        report({ type: 'map-ready', api: loaded, geocoder: getGeocoderAvailability() })
        unsubscribeGeocoder = onGeocoderAvailability((geocoder) => report({ type: 'geocoder', geocoder }))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const kind = e instanceof MapLoadError ? e.kind : 'load'
        setError(kind)
        report({ type: 'map-failed', kind })
      })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeGeocoder?.()
      if (maps && clickListener) maps.Event.removeListener(clickListener)
      if (maps) for (const l of mapListeners) maps.Event.removeListener(l)
      initedRef.current = false
      pendingFitRef.current = null
      created?.destroy?.()
      setMap(null)
    }
  }, [])

  // 바깥 .map 크기가 바뀌면 지도 크기를 맞춘다 (mobile 화면 전환·tablet 높이 변경·창 크기 변경).
  // canvas가 아니라 바깥 section을 본다 — SDK가 canvas에 inline px 크기를 넣어서 canvas는 레이아웃을 따라가지 않는다.
  // 크기가 0이면(숨김) setSize 하지 않고 `sized=false`만 둔다 — 점포 정보창은 `sized`일 때만 연다(아래, 6-4)
  useEffect(() => {
    const el = sectionRef.current
    if (!api || !map || !el) return
    const fit = () => {
      const visible = el.clientWidth > 0 && el.clientHeight > 0
      if (visible) map.setSize(new api.Size(el.clientWidth, el.clientHeight))
      setSized(visible)
      // 숨김 복귀(순위 4): 미뤄 둔 맞춤만 실제 크기로 1회. 크기만 바뀐 것은 zoom을 바꾸지 않는다(순위 8)
      if (visible && pendingFitRef.current) {
        const pending = pendingFitRef.current
        pendingFitRef.current = null
        runFitRef.current(pending)
      }
      if (visible && infoDeferredRef.current) {
        infoDeferredRef.current = false
        setInfoRetry((n) => n + 1)                         // setSize 뒤에 미룬 정보창을 현재 선택으로 다시 처리
      }
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fitRef.current = fit
    fit()
    return () => {
      ro.disconnect()
      fitRef.current = () => {}
      setSized(false)
    }
  }, [api, map])

  // 범위 맞춤 (D-022). 단일(8-B1): 선택 지점 원 — 순위 1 "범위에 맞추기"·2 새 위치·4 숨김 복귀.
  // 비교(8-B2): 순위 1 "두 위치 모두 보기"(A∪B)·5 B 선택·6 A↔B 기준 전환·비교 종료.
  // 맞춤 = setCenter → setZoom(z, false) → panBy(원·사각형 중심을 U 중심으로). 지도가 숨겨졌거나(크기 0) init 전이면
  // 동작을 미뤘다가 보이고 setSize한 뒤·init 뒤 1회, 그때의 최신 선택·비교 상태로 다시 검증해 실행한다.
  // 아래 layoutKey 크기 맞춤(layout effect)보다 **먼저 선언한 layout effect**에서 최신 상태를 반영한다 —
  // 비교 시작·종료와 지도 표시가 같은 렌더에 일어나도 옛 상태로 미룬 맞춤을 실행하지 않게(8-B1 회귀 수정)
  const selectedRef = useRef(selected)
  const comparingRef = useRef(compare !== null)
  const bLocationRef = useRef(compare?.location ?? null)
  useLayoutEffect(() => {
    selectedRef.current = selected
    comparingRef.current = compare !== null
    bLocationRef.current = compare?.location ?? null
    /** 이 동작이 지금 상태에서 의미가 있는지: 단일은 비교 밖, 비교 동작은 비교 중 + B 있음, A로 이동은 A 있음 */
    const valid = (action: FitAction) => {
      if (!selectedRef.current) return false
      if (action.t === 'single') return !comparingRef.current
      if (action.t === 'focus' && action.side === 'A') return true
      return comparingRef.current && bLocationRef.current !== null
    }
    // 상태가 바뀌어 더는 맞지 않는 대기 동작은 버린다(비교 시작 → 단일 대기 버림, 비교 종료·B 지움 → 비교 대기 버림)
    if (pendingFitRef.current && !valid(pendingFitRef.current)) pendingFitRef.current = null
    runFitRef.current = (action) => {
      const el = sectionRef.current
      if (!api || !map || !el) return
      if (!valid(action)) {
        pendingFitRef.current = null
        return
      }
      if (!initedRef.current || el.clientWidth === 0 || el.clientHeight === 0) {
        // 단일 auto는 이미 기다리는 동작을 덮지 않는다(무조건 맞춤·비교 동작이 이긴다)
        if (!(action.t === 'single' && action.mode === 'auto' && pendingFitRef.current)) pendingFitRef.current = action
        return
      }
      const size = { w: el.clientWidth, h: el.clientHeight }
      const b = map.getBounds()
      const view = { bounds: { s: b.getSW().lat(), n: b.getNE().lat(), w: b.getSW().lng(), e: b.getNE().lng() }, w: size.w, h: size.h }
      const u = usableArea(size, mapObstacles(el, canvasRef.current), FIT_PAD)
      const range = { min: map.getMinZoom?.() ?? 0, max: map.getMaxZoom?.() ?? 21 }
      /** 원 하나는 그 중심(선택 좌표), A∪B는 사각형의 화면 중심에 맞춘다 */
      const fitBox = (box: GeoBox, rect: Rect, center?: { lat: number; lng: number }) => {
        const z = fitZoom(map.getZoom(), rect, u, range)
        const c = center ?? boxCenter(box)
        const pan = panToUsable(size, u)
        map.setCenter(new api.LatLng(c.lat, c.lng))
        map.setZoom(z, false)
        map.panBy(new api.Point(pan.x, pan.y))
      }
      const a = selectedRef.current!
      const boxA = circleBox(a.lat, a.lng, RADIUS_M)
      const bLoc = bLocationRef.current
      const boxB = bLoc ? circleBox(bLoc.lat, bLoc.lng, RADIUS_M) : boxA
      switch (action.t) {
        case 'single': {
          if (action.mode === 'auto' && lockedRef.current) return     // 미뤄 둔 사이 사용자가 직접 조정했다
          const rect = boxToRect(boxA, view)
          if (action.mode === 'auto' && satisfiesSingle(rect, u)) return
          fitBox(boxA, rect, a)
          return
        }
        case 'union': {                                              // 순위 1 "두 위치 모두 보기": 기준 zoom 미만이어도 맞춘다
          const box = unionBox(boxA, boxB)
          fitBox(box, boxToRect(box, view))
          return
        }
        case 'b-select': {                                           // 순위 5: 함께 맞춘 zoom(래스터 기준) ≥ 13이면 A∪B, 아니면 B 원
          const box = unionBox(boxA, boxB)
          const rect = boxToRect(box, view)
          const z = fitZoom(map.getZoom(), rect, u, range)
          if (rasterZoom(z, renderModeRef.current) >= UNION_MIN_RASTER_ZOOM) {
            // 이미 두 원이 U 안이고 맞춰도 zoom이 그대로면 움직이지 않는다. 더 넓게 보는 중(작은 두 원)은 맞춘다 —
            // mobile에서 숨긴 채 A를 고르고 바로 비교하면 A 단일 맞춤 없이 기본 zoom에서 B를 고르게 된다
            if (map.getZoom() >= z && insideUsable(boxToRect(boxA, view), u) && insideUsable(boxToRect(boxB, view), u)) return
            fitBox(box, rect)
            return
          }
          const rB = boxToRect(boxB, view)
          if (satisfiesSingle(rB, u)) return
          fitBox(boxB, rB, bLoc ?? a)
          return
        }
        case 'focus': {                                              // 순위 6: 지금 zoom에서 panTo 뒤 조건을 만족하면 panTo, 아니면 맞춤
          const box = action.side === 'B' ? boxB : boxA
          const c = action.side === 'B' && bLoc ? bLoc : a
          const rect = boxToRect(box, view)
          if (lockedRef.current || satisfiesSingle(rectCenteredInMap(size, rect), u)) map.panTo(new api.LatLng(c.lat, c.lng))
          else fitBox(box, rect, c)
          return
        }
      }
    }
  })

  // 바깥 화면 전환 신호(layoutKey, mobile 지도↔패널): DOM 반영 뒤(layout effect) 같은 크기 맞춤을 한 번 더 돈다.
  // 크기 알림 없이 지도 화면으로 돌아와도 실제 크기가 양수면 setSize → 미룬 정보창을 현재 선택으로 처리한다(실제 크기 검사 그대로)
  useLayoutEffect(() => {
    fitRef.current()
  }, [layoutKey])

  // 선택 지점이 바뀌면(지도 클릭·주소·좌표 입력, 분석 불가 지점 포함) 맞춘다(순위 2, 잠금 해제). 같은 좌표에서 tone·결과만
  // 바뀌면 그대로. 비교 중에는 A가 고정이라 A 좌표가 바뀌지 않는다(바뀌면 지금처럼 panTo)
  const selectedLat = selected?.lat
  const selectedLng = selected?.lng
  useEffect(() => {
    if (!api || !map || selectedLat === undefined || selectedLng === undefined) {
      pendingFitRef.current = null
      return
    }
    if (comparingRef.current) {
      map.panTo(new api.LatLng(selectedLat, selectedLng))
      return
    }
    lockedRef.current = false
    pendingFitRef.current = null
    runFitRef.current({ t: 'single', mode: 'auto' })
  }, [api, map, selectedLat, selectedLng])

  /** "범위에 맞추기"(단일)·"두 위치 모두 보기"(비교) — 순위 1: 무조건 맞추고 잠금을 푼다 */
  const fitToRange = () => {
    lockedRef.current = false
    runFitRef.current(comparingRef.current ? { t: 'union' } : { t: 'single', mode: 'force' })
  }

  // 선택 지점(A) 마커 + 반경 원. 다시 클릭하면 같은 오버레이를 옮긴다. 비교 중이면 글자 "A" 마커(B를 아직 안 골라도)
  const comparing = compare !== null
  const markerRef = useRef<NaverMarker | null>(null)
  const circleRef = useRef<NaverCircle | null>(null)
  useEffect(() => {
    if (!api || !map) return
    if (!selected) {
      markerRef.current?.setMap(null)
      circleRef.current?.setMap(null)
      return
    }
    const position = new api.LatLng(selected.lat, selected.lng)
    const icon = pointIcon(api, comparing ? 'A' : 'single', markerTone)
    if (markerRef.current) {
      markerRef.current.setPosition(position)
      markerRef.current.setIcon(icon)
      markerRef.current.setMap(map)
    } else {
      markerRef.current = new api.Marker({ map, position, icon, clickable: false })
    }

    if (markerTone === 'invalid') {
      circleRef.current?.setMap(null)
    } else if (circleRef.current) {
      circleRef.current.setCenter(position)
      circleRef.current.setMap(map)
    } else {
      circleRef.current = radiusCircle(api, map, position, 'A')
    }
  }, [api, map, selected, markerTone, comparing])

  // 비교 B 마커 + 반경 원 (5차-B4). B를 다시 고르면 같은 오버레이를 옮기고, 고르기 전·비교 종료면 지운다
  const bLat = compare?.location?.lat
  const bLng = compare?.location?.lng
  const bTone = compare?.tone ?? 'selected'
  const bMarkerRef = useRef<NaverMarker | null>(null)
  const bCircleRef = useRef<NaverCircle | null>(null)
  useEffect(() => {
    if (!api || !map) return
    if (bLat === undefined || bLng === undefined) {
      bMarkerRef.current?.setMap(null)
      bCircleRef.current?.setMap(null)
      return
    }
    const position = new api.LatLng(bLat, bLng)
    const icon = pointIcon(api, 'B', bTone)
    if (bMarkerRef.current) {
      bMarkerRef.current.setPosition(position)
      bMarkerRef.current.setIcon(icon)
      bMarkerRef.current.setMap(map)
    } else {
      bMarkerRef.current = new api.Marker({ map, position, icon, clickable: false })
    }
    if (bTone === 'invalid') {
      bCircleRef.current?.setMap(null)                     // 분석 불가 위치: 반경 원 없음 (§8.11)
    } else if (bCircleRef.current) {
      bCircleRef.current.setCenter(position)
      bCircleRef.current.setMap(map)
    } else {
      bCircleRef.current = radiusCircle(api, map, position, 'B')
    }
  }, [api, map, bLat, bLng, bTone])

  // B를 고르면(순위 5, 잠금 해제) 두 원이 함께 들어가는 zoom이 래스터 기준 13 이상이면 A∪B, 아니면 B 원을 맞춘다.
  // B를 지울 때(다시 고르기)는 옮기지 않는다
  useEffect(() => {
    if (!api || !map || bLat === undefined || bLng === undefined) return
    lockedRef.current = false
    runFitRef.current({ t: 'b-select' })
  }, [api, map, bLat, bLng])

  // 점포 기준 A↔B 전환(순위 6): 그 원이 지금 zoom에서 조건을 만족하면 panTo, 아니면 맞춤. 잠금 중이면 panTo만.
  // 분석 완료로 기준이 처음 생기는 것(null → A/B)은 움직이지 않는다(순위 8)
  const focus = compare?.focus ?? null
  const focusRef = useRef(focus)
  useEffect(() => {
    const prev = focusRef.current
    focusRef.current = focus
    if (!api || !map || !focus || !prev || prev === focus) return
    runFitRef.current({ t: 'focus', side: focus })
  }, [api, map, focus])

  // 비교가 끝나면 A로(순위 6): 조건을 만족하면 panTo, 아니면 맞춤. 잠금 중이면 panTo만
  const wasComparingRef = useRef(comparing)
  useEffect(() => {
    if (wasComparingRef.current && !comparing && api && map && selectedLat !== undefined && selectedLng !== undefined) {
      runFitRef.current({ t: 'focus', side: 'A' })
    }
    wasComparingRef.current = comparing
  }, [api, map, comparing, selectedLat, selectedLng])

  useEffect(
    () => () => {
      for (const ref of [markerRef, circleRef, bMarkerRef, bCircleRef]) {
        ref.current?.setMap(null)
        ref.current = null
      }
    },
    [map],
  )

  // 점포 정보창 닫기 (4차 보완): 선택만 지운다 — 마커·목록·지도 중심·줌은 그대로.
  // 닫는 데 쓴 버튼(지도 위 막대·정보창 안)이 사라지므로 포커스를 지도 영역으로 옮겨 잃지 않게 한다
  const closeStore = () => {
    onStoreSelectRef.current?.(null)
    sectionRef.current?.focus()
  }
  const closeStoreRef = useRef(closeStore)
  useEffect(() => {
    closeStoreRef.current = closeStore
  })
  const activeStore = stores?.find((s) => s.id === activeStoreId) ?? null
  /** 지도 영역 안(지도 위 막대, SDK 컨트롤, 정보창 버튼, 영역 자체)에서 Escape → 선택·정보창 닫기 */
  const onMapKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !activeStore) return
    e.preventDefault()
    closeStore()
  }

  // 동종 점포 마커 (4차). stores가 바뀌면 이전 마커·클릭 리스너를 모두 지우고 새로 그린다
  const storeMarkersRef = useRef<Map<string, NaverMarker>>(new Map())
  useEffect(() => {
    if (!api || !map || !stores || stores.length === 0) return
    const markers = new Map<string, NaverMarker>()
    const listeners: unknown[] = []
    for (const store of stores) {
      const marker = new api.Marker({
        map,
        position: new api.LatLng(store.lat, store.lng),
        icon: storeIcon(api, false),
        clickable: true,
        title: store.name,
      })
      listeners.push(api.Event.addListener(marker, 'click', () => onStoreSelectRef.current?.(store.id)))
      markers.set(store.id, marker)
    }
    storeMarkersRef.current = markers
    return () => {
      listeners.forEach((l) => api.Event.removeListener(l))
      markers.forEach((m) => m.setMap(null))
      storeMarkersRef.current = new Map()
    }
  }, [api, map, stores])

  // 선택한 점포: 마커 강조 + 정보창. 새로 선택했을 때만 그 점포로 지도를 옮긴다 (zoom은 그대로)
  // 정보창은 지도가 보이고 크기가 맞춰진 뒤(`sized`)에만 연다(6-4): SDK는 open 때 내용 크기를 재는데, mobile 패널 화면처럼
  // 지도가 숨겨져(0×0) 있으면 폭 0으로 고정돼 지도를 보였을 때 폭 24px로 접힌다. 숨겨지면 닫아 두고(다른 선택의 옛 정보창이
  // 다시 보이지 않게), 다시 보이면 그때의 선택으로 연다. 이동(panTo)도 같은 시점 — 새로 선택한 점포일 때만
  const infoRef = useRef<NaverInfoWindow | null>(null)
  /** 단일 정보창 배치로 위치 옵션을 바꿨거나 지도를 옮겼는지 — 비교에서는 기본 위치로만 되돌린다 */
  const infoAdjustedRef = useRef(false)
  const pannedStoreRef = useRef<string | null>(null)
  useEffect(() => {
    if (!api || !map) return
    storeMarkersRef.current.forEach((m, id) => m.setIcon(storeIcon(api, id === activeStoreId)))
    const marker = activeStoreId ? storeMarkersRef.current.get(activeStoreId) : undefined
    const store = stores?.find((s) => s.id === activeStoreId)
    if (!marker || !store) {
      infoRef.current?.close()
      pannedStoreRef.current = null
      infoDeferredRef.current = false                      // 해제·위치 변경: 미룬 열기도 없앤다(옛 정보창 복원 없음)
      return
    }
    // ResizeObserver 알림(`sized`)은 다음 렌더 프레임에 오므로, 열기 직전에 실제 크기도 한 번 더 본다.
    // 미루면 표시만 해 두고, 다음 양수 크기 알림(크기 맞춤 뒤)에서 그때의 선택으로 다시 처리한다
    const el = sectionRef.current
    if (!sized || !el || el.clientWidth === 0 || el.clientHeight === 0) {
      infoRef.current?.close()
      infoDeferredRef.current = true
      return
    }
    infoDeferredRef.current = false
    const content = storeInfoContent(store, () => closeStoreRef.current())
    if (infoRef.current) infoRef.current.setContent(content)
    else
      infoRef.current = new api.InfoWindow({
        content,
        borderWidth: 1,
        borderColor: token('--color-border'),
        backgroundColor: token('--color-surface'),
        anchorSize: new api.Size(10, 8),
        disableAnchor: false,
      })
    const info = infoRef.current
    const resetInfo = () => {
      info.setOptions?.({ pixelOffset: new api.Point(0, 0), disableAnchor: false, anchorSkew: false })
      infoAdjustedRef.current = false
    }
    resetInfo()                                                   // 기본 위치에서 다시 시작
    info.open(map, marker)
    // 정보창 배치(D-022): 이동이 끝난 뒤 정보창이 U 밖이거나 분석 핀(단일 핀, 비교면 A·B 핀 — 8-B2)을 덮으면 후보 위치로 옮긴다
    const place = () => {
      if (placeStoreInfo(api, map, info, el, canvasRef.current)) infoAdjustedRef.current = true
    }
    if (pannedStoreRef.current !== activeStoreId) {
      map.panTo(new api.LatLng(store.lat, store.lng))
      pannedStoreRef.current = activeStoreId
      // panTo는 약 1초 애니메이션 — idle 뒤에 잰다. idle이 오지 않으면(그리기가 멈춘 창) 1.5초 뒤 한 번
      let done = false
      const once = () => {
        if (done) return
        done = true
        api.Event.removeListener(idle)
        clearTimeout(timer)
        place()
      }
      const idle = api.Event.addListener(map, 'idle', once)
      const timer = setTimeout(once, 1500)
      return () => {
        done = true
        api.Event.removeListener(idle)
        clearTimeout(timer)
      }
    }
    place()
  }, [api, map, stores, activeStoreId, sized, infoRetry])

  useEffect(
    () => () => {
      infoRef.current?.close()
      infoRef.current = null
    },
    [map],
  )

  // 분석된 행정동 경계 강조: A, 그리고 성공한 B. B가 A와 같은 동이면 다시 그리지 않는다
  useDongPolygons(api, map, dong?.guCode, dong?.dongName)
  const bDong = compare?.dong ?? null
  const bSameDong = bDong !== null && dong !== null && bDong.guCode === dong.guCode && bDong.dongName === dong.dongName
  useDongPolygons(api, map, bSameDong ? undefined : bDong?.guCode, bSameDong ? undefined : bDong?.dongName)

  return (
    // tabIndex=-1: 정보창을 닫은 뒤 포커스를 받을 수 있게 (탭 순서에는 넣지 않는다)
    // map--store-active: 선택한 점포 막대가 있다 → mobile에서는 같은 자리의 안내 칩을 숨긴다(겹치지 않게, MapView.css)
    <section
      ref={sectionRef}
      className={`map${activeStore ? ' map--store-active' : ''}`}
      aria-label="위치 선택 지도"
      tabIndex={-1}
      onKeyDown={onMapKeyDown}
    >
      <div ref={canvasRef} className="map__canvas" />
      {/* SDK 정보창 밖에서도 키보드로 닫을 수 있는 조작 (DESIGN.md §8.14). 지도 위 우리 DOM이라 탭 순서에 들어간다 */}
      {activeStore && (
        <div className="map__store-bar" role="group" aria-label="선택한 점포">
          <span className="map__store-bar-name">
            {storeContext && <span className="map__store-bar-context">{storeContext} · </span>}
            {activeStore.name}
          </span>
          <button type="button" className="map__store-bar-close" onClick={closeStore}>
            정보창 닫기
          </button>
        </div>
      )}
      {error ? (
        <div className="map__state" role="alert">
          <Icon name="alert-triangle" size={20} />
          <p className="map__state-title">{MESSAGES[error].title}</p>
          <p className="map__state-body">{MESSAGES[error].body}</p>
        </div>
      ) : (
        !map && (
          <div className="map__state" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <p className="map__state-body">지도를 불러오는 중…</p>
          </div>
        )
      )}
      {map && !error && (compare ? compare.guide : !selected && '지도를 눌러 위치를 고르세요') && (
        <p className="map__guide">{compare ? compare.guide : '지도를 눌러 위치를 고르세요'}</p>
      )}
      {map && !error && (
        <ul className="map__legend" aria-label="지도 범례">
          {compare ? (
            <>
              <li>
                <span className="map__legend-marker map__legend-marker--a" aria-hidden="true" />A 기준 위치
              </li>
              <li>
                <span className="map__legend-marker map__legend-marker--b" aria-hidden="true" />B 비교 위치
              </li>
              <li>
                <span className="map__legend-radius" aria-hidden="true" />A 반경 {RADIUS_M}m
              </li>
              <li>
                <span className="map__legend-radius map__legend-radius--b" aria-hidden="true" />B 반경 {RADIUS_M}m
              </li>
            </>
          ) : (
            <>
              <li>
                <span className="map__legend-marker" aria-hidden="true" />
                선택 지점
              </li>
              <li>
                <span className="map__legend-radius" aria-hidden="true" />
                반경 {RADIUS_M}m
              </li>
            </>
          )}
          <li>
            <span className="map__legend-dong" aria-hidden="true" />
            분석된 행정동 경계
          </li>
          {stores && stores.length > 0 && (
            <li>
              <span className="map__legend-store" aria-hidden="true" />
              같은 업종 점포
            </li>
          )}
          {/* D-022 순위 1: 단일 "범위에 맞추기"(분석 불가 지점은 반경 원이 없어 두지 않는다), 비교 "두 위치 모두 보기"(B를 고른 뒤) */}
          {(compare ? compare.location !== null && selected !== null : selected !== null && markerTone === 'selected') && (
            <li className="map__legend-action">
              <button type="button" className="button-ghost button-ghost--small map__fit" onClick={fitToRange}>
                {compare ? '두 위치 모두 보기' : '범위에 맞추기'}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
