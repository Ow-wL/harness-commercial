import type { AnalyzeContext, EngineResult } from '../api/schemas.ts'
import { formatDistance, groupName, locationName, type NearestStation } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import './ContextBar.css'

/**
 * Context Bar (DESIGN.md §6 위계 1·2, §8.5 Location Chip, §8.5a 최근접역, §8.6 Business Chip).
 * 위치는 API context의 시군구·행정동 이름이 주 정보, 최근접역(직선거리)이 보조 정보다.
 * 좌표는 여기 두지 않는다 — 결과 패널의 "좌표 보기"(LocationSummary)에서 연다. 업종코드는 칩 밖 caption mono.
 */
export function ContextBar({
  context,
  meta,
  station,
}: {
  context: AnalyzeContext
  meta: EngineResult['meta']
  station: NearestStation | null
}) {
  return (
    <div className="context-bar" role="group" aria-label="분석 조건">
      <span className="context-bar__item">
        <Chip icon="map-pin">{locationName(context)}</Chip>
        {station && (
          <span className="context-bar__sub">
            {station.name} · 직선거리 {formatDistance(station.distanceM)}
          </span>
        )}
      </span>
      <span className="context-bar__item">
        <Chip icon="store">
          {meta.업종} · {groupName(meta.업종그룹)}
        </Chip>
        <span className="context-bar__mono">{meta.업종코드}</span>
      </span>
    </div>
  )
}
