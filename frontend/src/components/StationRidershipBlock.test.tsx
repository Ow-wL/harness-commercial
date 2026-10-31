import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InsightsResponseSchema, type StationRidership } from '../api/schemas.ts'
import { StationRidershipBlock } from './StationRidershipBlock.tsx'

const bands = ['06시 전', ...Array.from({ length: 18 }, (_, i) => `${i + 6}시`), '24시 후']
const series = (peak: number, v: number) => bands.map((_, i) => (i === peak ? v : 10))
const STATION: StationRidership = {
  name: '부평', lines: '인천1호선', distance_m: 85, bands,
  weekday: { board: series(13, 500), alight: series(13, 956), days: 261 },
  weekend: { board: series(11, 300), alight: series(9, 594), days: 104 },
  period_from: '2025-07-01', period_to: '2026-06-30', source: '인천교통공사',
  coverage: '인천교통공사 노선(인천1·2호선, 7호선 인천·부천 구간)만 들어 있습니다. 같은 역의 코레일·공항철도 이용자는 빠져 있습니다(예: 부평·주안의 1호선 경인선)',
}

describe('가까운 역 시간대별 승하차 (R3 13-41)', () => {
  it('역·노선·거리, 평일 하차 합계와 가장 많은 시간, 출처·포함 노선·점수 무관 고지', () => {
    render(<StationRidershipBlock station={STATION} />)
    expect(screen.getByRole('heading', { name: /가까운 역 · 부평역 인천1호선/ })).toBeInTheDocument()
    expect(screen.getByText('직선 85m')).toBeInTheDocument()
    expect(screen.getByText(/평일 하루 평균 하차 1,146명 · 승차 690명, 하차가 가장 많은 때는 18시예요/)).toBeInTheDocument()
    const note = screen.getByText(/점수에는 쓰지 않는 참고 자료/)
    expect(note).toHaveTextContent('인천교통공사 2025-07~2026-06 평일 261일 평균')
    expect(note).toHaveTextContent('경인선')
    expect(screen.getByRole('button', { name: '평일' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('가장 많은 때가 "06시 전"이면 "이에요"', () => {
    render(<StationRidershipBlock station={{ ...STATION, weekday: { ...STATION.weekday, alight: series(0, 999) } }} />)
    expect(screen.getByText(/가장 많은 때는 06시 전이에요/)).toBeInTheDocument()
  })

  it('주말로 바꾸면 주말 값과 날 수', () => {
    render(<StationRidershipBlock station={STATION} />)
    fireEvent.click(screen.getByRole('button', { name: '주말' }))
    expect(screen.getByRole('button', { name: '주말' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/주말 하루 평균 하차 784명 · 승차 490명, 하차가 가장 많은 때는 14시예요/)).toBeInTheDocument()
    expect(screen.getByText(/주말 104일 평균/)).toBeInTheDocument()
  })

  it('/insights 스키마: station 이 있거나 null 이거나 없어도(이전 서버) 통과', () => {
    const base = { biz_code: 'I21201', gu_code: '28237', gu_name: '부평구', engine_version: 'mvp-0.5.1', inflow: null, hours_profile: null, hours_profile_note: null }
    expect(InsightsResponseSchema.parse({ ...base, station: STATION }).station?.name).toBe('부평')
    expect(InsightsResponseSchema.parse({ ...base, station: null }).station).toBeNull()
    expect(InsightsResponseSchema.parse(base).station).toBeUndefined()
  })
})
