import { useId, useState, type ReactNode } from 'react'
import './FoldSection.css'

/**
 * 접힌 줄 (13-51 화면 단순화, D-049): 결과의 "더 알아보기" 카드(시간대·업종 순위·지원사업)를 질문 한 줄로 접어 두고 누르면 펼친다.
 * - 줄마다 따로 펼친다(하나를 열어도 다른 줄이 닫히지 않는다) — 번갈아 볼 때 조작이 늘지 않게.
 * - 내용은 접혀 있어도 DOM 에 둔다(`hidden`): 카드가 하던 자료 요청·상태는 그대로이고, 인쇄는 print.css 가 모두 펼친다.
 * - 밖에서 열어야 할 때(예: AI 요약의 "지원사업 보기")는 `openSignal` 값을 바꾼다 — 바뀔 때마다 펼친다.
 */
export function FoldSection({
  id,
  label,
  hint,
  openSignal = 0,
  children,
}: {
  /** 줄을 가리키는 id (이동 링크·테스트가 쓴다) */
  id: string
  /** 줄 제목 — 질문 한 줄 */
  label: string
  /** 접힌 상태에서 보이는 보조 설명 */
  hint?: string
  /** 값이 바뀌면 펼친다 */
  openSignal?: number
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [seenSignal, setSeenSignal] = useState(openSignal)
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal)
    setOpen(true)
  }
  const bodyId = useId()

  return (
    <div className={`fold${open ? ' fold--open' : ''}`} id={id}>
      <button type="button" className="fold__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
        <span className="fold__text">
          <span className="fold__label">{label}</span>
          {hint && <span className="fold__hint">{hint}</span>}
        </span>
        <svg className="fold__chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div id={bodyId} className="fold__body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
