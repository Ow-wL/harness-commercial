import type { EngineResult } from '../api/schemas.ts'
import { evidenceLine } from '../lib/evidence.ts'
import { BOTTLENECK_WARN_BELOW, formatScore, notComputedText, type Indicator } from '../lib/format.ts'
import { Chip } from './Chip.tsx'
import { Icon } from './Icon.tsx'
import './PerspectiveScores.css'

/**
 * Perspective Score 막대 행 (DESIGN.md §6, §8.2, §8.3).
 * 순서는 엔진 지표 배열 그대로(시장성→안정성, 정렬하지 않는다). 채움은 모두 --color-data-bar, 50 기준선.
 * 관점 점수는 세부지표 백분위의 가중평균이라 인천 내 순위가 아니다 — 50 기준선은 0~100 척도의 중간일 뿐
 * "인천 중앙"이 아니다 (docs/SCORE_EXPLANATION_AUDIT.md 3장).
 * 막대는 aria-hidden이고 같은 값을 숫자 텍스트로 준다(§15: "시장성 61.6점").
 * 막대 아래 한 줄(8-C1b): 짧은 라벨(가장 높음 / 가장 낮음 / 병목) + 신뢰도 낮음 chip + 근거 줄(raw 값 포맷만, lib/evidence.ts).
 * 해상도 chip("시군구 단위 데이터")은 근거 줄 끝 "· 구 단위"로 합쳤다(docs/UX_REDESIGN.md 2.5).
 */
export function PerspectiveScores({
  indicators,
  summary,
  guName,
  business,
}: {
  indicators: readonly Indicator[]
  summary: EngineResult['종합']
  /** 근거 줄의 시장성 "{구} 하루 유입" — API context의 시군구 */
  guName: string
  /** 근거 줄의 경쟁성 "반경 500m {업종} N곳" — meta.업종 */
  business: string
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
          50 = 척도 중간 · 순위 아님
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
            evidence={evidenceLine(ind, guName, business)}
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
  evidence,
}: {
  indicator: Indicator
  isStrongest: boolean
  isBottleneck: boolean
  bottleneckWarn: boolean
  evidence: string | null
}) {
  const lowConfidence = ind.confidence === 'low'
  const hasLine = isStrongest || isBottleneck || lowConfidence || evidence !== null
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
        <p className="perspective__sub perspective__missing-note">{notComputedText(ind)}</p>
      )}
      {hasLine && (
        <p className="perspective__sub perspective__evidence">
          {isStrongest && <span className="perspective__strongest">가장 높음</span>}
          {isBottleneck &&
            (bottleneckWarn ? (
              <Chip tone="warning" icon="alert-triangle">
                병목
              </Chip>
            ) : (
              <span className="perspective__lowest">가장 낮음</span>
            ))}
          {lowConfidence && (
            <Chip tone="warning" icon="alert-triangle">
              신뢰도 낮음
            </Chip>
          )}
          {evidence && <span className="perspective__evidence-text">{evidence}</span>}
        </p>
      )}
    </li>
  )
}
