import { useId, useState } from 'react'
import type { EngineResult } from '../api/schemas.ts'
import { formatScore } from '../lib/format.ts'
import { scoreHelp } from '../lib/scoreHelp.ts'
import './OverallScore.css'

/**
 * 종합 점수 (DESIGN.md §8.1, A3 §19.1): 큰 숫자 + "/ 100", 오른쪽에 "종합 적합도 · 다섯 관점 가중평균 · 순위 아님"과
 * [이 점수는?](8-C1d, 접힘 — 펼치면 SCORE_HELP 3항목(v0.5 는 비교 기준 한 줄을 더해 4항목), 자세한 내용은 상세 근거의 "점수 읽는 법").
 * 숫자에 색을 입히지 않는다. 종합 null이면 "산출 불가". 가장 높은·낮은 관점은 헤드라인이 맡는다(8-C1a, 중복 요약 정리).
 */
export function OverallScore({ summary, engineVersion }: { summary: EngineResult['종합']; engineVersion: string }) {
  const userWeighted = summary.가중치_출처 !== '기본(업종그룹)'
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = useId()

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
          <button
            type="button"
            className="overall__help-toggle"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((v) => !v)}
          >
            이 점수는?
          </button>
        </div>
      </div>
      {helpOpen && (
        <ul id={helpId} className="overall__help" aria-label="이 점수는?">
          {scoreHelp(engineVersion).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
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
