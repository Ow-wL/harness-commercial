import type { EngineResult } from '../api/schemas.ts'
import { formatScore, type Indicator } from '../lib/format.ts'
import './OverallScore.css'

/**
 * Overall Score (DESIGN.md §8.1) + 오른쪽 요약 2줄(가장 강한 관점·병목, §6 결과 레이아웃).
 * 숫자에 색을 입히지 않는다. 종합 null이면 "산출 불가".
 */
export function OverallScore({
  summary,
  indicators,
}: {
  summary: EngineResult['종합']
  indicators: readonly Indicator[]
}) {
  const strongest = indicators.find((i) => i.key === summary.최고_지표)
  const bottleneck = indicators.find((i) => i.key === summary.병목_지표)
  const userWeighted = summary.가중치_출처 !== '기본(업종그룹)'

  return (
    <section className="overall" aria-labelledby="overall-caption">
      <div className="overall__score">
        <h2 id="overall-caption" className="overall__caption">
          종합 적합도
        </h2>
        {summary.점수 === null ? (
          <>
            <p className="overall__unavailable">산출 불가</p>
            <p className="overall__note">점수를 낸 관점이 없어 종합 점수를 계산하지 않았습니다.</p>
          </>
        ) : (
          <>
            <p className="overall__number">
              {formatScore(summary.점수)}
              <span className="overall__unit">/100</span>
            </p>
            <p className="overall__note">인천 158개 행정동 대비 백분위</p>
          </>
        )}
      </div>
      {(strongest?.score != null || bottleneck?.score != null) && (
        <dl className="overall__summary">
          {strongest && strongest.score !== null && (
            <div>
              <dt>가장 강한 관점</dt>
              <dd>
                {strongest.label} <span className="overall__value">{formatScore(strongest.score)}</span>
              </dd>
            </div>
          )}
          {bottleneck && bottleneck.score !== null && (
            <div>
              <dt>병목</dt>
              <dd>
                {bottleneck.label} <span className="overall__value">{formatScore(bottleneck.score)}</span>
              </dd>
            </div>
          )}
        </dl>
      )}
      {userWeighted && (
        <p className="overall__weights">
          사용자 가중치 적용({summary.가중치_출처})
          {summary.기본가중치_종합점수 !== undefined &&
            ` · 기본 가중치 점수 ${formatScore(summary.기본가중치_종합점수)}`}
        </p>
      )}
    </section>
  )
}
