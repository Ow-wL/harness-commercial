/**
 * 대시보드 시트 손잡이 (DESIGN.md §20.1): 끌어서 올리고 내리거나, 눌러서 전환한다. 키보드는 안의 버튼으로 같은 동작.
 * 끄는 동안의 위치는 패널 inline transform 으로만 다룬다(프레임마다 렌더하지 않는다). 놓으면 inline 을 지우고 상태를 정하므로
 * CSS transition 이 놓은 자리에서 이어서 움직인다.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from './Icon.tsx'
import './SheetHandle.css'

/** 이만큼 움직여야 끌기로 본다 — 그 전에는 누르기 */
const DRAG_START_PX = 6
/** 이보다 빠르게 튕기면(px/ms) 위치와 상관없이 그 방향으로 */
const FLICK_PX_PER_MS = 0.5

type Drag = {
  pointerId: number
  startY: number
  base: number
  travel: number
  offset: number
  lastY: number
  lastT: number
  velocity: number
  moved: boolean
}

export function SheetHandle({
  toggleId,
  lowered,
  summary,
  controls,
  onChange,
}: {
  toggleId: string
  lowered: boolean
  summary: string
  controls: string
  onChange: (lowered: boolean) => void
}) {
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)

  const panelOf = (el: HTMLElement) => el.closest<HTMLElement>('.panel')

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragged.current = false
    const panel = panelOf(e.currentTarget)
    if (!panel) return
    // 누르는 순간 잡는다 — 손잡이 줄이 얇아 빠르게 끌면 첫 이동부터 줄 밖이다. 끌지 않고 떼면 click 이 이 줄로 와서 같은 전환을 한다
    e.currentTarget.setPointerCapture(e.pointerId)
    const travel = panel.offsetHeight - e.currentTarget.offsetHeight
    drag.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      base: lowered ? travel : 0,
      travel,
      offset: lowered ? travel : 0,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      moved: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const delta = e.clientY - d.startY
    if (!d.moved) {
      if (Math.abs(delta) < DRAG_START_PX) return
      d.moved = true
    }
    const panel = panelOf(e.currentTarget)
    if (!panel) return
    d.velocity = e.timeStamp > d.lastT ? (e.clientY - d.lastY) / (e.timeStamp - d.lastT) : d.velocity
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    d.offset = Math.min(d.travel, Math.max(0, d.base + delta))
    panel.toggleAttribute('data-dragging', true)
    panel.style.transform = `translateY(${d.offset}px)`
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (!d.moved) return
    dragged.current = true
    const panel = panelOf(e.currentTarget)
    if (panel) {
      panel.removeAttribute('data-dragging')
      panel.style.removeProperty('transform')
    }
    if (!commit) return
    const next = Math.abs(d.velocity) > FLICK_PX_PER_MS ? d.velocity > 0 : d.offset > d.travel / 2
    if (next !== lowered) onChange(next)
  }

  return (
    <div
      className="sheet-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
      onClick={() => {
        // 끌고 놓은 뒤 따라오는 click 은 전환으로 치지 않는다. 손잡이 어디를 눌러도 안의 버튼과 같은 동작
        if (dragged.current) {
          dragged.current = false
          return
        }
        onChange(!lowered)
      }}
    >
      <span className="sheet-handle__grip" aria-hidden="true" />
      <span className="sheet-handle__summary">{summary}</span>
      <button id={toggleId} type="button" className="sheet-handle__toggle" aria-expanded={!lowered} aria-controls={controls}>
        <span className="sheet-handle__icon" aria-hidden="true">
          <Icon name="chevron-right" size={16} />
        </span>
        {lowered ? '대시보드 올리기' : '지도 크게 보기'}
      </button>
    </div>
  )
}
