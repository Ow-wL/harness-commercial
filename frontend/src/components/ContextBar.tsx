import type { AnalyzeContext, EngineResult } from '../api/schemas.ts'
import { groupName } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import './ContextBar.css'

/**
 * Context Bar (DESIGN.md §6 위계 1·2, §8.5 Location Chip, §8.6 Business Chip).
 * 행정동 이름은 API context 값 그대로, 좌표·업종코드는 칩 밖 caption mono.
 */
export function ContextBar({ context, meta }: { context: AnalyzeContext; meta: EngineResult['meta'] }) {
  return (
    <div className="context-bar" role="group" aria-label="분석 조건">
      <span className="context-bar__item">
        <Chip icon="map-pin">
          {context.gu_name} {context.dong_name}
        </Chip>
        <span className="context-bar__mono">
          {context.lat}, {context.lng}
        </span>
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
