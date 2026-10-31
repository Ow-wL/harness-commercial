import { useState } from 'react'
import type { RankItem, RankResponse } from '../api/schemas.ts'
import { formatRadius, formatScore } from '../lib/format.ts'
import { gradeLabel, gradeOf } from '../lib/grade.ts'
import type { RankState } from '../lib/useRank.ts'
import { Icon } from './Icon.tsx'
import './RankCard.css'

const TOP_N = 5

/**
 * 이 자리 업종 순위 카드 (R1 13-16, 팀 점검 보고서 C1): 같은 지점·반경에서 29개 업종의 종합점수(기본 가중치)를 높은 순으로.
 * 상위 5 + 지금 업종의 자리, "전체 보기"로 29개. 항목을 누르면 그 업종으로 다시 분석한다(App). 학교구역 규제 업종은 ⚠ 배지.
 * 표현은 "점수가 높은 업종" — 추천·성공 확률이 아니다(면책 정책). 점수·등급은 결과 화면과 같은 규칙(lib/grade).
 */
export function RankCard({
  state,
  currentBiz,
  onPick,
  onRetry,
  busy = false,
}: {
  state: RankState
  currentBiz: string
  onPick: (biz: string) => void
  /** 실패 뒤 같은 조건으로 다시 요청(Codex R1-6 — 자동 반복은 하지 않는다) */
  onRetry?: () => void
  busy?: boolean
}) {
  const [all, setAll] = useState(false)
  if (state.status === 'idle') return null
  return (
    <section className="rank-card" aria-labelledby="rank-title">
      <div className="rank-card__head">
        <h2 id="rank-title" className="result__section-title">이 자리에서 점수가 높은 업종</h2>
        {state.status === 'success' && (
          <span className="rank-card__meta">
            {state.data.count}개 업종 · 반경 {formatRadius(state.data.radius_m)} · 기본 계산 기준
          </span>
        )}
      </div>
      {/* 진행·실패 알림: role=status 대신 aria-live(결과 화면의 다른 status — 링크 복사 안내 — 와 역할이 겹치지 않게) */}
      <div className="rank-card__live" aria-live="polite">
        {state.status === 'loading' && <p className="rank-card__status">업종별 점수를 계산하는 중…</p>}
        {state.status === 'error' && (
          <p className="rank-card__status">
            업종 순위를 불러오지 못했습니다. 분석 결과는 그대로입니다.
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
      </div>
      {state.status === 'success' && <RankList data={state.data} currentBiz={currentBiz} all={all} onPick={onPick} busy={busy} onToggle={() => setAll((v) => !v)} />}
      <p className="rank-card__note">같은 자리·같은 자료로 업종만 바꿔 계산한 종합점수입니다. 순위는 성공 확률이나 추천이 아닙니다.</p>
    </section>
  )
}

function RankList({
  data,
  currentBiz,
  all,
  onPick,
  busy,
  onToggle,
}: {
  data: RankResponse
  currentBiz: string
  all: boolean
  onPick: (biz: string) => void
  busy: boolean
  onToggle: () => void
}) {
  const items = data.items
  const currentIndex = items.findIndex((i) => i.biz_code === currentBiz)
  const shown = all ? items : items.slice(0, TOP_N)
  const currentHidden = !all && currentIndex >= TOP_N
  const row = (item: RankItem, index: number) => {
    const grade = gradeOf(item.overall)
    const current = item.biz_code === currentBiz
    return (
      <li key={item.biz_code} className={`rank-item${current ? ' rank-item--current' : ''}`}>
        <button
          type="button"
          className="rank-item__button"
          disabled={busy || current}
          aria-current={current ? 'true' : undefined}
          onClick={() => onPick(item.biz_code)}
        >
          <span className="rank-item__rank">{index + 1}</span>
          <span className="rank-item__name">
            {item.name}
            {current && <span className="rank-item__you">지금 업종</span>}
            {item.regulated && (
              <span className="rank-item__reg">
                <Icon name="alert-triangle" size={12} />
                규제 확인
              </span>
            )}
          </span>
          <span className="rank-item__bar" aria-hidden="true">
            {item.overall !== null && <span className={`rank-item__fill${grade ? ` rank-item__fill--${grade}` : ''}`} style={{ width: `${item.overall}%` }} />}
          </span>
          <span className="rank-item__score">
            {item.overall === null ? <span className="rank-item__none">산출 불가</span> : formatScore(item.overall)}
            {grade && <span className={`grade grade--${grade}`}>{gradeLabel(item.overall)}</span>}
          </span>
          {item.weakest && item.weakest.score !== null && (
            <span className="rank-item__weak">가장 낮은 관점 {item.weakest.label} {formatScore(item.weakest.score)}</span>
          )}
        </button>
      </li>
    )
  }
  return (
    <>
      <ol className="rank-card__list" aria-label="업종별 종합점수 순위">
        {shown.map((item, i) => row(item, i))}
        {currentHidden && (
          <>
            <li className="rank-card__gap" aria-hidden="true">
              ⋯
            </li>
            {row(items[currentIndex]!, currentIndex)}
          </>
        )}
      </ol>
      {/* 인쇄 범위 안내(종이에만): 화면에서 펼친 만큼만 찍힌다 */}
      {!all && items.length > TOP_N && (
        <p className="rank-card__print-scope" aria-hidden="true">
          상위 {TOP_N}개{currentHidden ? '와 지금 업종' : ''}만 인쇄했습니다(전체 {items.length}개).
        </p>
      )}
      {items.length > TOP_N && (
        <button type="button" className="rank-card__toggle" aria-expanded={all} onClick={onToggle}>
          {all ? '상위 5개만 보기' : `전체 ${items.length}개 보기`}
        </button>
      )}
    </>
  )
}
