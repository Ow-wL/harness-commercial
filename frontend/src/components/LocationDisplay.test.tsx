import { fireEvent, render, screen } from '@testing-library/react'
import { AnalyzeResponseSchema, type EngineResult } from '../api/schemas.ts'
import pcbangFixture from '../fixtures/bupyeong-pcbang.json'
import { formatDistance, locationName, nearestStation } from '../lib/format.ts'
import { LocationSummary } from './LocationSummary.tsx'

/** 실제 /analyze 응답 (부평역 · PC방): context 부평구 부평1동, 입지성 raw 최근접역 "부평" · 85m */
const PCBANG = AnalyzeResponseSchema.parse(pcbangFixture)

/** 엔진 schema가 허용하는 "역 정보 없음" 형태 (scoring.score_location: 역 데이터가 없으면 최근접역·거리 null) */
function withoutStation(indicators: EngineResult['지표']): EngineResult['지표'] {
  const [market, customer, competition, location, stability] = indicators
  return [market, customer, competition, { ...location, raw: { ...location.raw, 최근접역: null, 최근접역_거리m: null } }, stability]
}

describe('위치 표시 규칙 (lib/format, DESIGN.md §8.5·§8.5a)', () => {
  it('위치 이름은 context의 시군구·행정동이다', () => {
    expect(locationName(PCBANG.context)).toBe('부평구 부평1동')
  })

  it('최근접역은 엔진 이름에 "역"을 붙이고 거리는 엔진 m 값 그대로 쓴다', () => {
    expect(PCBANG.result.지표[3].raw).toMatchObject({ 최근접역: '부평', 최근접역_거리m: 85 })
    expect(nearestStation(PCBANG.result.지표)).toEqual({ name: '부평역', distanceM: 85 })
    expect(formatDistance(1240)).toBe('1,240m')
  })

  it('역 이름이나 거리가 없으면 null', () => {
    expect(nearestStation(withoutStation(PCBANG.result.지표))).toBeNull()
  })
})

/* Context Bar(헤더의 위치·업종 칩)는 A3에서 위쪽 조건 바(App)와 결과 머리(AnalysisResult)로 옮겼다 — 그 규칙은 App.test·AnalysisResult.test가 본다 */

describe('LocationSummary (결과 패널 위치 보조 정보)', () => {
  it('최근접역을 직선거리로 보이고, 도보 거리와 다를 수 있음을 알린다', () => {
    render(<LocationSummary context={PCBANG.context} station={nearestStation(PCBANG.result.지표)} />)
    expect(screen.getByText(/가장 가까운 역/)).toHaveTextContent(
      '가장 가까운 역 부평역 · 직선거리 85m (걸어서 가는 거리와 다를 수 있음)',
    )
  })

  it('역 정보가 없으면 없다고 표시한다', () => {
    render(<LocationSummary context={PCBANG.context} station={null} />)
    expect(screen.getByText('가장 가까운 역 정보가 없습니다')).toBeInTheDocument()
  })

  it('좌표는 기본 접힘이고 "좌표 보기"로 분석 좌표를 연다', () => {
    render(<LocationSummary context={PCBANG.context} station={nearestStation(PCBANG.result.지표)} />)
    const toggle = screen.getByRole('button', { name: '좌표 보기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('37.4894, 126.7246')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const coord = screen.getByText('37.4894, 126.7246')
    expect(toggle).toHaveAttribute('aria-controls', coord.parentElement!.id)
    expect(coord.parentElement).toHaveTextContent('분석 좌표(WGS84) 37.4894, 126.7246')

    fireEvent.click(toggle)
    expect(screen.queryByText('37.4894, 126.7246')).not.toBeInTheDocument()
  })
})
