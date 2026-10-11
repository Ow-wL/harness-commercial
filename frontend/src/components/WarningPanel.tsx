import type { AnalyzeResponse } from '../api/schemas.ts'
import { dataLimits, displayWarnings } from '../lib/warnings.ts'
import { Icon } from './Icon.tsx'
import './WarningPanel.css'

/** Warning Panel "주의할 점" (DESIGN.md §8.7). 접지 않는다. 경고가 없어도 섹션을 숨기지 않는다. */
export function WarningPanel({ analysis }: { analysis: AnalyzeResponse }) {
  const warnings = displayWarnings(analysis)
  const limits = dataLimits(analysis)

  return (
    <section className="result-section" aria-labelledby="warnings-title">
      <h2 id="warnings-title" className="result-section__title">
        주의할 점
      </h2>
      {warnings.length === 0 ? (
        <p className="warnings__empty">특별한 경고가 없습니다.</p>
      ) : (
        <ul className="warnings__list">
          {warnings.map((text) => (
            <li key={text} className="warnings__item warnings__item--warning">
              <Icon name="alert-triangle" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
      {limits.length > 0 && (
        <>
          <h3 className="warnings__subtitle">데이터 한계</h3>
          <ul className="warnings__list">
            {limits.map((n) => (
              <li key={n.text} className={`warnings__item warnings__item--${n.tone}`}>
                <Icon name={n.tone === 'warning' ? 'alert-triangle' : 'info'} />
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
