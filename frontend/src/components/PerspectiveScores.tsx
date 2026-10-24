import { Fragment } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { evidenceLine } from '../lib/evidence.ts'
import { BOTTLENECK_WARN_BELOW, formatScore, notComputedText, type Indicator } from '../lib/format.ts'
import { Icon } from './Icon.tsx'
import './PerspectiveScores.css'

/**
 * 다섯 관점 행 (DESIGN.md §6·§8.2·§8.3, A3 §19.1 요약 탭).
 * 순서는 엔진 지표 배열 그대로(시장성→안정성, 정렬하지 않는다). 막대는 모두 한 색, 50 기준선.
 * 관점 점수는 세부지표 백분위의 가중평균이라 인천 내 순위가 아니다 — 50 기준선은 0~100 척도의 중간일 뿐이다.
 * 행 = [식별색 + 이름][막대][점수] / 둘째 줄: 짧은 라벨(가장 높음·병목·가장 낮음) · 신뢰도 낮음 · 근거 줄(8-C1b).
 * 행 전체가 버튼 — 누르면 상세 근거 탭의 그 관점을 펼친다. 막대는 aria-hidden이고 같은 값을 숫자 텍스트로 준다(§15).
 */
export function PerspectiveScores({
  indicators,
  summary,
  guName,
  business,
  radiusM,
  onOpen,
}: {
  indicators: readonly Indicator[]
  summary: EngineResult['종합']
  /** 근거 줄의 시장성 "{구} 하루 유입" — API context의 시군구 */
  guName: string
  /** 근거 줄의 경쟁성 "반경 500m {업종} N곳" — meta.업종 */
  business: string
  /** 근거 줄의 고객성 "반경 {r} 타겟 연령 거주"(v0.5 반경 인구) — meta.분석반경_m */
  radiusM?: number
  /** 관점 행을 누르면 그 관점 근거로 (상세 근거 탭) */
  onOpen?: (key: string) => void
}) {
  const bottleneck = indicators.find((i) => i.key === summary.병목_지표)
  const bottleneckWarn =
    bottleneck !== undefined && bottleneck.score !== null && bottleneck.score < BOTTLENECK_WARN_BELOW

  return (
    <section className="perspectives" aria-labelledby="perspectives-title">
      <h2 id="perspectives-title" className="visually-hidden">
        5대 관점
      </h2>
      <p className="perspectives__scale" aria-hidden="true">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </p>
      <p className="visually-hidden">막대의 50은 0~100 척도의 중간이며 순위가 아닙니다.</p>
      <ul className="perspectives__list">
        {indicators.map((ind) => (
          <PerspectiveRow
            key={ind.key}
            indicator={ind}
            isStrongest={ind.key === summary.최고_지표}
            isBottleneck={ind.key === summary.병목_지표}
            bottleneckWarn={bottleneckWarn}
            evidence={evidenceLine(ind, guName, business, radiusM)}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  )
}

function PerspectiveRow({
  indicator: ind,
  isStrongest,
  isBottleneck,
  bottleneckWarn,
  evidence,
  onOpen,
}: {
  indicator: Indicator
  isStrongest: boolean
  isBottleneck: boolean
  bottleneckWarn: boolean
  evidence: string | null
  onOpen?: (key: string) => void
}) {
  const lowConfidence = ind.confidence === 'low'
  const trackClass = [
    'perspective__track',
    ind.score === null && 'perspective__track--missing',
    isBottleneck && bottleneckWarn && 'perspective__track--warn',
  ]
    .filter(Boolean)
    .join(' ')
  const tags = [
    isStrongest && (
      <span key="hi" className="perspective__strongest">
        가장 높음
      </span>
    ),
    isBottleneck &&
      (bottleneckWarn ? (
        <span key="bn" className="perspective__bottleneck">
          <Icon name="alert-triangle" size={12} />
          병목
        </span>
      ) : (
        <span key="lo" className="perspective__lowest">
          가장 낮음
        </span>
      )),
    lowConfidence && (
      <span key="lc" className="perspective__low-confidence">
        <Icon name="alert-triangle" size={12} />
        신뢰도 낮음
      </span>
    ),
  ].filter(Boolean)

  const body = (
    <>
      <span className="perspective__main">
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
      </span>
      {ind.score === null && <span className="perspective__sub perspective__missing-note">{notComputedText(ind)}</span>}
      {(tags.length > 0 || evidence) && (
        <span className="perspective__sub perspective__evidence">
          {tags}
          {evidence && (
            // " · " 조각 안에서는 줄을 바꾸지 않는다(숫자와 단위가 다음 줄로 떨어지지 않게) — 줄바꿈은 조각 사이에서만
            <span className="perspective__evidence-text">
              {evidence.split(' · ').map((part, i, all) => (
                <Fragment key={i}>
                  {/* 구분점은 앞 조각 끝에 붙이고 공백은 밖에 둔다 — 줄이 "·"로 시작하지 않게 */}
                  <span className="perspective__evidence-part">
                    {part}
                    {i < all.length - 1 && ' ·'}
                  </span>
                  {i < all.length - 1 && ' '}
                </Fragment>
              ))}
            </span>
          )}
        </span>
      )}
    </>
  )

  return (
    <li className={`perspective persp-${ind.key}`} data-key={ind.key}>
      {onOpen ? (
        <button type="button" className="perspective__button" onClick={() => onOpen(ind.key)}>
          {body}
          <span className="visually-hidden"> · 근거 자세히</span>
        </button>
      ) : (
        <div className="perspective__button">{body}</div>
      )}
    </li>
  )
}
