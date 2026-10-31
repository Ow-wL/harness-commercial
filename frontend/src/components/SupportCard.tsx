import type { ApiFailure } from '../api/client.ts'
import type { SupportItem, SupportMatchResponse } from '../api/schemas.ts'
import { SUPPORT_SOURCE_NAME, SUPPORT_TEXT, asOfLabel, deadlineLabel } from '../content/support.ts'
import { isEmptyProfile, type Profile } from '../lib/profile.ts'
import type { SupportState } from '../lib/useSupport.ts'
import { ProfileFields } from './ProfileFields.tsx'
import './SupportCard.css'

const failureText = (f: ApiFailure) => (f.kind === 'api' && f.error.code === 'rate_limited' ? '요청이 너무 많아요. 1분쯤 뒤에 다시 시도해 주세요.' : SUPPORT_TEXT.failed)

/**
 * 지원사업 카드 (R3 13-33, 결과 카드 ⑥ — AI 요약 다음): POST /support/match 의 앞 5건. 공고명은 원문 링크(새 탭), 기관·지역·대상 배지,
 * 마감 D-N(날짜 없는 공고는 신청기간 원문), 왜 맞는지(reasons). 아래에 내 상황(프로필) 입력 칸 — 바꾸면 다시 찾는다(부르는 쪽).
 * 서버가 광고하지 않으면(/health support.enabled false) 부르는 쪽이 그리지 않는다.
 */
export function SupportCard({ state, profile, onProfile, onRetry, condition }: {
  state: SupportState
  profile: Profile
  onProfile: (p: Profile) => void
  onRetry?: () => void
  /** 기준 조건 한 줄(예: "카페 · 부평구") */
  condition: string
}) {
  if (state.status === 'idle') return null
  const data = state.status === 'success' ? state.data : null
  return (
    <section className="support-card" aria-labelledby="support-card-title">
      <div className="support-card__head">
        <h2 id="support-card-title" className="result__section-title">
          {SUPPORT_TEXT.title}
        </h2>
        {data && data.total > 0 && (
          <span className="support-card__count">
            {data.total}건 중 {data.items.length}건
          </span>
        )}
      </div>
      <p className="support-card__lead">
        {condition}
        {isEmptyProfile(profile) ? '' : ' · 내 상황'} 기준
      </p>
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
      {data && data.items.length > 0 && (
        <ol className="support-card__list">
          {data.items.map((it) => (
            <SupportRow key={it.id} item={it} />
          ))}
        </ol>
      )}
      <div className="support-card__profile">
        {isEmptyProfile(profile) && <p className="support-card__nudge">{SUPPORT_TEXT.profileNudge}</p>}
        <ProfileFields profile={profile} onChange={onProfile} />
      </div>
      {data && <SupportNote data={data} />}
    </section>
  )
}

function SupportRow({ item }: { item: SupportItem }) {
  const apply = item.apply_url && item.apply_url !== item.url ? item.apply_url : null
  return (
    <li className="support-card__item">
      <div className="support-card__top">
        <a className="support-card__title" href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
          <span className="visually-hidden"> (새 창)</span>
        </a>
        <span className={`support-card__due${item.deadline_soon ? ' support-card__due--soon' : ''}`}>{deadlineLabel(item)}</span>
      </div>
      <p className="support-card__meta">
        {item.agency && <span>{item.agency}</span>}
        <span className="support-card__badge">{item.nationwide ? '전국' : '인천'}</span>
        {item.targets.slice(0, 2).map((t) => (
          <span key={t} className="support-card__badge">
            {t}
          </span>
        ))}
      </p>
      {item.reasons.length > 0 && <p className="support-card__why">{item.reasons.join(' · ')}</p>}
      {apply && (
        <a className="support-card__apply" href={apply} target="_blank" rel="noopener noreferrer">
          {SUPPORT_TEXT.apply}
          <span className="visually-hidden"> (새 창)</span>
        </a>
      )}
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
