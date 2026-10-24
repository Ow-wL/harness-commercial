import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  APP_VERSION,
  CHANGE_LABEL,
  DEPLOYMENTS,
  RELEASES,
  RENUMBERED_UNTIL,
  deploymentLabel,
  formatReleaseDate,
  productionOf,
} from '../lib/patchNotes.ts'
import { Icon } from './Icon.tsx'
import './UpdateNotes.css'

const FOCUSABLE = 'button, [href], summary, [tabindex]:not([tabindex="-1"])'
const engineLabel = (e: string) => `점수 엔진 ${e.replace(/^mvp-/, 'v')}`

/** 닫힌 "자세히" 안의 요소는 Tab 순서에 없다(요약 줄 자체는 있다) */
function reachable(el: HTMLElement): boolean {
  const details = el.closest('details')
  return !details || details.open || (el.tagName === 'SUMMARY' && el.parentElement === details)
}

/**
 * 업데이트 내역(패치노트, D-031): 조건 바의 작은 버튼 → 최신순 모달. 지도 영역 밖(헤더)이라 지도 SDK가 실패해도 열린다.
 * 열고 닫아도 App 상태(분석·비교·선택 위치)는 건드리지 않는다. Escape·닫기·배경 클릭으로 닫고, 닫으면 버튼으로 포커스를 돌린다.
 */
export function UpdateNotes() {
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
        className="bar__updates"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="업데이트 내역"
        title={`업데이트 내역 · 지금 화면 ${APP_VERSION}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="history" size={20} />
        <span className="bar__updates-label" aria-hidden="true">
          업데이트
        </span>
      </button>
      {open && createPortal(<UpdatesDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function UpdatesDialog({ onClose }: { onClose: () => void }) {
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
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
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
        aria-labelledby="updates-title"
        aria-describedby="updates-current"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="updates__head">
          <h2 id="updates-title" className="updates__title">
            업데이트 내역
          </h2>
          <button type="button" className="updates__close" aria-label="업데이트 내역 닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="updates__body">
          <p id="updates-current" className="updates__current">
            지금 보고 있는 화면은 <strong>{APP_VERSION}</strong>입니다.
          </p>
          <p className="updates__note">
            v0.0.1~{RENUMBERED_UNTIL}은 기존 변경 이력을 정리하며 부여한 앱 버전입니다. 앱 버전은 점수 엔진 버전과 따로
            매깁니다.
          </p>
          <ol className="updates__list">
            {RELEASES.map((r) => {
              const live = productionOf(r.version)
              const deploys = DEPLOYMENTS.filter((d) => d.app_version === r.version)
              return (
                <li key={r.version} className="updates__item">
                  <article aria-labelledby={`update-${r.version}`}>
                    <h3 id={`update-${r.version}`} className="updates__item-head">
                      <span className="updates__version">{r.version}</span>
                      <span className="updates__date">
                        {' · '}
                        {formatReleaseDate(r)}
                      </span>
                      <span className="updates__item-title">{r.title}</span>
                    </h3>
                    <ul className="updates__changes">
                      {r.changes.map((c) => (
                        <li key={c.text} className="updates__change">
                          <span className={`updates__tag updates__tag--${c.type}`}>{CHANGE_LABEL[c.type]}</span>
                          <span>{c.text}</span>
                        </li>
                      ))}
                    </ul>
                    {live && (
                      <p className="updates__live">
                        운영 반영 {live.date.replaceAll('-', '.')}
                        {live.app_version !== r.version && ` (${live.app_version}와 함께)`}
                      </p>
                    )}
                    <details className="updates__details">
                      <summary>자세히</summary>
                      <dl className="updates__meta">
                        {r.engine && (
                          <>
                            <dt>점수 엔진</dt>
                            <dd>{engineLabel(r.engine)}</dd>
                          </>
                        )}
                        {r.work && r.work.length > 0 && (
                          <>
                            <dt>작업</dt>
                            <dd>{r.work.join(' · ')}</dd>
                          </>
                        )}
                        {deploys.length > 0 && (
                          <>
                            <dt>배포 기록</dt>
                            {deploys.map((d) => (
                              <dd key={d.id}>
                                {deploymentLabel(d)} — {d.note} <code>{d.source_commit}</code>
                              </dd>
                            ))}
                          </>
                        )}
                        <dt>커밋</dt>
                        <dd className="updates__commits">
                          {r.commits.length > 0 ? r.commits.map((h) => <code key={h}>{h}</code>) : '이 화면을 만든 뒤에 연결됩니다'}
                        </dd>
                      </dl>
                    </details>
                  </article>
                </li>
              )
            })}
          </ol>
          <p className="updates__foot">배포 기록은 이 화면을 만든 시점까지의 기록입니다. 날짜는 한국 시간 기준입니다.</p>
        </div>
      </div>
    </div>
  )
}
