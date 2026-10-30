import type { RegulationAlert, WeakAlert } from '../lib/alerts.ts'
import { Icon } from './Icon.tsx'
import './ResultAlerts.css'

/**
 * 규제 배너 (13-1, 팀 점검 보고서 A1): 점수 카드 **위**, 펼친 채, 빨간 테두리. 학교구역 경고가 있는 결과에만 그린다.
 * 원문은 상세 근거 › 주의할 점에 엔진 순서대로 그대로 있고, 여기 문장은 엔진 값(업종·학교 수)으로만 만든 요약이다(lib/alerts).
 * 인쇄·공유(결과 패널 안이라 그대로 인쇄된다)·비교 전체 결과에도 같은 자리에 보인다.
 */
export function RegulationBanner({ alert }: { alert: RegulationAlert | null }) {
  if (!alert) return null
  return (
    <div className="regulation" role="alert">
      <span className="regulation__mark" aria-hidden="true">
        <Icon name="alert-triangle" size={16} />
      </span>
      <p className="regulation__text">
        <span className="visually-hidden">규제 경고: </span>
        {alert.text}
      </p>
    </div>
  )
}

/** 점수 숫자 옆 작은 배지 "규제 확인 필요" (13-1) — 종합 점수·비교 머리·보관함에서 같은 모양 */
export function RegulationBadge({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="regulation-badge">규제 확인 필요</span>
}

/**
 * 주의 관점 한 줄 (13-3, 팀 점검 보고서 A3): 25점 미만 관점이 있으면 점수 카드 아래 한 줄 — "{관점}이 매우 낮아요 — {근거}".
 * 관점 행(PerspectiveScores)에서는 같은 관점의 숫자·막대가 빨강 + "주의" 배지다.
 */
export function WeakPerspectiveLine({ alert }: { alert: WeakAlert | null }) {
  if (!alert) return null
  return (
    <p className="weak-line">
      <span className="weak-line__mark" aria-hidden="true">
        <Icon name="alert-triangle" size={14} />
      </span>
      <span className="visually-hidden">주의 관점: </span>
      {alert.text}
    </p>
  )
}
