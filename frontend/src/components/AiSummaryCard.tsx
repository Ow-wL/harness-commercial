import type { ApiFailure } from '../api/client.ts'
import type { SummaryResponse } from '../api/schemas.ts'
import { AI_ERROR_TEXT, AI_TEXT } from '../content/ai.ts'
import type { SummaryState } from '../lib/useSummary.ts'
import './AiSummaryCard.css'

const failureText = (f: ApiFailure) => (f.kind === 'api' ? (AI_ERROR_TEXT[f.error.code] ?? AI_ERROR_TEXT.ai_upstream!) : AI_ERROR_TEXT.ai_upstream!)

/**
 * AI 요약 카드 (R2 13-23, 결과 카드 ⑤): 좋은 점·주의할 점·결정 전에 확인할 것. 각 문장 옆 근거 키는 접어서(자세히) 보인다.
 * 점수를 바꾸지 않고, 순위·확률·추천을 말하지 않는다(서버 시스템 프롬프트). 서버가 AI 를 광고하지 않으면 그리지 않는다 —
 * 그때는 점수 카드의 한 줄 결론(R1 템플릿)이 그대로 요약이다. "AI에게 질문"으로 질문 창(AskDialog)을 연다.
 */
export function AiSummaryCard({ state, onRetry, onAsk }: { state: SummaryState; onRetry?: () => void; onAsk?: () => void }) {
  if (state.status === 'idle') return null
  return (
    <section className="ai-card" aria-labelledby="ai-card-title">
      <div className="ai-card__head">
        <h2 id="ai-card-title" className="result__section-title">
          {AI_TEXT.summaryTitle}
        </h2>
        {onAsk && (
          <button type="button" className="ai-card__ask" onClick={onAsk}>
            {AI_TEXT.askOpen}
          </button>
        )}
      </div>
      <div aria-live="polite">
        {state.status === 'loading' && <p className="ai-card__status">{AI_TEXT.loading}</p>}
        {state.status === 'error' && (
          <p className="ai-card__status">
            {failureText(state.failure)}
            {onRetry && state.failure.kind !== 'api' && (
              <>
                {' '}
                <button type="button" className="rank-card__retry" onClick={onRetry}>
                  다시 시도
                </button>
              </>
            )}
          </p>
        )}
        {state.status === 'stale' && <p className="ai-card__status">서버의 자료가 이 결과를 만든 뒤 바뀌어 AI 요약을 함께 보이지 않습니다. 다시 분석해 주세요.</p>}
      </div>
      {state.status === 'success' && <SummaryLists data={state.data} />}
      <p className="ai-card__note">{AI_TEXT.summaryNote}</p>
    </section>
  )
}

function SummaryLists({ data }: { data: SummaryResponse }) {
  const groups = [
    { key: 'good', title: AI_TEXT.good, items: data.good },
    { key: 'bad', title: AI_TEXT.bad, items: data.bad },
    { key: 'check', title: AI_TEXT.check, items: data.check },
  ] as const
  return (
    <div className="ai-card__groups">
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.key} className={`ai-card__group ai-card__group--${g.key}`}>
              <h3 className="ai-card__group-title">{g.title}</h3>
              <ul className="ai-card__list">
                {g.items.map((it, i) => (
                  <li key={i} className="ai-card__item">
                    {it.text}
                    {it.fields.length > 0 && <span className="ai-card__fields"> · 근거 {it.fields.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  )
}
