import { fireEvent, render, screen, within } from '@testing-library/react'
import App from './App.tsx'
import { AnalyzeResponseSchema } from './api/schemas.ts'
import { AnalysisResult } from './components/AnalysisResult.tsx'
import fixture from './fixtures/bupyeong-pcbang.json'
// 루트 golden을 그 자리에서 읽는다 (frontend로 복사하지 않는다)
import nailShopGolden from '../../tests/golden/v0.3/json/full_네일숍.json'

const PERSPECTIVE_LABELS = ['시장성', '고객성', '경쟁성', '입지성', '안정성']

function perspectiveRows() {
  const list = within(screen.getByRole('region', { name: '5대 관점' })).getByRole('list')
  return within(list).getAllByRole('listitem')
}

describe('App — 부평역 · PC방 고정 응답 결과 화면', () => {
  it('fixture는 실제 /analyze 응답 계약(AnalyzeResponseSchema)을 통과한다', () => {
    const parsed = AnalyzeResponseSchema.safeParse(fixture)
    expect(parsed.success, parsed.error?.message).toBe(true)
    // 일반 ContextBuilder 경로 (legacy golden의 BUPYEONG_STATION 아님)
    expect(fixture.context).toMatchObject({ gu_name: '부평구', dong_name: '부평1동', rent_area: null })
  })

  it('위치·업종 context를 보여 준다', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    const bar = screen.getByRole('group', { name: '분석 조건' })
    expect(within(bar).getByText('부평구 부평1동')).toBeInTheDocument()
    expect(within(bar).getByText('PC방 · 목적방문형')).toBeInTheDocument()
    expect(within(bar).getByText('37.4894, 126.7246')).toBeInTheDocument()
  })

  it('종합 점수를 fixture 값 그대로 보여 준다', () => {
    render(<App />)
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText(String(fixture.result.종합.점수))).toBeInTheDocument()
  })

  it('5대 관점을 고정 순서로, 점수를 숫자 텍스트로 보여 준다', () => {
    render(<App />)
    const rows = perspectiveRows()
    expect(rows.map((r) => r.dataset.key)).toEqual(['market', 'customer', 'competition', 'location', 'stability'])
    rows.forEach((row, i) => {
      const ind = fixture.result.지표[i]!
      expect(within(row).getByText(PERSPECTIVE_LABELS[i]!)).toBeInTheDocument()
      expect(row).toHaveTextContent(`${ind.label}${ind.score!.toFixed(1)}점`)
    })
  })

  it('최고 관점과 병목 관점을 표시한다', () => {
    render(<App />)
    const rows = perspectiveRows()
    const customer = rows.find((r) => r.dataset.key === fixture.result.종합.최고_지표)!
    const competition = rows.find((r) => r.dataset.key === fixture.result.종합.병목_지표)!
    expect(within(customer).getByText('가장 강한 관점')).toBeInTheDocument()
    // 병목 30.2 ≥ 25 → 중립 톤 "가장 낮은 관점" (DESIGN.md §8.3)
    expect(within(competition).getByText('가장 낮은 관점')).toBeInTheDocument()

    const summary = within(screen.getByRole('region', { name: '종합 적합도' }))
    expect(summary.getByText('병목').nextSibling).toHaveTextContent('경쟁성 30.2')
    expect(summary.getByText('가장 강한 관점').nextSibling).toHaveTextContent('고객성 82.8')
  })

  it('세부 분석은 기본 접힘이고, 버튼으로 열면 breakdown이 보인다', () => {
    render(<App />)
    const toggle = screen.getByRole('button', { name: /^안정성/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('table', { name: '안정성 세부 지표' })).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const table = screen.getByRole('table', { name: '안정성 세부 지표' })
    const s1 = within(table).getByRole('row', { name: /3년 생존율/ })
    expect(s1).toHaveTextContent('55.6')
    expect(s1).toHaveTextContent('0.471')
    expect(s1).toHaveTextContent('26.1')
    // rent_area=null → S4 제외: 0이 아니라 "데이터 없음"·"제외"
    const s4 = within(table).getByRole('row', { name: /상권 임대료/ })
    expect(s4).toHaveTextContent('데이터 없음')
    expect(s4).toHaveTextContent('제외(데이터 없음)')

    // 원시값은 2차 disclosure
    expect(screen.queryByText('인천_업종평균_3년생존율')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '원시값 보기' }))
    expect(screen.getByText('인천_업종평균_3년생존율')).toBeInTheDocument()
  })

  it('엔진 경고가 없으면 "특별한 경고가 없습니다"와 데이터 한계를 접지 않고 보여 준다', () => {
    render(<App />)
    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    expect(warnings.getByText('특별한 경고가 없습니다.')).toBeInTheDocument()
    expect(warnings.getByText(/상권 임대료\(소규모상가\)' 지표를 제외/)).toBeInTheDocument()
  })

  it('면책은 엔진 원문 그대로 항상 보인다', () => {
    render(<App />)
    expect(screen.getByText(fixture.result.면책)).toBeInTheDocument()
  })
})

describe('AnalysisResult — 관점 score=null 인 정상 엔진 결과', () => {
  // golden v0.3 네일숍: 안정성 score null(커버리지 부족), 경쟁성 1.2 병목(< 25). 엔진 결과를 변조하지 않고 그대로 쓴다
  const analysis = AnalyzeResponseSchema.parse({ context: fixture.context, result: nailShopGolden })

  it('null 관점을 0점이 아니라 "데이터 없음"으로 표시한다', () => {
    expect(analysis.result.지표[4].score).toBeNull()
    render(<AnalysisResult analysis={analysis} />)

    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(within(stability).getByText('데이터 없음')).toBeInTheDocument()
    expect(stability).toHaveTextContent('종합점수에서 제외했습니다')
    expect(stability).not.toHaveTextContent(/\d+\.\d점/)

    fireEvent.click(screen.getByRole('button', { name: /^안정성/ }))
    expect(screen.getByRole('button', { name: /^안정성/ })).toHaveTextContent('데이터 없음')
  })

  it('병목 < 25는 warning 톤 "병목"과 엔진 경고 원문을 보여 준다', () => {
    render(<AnalysisResult analysis={analysis} />)
    const competition = perspectiveRows().find((r) => r.dataset.key === 'competition')!
    expect(within(competition).getByText('병목')).toBeInTheDocument()

    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    for (const text of analysis.result.경고) expect(warnings.getByText(text)).toBeInTheDocument()
  })
})
