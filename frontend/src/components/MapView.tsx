import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { findDongRings } from '../map/dongBoundary.ts'
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
}

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
}

/** 인천 중심 초기 화면 (인천광역시청 부근) */
const INCHEON_CENTER: LatLng = { lat: 37.4563, lng: 126.7052 }
const INITIAL_ZOOM = 11
/** 분석 반경 = 엔진 config.RADIUS_M (meta.분석반경_m) */
export const RADIUS_M = 500
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
}: MapViewProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<NaverMapsApi | null>(null)
  const [map, setMap] = useState<NaverMap | null>(null)
  const [error, setError] = useState<MapLoadErrorKind | null>(null)

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

    loadNaverMaps(import.meta.env.VITE_NAVER_MAP_CLIENT_ID)
      .then((loaded) => {
        if (cancelled || !canvasRef.current) return
        maps = loaded
        created = new loaded.Map(canvasRef.current, {
          center: new loaded.LatLng(INCHEON_CENTER.lat, INCHEON_CENTER.lng),
          zoom: INITIAL_ZOOM,
          zoomControl: true,
          zoomControlOptions: { position: loaded.Position.TOP_RIGHT },
          scaleControl: true,
          mapDataControl: false,
        })
        clickListener = loaded.Event.addListener(created, 'click', (e) => {
          if (!interactiveRef.current) return
          onSelectRef.current({ lat: round(e.coord.lat()), lng: round(e.coord.lng()) })
        })
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
      created?.destroy?.()
      setMap(null)
    }
  }, [])

  // 바깥 .map 크기가 바뀌면 지도 크기를 맞춘다 (mobile 화면 전환·tablet 높이 변경·창 크기 변경).
  // canvas가 아니라 바깥 section을 본다 — SDK가 canvas에 inline px 크기를 넣어서 canvas는 레이아웃을 따라가지 않는다
  useEffect(() => {
    const el = sectionRef.current
    if (!api || !map || !el) return
    const fit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) map.setSize(new api.Size(el.clientWidth, el.clientHeight))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [api, map])

  // 선택 지점이 바뀌면 그 위치로 지도를 옮긴다 (좌표 직접 입력·분석 불가 지점 포함). zoom은 사용자가 둔 그대로
  const selectedLat = selected?.lat
  const selectedLng = selected?.lng
  useEffect(() => {
    if (!api || !map || selectedLat === undefined || selectedLng === undefined) return
    map.panTo(new api.LatLng(selectedLat, selectedLng))
  }, [api, map, selectedLat, selectedLng])

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

  // B를 고르면 B로 옮긴다(zoom 그대로). B를 지울 때(다시 고르기)는 옮기지 않는다
  useEffect(() => {
    if (!api || !map || bLat === undefined || bLng === undefined) return
    map.panTo(new api.LatLng(bLat, bLng))
  }, [api, map, bLat, bLng])

  // 비교가 끝나면 A로 옮긴다(zoom 그대로). 자동 확대·fitBounds는 하지 않는다(D3)
  const wasComparingRef = useRef(comparing)
  useEffect(() => {
    if (wasComparingRef.current && !comparing && api && map && selectedLat !== undefined && selectedLng !== undefined) {
      map.panTo(new api.LatLng(selectedLat, selectedLng))
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
  const infoRef = useRef<NaverInfoWindow | null>(null)
  const pannedStoreRef = useRef<string | null>(null)
  useEffect(() => {
    if (!api || !map) return
    storeMarkersRef.current.forEach((m, id) => m.setIcon(storeIcon(api, id === activeStoreId)))
    const marker = activeStoreId ? storeMarkersRef.current.get(activeStoreId) : undefined
    const store = stores?.find((s) => s.id === activeStoreId)
    if (!marker || !store) {
      infoRef.current?.close()
      pannedStoreRef.current = null
      return
    }
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
    infoRef.current.open(map, marker)
    if (pannedStoreRef.current !== activeStoreId) {
      map.panTo(new api.LatLng(store.lat, store.lng))
      pannedStoreRef.current = activeStoreId
    }
  }, [api, map, stores, activeStoreId])

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
        </ul>
      )}
    </section>
  )
}
