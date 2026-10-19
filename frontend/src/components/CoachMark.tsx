/**
 * 첫 방문 안내 말풍선 (묶음 D, docs/ONBOARDING_DESIGN.md §1·§4, DESIGN.md §19.9).
 *
 * 비모달: `role="status"` + `aria-live="polite"`. 포커스를 가로채지 않는다 — 부모가 붙는 요소 **바로 다음**에 둔다(인라인, 절대 위치 아님).
 * 버튼: "건너뛰기"(안내 전체 종료)와 "다음"(마지막은 "확인"). 말풍선 안에서 Escape는 지금 말풍선만 숨긴다(onDismiss).
 * 문구에 점수·관점·데이터 설명을 넣지 않는다(중복 금지).
 */
import type { KeyboardEvent } from 'react'
import { TOUR_LABELS } from '../content/onboarding.ts'
import { Icon } from './Icon.tsx'
import './CoachMark.css'

/** "사용 방법 다시 보기" 아이콘 버튼 (조건 머리·결과 머리, 44px). 지금 화면에 맞는 단계부터 안내를 다시 연다 */
export function ReplayHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="help-replay" aria-label={TOUR_LABELS.replay} title={TOUR_LABELS.replay} onClick={onClick}>
      <Icon name="help-circle" size={20} />
    </button>
  )
}

export function CoachMark({
  text,
  index,
  last,
  onNext,
  onSkip,
  onDismiss,
}: {
  text: string
  /** ①~③은 {index, total}, 결과 안내는 null(단독) */
  index: { index: number; total: number } | null
  /** 마지막 말풍선이면 "확인" */
  last: boolean
  onNext: () => void
  onSkip: () => void
  onDismiss: () => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onDismiss()
  }
  return (
    <div className="coach" role="status" aria-live="polite" aria-label={TOUR_LABELS.region} onKeyDown={onKeyDown}>
      <p className="coach__text">
        {index && (
          <span className="coach__index" aria-label={`${index.index}단계 / ${index.total}단계`}>
            {index.index}/{index.total}
          </span>
        )}
        {text}
      </p>
      <div className="coach__actions">
        <button type="button" className="coach__skip" onClick={onSkip}>
          {TOUR_LABELS.skip}
        </button>
        <button type="button" className="coach__next" onClick={onNext}>
          {last ? TOUR_LABELS.done : TOUR_LABELS.next}
        </button>
      </div>
    </div>
  )
}
