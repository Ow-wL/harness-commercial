import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SupportItem, SupportMatchResponse } from '../api/schemas.ts'
import { SupportMatchResponseSchema } from '../api/schemas.ts'
import { asOfLabel, deadlineLabel } from '../content/support.ts'
import { EMPTY_PROFILE } from '../lib/profile.ts'
import { SupportCard } from './SupportCard.tsx'

const item = (over: Partial<SupportItem>): SupportItem => ({
  id: 'bizinfo:1', source: 'bizinfo', sources: ['bizinfo'], title: '[인천] 소상공인 특례보증', agency: '인천광역시', operator: null,
  targets: ['소상공인'], category: '금융', nationwide: false, regions: ['인천'], period_text: '예산 소진시까지', start: null, end: null,
  days_left: null, deadline_soon: false, url: 'https://www.bizinfo.go.kr/view?1', apply_url: null, summary: null,
  reasons: ['인천 공고', '소상공인 대상'], ...over,
})

const DATA: SupportMatchResponse = SupportMatchResponseSchema.parse({
  as_of: '2026-11-01T06:00:00+09:00',
  total: 12,
  items: [
    item({}),
    item({ id: 'kstartup:2', source: 'kstartup', sources: ['kstartup', 'bizinfo'], title: '예비창업 멘토링', agency: '창업기관', nationwide: true,
      regions: [], targets: ['일반인', '일반기업', '1인 창조기업'], period_text: '20261020 ~ 20261104', end: '2026-11-04', days_left: 3,
      deadline_soon: true, url: 'https://www.k-startup.go.kr/2', apply_url: 'https://apply.example/2', reasons: ['창업 지원', '마감 3일 남음'] }),
  ],
})

const card = (state: Parameters<typeof SupportCard>[0]['state'], profile = EMPTY_PROFILE, onProfile = vi.fn(), onRetry = vi.fn()) =>
  render(<SupportCard state={state} profile={profile} onProfile={onProfile} onRetry={onRetry} condition="PC방 · 부평구" />)

describe('SupportCard — 조건에 맞는 지원사업 (R3 13-33)', () => {
  it('공고 링크(새 창)·마감·배지·이유·출처, 신청 링크는 공고 주소와 다를 때만', () => {
    card({ status: 'success', data: DATA })
    expect(screen.getByRole('heading', { name: '조건에 맞는 지원사업' })).toBeInTheDocument()
    expect(screen.getByText('12건 중 2건')).toBeInTheDocument()
    expect(screen.getByText('PC방 · 부평구 기준')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('support-card__item'))
    expect(rows).toHaveLength(2)
    const first = within(rows[0]!)
    const link = first.getByRole('link', { name: /\[인천\] 소상공인 특례보증/ })
    expect(link).toHaveAttribute('href', 'https://www.bizinfo.go.kr/view?1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(first.getByText('예산 소진시까지')).toBeInTheDocument()
    expect(first.getByText('인천')).toBeInTheDocument()
    expect(first.getByText('인천 공고 · 소상공인 대상')).toBeInTheDocument()
    expect(first.queryByRole('link', { name: /신청 페이지/ })).toBeNull()
    const second = within(rows[1]!)
    expect(second.getByText('D-3')).toHaveClass('support-card__due--soon')
    expect(second.getByText('전국')).toBeInTheDocument()
    expect(second.getByRole('link', { name: /신청 페이지/ })).toHaveAttribute('href', 'https://apply.example/2')
    const note = screen.getByText(/선정 가능성과는 무관/)
    expect(note).toHaveTextContent('출처: 기업마당 · K-Startup · 2026-11-01 06:00 기준')
    expect(document.body).not.toHaveTextContent('추천')
  })

  it('내 상황이 비면 좁히기 안내 + 입력 칸, 바꾸면 onProfile', () => {
    const onProfile = vi.fn()
    card({ status: 'success', data: DATA }, EMPTY_PROFILE, onProfile)
    expect(screen.getByText(/더 좁혀져요/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '창업 단계' }), { target: { value: '예비' } })
    expect(onProfile).toHaveBeenCalledWith({ stage: '예비', youth: null, preferred: [] })
  })

  it('내 상황이 있으면 안내 없이 "내 상황 기준"', () => {
    card({ status: 'success', data: DATA }, { stage: '운영 중', youth: null, preferred: [] })
    expect(screen.queryByText(/더 좁혀져요/)).toBeNull()
    expect(screen.getByText('PC방 · 부평구 · 내 상황 기준')).toBeInTheDocument()
  })

  it('빈 결과·아직 수집 전·불러오기 실패(다시 시도)·idle', () => {
    const { rerender, container } = card({ status: 'success', data: { as_of: '2026-11-01T06:00:00+09:00', total: 0, items: [] } })
    expect(screen.getByText(/조건에 맞는 공고가 없어요/)).toBeInTheDocument()
    rerender(<SupportCard state={{ status: 'success', data: { as_of: null, total: 0, items: [] } }} profile={EMPTY_PROFILE} onProfile={vi.fn()} condition="x" />)
    expect(screen.getByText(/아직 받아 오지 못했어요/)).toBeInTheDocument()
    const onRetry = vi.fn()
    rerender(<SupportCard state={{ status: 'error', failure: { kind: 'network' } }} profile={EMPTY_PROFILE} onProfile={vi.fn()} onRetry={onRetry} condition="x" />)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalled()
    rerender(<SupportCard state={{ status: 'idle' }} profile={EMPTY_PROFILE} onProfile={vi.fn()} condition="x" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('마감·기준 시각 표기', () => {
    expect(deadlineLabel({ days_left: 0, period_text: 'x' })).toBe('D-day')
    expect(deadlineLabel({ days_left: 12, period_text: 'x' })).toBe('D-12')
    expect(deadlineLabel({ days_left: null, period_text: '' })).toBe('마감 정보 없음')
    expect(asOfLabel('2026-11-01T06:00:00+09:00')).toBe('2026-11-01 06:00')
    expect(asOfLabel(null)).toBeNull()
  })
})
