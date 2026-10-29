import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { FIELD_CHECK_COUNT } from '../content/fieldChecks.ts'
import { dataVersionLabel } from '../lib/dataVersion.ts'
import { doneCount, readFieldNotes } from '../lib/fieldNotes.ts'
import { formatRadius, formatScore } from '../lib/format.ts'
import type { SavedSite } from '../lib/savedSites.ts'
import { Icon } from './Icon.tsx'
import './SavedSites.css'

const FOCUSABLE = 'button, [href], textarea, input, [tabindex]:not([tabindex="-1"])'

/**
 * 후보 보관함 (계획 1-2, 12-25): 조건 바 버튼 → 모달. 항목마다 조건 · **저장 당시 결과**(스냅샷, 그때의 데이터 묶음·엔진·저장일) ·
 * 현장 확인 진행 · 메모 · "같은 조건으로 다시 분석"(지금 서버의 새 결과 — 스냅샷을 다시 보여 주지 않는다) · 삭제.
 * 지도 영역 밖(헤더)이라 지도 SDK가 실패해도 열린다. 열고 닫아도 분석·비교 상태는 그대로다(다시 분석을 누르기 전까지).
 */
export function SavedSites({
  sites,
  onReanalyze,
  onMemo,
  onRemove,
}: {
  sites: readonly SavedSite[]
  onReanalyze: (site: SavedSite) => void
  onMemo: (id: string, memo: string) => void
  onRemove: (id: string) => void
}) {
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
        className="bar__updates bar__saved"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`보관함 ${sites.length}곳`}
        title="후보 보관함"
        onClick={() => setOpen(true)}
      >
        <Icon name="bookmark" size={20} />
        <span className="bar__updates-label" aria-hidden="true">
          보관함
        </span>
        {sites.length > 0 && (
          <span className="bar__saved-count" aria-hidden="true">
            {sites.length}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <SavedDialog
            sites={sites}
            onClose={() => setOpen(false)}
            onReanalyze={(site) => {
              setOpen(false)
              onReanalyze(site)
            }}
            onMemo={onMemo}
            onRemove={onRemove}
          />,
          document.body,
        )}
    </>
  )
}

function SavedDialog({
  sites,
  onClose,
  onReanalyze,
  onMemo,
  onRemove,
}: {
  sites: readonly SavedSite[]
  onClose: () => void
  onReanalyze: (site: SavedSite) => void
  onMemo: (id: string, memo: string) => void
  onRemove: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])

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
        className="updates saved"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-title"
        aria-describedby="saved-lead"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="updates__head">
          <h2 id="saved-title" className="updates__title">
            후보 보관함
          </h2>
          <button type="button" className="updates__close" aria-label="보관함 닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="updates__body">
          <p id="saved-lead" className="updates__current">
            이 브라우저에만 최대 3곳을 저장합니다. 저장 당시 결과는 그때 서버의 값이고, 다시 분석하면 지금 데이터 묶음·엔진으로 새로
            계산합니다.
          </p>
          {sites.length === 0 ? (
            <p className="saved__empty">아직 보관한 후보가 없습니다. 분석 결과 위의 &quot;보관&quot;으로 저장하세요.</p>
          ) : (
            <ol className="saved__list">
              {sites.map((site) => (
                <SavedItem key={site.id} site={site} onReanalyze={onReanalyze} onMemo={onMemo} onRemove={onRemove} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

const savedDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function SavedItem({
  site,
  onReanalyze,
  onMemo,
  onRemove,
}: {
  site: SavedSite
  onReanalyze: (site: SavedSite) => void
  onMemo: (id: string, memo: string) => void
  onRemove: (id: string) => void
}) {
  const titleId = `saved-${site.id}-title`
  const memoId = `saved-${site.id}-memo`
  const notes = readFieldNotes(site.key)
  const done = doneCount(notes, Object.keys(notes))
  const { overall, perspectives, stores, gaps, locationName } = site.snapshot
  const radius = site.conditions.radius ?? 500
  return (
    <li className="saved__item">
      <article aria-labelledby={titleId}>
        <h3 id={titleId} className="saved__item-title">
          {locationName} · {site.conditions.bizName} · 반경 {formatRadius(radius)}
        </h3>
        <p className="saved__snapshot">
          <span className="saved__snapshot-label">저장 당시 결과</span>
          <span className="saved__score">{overall === null ? '산출 불가' : formatScore(overall)}</span>
          <span className="saved__meta">
            {savedDate(site.savedAt)} 저장 · {site.versions.data ? dataVersionLabel(site.versions.data) : '데이터 묶음 모름'} · 엔진{' '}
            {site.versions.engine}
          </span>
        </p>
        <p className="saved__perspectives">
          {perspectives.map((p) => (
            <span key={p.key} className="saved__perspective">
              {p.label} {p.score === null ? '미산출' : formatScore(p.score)}
            </span>
          ))}
          <span className="saved__perspective">같은 업종 {stores.toLocaleString('ko-KR')}곳</span>
        </p>
        {gaps.length > 0 && <p className="saved__gaps">확인 필요 · {gaps.join(' · ')}</p>}
        <p className="saved__progress">
          현장 확인 {done}/{FIELD_CHECK_COUNT} 확인함
          <span className="saved__coords">
            {' '}
            · 좌표 {site.conditions.lat}, {site.conditions.lng}
          </span>
        </p>
        <label className="visually-hidden" htmlFor={memoId}>
          {locationName} 메모
        </label>
        <textarea
          id={memoId}
          className="input saved__memo"
          rows={2}
          placeholder="메모 (이 브라우저에만 저장)"
          value={site.memo}
          onChange={(e) => onMemo(site.id, e.target.value)}
        />
        <div className="saved__actions">
          <button type="button" className="button button--primary" onClick={() => onReanalyze(site)}>
            같은 조건으로 다시 분석
          </button>
          <button type="button" className="button button--ghost-fill" onClick={() => onRemove(site.id)}>
            삭제
          </button>
        </div>
      </article>
    </li>
  )
}
