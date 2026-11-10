import { useId, useState, type ReactNode } from 'react'
import { Icon } from './Icon.tsx'
import './DataNote.css'

/**
 * 접힌 "자료 안내" (v0.4.1): 카드 아래 각주(자료 단위·기간·포함 범위·점수와의 관계)를 한 줄 버튼 뒤로 접는다.
 * 내용은 접혀 있어도 DOM 에 두고 화면에서만 숨긴다 — 인쇄는 늘 찍는다(DataNote.css), 문장은 바꾸지 않는다.
 */
export function DataNote({ label = '자료 안내', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="data-note">
      <button type="button" className="data-note__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Icon name="info" size={14} />
        {label}
        <span className="chevron" data-open={open}>
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      <div id={id} className={`data-note__body${open ? '' : ' data-note__body--folded'}`}>
        {children}
      </div>
    </div>
  )
}
