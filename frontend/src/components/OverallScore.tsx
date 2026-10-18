import type { EngineResult } from '../api/schemas.ts'
import { formatScore } from '../lib/format.ts'
import './OverallScore.css'

/**
 * 종합 점수 (DESIGN.md §8.1, A3 §19.1): 큰 숫자 + "/ 100", 오른쪽에 "종합 적합도 · 다섯 관점 가중평균 · 순위 아님".
 * 숫자에 색을 입히지 않는다. 종합 null이면 "산출 불가". 가장 높은·낮은 관점은 헤드라인이 맡는다(8-C1a, 중복 요약 정리).
 */
export function OverallScore({ summary }: { summary: EngineResult['종합'] }) {
  const userWeighted = summary.가중치_출처 !== '기본(업종그룹)'

  return (
    <section className="overall" aria-labelledby="overall-caption">
      <div className="overall__score">
        {summary.점수 === null ? (
          <p className="overall__unavailable">산출 불가</p>
        ) : (
          <p className="overall__number">
            {formatScore(summary.점수)}
            <span className="overall__unit">/ 100</span>
          </p>
        )}
        <div className="overall__cap">
          <h2 id="overall-caption" className="overall__caption">
            종합 적합도
          </h2>
          {/* 종합은 관점 점수의 가중평균이라 백분위가 아니다 — "상위 N%"로 바꿔 표시하지 않는다 (docs/SCORE_EXPLANATION_AUDIT.md 3장) */}
          <p className="overall__note">
            {summary.점수 === null ? '점수를 낸 관점이 없어 계산하지 않음' : '다섯 관점 가중평균 · 순위 아님'}
          </p>
        </div>
      </div>
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
