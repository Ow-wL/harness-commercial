import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import pcFixture from '../fixtures/bupyeong-pcbang.json'
import { TimeInsightsCard } from './TimeInsightsCard.tsx'

const PC = AnalyzeResponseSchema.parse(pcFixture)
const hour = (peak: number[]) => Array.from({ length: 24 }, (_, h) => (peak.includes(h) ? 50000 : 10000))
const withInsights = (by_hour: number[], profile: number[] | null) =>
  AnalyzeResponseSchema.parse({
    ...pcFixture,
    insights: {
      inflow: { gu_code: '28237', gu_name: '부평구', as_of: '2026-08', daily: 679748, by_hour, work_ratio: 0.41 },
      hours_profile: profile,
      hours_profile_note: '업종별 영업 시간대 프로파일은 추정치입니다',
    },
  })

describe('TimeInsightsCard — 시간대·인구 카드 (13-15)', () => {
  it('insights 가 없으면(구버전 서버) 카드를 그리지 않는다', () => {
    const { container } = render(<TimeInsightsCard analysis={PC} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('24시간 막대(피크 구간 강조)·읽기 문장·반경 인구 숫자·자료 단위와 기준월', () => {
    const { container } = render(<TimeInsightsCard analysis={withInsights(hour([18, 19, 20, 21]), hour([19, 20, 21, 22]))} />)
    expect(screen.getByRole('heading', { name: '시간대와 사람' })).toBeInTheDocument()
    expect(container.querySelectorAll('.time-chart__bar')).toHaveLength(24)
    expect(container.querySelectorAll('.time-chart__bar--peak').length).toBeGreaterThan(0)
    expect(screen.getByText(/^부평구는 저녁\(17~21시\) 유입이 하루의 \d+%로 가장 많아요\./)).toBeInTheDocument()
    expect(screen.getByText(/PC방의 주된 영업 시간대\(저녁\)와 겹쳐/)).toBeInTheDocument()
    expect(screen.getByText('타겟 연령 거주')).toBeInTheDocument()
    expect(screen.getByText(/부평구 하루 유입 679,748명 · 구 단위 · 2026-08 기준/)).toBeInTheDocument()
    expect(screen.getByText(/여기서 점수를 더하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByText(/프로파일은 추정치입니다/)).toBeInTheDocument()
  })

  it('문장에 순위·확률·추천이 없다', () => {
    const { container } = render(<TimeInsightsCard analysis={withInsights(hour([8, 9]), hour([19, 20]))} />)
    expect(container.textContent).not.toMatch(/순위|확률|추천/)
  })
})
