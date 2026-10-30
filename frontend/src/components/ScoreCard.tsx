import type { AnalyzeResponse } from '../api/schemas.ts'
import { regulationAlert, weakAlert } from '../lib/alerts.ts'
import { conclusion } from '../lib/conclusion.ts'
import { OverallScore } from './OverallScore.tsx'
import { RegulationBanner, WeakPerspectiveLine } from './ResultAlerts.tsx'
import './ScoreCard.css'

/**
 * 종합 점수 카드 (13-11, 대시보드 — DESIGN.md §20.2): (규제 배너, 13-1) → 큰 숫자 + 등급 + 규제 배지(OverallScore) → 한 줄 결론(13-12 템플릿,
 * R2 의 AI 요약이 이 자리를 대체·보강한다) → 주의 관점 한 줄(13-3). 순서가 곧 읽는 순서다: 점수보다 먼저 보여야 할 것이 위에 온다.
 */
export function ScoreCard({ analysis }: { analysis: AnalyzeResponse }) {
  const regulation = regulationAlert(analysis)
  const c = conclusion(analysis)
  return (
    <section className="score-card" aria-label="종합 점수와 한 줄 결론">
      <RegulationBanner alert={regulation} />
      <OverallScore summary={analysis.result.종합} engineVersion={analysis.result.meta.엔진버전} regulated={regulation !== null} />
      <p className="score-card__conclusion" data-rule={c.rule}>
        {c.text}
      </p>
      <WeakPerspectiveLine alert={weakAlert(analysis)} />
    </section>
  )
}
