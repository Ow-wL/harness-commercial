import type { AnalyzeContext } from '../api/schemas.ts'
import { Icon } from './Icon.tsx'
import './MapPlaceholder.css'

/**
 * 지도 SDK 연결 전(4-1~4-3) Map Area 자리 (DESIGN.md §4.3): --color-surface-muted 바탕 위
 * 위치 요약(행정동 이름·좌표)과 "지도는 준비 중". 실제 지도는 TASKS 4-4.
 */
export function MapPlaceholder({ context }: { context: AnalyzeContext }) {
  return (
    <aside className="map-placeholder" aria-label="지도 영역 (준비 중)">
      <div className="map-placeholder__body">
        <Icon name="map-pin" size={24} />
        <p className="map-placeholder__place">{context.label}</p>
        <p className="map-placeholder__coord">
          {context.lat}, {context.lng}
        </p>
        <p className="map-placeholder__note">지도는 준비 중입니다</p>
      </div>
    </aside>
  )
}
