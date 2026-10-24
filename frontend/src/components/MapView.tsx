import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { findDongRings } from '../map/dongBoundary.ts'
import { boundaryTier, loadGuBoundaries, type BoundaryTier } from '../map/guBoundary.ts'
import { lastStyleStatus, styleStatusSince } from '../map/styleStatus.ts'
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
  resetNaverMapsForRetry,
  type MapLoadErrorKind,
  type SdkEvent,
  type SdkState,
  type NaverCircle,
  type NaverInfoWindow,
  type NaverMap,
  type NaverMapsApi,
  type NaverMapEvent,
  type NaverMarker,
  type NaverPolygon,
} from '../map/naverMaps.ts'
import { formatRadius } from '../lib/format.ts'
import { STORE_GLYPH_FALLBACK, STORE_MARKER_SIZE, storeMarkerHtml, storeMarkerMode, type StoreGlyph, type StoreMarkerMode } from '../lib/storeIcons.ts'
import { STORE_LINKS_NOTE, type StoreLinks } from '../lib/storeLinks.ts'
import { Icon } from './Icon.tsx'
import { StoreGlyphIcon } from './StoreGlyphIcon.tsx'
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
 * b-select: B 선택(순위 5) / focus: A↔B 기준 전환(비교 중) · 비교 종료(end, → A)(순위 6)
 */
type FitAction =
  | { t: 'single'; mode: 'auto' | 'force' }
  | { t: 'union' }
  | { t: 'b-select' }
  | { t: 'focus'; side: 'A' | 'B'; end?: boolean }

/**
 * 지도에 표시할 동종 점포 (4차). 문구는 표시용으로 만들어 넘긴다(App이 API 응답으로 만든다).
 * links: 선택 점포 정보창의 네이버·구글 검색 링크(묶음 B, lib/storeLinks). 생략·null이면 링크 줄 없음(상호·주소 모두 없는 점포)
 */
export type MapStore = { id: string; name: string; address: string; distance: string; lat: number; lng: number; links?: StoreLinks | null }

export type MapViewProps = {
  /** 선택 지점. null이면 마커·반경 없음 */
  selected: LatLng | null
  /**
   * 분석 반경(m, 8-D3). A·B 원 반경·맞춤·범례에 쓴다. 생략하면 500. 바뀌면 원을 바로 바꾸고 새 원에 맞춘다
   * (D-022 순위 3 — 새 위치와 같은 규칙, 잠금 해제. 비교 중 B가 있으면 B 선택과 같은 규칙)
   */
  radiusM?: number
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
  /**
   * 점포 업종 글리프(묶음 B, lib/storeIcons — App이 점포 응답의 biz_code로 정한다). 생략하면 폴백 `store`.
   * 표현(아이콘 24px / 16px / 점)은 줌·개수 규칙으로 MapView가 정한다
   */
  storeGlyph?: StoreGlyph
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
  /**
   * 화면 테마(묶음 A, §19.7). 바뀌면 지도를 그 테마에 맞게 다시 만든다 — 다크: `VITE_NAVER_MAP_STYLE_ID`(GL 다크 스타일),
   * 라이트: `VITE_NAVER_MAP_LIGHT_STYLE_ID`가 있으면 GL 라이트 스타일, 없으면 NAVER 기본 밝은 지도. 둘 다 스타일 실패 시 밝은 지도로
   * 복구한다(§19.3.1). 중심·줌·오버레이·선택은 새 지도로 이어진다. 생략하면 다크
   */
  theme?: 'light' | 'dark'
}

/** 인천 중심 초기 화면 (인천광역시청 부근) */
const INCHEON_CENTER: LatLng = { lat: 37.4563, lng: 126.7052 }
const INITIAL_ZOOM = 11
/** 기본 분석 반경 = 엔진 config.RADIUS_M (meta.분석반경_m). 반경 선택(8-D3)이 있으면 radiusM prop */
export const RADIUS_M = 500
/** GL 벡터 지도(검수용 선택, 기본 끔 — `VITE_NAVER_MAP_GL=1`). 다크 스타일 ID가 있으면 이 값과 무관하게 GL로 먼저 만든다(8-DK) */
const MAP_GL = import.meta.env.VITE_NAVER_MAP_GL === '1'
/**
 * 다크 스타일 지도·밝은 대체 지도의 init 대기 시간 (DESIGN.md §19.3.1, 8-DK). **화면이 보이는 동안만** 센다 —
 * 문서가 숨겨졌거나 지도 영역 크기가 0이면(mobile 패널 화면) 멈추고, 다시 보이면 처음부터 센다
 */
export const MAP_INIT_TIMEOUT_MS = 8_000
const INIT_TICK_MS = 250
/** 지도 톤 (§19.3): 다크 = 실제 GL + 그 지도의 스타일 요청 200 + init. 그 밖은 밝은 지도 + 밝은 대체 팔레트 */
export type MapTone = 'dark' | 'light'

/** 지도 톤을 문서에 건다 — 지도 오버레이·정보창 색 토큰(tokens-a3.css)이 이 값으로 바뀐다 */
function applyMapTone(tone: MapTone | null) {
  if (tone) document.documentElement.dataset.mapTone = tone
  else delete document.documentElement.dataset.mapTone
}
/** 사용 영역 U의 여백 (D-022) */
const FIT_PAD = 8
/**
 * SDK 표기 DOM을 못 찾을 때 대신 쓰는 사각형(지도 생성 직후 아직 없을 수 있다, 8-B0): 로고·축척·지도 데이터 저작권 한 줄,
 * 왼쪽 아래(A3, D-023 — 실측 약 240×17). 확대·축소·맞춤은 우리 버튼(.map__controls)이라 DOM으로 잰다
 */
const SDK_CONTROL_FALLBACK = (_w: number, h: number): Rect[] => [{ x: 10, y: h - 27, w: 240, h: 17 }]

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

/** 반경 원 선 모양: A 짧은 대시, B 점 — 같은 반경을 선 모양으로 구분한다 (COMPARE_DESIGN.md 4.2). 색도 A/B로 다르다(§19.3) */
const RADIUS_STROKE = { A: 'shortdash', B: 'dot' } as const
const RADIUS_TOKENS = {
  A: { stroke: '--color-map-radius-stroke', fill: '--color-map-radius-fill' },
  B: { stroke: '--color-map-b-radius-stroke', fill: '--color-map-b-radius-fill' },
} as const

/** 분석 반경 원 (§8.11, 기본 500m). 색·두께는 지도 톤 토큰(§19.3: 다크 2px, 밝은 지도 2.5px) */
function radiusCircle(api: NaverMapsApi, map: NaverMap, center: unknown, which: 'A' | 'B', radius: number): NaverCircle {
  return new api.Circle({
    map,
    center,
    radius,
    fillColor: token(RADIUS_TOKENS[which].fill),
    fillOpacity: 1,
    strokeColor: token(RADIUS_TOKENS[which].stroke),
    strokeWeight: Number.parseFloat(token('--map-radius-stroke-width')) || 2,
    strokeStyle: RADIUS_STROKE[which],
    clickable: false,
  })
}

/** 행정동 경계 강조 (A·B 공용). guCode·dongName이 없으면 그리지 않고, 바뀌면 이전 경계를 지운다 */
/**
 * 지도·오버레이·리스너 정리 중 SDK 호출. NAVER SDK는 인증 실패 때 `window.naver.maps`를 null 로 바꾸고, 그 뒤 이미 만든 객체를
 * 다루는 SDK 내부가 TypeError 를 던진다(2026-10-25 무트래픽 리비전 검증 — 테마 전환 때 Event.removeListener). 정리 중 예외가
 * React effect 정리 밖으로 나가면 앱 전체가 내려가므로, 단계마다 시도하고 실패는 숨기지 않고 console.error 로 남긴 뒤 나머지를 계속한다
 */
function release(label: string, steps: readonly (() => unknown)[]): void {
  let first: unknown = null
  let failed = 0
  for (const step of steps) {
    try {
      step()
    } catch (e) {
      if (failed === 0) first = e
      failed += 1
    }
  }
  if (failed > 0) console.error(`[map] ${label} 중 NAVER SDK 오류 ${failed}건 — 이 지도 객체는 버리고 계속합니다`, first)
}

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
              strokeStyle: 'shortdash',                    // 흐린 점선 — 위계: 핀 → 반경 원 → 점포 → 경계(§19.3)
              clickable: false,
            }),
          )
        }
      })
      .catch((e: unknown) => console.error('[map] 행정동 경계를 불러오지 못했습니다', e))
    return () => {
      cancelled = true
      release('행정동 경계 정리', polygons.map((p) => () => p.setMap(null)))
    }
  }, [api, map, guCode, dongName])
}

/**
 * 인천 외곽선 + 구 경계 (묶음 A, §19.3 위계: 외곽 2px 실선 › 구 1px 실선 › 분석 행정동 점선). 지도가 준비되면 1회 받아 그리고,
 * 줌 단계(래스터 기준 ≤11 외곽선만 / 12~14 구 경계 / ≥15 구 경계 흐리게)는 zoom_changed·idle 때 옵션만 바꾼다.
 * 색은 지도 톤 토큰(§19.3)에서 그릴 때 읽는다 — 톤·테마가 바뀌면 지도가 새로 만들어져 다시 그린다. 클릭을 받지 않는다
 */
function useGuBoundaries(api: NaverMapsApi | null, map: NaverMap | null, renderModeRef: { current: number | null }) {
  useEffect(() => {
    if (!api || !map) return
    let cancelled = false
    const outline: NaverPolygon[] = []
    const gu: NaverPolygon[] = []
    const listeners: unknown[] = []
    let tier: BoundaryTier | null = null
    const apply = () => {
      const next = boundaryTier(rasterZoom(map.getZoom(), renderModeRef.current))
      if (next === tier) return
      tier = next
      for (const p of gu) {
        if (next === 'outline') {
          p.setMap(null)
          continue
        }
        p.setOptions?.({ strokeColor: token(next === 'gu' ? '--color-map-gu-stroke' : '--color-map-gu-stroke-faint') })
        p.setMap(map)
      }
    }
    const make = (rings: { lat: number; lng: number }[][][], options: Record<string, unknown>) =>
      rings.map(
        (polygon) =>
          new api.Polygon({
            map,
            paths: polygon.map((ring) => ring.map((p) => new api.LatLng(p.lat, p.lng))),
            fillOpacity: 0,
            strokeOpacity: 1,
            clickable: false,
            ...options,
          }),
      )
    loadGuBoundaries()
      .then((b) => {
        if (cancelled) return
        outline.push(...make(b.outline, { strokeColor: token('--color-map-outline-stroke'), strokeWeight: 2, zIndex: 2 }))
        gu.push(...make(b.gu, { strokeColor: token('--color-map-gu-stroke'), strokeWeight: 1, zIndex: 1 }))
        apply()
        listeners.push(api.Event.addListener(map, 'zoom_changed', apply), api.Event.addListener(map, 'idle', apply))
      })
      .catch((e: unknown) => console.error('[map] 구 경계를 불러오지 못했습니다', e))
    return () => {
      cancelled = true
      release('구 경계 정리', [
        ...listeners.map((l) => () => api.Event.removeListener(l)),
        ...[...outline, ...gu].map((p) => () => p.setMap(null)),
      ])
    }
  }, [api, map, renderModeRef])
}

/**
 * 지금 줌(래스터 기준, GL은 +1 환산 — mapFit.rasterZoom). 지도가 준비되면 읽고 init·zoom_changed·idle 때 갱신한다.
 * 점포 표현 전환(묶음 B)에만 쓴다 — 값이 같으면 React가 다시 그리지 않는다. 지도가 없으면 0(점 표현)
 */
function useRasterZoom(api: NaverMapsApi | null, map: NaverMap | null, renderModeRef: { current: number | null }): number {
  const [zoom, setZoom] = useState<number>(0)
  useEffect(() => {
    if (!api || !map) return
    const read = () => setZoom(rasterZoom(map.getZoom(), renderModeRef.current))
    read()
    const listeners = ['init', 'zoom_changed', 'idle'].map((type) => api.Event.addListener(map, type, read))
    return () => release('줌 리스너 해제', listeners.map((l) => () => api.Event.removeListener(l)))
  }, [api, map, renderModeRef])
  return zoom
}

/**
 * 동종 점포 마커 아이콘 (§8.11, 묶음 B): 점 10px(선택 14px) 또는 업종 글리프 24px·16px(선택은 같은 크기 + 바깥 링).
 * 앵커는 마커 가운데(크기는 border 포함, box-sizing: border-box)
 */
const storeIcon = (api: NaverMapsApi, mode: StoreMarkerMode, glyph: StoreGlyph, active: boolean) => {
  const size = STORE_MARKER_SIZE[mode][active ? 'active' : 'normal']
  return { content: storeMarkerHtml(mode, glyph, active), anchor: new api.Point(size / 2, size / 2) }
}

/** 선택 점포 마커의 zIndex(다른 점포 위). 일반 점포는 SDK 기본값(undefined)으로 되돌린다 */
const STORE_ACTIVE_Z_INDEX = 1000

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
  // 네이버·구글 검색 링크(묶음 B, 2-4): 선택 점포에만. href는 DOM 속성으로(문자열 HTML 아님), 새 탭 + noopener
  if (store.links) {
    const links = document.createElement('p')
    links.className = 'map-store-info__links'
    const anchor = (href: string, text: string) => {
      const a = document.createElement('a')
      a.href = href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = text
      links.appendChild(a)
    }
    anchor(store.links.naver, '네이버 지도')
    anchor(store.links.google, '구글 지도')
    root.appendChild(links)
    line('p', STORE_LINKS_NOTE, 'map-store-info__caption')
  }
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'map-store-info__close'
  close.textContent = '닫기'
  close.addEventListener('click', onClose)
  root.appendChild(close)
  return root
}

/** SDK 컨트롤(로고·축척·저작권·확대 버튼) 사각형: z-index 100인 요소 중 바깥쪽 것만 본다(8-B0 스파이크와 같은 방식) */
function sdkControlRects(section: HTMLElement, canvas: HTMLElement | null): Rect[] {
  if (!canvas) return []
  const m = section.getBoundingClientRect()
  const out: Rect[] = []
  for (const el of canvas.querySelectorAll<HTMLElement>('*')) {
    if (getComputedStyle(el).zIndex !== '100') continue
    if (el.parentElement && getComputedStyle(el.parentElement).zIndex === '100') continue
    const b = el.getBoundingClientRect()
    if (b.width < 1 || b.height < 1 || b.width >= m.width) continue
    out.push({ x: b.left - m.left, y: b.top - m.top, w: b.width, h: b.height })
  }
  return out
}

/**
 * 사용 영역 U의 장애물(지도 section 기준 사각형): 우리 오버레이(범례·안내 칩·점포 막대) + SDK 컨트롤.
 * SDK 컨트롤을 못 찾으면 실측 크기로 대신한다
 */
function mapObstacles(section: HTMLElement, canvas: HTMLElement | null): Rect[] {
  const m = section.getBoundingClientRect()
  const rel = (b: DOMRect): Rect => ({ x: b.left - m.left, y: b.top - m.top, w: b.width, h: b.height })
  const out: Rect[] = []
  for (const el of section.querySelectorAll<HTMLElement>('.map__legend, .map__guide, .map__store-bar, .map__controls')) {
    const b = el.getBoundingClientRect()
    if (b.width > 0 && b.height > 0) out.push(rel(b))
  }
  // 지도 밖에서 지도 위에 떠 있는 화면 요소(A3: 위쪽 조건 바·오른쪽 결과 패널): `data-map-obstacle`. 지도와 겹친 부분만 센다
  for (const el of document.querySelectorAll<HTMLElement>('[data-map-obstacle]')) {
    if (section.contains(el) || el.contains(section)) continue
    const b = el.getBoundingClientRect()
    const x = Math.max(b.left, m.left)
    const y = Math.max(b.top, m.top)
    const r = Math.min(b.right, m.right)
    const bottom = Math.min(b.bottom, m.bottom)
    if (r - x > 0 && bottom - y > 0) out.push({ x: x - m.left, y: y - m.top, w: r - x, h: bottom - y })
  }
  const sdk = sdkControlRects(section, canvas)
  out.push(...(sdk.length > 0 ? sdk : SDK_CONTROL_FALLBACK(section.clientWidth, section.clientHeight)))
  return out
}

/** 지도 아래 끝에 붙은 SDK 표기 줄(로고·축척·저작권)로 보는 범위 */
const BAND_EDGE_PX = 48

/**
 * 저작권 줄 배경 띠 (§19.3, 8-DK): SDK 표기 줄(로고·축척·지도 데이터 저작권)의 실제 크기에 맞춘다. SDK 요소는 건드리지 않고
 * 그 아래(지도 타일·오버레이 위)에 띠만 깐다 — SDK 글자색(#444)·로고는 다크 스타일에서도 그대로라 밝은 띠가 필요하다.
 * 축척 길이가 zoom마다 바뀌므로 idle·크기 맞춤마다 다시 잰다. 표기를 못 찾으면 숨긴다
 */
function syncControlBand(band: HTMLElement | null, section: HTMLElement | null, canvas: HTMLElement | null) {
  if (!band || !section) return
  const w = section.clientWidth
  const h = section.clientHeight
  const rects = sdkControlRects(section, canvas).filter((r) => r.y + r.h >= h - BAND_EDGE_PX && r.h < BAND_EDGE_PX)
  if (w === 0 || h === 0 || rects.length === 0) {
    if (!band.hidden) band.hidden = true                   // 바뀔 때만 쓴다(idle·크기 맞춤마다 불린다)
    return
  }
  const left = Math.min(...rects.map((r) => r.x))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const top = Math.min(...rects.map((r) => r.y))
  const padX = Number.parseFloat(token('--map-band-pad-x')) || 4
  const padTop = Number.parseFloat(token('--map-band-pad-top')) || 2
  // 표기 묶음이 오른쪽이면 오른쪽 끝에, 왼쪽이면 왼쪽 끝에 붙인다
  const onRight = left + right > w
  band.style.left = onRight ? 'auto' : '0px'
  band.style.right = onRight ? '0px' : 'auto'
  band.style.width = `${Math.ceil(onRight ? w - left + padX : right + padX)}px`
  band.style.height = `${Math.ceil(h - top + padTop)}px`
  band.dataset.side = onRight ? 'right' : 'left'
  band.hidden = false
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
  init: {
    title: '지도를 준비하지 못했습니다',
    body: '잠시 뒤 새로고침해 주세요. 패널의 좌표 입력으로도 위치를 고를 수 있습니다.',
  },
}

/**
 * NAVER 지도 (DESIGN.md §5.D, §8.11·§8.12). SDK는 map/naverMaps.ts 로더를 통해서만 쓴다.
 * 클릭 → onSelect(좌표). 선택 지점에 마커 + 반경 500m 원, 분석 후 행정동 경계 강조.
 */
export function MapView({
  selected,
  radiusM = RADIUS_M,
  markerTone,
  dong,
  interactive,
  onSelect,
  stores = null,
  activeStoreId = null,
  onStoreSelect,
  storeGlyph = STORE_GLYPH_FALLBACK,
  compare = null,
  storeContext,
  onSdkState,
  layoutKey,
  theme = 'dark',
}: MapViewProps) {
  const sectionRef = useRef<HTMLElement>(null)
  /** React가 그리는 지도 자리. SDK 지도 요소(canvas)는 세대마다 이 안에 새로 만든다(8-DK) */
  const hostRef = useRef<HTMLDivElement>(null)
  /** 지금 세대의 SDK 지도 요소 */
  const canvasRef = useRef<HTMLDivElement | null>(null)
  /** 저작권 줄 배경 띠 (§19.3) */
  const bandRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<NaverMapsApi | null>(null)
  const [map, setMap] = useState<NaverMap | null>(null)
  const [error, setError] = useState<MapLoadErrorKind | null>(null)
  // "지도 다시 불러오기"(인증·로드·초기화 실패 뒤). 값이 바뀌면 아래 SDK 로드·지도 생성 effect가 처음부터 다시 돈다
  const [retry, setRetry] = useState(0)
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
  /**
   * 테마 전환으로 지도를 다시 만들 때 이어받는 보기(중심·래스터 기준 zoom, 묶음 A). 이전 세대를 정리하기 직전에 적고,
   * 새 지도를 내놓을 때 지운다. 이어받아 만든 지도(restoredMapRef)에서는 "새 위치"·"B 선택" 맞춤을 다시 돌리지 않는다 —
   * 좌표가 그대로이므로 보던 범위를 유지한다(스타일 실패 복구도 같은 경로)
   */
  const carryRef = useRef<{ lat: number; lng: number; zoomRaster: number } | null>(null)
  const restoredMapRef = useRef<NaverMap | null>(null)
  const liveMapRef = useRef<NaverMap | null>(null)

  /** 실패한 지도만 다시 불러온다 — 선택 위치·결과·비교는 props 그대로라 새 지도에 다시 그려진다 */
  const retryMap = () => {
    if (error === 'auth' || error === 'load') resetNaverMapsForRetry()
    setRetry((n) => n + 1)
  }

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
    // SDK 상태를 App에 올린다 (7-B1). failed는 끝 상태 — 뒤늦은 인증 실패 뒤 Geocoder 준비 알림이 ready로 되돌리지 못한다
    let sdkState: SdkState = { status: 'loading' }
    const report = (event: SdkEvent) => {
      const next = reduceSdkState(sdkState, event)
      if (next === sdkState || cancelled) return
      sdkState = next
      onSdkStateRef.current?.(next)
    }
    let unsubscribeGeocoder: (() => void) | null = null
    // 인증 실패: 이 SDK는 더 쓸 수 없다(naver.maps = null). 지금 세대(지도·리스너·init 대기)를 바로 걷어 내고 지도 영역에 안내만 남긴다 —
    // 대기 중이던 스타일 지도가 시간 초과로 밝은 지도를 다시 만들거나, 내놓은 지도에 오버레이를 계속 그리지 않게 한다
    let authDead = false
    const unsubscribe = onNaverAuthFailure(() => {
      if (cancelled) return
      authDead = true
      gen += 1
      if (waitVisible) clearInterval(waitVisible)
      waitVisible = null
      disposeAttempt?.()
      disposeAttempt = null
      liveMapRef.current = null
      initedRef.current = false
      pendingFitRef.current = null
      applyMapTone(null)
      setMap(null)
      setError('auth')
      report({ type: 'auth-failed' })
    })

    // 지도 세대 (DESIGN.md §19.3.1, 8-DK): 지도 하나와 그 지도에 붙인 리스너·타이머·스타일 관찰. 다크 스타일이 실패하면 이 세대를
    // 모두 정리하고 밝은 지도를 한 번만 다시 만든다. 이전 세대의 늦은 이벤트·타이머·스타일 요청 결과는 세대 번호가 달라 버린다
    let gen = 0
    let disposeAttempt: (() => void) | null = null
    // 테마별 커스텀 스타일(묶음 A): 다크는 §19.4 스타일, 라이트는 선택(없으면 NAVER 기본 밝은 지도). 스타일이 성공하면 그 테마의 톤
    const styleId = (theme === 'dark' ? import.meta.env.VITE_NAVER_MAP_STYLE_ID : import.meta.env.VITE_NAVER_MAP_LIGHT_STYLE_ID) ?? ''
    const styledTone: MapTone = theme

    /** 지도를 화면에 내놓는다(오버레이·맞춤·주소 기능이 이 지도로 돈다). 톤을 먼저 걸어 오버레이가 맞는 색으로 그려지게 한다 */
    const expose = (loaded: NaverMapsApi, map: NaverMap, tone: MapTone) => {
      applyMapTone(tone)
      if (sectionRef.current) sectionRef.current.dataset.mapTone = tone
      restoredMapRef.current = carryRef.current ? map : null
      carryRef.current = null
      liveMapRef.current = map
      setApi(loaded)
      setMap(map)
      // 지도는 준비됐다. Geocoder는 지금 상태를 올리고, 뒤에 정해지면(ready/unavailable) 다시 올린다
      report({ type: 'map-ready', api: loaded, geocoder: getGeocoderAvailability() })
      unsubscribeGeocoder = onGeocoderAvailability((geocoder) => report({ type: 'geocoder', geocoder }))
    }

    /** init 뒤 공통: 실제 그리기 방식(1 래스터 / 2 GL — GL을 요청해도 지원 안 되면 1)을 남기고 미룬 맞춤을 돈다 */
    const markInited = (map: NaverMap) => {
      if (initedRef.current) return
      initedRef.current = true
      const mode = map.get?.('renderMode')
      renderModeRef.current = typeof mode === 'number' ? mode : null
      if (sectionRef.current && mode != null) sectionRef.current.dataset.renderMode = String(mode)
      const pending = pendingFitRef.current
      pendingFitRef.current = null
      if (pending) runFitRef.current(pending)
    }

    /**
     * 지도 한 세대를 만든다. kind:
     * - plain: 스타일 ID 없음 — 지금까지와 같다(바로 내놓고 init 뒤 맞춤, 밝은 지도)
     * - styled: GL + 다크 스타일. init + 이 세대의 스타일 요청 200 + 실제 GL일 때만 다크로 내놓는다. 아니면 fallback
     * - fallback: 스타일 실패 뒤 한 번만 — `gl: false`, 스타일 없음. init 뒤에 밝은 팔레트로 내놓고, 이것도 실패하면 지도 오류
     */
    const attempt = (loaded: NaverMapsApi, kind: 'plain' | 'styled' | 'fallback') => {
      const host = hostRef.current
      if (cancelled || authDead || !host) return
      const g = ++gen
      const live = () => !cancelled && !authDead && g === gen
      const listeners: unknown[] = []
      let tick: ReturnType<typeof setInterval> | null = null
      let raf = 0
      let observer: PerformanceObserver | null = null
      let onVisibility: (() => void) | null = null
      // SDK가 컨테이너에 inline 스타일·자식을 남기므로 세대마다 새 요소를 쓴다(React가 그리는 host 안)
      const canvas = document.createElement('div')
      canvas.className = 'map__canvas'
      host.appendChild(canvas)
      canvasRef.current = canvas
      const gl = kind === 'styled' || (kind === 'plain' && MAP_GL)
      const t0 = typeof performance.now === 'function' ? performance.now() : 0
      // 테마 전환이면 이전 지도의 보기(중심·래스터 기준 zoom)를 이어받는다. GL은 같은 축척에서 zoom이 1 작다(래스터 11 = GL 10)
      const carry = carryRef.current
      const center = carry ?? INCHEON_CENTER
      const zoomRaster = carry ? carry.zoomRaster : INITIAL_ZOOM
      // SDK 초기화 실패(지도 생성자가 예외): 만든 요소만 정리하고 지도 영역 오류로 둔다 — 예외를 위로 올리지 않는다
      let map: NaverMap
      try {
        map = new loaded.Map(canvas, {
          center: new loaded.LatLng(center.lat, center.lng),
          zoom: gl ? zoomRaster - 1 : zoomRaster,
          ...(gl ? { gl: true } : {}),
          ...(kind === 'styled' ? { customStyleId: styleId } : {}),
          // 확대·축소는 지도에 보이는 영역 오른쪽 아래의 우리 버튼(.map__controls, A3 §19.1) — 지도가 화면 전체라 SDK 오른쪽
          // 컨트롤은 결과 패널 뒤에 숨는다. 로고·축척·지도 데이터 저작권(D-023 D7)은 왼쪽 아래 한 줄 + 배경 띠(syncControlBand)
          zoomControl: false,
          scaleControl: true,
          logoControlOptions: { position: loaded.Position.BOTTOM_LEFT },
          scaleControlOptions: { position: loaded.Position.BOTTOM_LEFT },
          mapDataControl: true,
          mapDataControlOptions: { position: loaded.Position.BOTTOM_LEFT },
        })
      } catch (e) {
        console.error('[map] NAVER 지도를 만들지 못했습니다 — 지도 영역만 실패로 두고 분석·비교는 그대로 씁니다', e)
        canvas.remove()
        if (canvasRef.current === canvas) canvasRef.current = null
        setError('init')
        report({ type: 'map-failed', kind: 'init' })
        return
      }
      const stopWaiting = () => {
        if (tick) clearInterval(tick)
        tick = null
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        observer?.disconnect()
        observer = null
        if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
        onVisibility = null
      }
      disposeAttempt = () => {
        stopWaiting()
        release('지도 세대 정리', [...listeners.map((l) => () => loaded.Event.removeListener(l)), () => map.destroy?.()])
        listeners.length = 0
        canvas.remove()
        if (canvasRef.current === canvas) canvasRef.current = null
      }
      const on = (type: string, handler: (e: NaverMapEvent) => void) =>
        listeners.push(loaded.Event.addListener(map, type, (e) => live() && handler(e)))
      try {
        on('click', (e) => {
          if (!interactiveRef.current) return
          onSelectRef.current({ lat: round(e.coord.lat()), lng: round(e.coord.lng()) })
        })
        on('zooming', () => (lockedRef.current = true))
        on('dragstart', () => (lockedRef.current = true))
        on('idle', () => syncControlBand(bandRef.current, sectionRef.current, canvasRef.current))
      } catch (e) {
        console.error('[map] NAVER 지도 이벤트를 걸지 못했습니다 — 만든 지도를 정리하고 지도 영역만 실패로 둡니다', e)
        disposeAttempt()
        disposeAttempt = null
        setError('init')
        report({ type: 'map-failed', kind: 'init' })
        return
      }

      if (kind === 'plain') {
        on('init', () => markInited(map))
        expose(loaded, map, 'light')
        return
      }

      // init 대기: 보이는 동안(문서 보임 + 지도 영역 크기 > 0)만 센다. 숨겨지면 0으로 되돌려 다시 보이면 처음부터 센다.
      // 숨김 중 만든 지도는 크기 0이라 init이 오지 않을 수 있어, 보이면 setSize 한다(크기 맞춤 effect는 내놓은 뒤에만 돈다)
      let settled = false
      let elapsed = 0
      let lastSize = ''
      const finish = (outcome: 'init' | 'timeout' | 'style-failed') => {
        if (settled || !live()) return
        settled = true
        stopWaiting()
        if (kind === 'styled') {
          // 이 세대의 요청이 없으면(SDK 캐시) 이 페이지에서 **이 스타일 ID**로 마지막에 본 결과로 본다 — 다른 스타일의 실패와 섞지 않는다
          const status = styleStatusSince(t0, styleId) ?? lastStyleStatus(styleId)
          const styled = outcome === 'init' && status === 200 && map.get?.('renderMode') === 2
          if (styled) {
            markInited(map)
            expose(loaded, map, styledTone)
            return
          }
          // 스타일 실패(요청 200 아님·시간 초과·GL 아님) → 이 세대를 정리하고 밝은 지도를 한 번만 다시 만든다.
          // 선택 위치·반경·결과는 props 그대로이고, 오버레이·맞춤은 새 지도를 내놓은 뒤 effect가 다시 그린다
          console.warn(`[map] ${styledTone === 'dark' ? '다크' : '라이트'} 지도 스타일을 쓰지 못해 기본 밝은 지도로 바꿉니다 (${outcome}${status ? `, 스타일 요청 ${status}` : ''})`)
          disposeAttempt?.()
          disposeAttempt = null
          attempt(loaded, 'fallback')
          return
        }
        if (outcome === 'init') {
          markInited(map)
          expose(loaded, map, 'light')
          return
        }
        // 밝은 대체 지도도 준비되지 않았다 — 다시 시도하지 않는다(좌표 입력 등 지도 없는 경로는 그대로)
        disposeAttempt?.()
        disposeAttempt = null
        setError('init')
        report({ type: 'map-failed', kind: 'init' })
      }
      const visible = () => {
        const el = sectionRef.current
        return document.visibilityState !== 'hidden' && !!el && el.clientWidth > 0 && el.clientHeight > 0
      }
      // 실제로 그려지는지: 문서가 visible이어도 앞에 나와 있지 않은 탭·창은 프레임을 그리지 않아 GL init이 오지 않는다
      // (검수 브라우저에서 확인 2026-10-18). 직전 tick 뒤 프레임이 하나라도 그려졌을 때만 센다. rAF가 없으면 그린다고 본다
      const hasRaf = typeof requestAnimationFrame === 'function'
      let painted = !hasRaf
      const frame = () => {
        painted = true
        if (!settled && live()) raf = requestAnimationFrame(frame)
      }
      if (hasRaf) raf = requestAnimationFrame(frame)
      tick = setInterval(() => {
        if (!live() || settled) return
        const drawn = painted
        painted = !hasRaf
        if (!visible() || !drawn) {
          elapsed = 0
          return
        }
        const el = sectionRef.current!
        const size = `${el.clientWidth}x${el.clientHeight}`
        if (size !== lastSize) {
          lastSize = size
          map.setSize(new loaded.Size(el.clientWidth, el.clientHeight))
        }
        elapsed += INIT_TICK_MS
        if (elapsed >= MAP_INIT_TIMEOUT_MS) finish('timeout')
      }, INIT_TICK_MS)
      onVisibility = () => {
        if (document.visibilityState === 'hidden') elapsed = 0
      }
      document.addEventListener('visibilitychange', onVisibility)
      on('init', () => finish('init'))
      if (kind === 'styled') {
        // 스타일 요청이 200이 아니면 SDK는 init 없이 "인증 실패" 무늬만 그린다(스파이크 실측) — 바로 실패로 본다
        const check = () => {
          const status = styleStatusSince(t0, styleId)
          if (status !== null && status !== 200) finish('style-failed')
        }
        if (typeof PerformanceObserver === 'function') {
          try {
            observer = new PerformanceObserver(() => live() && check())
            observer.observe({ type: 'resource', buffered: false })
          } catch {
            observer = null                                   // 관찰을 못 하면 시간 초과로 판정한다
          }
        }
        check()
      }
    }

    /**
     * 스타일(GL) 지도는 지도 영역이 보일 때만 만든다. 숨겨진(0×0, mobile 패널 화면) 컨테이너에 만들면 SDK가 GL을 못 열어 래스터로
     * init 하고, 그러면 스타일 실패로 보여 밝은 지도로 복구돼 버린다(묶음 A 검수에서 테마 전환 시 재현). 보일 때까지 기다렸다 만든다 —
     * 그동안 지도 상태는 비어 있고(로딩 표시), 보이는 순간 만든다. 기본 지도(plain)는 지금처럼 바로 만든다
     */
    let waitVisible: ReturnType<typeof setInterval> | null = null
    const sectionVisible = () => {
      const el = sectionRef.current
      return !!el && el.clientWidth > 0 && el.clientHeight > 0
    }
    const start = (loaded: NaverMapsApi, kind: 'plain' | 'styled') => {
      if (kind === 'plain' || sectionVisible()) return attempt(loaded, kind)
      waitVisible = setInterval(() => {
        if (cancelled || !sectionVisible()) return
        if (waitVisible) clearInterval(waitVisible)
        waitVisible = null
        attempt(loaded, kind)
      }, INIT_TICK_MS)
    }
    // GL 서브모듈은 어느 테마든 스타일 ID가 하나라도 있으면 처음부터 불러온다(로더는 한 번만 붙는다 — 뒤에 테마를 바꿔도 다시 받지 않는다)
    const anyStyle = (import.meta.env.VITE_NAVER_MAP_STYLE_ID ?? '') !== '' || (import.meta.env.VITE_NAVER_MAP_LIGHT_STYLE_ID ?? '') !== ''
    loadNaverMaps(import.meta.env.VITE_NAVER_MAP_CLIENT_ID, { gl: MAP_GL || anyStyle })
      .then((loaded) => {
        if (cancelled) return
        start(loaded, styleId ? 'styled' : 'plain')
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
      // 테마 전환(theme 변경으로 다시 도는 effect): 내놓은 지도의 보기를 적어 두고 새 지도가 이어받는다. init 전이면 적지 않는다
      const live = liveMapRef.current
      carryRef.current = null
      release('테마 전환 보기 이어받기', [
        () => {
          const c = live && initedRef.current ? live.getCenter?.() : undefined
          const liveMode = live?.get?.('renderMode')
          carryRef.current = c
            ? { lat: c.lat(), lng: c.lng(), zoomRaster: rasterZoom(live!.getZoom(), typeof liveMode === 'number' ? liveMode : null) }
            : null
        },
      ])
      liveMapRef.current = null
      if (waitVisible) clearInterval(waitVisible)
      waitVisible = null
      disposeAttempt?.()
      disposeAttempt = null
      applyMapTone(null)
      initedRef.current = false
      pendingFitRef.current = null
      setMap(null)
      // 이 세대의 지도 오류는 세대와 함께 지운다 — 테마 전환으로 만드는 새 세대가 이전 오류 안내를 물려받지 않게(Codex 검수 2026-10-19).
      // 이전 세대의 늦은 실패는 cancelled·세대 번호·구독 해제로 새 세대의 상태를 건드리지 못하고, 새 세대가 실패하면 그때 다시 건다
      setError(null)
    }
  }, [theme, retry])

  // 바깥 .map 크기가 바뀌면 지도 크기를 맞춘다 (mobile 화면 전환·tablet 높이 변경·창 크기 변경).
  // canvas가 아니라 바깥 section을 본다 — SDK가 canvas에 inline px 크기를 넣어서 canvas는 레이아웃을 따라가지 않는다.
  // 크기가 0이면(숨김) setSize 하지 않고 `sized=false`만 둔다 — 점포 정보창은 `sized`일 때만 연다(아래, 6-4)
  useEffect(() => {
    const el = sectionRef.current
    if (!api || !map || !el) return
    const fit = () => {
      const visible = el.clientWidth > 0 && el.clientHeight > 0
      if (visible) map.setSize(new api.Size(el.clientWidth, el.clientHeight))
      syncControlBand(bandRef.current, el, canvasRef.current)
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
  const radiusRef = useRef(radiusM)
  const focusNowRef = useRef(compare?.focus ?? null)
  useLayoutEffect(() => {
    selectedRef.current = selected
    radiusRef.current = radiusM
    comparingRef.current = compare !== null
    bLocationRef.current = compare?.location ?? null
    focusNowRef.current = compare?.focus ?? null
    /**
     * 이 동작이 지금 상태에서 의미가 있는지: 단일·비교 종료(→A)는 비교 밖, 비교 동작은 비교 중 + B 있음,
     * 기준 전환은 그 기준이 아직 지금 기준일 때만(B를 지우거나 기준이 다시 바뀌면 버린다)
     */
    const valid = (action: FitAction) => {
      if (!selectedRef.current) return false
      if (action.t === 'single' || (action.t === 'focus' && action.end)) return !comparingRef.current
      if (!comparingRef.current || bLocationRef.current === null) return false
      return action.t !== 'focus' || focusNowRef.current === action.side
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
      // 사용자가 직접 확대·이동했으면(잠금) 맞추지 않는다 — 바로 실행하는 요청은 호출 전에 잠금을 풀고 오므로 여기서
      // 걸리는 것은 미뤄 둔 사이 잠긴 경우다(순위 4). 기준 전환·비교 종료는 잠금 중 panTo만(순위 6, 아래)
      if (lockedRef.current && action.t !== 'focus') return
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
      const boxA = circleBox(a.lat, a.lng, radiusRef.current)
      const bLoc = bLocationRef.current
      const boxB = bLoc ? circleBox(bLoc.lat, bLoc.lng, radiusRef.current) : boxA
      switch (action.t) {
        case 'single': {
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
  const lastSelectedKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedLat === undefined || selectedLng === undefined) lastSelectedKeyRef.current = null
    if (!api || !map || selectedLat === undefined || selectedLng === undefined) {
      pendingFitRef.current = null                        // 지도 교체 중(map null)에는 좌표 기록을 지우지 않는다 — 이어받기 판정용
      return
    }
    // 테마 전환으로 이어받은 지도 + 같은 좌표: 보던 범위를 유지한다(맞춤·panTo 없음). 좌표가 바뀌면 지금처럼
    const key = `${selectedLat},${selectedLng}`
    const restored = restoredMapRef.current === map && lastSelectedKeyRef.current === key
    lastSelectedKeyRef.current = key
    if (restored) return
    if (comparingRef.current) {
      map.panTo(new api.LatLng(selectedLat, selectedLng))
      return
    }
    lockedRef.current = false
    pendingFitRef.current = null
    runFitRef.current({ t: 'single', mode: 'auto' })
  }, [api, map, selectedLat, selectedLng])

  /**
   * 확대·축소 버튼(A3): 사용자가 직접 바꾼 것이므로 잠금을 켠다(D-022 순위 7 — SDK `zooming`은 우리 호출에서 오지 않는다, 8-B0)
   */
  const zoomBy = (delta: number) => {
    if (!map) return
    lockedRef.current = true
    map.setZoom(Math.round(map.getZoom()) + delta, true)
  }

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
      circleRef.current = radiusCircle(api, map, position, 'A', radiusRef.current)
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
      bCircleRef.current = radiusCircle(api, map, position, 'B', radiusRef.current)
    }
  }, [api, map, bLat, bLng, bTone])

  // 반경 변경(순위 3, 8-D3): 있는 원의 반경을 바로 바꾸고, 잠금을 풀어 새 원에 맞춘다 — 단일은 새 위치(순위 2)와 같은 규칙,
  // 비교 중 B가 있으면 B 선택(순위 5)과 같은 규칙. 처음 렌더(값이 바뀌지 않음)에는 움직이지 않는다
  const lastRadiusRef = useRef(radiusM)
  useEffect(() => {
    if (lastRadiusRef.current === radiusM) return
    lastRadiusRef.current = radiusM
    circleRef.current?.setRadius(radiusM)
    bCircleRef.current?.setRadius(radiusM)
    if (!api || !map) return
    lockedRef.current = false
    runFitRef.current(comparingRef.current && bLocationRef.current ? { t: 'b-select' } : { t: 'single', mode: 'auto' })
  }, [api, map, radiusM])

  // B를 고르면(순위 5, 잠금 해제) 두 원이 함께 들어가는 zoom이 래스터 기준 13 이상이면 A∪B, 아니면 B 원을 맞춘다.
  // B를 지울 때(다시 고르기)는 옮기지 않는다
  const lastBKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (bLat === undefined || bLng === undefined) lastBKeyRef.current = null
    if (!api || !map || bLat === undefined || bLng === undefined) return
    const key = `${bLat},${bLng}`
    const restored = restoredMapRef.current === map && lastBKeyRef.current === key   // 테마 전환: 같은 B면 보던 범위 유지
    lastBKeyRef.current = key
    if (restored) return
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
      runFitRef.current({ t: 'focus', side: 'A', end: true })
    }
    wasComparingRef.current = comparing
  }, [api, map, comparing, selectedLat, selectedLng])

  useEffect(
    () => () => {
      const refs = [markerRef, circleRef, bMarkerRef, bCircleRef]
      release('선택 마커·반경 정리', refs.map((ref) => () => ref.current?.setMap(null)))
      for (const ref of refs) ref.current = null
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

  // 점포 표현(묶음 B): 래스터 기준 줌 ≥15 아이콘 24px / 13~14 아이콘 16px / ≤12 점, N ≥ 80이면 점. 줌은 zoom_changed·idle에서 읽는다
  const rasterZoomNow = useRasterZoom(api, map, renderModeRef)
  const storeMode: StoreMarkerMode = storeMarkerMode(rasterZoomNow, stores?.length ?? 0)
  const storeModeRef = useRef(storeMode)
  useEffect(() => {
    storeModeRef.current = storeMode                       // 마커를 새로 만들 때 지금 표현으로(아래 effect보다 먼저 선언 → 먼저 실행)
  })

  // 동종 점포 마커 (4차). stores가 바뀌면 이전 마커·클릭 리스너를 모두 지우고 새로 그린다 (표현·선택이 바뀌면 아이콘만 바꾼다)
  const storeMarkersRef = useRef<Map<string, NaverMarker>>(new Map())
  useEffect(() => {
    if (!api || !map || !stores || stores.length === 0) return
    const markers = new Map<string, NaverMarker>()
    const listeners: unknown[] = []
    for (const store of stores) {
      const marker = new api.Marker({
        map,
        position: new api.LatLng(store.lat, store.lng),
        icon: storeIcon(api, storeModeRef.current, storeGlyph, false),
        clickable: true,
        title: store.name,
      })
      listeners.push(api.Event.addListener(marker, 'click', () => onStoreSelectRef.current?.(store.id)))
      markers.set(store.id, marker)
    }
    storeMarkersRef.current = markers
    return () => {
      release('점포 마커 정리', [
        ...listeners.map((l) => () => api.Event.removeListener(l)),
        ...[...markers.values()].map((m) => () => m.setMap(null)),
      ])
      storeMarkersRef.current = new Map()
    }
  }, [api, map, stores, storeGlyph])

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
    storeMarkersRef.current.forEach((m, id) => {
      const active = id === activeStoreId
      m.setIcon(storeIcon(api, storeMode, storeGlyph, active))
      m.setZIndex?.(active ? STORE_ACTIVE_Z_INDEX : undefined)
    })
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
        borderColor: token('--color-map-info-border'),          // 지도 톤 색(§19.3 정보창) — 패널 색이 아니다
        backgroundColor: token('--color-map-info-bg'),
        anchorColor: token('--color-map-info-bg'),
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
        clearTimeout(timer)
        release('정보창 이동 대기 해제', [() => api.Event.removeListener(idle)])
      }
    }
    place()
  }, [api, map, stores, storeMode, storeGlyph, activeStoreId, sized, infoRetry])

  useEffect(
    () => () => {
      release('점포 정보창 닫기', [() => infoRef.current?.close()])
      infoRef.current = null
    },
    [map],
  )

  // 인천 외곽선·구 경계(묶음 A): 지도마다 1회, 줌 단계별 표시
  useGuBoundaries(api, map, renderModeRef)
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
      <div ref={hostRef} className="map__canvas-host" />
      {/* 저작권 줄 배경 띠: SDK 표기(z 100) 아래, 지도 타일·오버레이 위. 크기·위치는 syncControlBand가 정한다 */}
      <div ref={bandRef} className="map__ctlband" aria-hidden="true" hidden />
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
          {error !== 'config' && (
            // 설정(Client ID 없음)은 다시 불러와도 같다. 인증·로드 실패는 SDK를 새로 받고, 초기화 실패는 지도만 다시 만든다
            <button type="button" className="button-ghost map__retry" onClick={retryMap}>
              지도 다시 불러오기
            </button>
          )}
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
                <span className="map__legend-radius" aria-hidden="true" />A 반경 {formatRadius(radiusM)}
              </li>
              <li>
                <span className="map__legend-radius map__legend-radius--b" aria-hidden="true" />B 반경 {formatRadius(radiusM)}
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
                반경 {formatRadius(radiusM)}
              </li>
            </>
          )}
          <li>
            <span className="map__legend-dong" aria-hidden="true" />
            분석된 행정동 경계
          </li>
          <li>
            <span className="map__legend-gu" aria-hidden="true" />
            인천·구 경계
          </li>
          {stores && stores.length > 0 && (
            <li>
              {/* 지금 표현 그대로: 아이콘이면 업종 글리프 원, 점이면 점 (묶음 B) */}
              {storeMode === 'dot' ? (
                <span className="map__legend-store" aria-hidden="true" />
              ) : (
                <span className="map__legend-store map__legend-store--icon" aria-hidden="true">
                  <StoreGlyphIcon glyph={storeGlyph} size={10} />
                </span>
              )}
              같은 업종 점포
            </li>
          )}
        </ul>
      )}
      {map && !error && (
        // 지도에 보이는 영역의 오른쪽 아래(결과 패널 왼쪽, A3 §19.1): 확대·축소 + D-022 순위 1 맞춤 버튼
        <div className="map__controls">
          <div className="map__zoom" role="group" aria-label="지도 확대·축소">
            <button type="button" className="map__zoom-button" aria-label="지도 확대" onClick={() => zoomBy(1)}>
              <span aria-hidden="true">+</span>
            </button>
            <button type="button" className="map__zoom-button" aria-label="지도 축소" onClick={() => zoomBy(-1)}>
              <span aria-hidden="true">−</span>
            </button>
          </div>
          {/* 단일 "범위에 맞추기"(분석 불가 지점은 반경 원이 없어 두지 않는다), 비교 "두 위치 모두 보기"(B를 고른 뒤) */}
          {(compare ? compare.location !== null && selected !== null : selected !== null && markerTone === 'selected') && (
            <button type="button" className="map__fit" onClick={fitToRange}>
              <span className="map__fit-icon" aria-hidden="true" />
              <span className="map__fit-label">{compare ? '두 위치 모두 보기' : '범위에 맞추기'}</span>
            </button>
          )}
        </div>
      )}
    </section>
  )
}
