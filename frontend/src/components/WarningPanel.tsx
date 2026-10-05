import type { AnalyzeResponse } from '../api/schemas.ts'
import { confidenceLabel, resolutionLabel } from '../lib/format.ts'
import { Icon } from './Icon.tsx'
import './WarningPanel.css'

type Notice = { tone: 'warning' | 'info'; text: string }

/**
 * 엔진 경고 외에 DESIGN.md §8.7이 이 패널에 모으라고 정한 데이터 한계 안내.
 * 엔진 값(flag·confidence·breakdown 상태·context)을 읽어 사실만 적는다. 엔진 경고 문장은 바꾸지 않는다.
 */
function dataLimits({ context, result }: AnalyzeResponse): Notice[] {
  const notices: Notice[] = []
  for (const ind of result.지표) {
    if (ind.confidence === 'low') {
      notices.push({ tone: 'warning', text: `${ind.label}: 신뢰도 ${confidenceLabel(ind.confidence)}` })
    }
    const resolution = resolutionLabel(ind.flags)
    if (resolution) notices.push({ tone: 'info', text: `${ind.label}: ${resolution}로 계산했습니다.` })
  }
  // rent_area=null → 안정성 S4(상권 임대료) 제외 (backend README: 일반 좌표는 항상 null)
  const s4 = result.지표[4].breakdown.find((b) => b.key === 's4')
  if (context.rent_area === null && s4 && s4.score === null) {
    notices.push({
      tone: 'info',
      text: `이 위치는 임대료 조사 상권이 지정되지 않아 안정성의 '${s4.label}' 지표를 제외하고 계산했습니다.`,
    })
  }
  return notices
}

/** Warning Panel "주의할 점" (DESIGN.md §8.7). 접지 않는다. 경고가 없어도 섹션을 숨기지 않는다. */
export function WarningPanel({ analysis }: { analysis: AnalyzeResponse }) {
  const warnings = analysis.result.경고
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
