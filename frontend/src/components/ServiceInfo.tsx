import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { SERVICE_CONTACT, SERVICE_INFO_LEAD, SERVICE_INFO_SECTIONS, SERVICE_INFO_TITLE } from '../content/serviceInfo.ts'
import { APP_VERSION } from '../lib/patchNotes.ts'
import { Icon } from './Icon.tsx'
import './UpdateNotes.css'
import './ServiceInfo.css'

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])'

/**
 * 서비스 안내(13-50): 조건 바의 ⓘ 버튼 → 모달. 무엇을 하는 서비스인지·자료 출처·개인정보 처리·문의를 언제든 볼 수 있게 한다.
 * 업데이트 내역과 같은 모달 틀(UpdateNotes.css)을 쓴다 — 지도 영역 밖이라 지도 SDK가 실패해도 열리고, 열고 닫아도 App 상태는 그대로.
 */
export function ServiceInfo() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="bar__updates bar__info"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={SERVICE_INFO_TITLE}
        title={SERVICE_INFO_TITLE}
        onClick={() => setOpen(true)}
      >
        <Icon name="info" size={20} />
        <span className="bar__updates-label" aria-hidden="true">
          안내
        </span>
      </button>
      {open && createPortal(<InfoDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function InfoDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // 모달 안에서만 Tab 이 돈다. Escape 는 여기서 멈춰 지도·패널의 Escape 처리로 번지지 않는다
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="updates-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="updates"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-info-title"
        aria-describedby="service-info-lead"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="updates__head">
          <h2 id="service-info-title" className="updates__title">
            {SERVICE_INFO_TITLE}
          </h2>
          <button type="button" className="updates__close" aria-label={`${SERVICE_INFO_TITLE} 닫기`} onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="updates__body">
          <p id="service-info-lead" className="updates__current">
            {SERVICE_INFO_LEAD}
          </p>
          {SERVICE_INFO_SECTIONS.map((s) => (
            <section key={s.title} className="service-info__section">
              <h3 className="service-info__title">{s.title}</h3>
              <ul className="service-info__list">
                {s.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
          {SERVICE_CONTACT && (
            <section className="service-info__section">
              <h3 className="service-info__title">만든 곳 · 문의</h3>
              <p className="service-info__contact">
                {SERVICE_CONTACT.maker} ·{' '}
                <a href={SERVICE_CONTACT.contactHref} target="_blank" rel="noopener noreferrer">
                  {SERVICE_CONTACT.contactLabel}
                </a>
              </p>
            </section>
          )}
          <p className="updates__foot">지금 화면 {APP_VERSION}</p>
        </div>
      </div>
    </div>
  )
}
