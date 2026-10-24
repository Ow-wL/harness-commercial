import type { AnalyzeResponse } from '../api/schemas.ts'
import { dataLimits, displayWarnings, isSchoolZoneWarning } from '../lib/warnings.ts'
import { Icon } from './Icon.tsx'
import './WarningPanel.css'

/**
 * Warning Panel "주의할 점" (DESIGN.md §8.7). 접지 않는다. 경고가 없어도 섹션을 숨기지 않는다.
 * 엔진 경고는 엔진 순서대로 모두 보인다. v0.5 학교구역 경고(엔진이 맨 앞에 둔다)는 원문 그대로 강조 표시만 한다(D-028).
 */
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
          {warnings.map((text) =>
            isSchoolZoneWarning(text) ? (
              <li key={text} className="warnings__item warnings__item--priority">
                <Icon name="alert-triangle" />
                <span>
                  <strong className="warnings__tag">학교구역 주의 · 먼저 확인</strong> {text}{' '}
                  <span className="warnings__note">
                    교육환경보호구역 안 영업 가능 여부는 관할 교육지원청에서 확인해야 하며, 이 안내가 허가 여부를 정하지 않습니다.
                  </span>
                </span>
              </li>
            ) : (
              <li key={text} className="warnings__item warnings__item--warning">
                <Icon name="alert-triangle" />
                <span>{text}</span>
              </li>
            ),
          )}
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
