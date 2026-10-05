import type { EngineResult } from '../api/schemas.ts'
import { formatScore, resolutionLabel, type Indicator } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import { Icon } from './Icon.tsx'
import './PerspectiveScores.css'

/** 병목 경고 기준 = 엔진 config.BOTTLENECK_THRESHOLD (DESIGN.md §8.3). 표시 톤에만 쓴다. */
export const BOTTLENECK_WARN_BELOW = 25

/**
 * Perspective Score 막대 행 (DESIGN.md §6, §8.2, §8.3).
 * 순서는 엔진 지표 배열 그대로(시장성→안정성, 정렬하지 않는다). 채움은 모두 --color-data-bar, 50 기준선.
 * 막대는 aria-hidden이고 같은 값을 숫자 텍스트로 준다(§15: "시장성 61.6점").
 */
export function PerspectiveScores({
  indicators,
  summary,
}: {
  indicators: readonly Indicator[]
  summary: EngineResult['종합']
}) {
  const bottleneck = indicators.find((i) => i.key === summary.병목_지표)
  const bottleneckWarn =
    bottleneck !== undefined && bottleneck.score !== null && bottleneck.score < BOTTLENECK_WARN_BELOW

  return (
    <section className="perspectives" aria-labelledby="perspectives-title">
      <div className="perspectives__head">
        <h2 id="perspectives-title" className="perspectives__title">
          5대 관점
        </h2>
        <p className="perspectives__legend">
          <span className="perspectives__legend-line" aria-hidden="true" />
          50 = 인천 중앙
        </p>
      </div>
      <ul className="perspectives__list">
        {indicators.map((ind) => (
          <PerspectiveRow
            key={ind.key}
            indicator={ind}
            isStrongest={ind.key === summary.최고_지표}
            isBottleneck={ind.key === summary.병목_지표}
            bottleneckWarn={bottleneckWarn}
          />
        ))}
      </ul>
      {bottleneck && bottleneckWarn && (
        <p className="perspectives__bottleneck-note">
          <Icon name="alert-triangle" />
          병목({bottleneck.label}): 종합 점수보다 이 관점이 실제 위험 요인일 수 있습니다
        </p>
      )}
    </section>
  )
}

function PerspectiveRow({
  indicator: ind,
  isStrongest,
  isBottleneck,
  bottleneckWarn,
}: {
  indicator: Indicator
  isStrongest: boolean
  isBottleneck: boolean
  bottleneckWarn: boolean
}) {
  const resolution = resolutionLabel(ind.flags)
  const lowConfidence = ind.confidence === 'low'
  const hasTags = isStrongest || isBottleneck || lowConfidence || resolution !== null
  const trackClass = [
    'perspective__track',
    ind.score === null && 'perspective__track--missing',
    isBottleneck && bottleneckWarn && 'perspective__track--warn',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li className={`perspective persp-${ind.key}`} data-key={ind.key}>
      <div className="perspective__main">
        <span className="perspective__label">
          <span className="perspective__marker" aria-hidden="true" />
          {ind.label}
        </span>
        <span className={trackClass} aria-hidden="true">
          {ind.score !== null && <span className="perspective__fill" style={{ width: `${ind.score}%` }} />}
          <span className="perspective__reference" />
        </span>
        {ind.score === null ? (
          <span className="perspective__missing">데이터 없음</span>
        ) : (
          <span className="perspective__score">
            {formatScore(ind.score)}
            <span className="visually-hidden">점</span>
          </span>
        )}
      </div>
      {ind.score === null && (
        <p className="perspective__sub perspective__missing-note">
          이 업종은 해당 관점 데이터가 부족해 종합점수에서 제외했습니다
        </p>
      )}
      {hasTags && (
        <div className="perspective__sub perspective__tags">
          {isStrongest && <span className="perspective__strongest">가장 강한 관점</span>}
          {isBottleneck &&
            (bottleneckWarn ? (
              <Chip tone="warning" icon="alert-triangle">
                병목
              </Chip>
            ) : (
              <Chip>가장 낮은 관점</Chip>
            ))}
          {lowConfidence && (
            <Chip tone="warning" icon="alert-triangle">
              신뢰도 낮음
            </Chip>
          )}
          {resolution && (
            <Chip tone="info" icon="info">
              {resolution}
            </Chip>
          )}
        </div>
      )}
    </li>
  )
}
