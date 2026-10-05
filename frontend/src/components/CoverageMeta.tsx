import type { EngineResult } from '../api/schemas.ts'
import { confidenceLabel, formatRatio, type Indicator } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import './CoverageMeta.css'

const CONFIDENCE_ORDER = ['high', 'medium', 'low'] as const

/**
 * Coverage Indicator 메타 줄 (DESIGN.md §8.4, §6 위계 6). 텍스트 우선, 5칸 세그먼트는 보조.
 * 신뢰도 요약은 엔진 confidence 값을 그대로 세어 보여 준다.
 */
export function CoverageMeta({
  summary,
  indicators,
}: {
  summary: EngineResult['종합']
  indicators: readonly Indicator[]
}) {
  const counts = new Map<string, number>()
  for (const ind of indicators) counts.set(ind.confidence, (counts.get(ind.confidence) ?? 0) + 1)
  // 높음 → 보통 → 낮음 고정 순서 (DESIGN.md §6 예: "신뢰도 높음 4 / 보통 1")
  const confidenceText = CONFIDENCE_ORDER.filter((c) => counts.has(c))
    .map((c) => `${confidenceLabel(c)} ${counts.get(c)}`)
    .join(' · ')

  return (
    <div className="coverage">
      <span className="coverage__item">
        데이터 충족률 <strong>{formatRatio(summary.데이터_충족률)}</strong>
        <span className="coverage__segments" aria-hidden="true">
          {indicators.map((ind) => (
            <span
              key={ind.key}
              className={`coverage__segment${ind.score === null ? ' coverage__segment--missing' : ''}`}
            />
          ))}
        </span>
      </span>
      <span className="coverage__item">신뢰도 {confidenceText}</span>
      <span className="coverage__item">가중치 {summary.가중치_출처}</span>
      {counts.has('low') && (
        <Chip tone="warning" icon="alert-triangle">
          신뢰도 낮은 관점 있음
        </Chip>
      )}
    </div>
  )
}
