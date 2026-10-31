import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { askQuestion, type AskTurn } from '../api/client.ts'
import { PROFILE_PREFERRED, PROFILE_STAGES, type ProfileSuggestion } from '../api/schemas.ts'
import { AI_ERROR_TEXT, AI_TEXT, SUGGESTED_QUESTIONS } from '../content/ai.ts'
import { mergeSuggestion, profileBody, readProfile, writeProfile, type Profile } from '../lib/profile.ts'
import { Icon } from './Icon.tsx'
import './AskDialog.css'

const FOCUSABLE = 'button, [href], textarea, input, select, [tabindex]:not([tabindex="-1"])'
/** 서버로 보내는 지난 대화(13-24: 최근 6턴) */
const HISTORY_TURNS = 6

export type AskTarget = { lat: number; lng: number; biz_code: string; radius_m?: number; title: string }

type Message = AskTurn & { outOfScope?: boolean; suggestion?: ProfileSuggestion | null }

/**
 * AI 자유 질문 창 (R2 13-24·13-26): 지금 결과의 위치·업종·반경 자료 안에서만 답한다. 추천 질문 칩 3개, 최근 6턴만 서버로,
 * 선택형 프로필(창업 단계·청년·우대 — 이 브라우저에만 저장, 질문할 때만 함께 보냄). AI 가 대화에서 프로필을 알아내면
 * "저장"을 눌러야 저장한다. 대화는 창을 닫으면 사라진다(서버 로그 정책은 고지 문구 그대로).
 */
export function AskDialog({ target, onClose }: { target: AskTarget; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile>(readProfile)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    ref.current?.focus()
    return () => abort.current?.abort()
  }, [])
  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest' })
  }, [messages])

  const updateProfile = (next: Profile) => {
    setProfile(next)
    writeProfile(next)
  }

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    const history = messages.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: q }])
    setDraft('')
    const ac = new AbortController()
    abort.current = ac
    try {
      const where = { lat: target.lat, lng: target.lng, biz_code: target.biz_code, ...(target.radius_m !== undefined ? { radius_m: target.radius_m } : {}) }
      const r = await askQuestion({ ...where, question: q, history, profile: profileBody(profile) }, ac.signal)
      if (ac.signal.aborted) return
      if (r.ok) {
        setMessages((m) => [...m, { role: 'assistant', content: r.data.answer, outOfScope: r.data.out_of_scope, suggestion: r.data.profile_suggestion }])
      } else {
        setError(r.failure.kind === 'api' ? (AI_ERROR_TEXT[r.failure.error.code] ?? AI_ERROR_TEXT.ai_upstream!) : AI_ERROR_TEXT.ai_upstream!)
      }
    } catch {
      // 창을 닫아 취소됨
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'))
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

  return createPortal(
    <div className="updates-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="updates ask"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-title"
        aria-describedby="ask-lead"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="updates__head">
          <h2 id="ask-title" className="updates__title">
            {AI_TEXT.askTitle}
          </h2>
          <button type="button" className="updates__close" aria-label="질문 창 닫기" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </header>
        <div className="updates__body ask__body">
          <p id="ask-lead" className="updates__current">
            <strong>{target.title}</strong> · {AI_TEXT.askLead}
          </p>
          {messages.length === 0 && (
            <div className="ask__chips" role="group" aria-label="추천 질문">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} type="button" className="ask__chip" disabled={busy} onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <ol ref={listRef} className="ask__log" aria-label="대화" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`ask__msg ask__msg--${m.role}`}>
                <span className="visually-hidden">{m.role === 'user' ? '내 질문: ' : 'AI 답변: '}</span>
                {m.content}
                {m.suggestion && (
                  <ProfileSuggestionBox suggestion={m.suggestion} onSave={() => updateProfile(mergeSuggestion(profile, m.suggestion!))} />
                )}
              </li>
            ))}
            {busy && <li className="ask__msg ask__msg--assistant ask__msg--busy">답을 쓰는 중…</li>}
          </ol>
          {error && (
            <p className="ask__error" role="alert">
              {error}
            </p>
          )}
          <form className="ask__form" onSubmit={onSubmit}>
            <label className="visually-hidden" htmlFor="ask-input">
              질문
            </label>
            <input
              id="ask-input"
              className="input ask__input"
              value={draft}
              maxLength={300}
              placeholder={AI_TEXT.askPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <button type="submit" className="button button--primary ask__send" disabled={busy || !draft.trim()}>
              {AI_TEXT.askSend}
            </button>
          </form>
          <ProfileFields profile={profile} onChange={updateProfile} />
          <p className="ask__privacy">{AI_TEXT.privacy}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ProfileSuggestionBox({ suggestion, onSave }: { suggestion: ProfileSuggestion; onSave: () => void }) {
  const [saved, setSaved] = useState(false)
  const parts = [
    suggestion.stage && `창업 단계 ${suggestion.stage}`,
    suggestion.youth !== null && (suggestion.youth ? '청년(39세 이하)' : '청년 아님'),
    suggestion.preferred && suggestion.preferred.length > 0 && `우대 ${suggestion.preferred.join('·')}`,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <span className="ask__suggest">
      {AI_TEXT.suggestionLead} {parts.join(' · ')}{' '}
      <button
        type="button"
        className="rank-card__retry"
        disabled={saved}
        onClick={() => {
          onSave()
          setSaved(true)
        }}
      >
        {saved ? '저장함' : '저장'}
      </button>
    </span>
  )
}

function ProfileFields({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  return (
    <details className="ask__profile">
      <summary>{AI_TEXT.profileTitle}</summary>
      <p className="ask__privacy">{AI_TEXT.profileNote}</p>
      <label className="ask__field">
        창업 단계
        <select
          className="input"
          value={profile.stage ?? ''}
          onChange={(e) => onChange({ ...profile, stage: (e.target.value || null) as Profile['stage'] })}
        >
          <option value="">선택 안 함</option>
          {PROFILE_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="ask__field ask__field--check">
        <input
          type="checkbox"
          checked={profile.youth === true}
          onChange={(e) => onChange({ ...profile, youth: e.target.checked ? true : null })}
        />
        청년(39세 이하)
      </label>
      <fieldset className="ask__field ask__field--pref">
        <legend>우대 조건</legend>
        {PROFILE_PREFERRED.map((p) => (
          <label key={p} className="ask__field--check">
            <input
              type="checkbox"
              checked={profile.preferred.includes(p)}
              onChange={(e) =>
                onChange({ ...profile, preferred: e.target.checked ? [...profile.preferred, p] : profile.preferred.filter((x) => x !== p) })
              }
            />
            {p}
          </label>
        ))}
      </fieldset>
    </details>
  )
}
