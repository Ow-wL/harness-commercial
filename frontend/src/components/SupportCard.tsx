import { useId, useState } from 'react'
import type { ApiFailure } from '../api/client.ts'
import type { SupportItem, SupportMatchResponse } from '../api/schemas.ts'
import { SUPPORT_SHOWN, SUPPORT_SOURCE_NAME, SUPPORT_TEXT, asOfLabel, deadlineLabel } from '../content/support.ts'
import { isEmptyProfile, type Profile } from '../lib/profile.ts'
import type { SupportState } from '../lib/useSupport.ts'
import { Icon } from './Icon.tsx'
import { ProfileFields } from './ProfileFields.tsx'
import './SupportCard.css'

const failureText = (f: ApiFailure) => (f.kind === 'api' && f.error.code === 'rate_limited' ? '요청이 너무 많아요. 1분쯤 뒤에 다시 시도해 주세요.' : SUPPORT_TEXT.failed)

/** 내 상황 요약 칩 글자: "예비 · 청년 · 여성" */
function profileSummary(p: Profile): string {
  return [p.stage, p.youth ? '청년' : null, ...p.preferred].filter(Boolean).join(' · ')
}

/**
 * 지원사업 카드 (R3 13-33 → v0.4.1 카드 격자, DESIGN §22, 결과 카드 ⑥ — AI 요약 다음): POST /support/match(최대 10건)를 공고 카드로.
 * 위: 조건 칩(업종·구·내 상황) + "내 상황 고르기"(입력 칸 펼침 — 바꾸면 부르는 쪽이 다시 찾는다).
 * 카드: 분야·마감 → 공고명(원문 그대로) → 사업 개요 2줄(원문 발췌) → 기관·지역·대상 → 맞는 이유 → "공고 보기"(새 창, 신청 주소가 다르면 "신청 페이지").
 * 처음 6건(SUPPORT_SHOWN), "N건 더 보기"로 나머지. "추천"이라 하지 않는다. 서버가 광고하지 않으면(/health support.enabled false) 부르는 쪽이 그리지 않는다.
 */
export function SupportCard({ state, profile, onProfile, onRetry, condition }: {
  state: SupportState
  profile: Profile
  onProfile: (p: Profile) => void
  onRetry?: () => void
  /** 기준 조건 한 줄(예: "카페 · 부평구") — 칩으로 나눠 보인다 */
  condition: string
}) {
  const [editing, setEditing] = useState(false)
  const [all, setAll] = useState(false)
  const profileId = useId()
  if (state.status === 'idle') return null
  const data = state.status === 'success' ? state.data : null
  const empty = isEmptyProfile(profile)
  const shown = data ? (all ? data.items : data.items.slice(0, SUPPORT_SHOWN)) : []
  const rest = data ? data.items.length - SUPPORT_SHOWN : 0
  return (
    <section className="support-card" aria-labelledby="support-card-title">
      <div className="support-card__head">
        <h2 id="support-card-title" className="result__section-title" tabIndex={-1}>
          {SUPPORT_TEXT.title}
        </h2>
        {data && data.total > 0 && (
          <span className="support-card__count">
            {data.total}건 중 {shown.length}건
          </span>
        )}
      </div>
      <div className="support-card__conditions">
        <span className="visually-hidden">기준:</span>
        {condition
          .split(' · ')
          .filter(Boolean)
          .map((c) => (
            <span key={c} className="support-card__cond">
              {c}
            </span>
          ))}
        {!empty && <span className="support-card__cond support-card__cond--mine">내 상황 · {profileSummary(profile)}</span>}
        <button
          type="button"
          className="support-card__cond support-card__cond--edit"
          aria-expanded={editing}
          aria-controls={profileId}
          onClick={() => setEditing((v) => !v)}
        >
          {empty ? `+ ${SUPPORT_TEXT.profileOpen}` : SUPPORT_TEXT.profileEdit}
        </button>
      </div>
      {empty && !editing && <p className="support-card__nudge">{SUPPORT_TEXT.profileNudge}</p>}
      {editing && (
        <div className="support-card__profile">
          <ProfileFields profile={profile} onChange={onProfile} bare id={profileId} />
        </div>
      )}
      <div aria-live="polite">
        {state.status === 'loading' && <p className="support-card__status">{SUPPORT_TEXT.loading}</p>}
        {state.status === 'error' && (
          <p className="support-card__status">
            {failureText(state.failure)}
            {onRetry && (
              <>
                {' '}
                <button type="button" className="rank-card__retry" onClick={onRetry}>
                  다시 시도
                </button>
              </>
            )}
          </p>
        )}
        {data && data.as_of === null && <p className="support-card__status">{SUPPORT_TEXT.notReady}</p>}
        {data && data.as_of !== null && data.items.length === 0 && <p className="support-card__status">{SUPPORT_TEXT.empty}</p>}
      </div>
      {shown.length > 0 && (
        <ol className="support-card__list">
          {shown.map((it) => (
            <SupportItemCard key={it.id} item={it} />
          ))}
        </ol>
      )}
      {rest > 0 && (
        <button type="button" className="support-card__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? SUPPORT_TEXT.less : SUPPORT_TEXT.more(rest)}
        </button>
      )}
      {data && <SupportNote data={data} />}
    </section>
  )
}

function SupportItemCard({ item }: { item: SupportItem }) {
  const apply = item.apply_url && item.apply_url !== item.url ? item.apply_url : null
  return (
    <li className="support-card__item">
      <article className="support-item" aria-label={item.title}>
        <div className="support-item__top">
          {item.category ? <span className="support-item__category">{item.category}</span> : <span />}
          <span className={`support-card__due${item.deadline_soon ? ' support-card__due--soon' : ''}`}>{deadlineLabel(item)}</span>
        </div>
        <h3 className="support-item__title">{item.title}</h3>
        {item.summary && <p className="support-item__summary">{item.summary}</p>}
        <p className="support-card__meta">
          {item.agency && (
            <span className="support-item__agency">
              <Icon name="building" size={14} />
              {item.agency}
            </span>
          )}
          <span className="support-card__badge">{item.nationwide ? '전국' : '인천'}</span>
          {item.targets.slice(0, 2).map((t) => (
            <span key={t} className="support-card__badge">
              {t}
            </span>
          ))}
        </p>
        {item.reasons.length > 0 && (
          <ul className="support-item__why" aria-label="조건에 맞는 이유">
            {item.reasons.map((r) => (
              <li key={r}>
                <Icon name="check" size={12} />
                {r}
              </li>
            ))}
          </ul>
        )}
        <div className="support-item__actions">
          <a className="support-item__open" href={item.url} target="_blank" rel="noopener noreferrer">
            {SUPPORT_TEXT.open}
            <Icon name="external-link" size={14} />
            <span className="visually-hidden"> — {item.title} (새 창)</span>
          </a>
          {apply && (
            <a className="support-item__apply" href={apply} target="_blank" rel="noopener noreferrer">
              {SUPPORT_TEXT.apply}
              <span className="visually-hidden"> — {item.title} (새 창)</span>
            </a>
          )}
        </div>
      </article>
    </li>
  )
}

function SupportNote({ data }: { data: SupportMatchResponse }) {
  const names = [...new Set(data.items.flatMap((i) => i.sources))].map((s) => SUPPORT_SOURCE_NAME[s] ?? s)
  const when = asOfLabel(data.as_of)
  return (
    <p className="support-card__note">
      {names.length > 0 && `출처: ${names.join(' · ')}`}
      {when && `${names.length > 0 ? ' · ' : ''}${when} 기준`}
      {(names.length > 0 || when) && '. '}
      {SUPPORT_TEXT.note}
    </p>
  )
}
