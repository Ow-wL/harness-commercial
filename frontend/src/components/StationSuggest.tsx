import { useEffect, useState } from 'react'
import type { Station } from '../api/schemas.ts'
import { loadStations, matchStations } from '../lib/stations.ts'
import { Icon } from './Icon.tsx'
import './StationSuggest.css'

/**
 * 역 이름 제안 (R1 13-17): 주소 검색 입력란 아래, 입력 앞부분과 맞는 인천권 역 최대 6개. 누르면 그 역 좌표를 위치로 고른다
 * (분석은 시작하지 않는다 — 주소 검색 결과 선택과 같은 규칙). 목록은 처음 그릴 때 1회 받는다. 장소 이름 검색(12-14)과 별개로 외부 API 없음.
 */
export function StationSuggest({ query, disabled, onSelect, labelPrefix = '' }: { query: string; disabled: boolean; onSelect: (s: Station) => void; labelPrefix?: string }) {
  const [stations, setStations] = useState<readonly Station[] | null>(null)
  useEffect(() => {
    let alive = true
    loadStations().then((list) => {
      if (alive) setStations(list)
    })
    return () => {
      alive = false
    }
  }, [])
  const matches = stations ? matchStations(stations, query) : []
  if (matches.length === 0) return null
  return (
    <div className="station-suggest" role="group" aria-label={`${labelPrefix}역 이름 제안`}>
      <p className="station-suggest__title">역 이름으로 바로 고르기</p>
      <ul className="station-suggest__list">
        {matches.map((s) => (
          <li key={`${s.name}:${s.lat}:${s.lng}`}>
            <button type="button" className="station-suggest__item" disabled={disabled} onClick={() => onSelect(s)}>
              <Icon name="map-pin" size={14} />
              <span className="station-suggest__name">{s.name}</span>
              {s.transfer && <span className="station-suggest__transfer">환승</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
