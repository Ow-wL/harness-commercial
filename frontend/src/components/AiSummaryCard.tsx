import { useState } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { SummaryResponse } from '../api/schemas.ts'
import { AI_ERROR_TEXT, AI_TEXT } from '../content/ai.ts'
import { citesSupport, fieldLabels, fieldPerspective, perspectiveName } from '../lib/aiFields.ts'
import { formatScore, type Indicator } from '../lib/format.ts'
import { gradeOf } from '../lib/grade.ts'
import type { SummaryState } from '../lib/useSummary.ts'
import { Icon, type IconName } from './Icon.tsx'
import { NumberEmphasis } from './NumberEmphasis.tsx'
import './AiSummaryCard.css'

const failureText = (f: ApiFailure) => (f.kind === 'api' ? (AI_ERROR_TEXT[f.error.code] ?? AI_ERROR_TEXT.ai_upstream!) : AI_ERROR_TEXT.ai_upstream!)

/**
 * AI 요약 카드 (R2 13-23, 결과 카드 ⑤ — v0.4.1 패널 개편, DESIGN §21): 좋은 점·주의할 점·확인할 것을 색 패널 세 칸으로 나누고,
 * 항목마다 관점 칩(근거 키의 관점 + 엔진 점수 — AI 가 쓴 숫자가 아니다)·숫자 강조, 확인할 것은 체크 목록 모양.
 * 근거 자료 이름(lib/aiFields — 내부 키 경로는 보이지 않는다)은 "근거 자료 보기"로 펼친다(인쇄는 늘 찍는다).
 * 점수를 바꾸지 않고, 순위·확률·추천을 말하지 않는다(서버 시스템 프롬프트). 서버가 AI 를 광고하지 않으면 그리지 않는다 —
 * 그때는 점수 카드의 한 줄 결론(R1 템플릿)이 그대로 요약이다. "AI에게 질문"으로 질문 창(AskDialog)을 연다.
 */
export function AiSummaryCard({
  state,
  onRetry,
  onAsk,
  indicators,
  onShowSupport,
}: {
  state: SummaryState
  onRetry?: () => void
  onAsk?: () => void
  /** 관점 칩의 점수(엔진 결과). 없으면 칩에 이름만 */
  indicators?: readonly Indicator[]
  /** 확인할 것이 지원사업 공고를 인용하면 "지원사업 보기"(지원사업 카드로 이동) */
  onShowSupport?: () => void
}) {
  const [showFields, setShowFields] = useState(false)
  if (state.status === 'idle') return null
  return (
    <section className={`ai-card${showFields ? ' ai-card--fields' : ''}`} aria-labelledby="ai-card-title">
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
      {state.status === 'success' && <SummaryPanels data={state.data} indicators={indicators} onShowSupport={onShowSupport} />}
      <div className="ai-card__foot">
        <p className="ai-card__note">
          <Icon name="info" size={14} />
          <span>{AI_TEXT.summaryNote}</span>
        </p>
        {state.status === 'success' && (
          <button type="button" className="ai-card__fields-toggle" aria-pressed={showFields} onClick={() => setShowFields((v) => !v)}>
            {showFields ? AI_TEXT.fieldsHide : AI_TEXT.fieldsShow}
          </button>
        )}
      </div>
    </section>
  )
}

const GROUPS: readonly { key: 'good' | 'bad' | 'check'; icon: IconName }[] = [
  { key: 'good', icon: 'check' },
  { key: 'bad', icon: 'alert-triangle' },
  { key: 'check', icon: 'clipboard-check' },
]

function SummaryPanels({ data, indicators, onShowSupport }: { data: SummaryResponse; indicators?: readonly Indicator[]; onShowSupport?: () => void }) {
  return (
    <div className="ai-card__groups">
      {GROUPS.map(({ key, icon }) => {
        const items = data[key]
        if (items.length === 0) return null
        return (
          <div key={key} className={`ai-card__group ai-card__group--${key}`}>
            <h3 className="ai-card__group-title">
              <Icon name={icon} size={16} />
              {AI_TEXT[key]}
              <span className="ai-card__count" aria-hidden="true">
                {items.length}
              </span>
            </h3>
            <ul className="ai-card__list">
              {items.map((it, i) => {
                const labels = fieldLabels(it.fields)
                const pkey = key === 'check' ? null : fieldPerspective(it.fields)
                const ind = pkey ? indicators?.find((x) => x.key === pkey) : undefined
                return (
                  <li key={i} className="ai-card__item">
                    {key === 'check' && (
                      <span className="ai-card__box" aria-hidden="true">
                        <Icon name="square" size={14} />
                      </span>
                    )}
                    <span className="ai-card__body">
                      {pkey && <PerspectiveChip label={ind?.label ?? perspectiveName(pkey)} score={ind?.score ?? null} />}
                      <span className="ai-card__text">
                        <NumberEmphasis text={it.text} />
                      </span>
                      {key === 'check' && onShowSupport && citesSupport(it.fields) && (
                        <button type="button" className="ai-card__link" onClick={onShowSupport}>
                          {AI_TEXT.showSupport}
                        </button>
                      )}
                      {/* 근거 자료 이름: 화면에서는 "근거 자료 보기"를 눌렀을 때만, 인쇄는 늘(AiSummaryCard.css) */}
                      {labels.length > 0 && <span className="ai-card__fields"> · 근거: {labels.join(', ')}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function PerspectiveChip({ label, score }: { label: string; score: number | null }) {
  const grade = gradeOf(score)
  return (
    <span className={`ai-card__chip${grade ? ` ai-card__chip--${grade}` : ''}`}>
      {label}
      {score !== null && ` ${formatScore(score)}`}
    </span>
  )
}
