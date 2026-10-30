import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { radarPoint } from '../lib/radar.ts'
import { RadarChart } from './RadarChart.tsx'

const ITEMS = [
  { key: 'market', label: '시장성', score: 61.6 },
  { key: 'customer', label: '고객성', score: 81.2 },
  { key: 'competition', label: '경쟁성', score: null },
  { key: 'location', label: '입지성', score: 66.6 },
  { key: 'stability', label: '안정성', score: 73.2 },
]

describe('RadarChart — 거미줄 그래프 (13-13)', () => {
  it('좌표: 첫 축은 위(12시), 100 은 반지름 끝, 0 은 중심', () => {
    expect(radarPoint(0, 5, 100, 100, 120)).toEqual({ x: 120, y: 20 })
    const c = radarPoint(0, 5, 0, 100, 120)
    expect(c.x).toBeCloseTo(120)
    expect(c.y).toBeCloseTo(120)
    const half = radarPoint(0, 5, 50, 100, 120)
    expect(half.y).toBeCloseTo(70)
  })

  it('50 기준 점선 링, 미산출 관점은 축 회색·점 없음(0으로 그리지 않음), 점수는 글자로도 준다', () => {
    const { container } = render(<RadarChart series={[{ id: 'a', name: 'A', items: ITEMS }]} />)
    expect(container.querySelector('.radar__ring--reference')).not.toBeNull()
    expect(container.querySelectorAll('.radar__axis--missing')).toHaveLength(1)
    expect(container.querySelectorAll('.radar__dot')).toHaveLength(4)
    // 다각형 꼭짓점도 4개(미산출 제외)
    expect(container.querySelector('.radar__area')!.getAttribute('points')!.split(' ')).toHaveLength(4)
    expect(screen.getByText('경쟁성 미산출')).toBeInTheDocument()
    expect(screen.getByText('고객성 81.2점')).toBeInTheDocument()
    expect(container.querySelector('.radar__series')).toHaveClass('radar__series--good')   // 평균 70.65 ≥ 70
  })

  it('비교: 두 series 를 겹치고 범례를 그린다, B 는 점선 면', () => {
    const b = ITEMS.map((i) => ({ ...i, score: i.score === null ? 40 : i.score - 20 }))
    const { container } = render(
      <RadarChart series={[{ id: 'a', name: 'A 부평역', items: ITEMS }, { id: 'b', name: 'B 신포동', items: b }]} />,
    )
    expect(container.querySelectorAll('.radar__area')).toHaveLength(2)
    expect(container.querySelector('.radar__series--b')).not.toBeNull()
    expect(screen.getByRole('list', { name: 'B 신포동' })).toBeInTheDocument()
  })

  it('산출된 관점이 3개 미만이면 다각형을 그리지 않는다(꼭짓점 2개는 면이 아니다)', () => {
    const two = ITEMS.map((i, k) => ({ ...i, score: k < 2 ? 50 : null }))
    const { container } = render(<RadarChart series={[{ id: 'a', name: 'A', items: two }]} />)
    expect(container.querySelector('.radar__area')).toBeNull()
    expect(container.querySelectorAll('.radar__axis--missing')).toHaveLength(3)
  })
})
