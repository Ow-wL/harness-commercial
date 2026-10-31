import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyzeResponseSchema, InsightsResponseSchema } from '../api/schemas.ts'
import pcFixture from '../fixtures/bupyeong-pcbang.json'
import { TimeInsightsCard } from './TimeInsightsCard.tsx'

const PC = AnalyzeResponseSchema.parse(pcFixture)          // 시장성 raw 시간대_적합도 1.32 (엔진 v0.3 fixture)
const hour = (peak: number[]) => Array.from({ length: 24 }, (_, h) => (peak.includes(h) ? 50000 : 10000))
const insights = (by_hour: number[], profile: number[] | null, biz_code = 'R10406') =>
  InsightsResponseSchema.parse({
    biz_code,
    gu_code: '28237',
    gu_name: '부평구',
    inflow: { gu_code: '28237', gu_name: '부평구', as_of: '2026-08', daily: 679748, by_hour, work_ratio: 0.41 },
    hours_profile: profile,
    hours_profile_note: '업종별 영업 시간대 프로파일은 추정치입니다',
  })

describe('TimeInsightsCard — 시간대·인구 카드 (13-15)', () => {
  it('자료가 없으면(이전 서버 404·오류) 또는 다른 업종의 자료면 카드를 그리지 않는다', () => {
    expect(render(<TimeInsightsCard analysis={PC} insights={null} />).container).toBeEmptyDOMElement()
    const other = render(<TimeInsightsCard analysis={PC} insights={insights(hour([12]), hour([19]), 'I21201')} />)
    expect(other.container).toBeEmptyDOMElement()
  })

  it('24시간 막대(피크 구간 강조)·읽기 문장·인구 숫자·자료 단위와 기준월', () => {
    const { container } = render(<TimeInsightsCard analysis={PC} insights={insights(hour([18, 19, 20, 21]), hour([19, 20, 21, 22]))} />)
    expect(screen.getByRole('heading', { name: '시간대와 사람' })).toBeInTheDocument()
    expect(container.querySelectorAll('.time-chart__bar')).toHaveLength(24)
    expect(container.querySelectorAll('.time-chart__bar--peak').length).toBeGreaterThan(0)
    expect(screen.getByText(/^부평구는 저녁\(17~21시\) 유입이 하루의 \d+%로 가장 많아요\./)).toBeInTheDocument()
    expect(screen.getByText('주요 손님층 연령 거주')).toBeInTheDocument()
    expect(screen.getByText('주변 직장인')).toBeInTheDocument()
    expect(screen.getByText(/부평구 하루 유입 679,748명 · 구 단위 · 2026-08 기준/)).toBeInTheDocument()
    expect(screen.getByText(/여기서 점수를 더하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/프로파일은 추정치입니다/)).toBeInTheDocument()
  })

  it('겹침 판단은 엔진 시간대 적합도(1.32 > 1.20)로 — 유입 피크(낮)와 영업 피크(저녁)가 달라도 "엇갈려요"가 아니다 (Codex R1-1)', () => {
    const { container } = render(<TimeInsightsCard analysis={PC} insights={insights(hour([11, 12, 13, 14, 15, 16]), hour([19, 20, 21]))} />)
    expect(screen.getByText(/^부평구는 낮\(11~16시\)/)).toBeInTheDocument()
    expect(screen.getByText(/PC방은 영업 시간대에 사람이 몰리는 편이에요\(주로 저녁 영업 · 시간대 적합도 1\.32/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('엇갈')
  })

  it('문장에 순위·확률·추천이 없다', () => {
    const { container } = render(<TimeInsightsCard analysis={PC} insights={insights(hour([8, 9]), hour([19, 20]))} />)
    expect(container.textContent).not.toMatch(/순위|확률|추천/)
  })
})
