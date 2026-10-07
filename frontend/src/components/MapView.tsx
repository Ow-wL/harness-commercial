import { useEffect, useRef, useState } from 'react'
import { findDongRings } from '../map/dongBoundary.ts'
import {
  loadNaverMaps,
  MapLoadError,
  onNaverAuthFailure,
  type MapLoadErrorKind,
  type NaverCircle,
  type NaverMap,
  type NaverMapsApi,
  type NaverMarker,
  type NaverPolygon,
} from '../map/naverMaps.ts'
import { Icon } from './Icon.tsx'
import './MapView.css'

export type LatLng = { lat: number; lng: number }

export type MapViewProps = {
  /** 선택 지점. null이면 마커·반경 없음 */
  selected: LatLng | null
  /** 'invalid' = 분석 불가 지점(회색 마커, 반경 원 없음, DESIGN.md §8.11) */
  markerTone: 'selected' | 'invalid'
  /** 분석이 끝난 행정동 (backend context). 경계를 강조한다 */
  dong: { guCode: string; dongName: string } | null
  /** false면 지도 클릭을 무시한다 (분석 중, §8.12) */
  interactive: boolean
  onSelect: (point: LatLng) => void
}

/** 인천 중심 초기 화면 (인천광역시청 부근) */
const INCHEON_CENTER: LatLng = { lat: 37.4563, lng: 126.7052 }
const INITIAL_ZOOM = 11
/** 분석 반경 = 엔진 config.RADIUS_M (meta.분석반경_m) */
export const RADIUS_M = 500
/** 지도 클릭 좌표 자릿수: 소수 6자리 ≈ 0.1m. 이 값이 그대로 요청 body와 화면에 쓰인다 */
const COORD_DIGITS = 6

const round = (v: number) => Number(v.toFixed(COORD_DIGITS))

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
export function MapView({ selected, markerTone, dong, interactive, onSelect }: MapViewProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<NaverMapsApi | null>(null)
  const [map, setMap] = useState<NaverMap | null>(null)
  const [error, setError] = useState<MapLoadErrorKind | null>(null)

  // 최신 콜백·상태를 클릭 핸들러가 읽는다 (지도를 다시 만들지 않기 위해)
  const onSelectRef = useRef(onSelect)
  const interactiveRef = useRef(interactive)
  useEffect(() => {
    onSelectRef.current = onSelect
    interactiveRef.current = interactive
  })

  // SDK 로드 + 지도 생성 (StrictMode에서 effect가 두 번 돌아도 script는 loader가 한 번만 붙인다)
  useEffect(() => {
    let cancelled = false
    let created: NaverMap | null = null
    let clickListener: unknown = null
    let maps: NaverMapsApi | null = null
    const unsubscribe = onNaverAuthFailure(() => setError('auth'))

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
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof MapLoadError ? e.kind : 'load')
      })

    return () => {
      cancelled = true
      unsubscribe()
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

  // 선택 지점 마커 + 반경 원. 다시 클릭하면 같은 오버레이를 옮긴다
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
    const icon = {
      content: `<div class="map-marker map-marker--${markerTone}"></div>`,
      anchor: new api.Point(8, 8),
    }
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
      circleRef.current = new api.Circle({
        map,
        center: position,
        radius: RADIUS_M,
        fillColor: token('--color-map-radius-fill'),
        fillOpacity: 1,
        strokeColor: token('--color-map-radius-stroke'),
        strokeWeight: 1.5,
        strokeStyle: 'shortdash',
        clickable: false,
      })
    }
  }, [api, map, selected, markerTone])

  useEffect(
    () => () => {
      markerRef.current?.setMap(null)
      circleRef.current?.setMap(null)
      markerRef.current = null
      circleRef.current = null
    },
    [map],
  )

  // 분석된 행정동 경계 강조
  const guCode = dong?.guCode
  const dongName = dong?.dongName
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

  return (
    <section ref={sectionRef} className="map" aria-label="위치 선택 지도">
      <div ref={canvasRef} className="map__canvas" />
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
      {map && !error && !selected && <p className="map__guide">지도를 눌러 위치를 고르세요</p>}
      {map && !error && (
        <ul className="map__legend" aria-label="지도 범례">
          <li>
            <span className="map__legend-marker" aria-hidden="true" />
            선택 지점
          </li>
          <li>
            <span className="map__legend-radius" aria-hidden="true" />
            반경 {RADIUS_M}m
          </li>
          <li>
            <span className="map__legend-dong" aria-hidden="true" />
            분석된 행정동 경계
          </li>
        </ul>
      )}
    </section>
  )
}
