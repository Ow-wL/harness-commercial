import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SummaryResponseSchema } from '../api/schemas.ts'
import { AiSummaryCard } from './AiSummaryCard.tsx'

const DATA = SummaryResponseSchema.parse({
  engine_version: 'mvp-0.5.1',
  prompt_version: 'r2-1',
  model: 'claude-sonnet-5-5',
  cached: false,
  good: [{ text: '주요 손님층이 많이 사는 편이에요.', fields: ['지표.customer.score'] }],
  bad: [{ text: '같은 업종이 12곳 있어요.', fields: ['지표.competition.raw.동종점포수'] }],
  check: [{ text: '저녁 유동을 확인하세요.', fields: [] }],
})

describe('AiSummaryCard — AI 요약 (R2 13-23)', () => {
  it('좋은 점·주의할 점·확인할 것과 근거 키, AI 면책 문구, "AI에게 질문"', () => {
    const onAsk = vi.fn()
    render(<AiSummaryCard state={{ status: 'success', data: DATA }} onAsk={onAsk} />)
    expect(screen.getByRole('heading', { name: 'AI 요약' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '좋은 점' })).toBeInTheDocument()
    expect(screen.getByText(/같은 업종이 12곳 있어요/)).toHaveTextContent('근거 지표.competition.raw.동종점포수')
    expect(screen.getByText(/틀릴 수 있으니/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI에게 질문' }))
    expect(onAsk).toHaveBeenCalled()
  })

  it('오류 코드별 문구(하루 한도·예산), 네트워크 오류만 다시 시도, idle 은 그리지 않는다', () => {
    const { rerender, container } = render(
      <AiSummaryCard state={{ status: 'error', failure: { kind: 'api', status: 429, error: { code: 'ai_limited', message: 'x' } } }} onRetry={() => {}} />,
    )
    expect(screen.getByText(/오늘 이 기기에서 쓸 수 있는 AI 횟수/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    rerender(<AiSummaryCard state={{ status: 'error', failure: { kind: 'api', status: 429, error: { code: 'ai_budget', message: 'x' } } }} />)
    expect(screen.getByText(/이번 달 AI 사용량이 모두 소진/)).toBeInTheDocument()
    rerender(<AiSummaryCard state={{ status: 'error', failure: { kind: 'network' } }} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    rerender(<AiSummaryCard state={{ status: 'idle' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('고정 문구에 순위·확률·추천·매출 표현이 없다', () => {
    const { container } = render(<AiSummaryCard state={{ status: 'success', data: DATA }} onAsk={() => {}} />)
    expect(container.textContent).not.toMatch(/순위|확률|추천|매출/)
  })
})
