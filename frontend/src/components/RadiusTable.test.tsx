import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang-v05.json'
import { radiusRows } from '../lib/radiusTable.ts'
import { RadiusTable } from './RadiusTable.tsx'

const r500 = AnalyzeResponseSchema.parse(fixture)
const at = (radius: number, overall: number) => {
  const c = structuredClone(r500)
  c.result.meta.분석반경_m = radius
  c.result.종합.점수 = overall
  return c
}

describe('반경별 비교 표 화면 (12-26)', () => {
  it('지금 반경 행은 aria-current, 분석한 반경은 점수·점포·확인 필요, 빈 반경은 "분석하기" — 범위 문구는 신뢰구간이 아니라고 밝힌다', () => {
    const onAnalyze = vi.fn()
    render(<RadiusTable rows={radiusRows([300, 500, 1000], r500, (r) => (r === 1000 ? at(1000, 64.8) : null))} busy={false} onAnalyze={onAnalyze} />)
    const table = screen.getByRole('table', { name: '반경별 종합·관점 점수, 같은 업종 점포 수, 확인 필요 항목 수' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[1]).toHaveTextContent(new RegExp(`500m · 지금${r500.result.종합.점수}`))   // 엔진 값 그대로 (v0.5 fixture 62.4)
    expect(rows[1]).toHaveTextContent('12곳')
    expect(rows[1]).toHaveTextContent('4개')
    expect(rows[2]).toHaveTextContent(/1km64\.8/)
    expect(rows[2]).not.toHaveAttribute('aria-current')
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '300m 분석하기' }))
    expect(onAnalyze).toHaveBeenCalledWith(300)
    expect(screen.getByText(new RegExp(`분석한 반경 2개의 종합 점수 범위 ${r500.result.종합.점수}~64.8`))).toHaveTextContent('오차범위나 신뢰구간이 아닙니다')
  })

  it('분석 중에는 "분석하기"를 누를 수 없고, 반경이 하나뿐이면 표를 그리지 않는다', () => {
    const { rerender } = render(<RadiusTable rows={radiusRows([300, 500], r500, () => null)} busy onAnalyze={() => {}} />)
    expect(screen.getByRole('button', { name: '300m 분석하기' })).toBeDisabled()
    expect(screen.queryByText(/종합 점수 범위/)).not.toBeInTheDocument()
    rerender(<RadiusTable rows={radiusRows([500], r500, () => null)} busy={false} onAnalyze={() => {}} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
