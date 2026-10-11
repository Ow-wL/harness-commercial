import { useId, useState } from 'react'
import type { AnalyzeContext } from '../api/schemas.ts'
import { formatDistance, type NearestStation } from '../lib/format.ts'
import { Icon } from './Icon.tsx'
import './LocationSummary.css'

/**
 * 결과 패널 맨 위 위치 보조 정보 (DESIGN.md §8.5a). 위치 이름은 Context Bar·결과 제목이 맡고, 여기는
 * 최근접역(직선거리)과 접힌 "좌표 보기"만 둔다. 좌표는 분석에 쓴 값(context.lat/lng) 그대로다.
 */
export function LocationSummary({ context, station }: { context: AnalyzeContext; station: NearestStation | null }) {
  const [open, setOpen] = useState(false)
  const coordId = useId()

  return (
    <div className="location-summary">
      <p className="location-summary__station">
        {station ? (
          <>
            가장 가까운 역 <strong>{station.name}</strong> · 직선거리 {formatDistance(station.distanceM)}
            <span className="location-summary__hint"> (걸어서 가는 거리와 다를 수 있음)</span>
          </>
        ) : (
          '가장 가까운 역 정보가 없습니다'
        )}
      </p>
      <button
        type="button"
        className="button-ghost button-ghost--small location-summary__toggle"
        aria-expanded={open}
        aria-controls={coordId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chevron" data-open={open}>
          <Icon name="chevron-right" />
        </span>
        좌표 보기
      </button>
      {open && (
        <p id={coordId} className="location-summary__coord">
          분석 좌표(WGS84) <span className="mono">{context.lat}, {context.lng}</span>
        </p>
      )}
    </div>
  )
}
