import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnalyzeResponseSchema, SummaryResponseSchema } from '../api/schemas.ts'
import pcFixture from '../fixtures/bupyeong-pcbang.json'
import { AiSummaryCard } from './AiSummaryCard.tsx'
import { splitNumbers } from '../lib/numberEmphasis.ts'

const DATA = SummaryResponseSchema.parse({
  engine_version: 'mvp-0.5.1',
  prompt_version: 'r2-1',
  model: 'claude-sonnet-5-5',
  cached: false,
  good: [{ text: '주요 손님층이 많이 사는 편이에요.', fields: ['지표.customer.score'] }],
  bad: [{ text: '같은 업종이 12곳 있어요.', fields: ['지표.competition.raw.동종점포수'] }],
  check: [{ text: '저녁 유동을 확인하세요.', fields: [] }],
})

const PC = AnalyzeResponseSchema.parse(pcFixture)
const item = (text: RegExp) => screen.getAllByRole('listitem').find((li) => text.test(li.textContent ?? ''))!

describe('AiSummaryCard — AI 요약 (R2 13-23, v0.4.1 패널)', () => {
  it('세 패널(제목·개수)과 항목, AI 면책 문구, "AI에게 질문"', () => {
    const onAsk = vi.fn()
    const { container } = render(<AiSummaryCard state={{ status: 'success', data: DATA }} onAsk={onAsk} />)
    expect(screen.getByRole('heading', { name: 'AI 요약' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '좋은 점' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '주의할 점' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '결정 전에 확인할 것' })).toBeInTheDocument()
    expect(container.querySelectorAll('.ai-card__group')).toHaveLength(3)
    expect(container.querySelector('.ai-card__group--good .ai-card__count')).toHaveTextContent('1')
    expect(document.body).not.toHaveTextContent('지표.')
    expect(screen.getByText(/틀릴 수 있으니/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI에게 질문' }))
    expect(onAsk).toHaveBeenCalled()
  })

  it('관점 칩은 근거 키의 관점 + 엔진 점수(등급색), 숫자는 굵게, 확인할 것은 칩 없이 체크 모양', () => {
    const { container } = render(<AiSummaryCard state={{ status: 'success', data: DATA }} indicators={PC.result.지표} />)
    const customer = PC.result.지표[1]
    const chip = item(/주요 손님층/).querySelector('.ai-card__chip')!
    expect(chip).toHaveTextContent(`고객성 ${customer.score!.toFixed(1)}`)
    expect(item(/같은 업종이/).querySelector('.ai-card__chip')).toHaveTextContent(/^경쟁성/)
    expect(item(/같은 업종이/).querySelector('.num-em')).toHaveTextContent('12곳')
    expect(item(/저녁 유동/).querySelector('.ai-card__chip')).toBeNull()
    expect(container.querySelectorAll('.ai-card__box')).toHaveLength(1)
  })

  it('근거 자료 이름은 "근거 자료 보기"로 펼친다(DOM 에는 늘 있어 인쇄된다)', () => {
    const { container } = render(<AiSummaryCard state={{ status: 'success', data: DATA }} />)
    expect(item(/같은 업종이/)).toHaveTextContent('근거: 같은 업종 점포 수')
    expect(item(/주요 손님층/)).toHaveTextContent('근거: 고객성 점수')
    const toggle = screen.getByRole('button', { name: '근거 자료 보기' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('.ai-card')).not.toHaveClass('ai-card--fields')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '근거 자료 숨기기' })).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelector('.ai-card')).toHaveClass('ai-card--fields')
  })

  it('확인할 것이 지원사업 후보를 인용하면 "지원사업 보기"(부르는 쪽이 넘길 때만)', () => {
    const data = SummaryResponseSchema.parse({ ...DATA, check: [{ text: '「상권 특례보증」 공고 원문을 확인하세요.', fields: ['지원사업_후보.S1'] }] })
    const onShowSupport = vi.fn()
    const { rerender } = render(<AiSummaryCard state={{ status: 'success', data }} onShowSupport={onShowSupport} />)
    fireEvent.click(screen.getByRole('button', { name: '지원사업 보기' }))
    expect(onShowSupport).toHaveBeenCalled()
    rerender(<AiSummaryCard state={{ status: 'success', data }} />)
    expect(screen.queryByRole('button', { name: '지원사업 보기' })).toBeNull()
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

  it('숫자 강조: 숫자+단위만, 이름 속 숫자("부평1동", "인천1호선", "1인 세대")는 그대로', () => {
    const nums = (t: string) => splitNumbers(t).filter((p) => p.num).map((p) => p.text)
    expect(nums('부평역이 85m 거리이고 같은 업종이 101곳이에요.')).toEqual(['85m', '101곳'])
    expect(nums('3년 생존율 67%, 인구 9,751명')).toEqual(['3년', '67%', '9,751명'])
    expect(nums('부평1동은 인천1호선 역 근처, 1인 세대가 많아요.')).toEqual([])
    expect(nums('점수 86.3점으로 높아요')).toEqual(['86.3점'])
    expect(splitNumbers('숫자 없음').map((p) => p.text).join('')).toBe('숫자 없음')
  })

  it('고정 문구에 순위·확률·추천·매출 표현이 없다', () => {
    const { container } = render(<AiSummaryCard state={{ status: 'success', data: DATA }} onAsk={() => {}} />)
    expect(container.textContent).not.toMatch(/순위|확률|추천|매출/)
  })
})
