import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang.json'
import nailShopFixture from '../fixtures/bupyeong-nailshop.json'
// 루트 golden을 그 자리에서 읽는다 (frontend로 복사하지 않는다)
import nailShopGolden from '../../../tests/golden/v0.3/json/full_네일숍.json'
import { AnalysisResult } from './AnalysisResult.tsx'
import { ContextBar } from './ContextBar.tsx'
import { nearestStation } from '../lib/format.ts'

/** 실제 backend POST /analyze 응답 캡처(부평역 좌표 · PC방)를 schema 검증 후 결과 화면에 넣는다 */
const FIXTURE = AnalyzeResponseSchema.parse(fixture)

function renderResult() {
  render(
    <>
      <ContextBar context={FIXTURE.context} meta={FIXTURE.result.meta} station={nearestStation(FIXTURE.result.지표)} />
      <AnalysisResult analysis={FIXTURE} />
    </>,
  )
}

const PERSPECTIVE_LABELS = ['시장성', '고객성', '경쟁성', '입지성', '안정성']

function perspectiveRows() {
  const list = within(screen.getByRole('region', { name: '5대 관점' })).getByRole('list')
  return within(list).getAllByRole('listitem')
}

describe('AnalysisResult — 실제 /analyze 응답(부평역 · PC방)', () => {
  it('fixture는 실제 /analyze 응답 계약(AnalyzeResponseSchema)을 통과한다', () => {
    const parsed = AnalyzeResponseSchema.safeParse(fixture)
    expect(parsed.success, parsed.error?.message).toBe(true)
    // 일반 ContextBuilder 경로 (legacy golden의 BUPYEONG_STATION 아님)
    expect(fixture.context).toMatchObject({ gu_name: '부평구', dong_name: '부평1동', rent_area: null })
  })

  it('위치·업종 context를 보여 준다', () => {
    renderResult()
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    const bar = screen.getByRole('group', { name: '분석 조건' })
    expect(within(bar).getByText('부평구 부평1동')).toBeInTheDocument()
    expect(within(bar).getByText('PC방 · 목적방문형')).toBeInTheDocument()
    // 위치 보조 정보는 최근접역 직선거리, 좌표는 Context Bar에 두지 않는다 (DESIGN.md §8.5·§8.5a)
    expect(within(bar).getByText('부평역 · 직선거리 85m')).toBeInTheDocument()
    expect(bar).not.toHaveTextContent('37.4894')
  })

  it('종합 점수를 fixture 값 그대로 보여 준다', () => {
    renderResult()
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText(String(fixture.result.종합.점수))).toBeInTheDocument()
  })

  it('종합 점수를 백분위·순위로 설명하지 않는다 (관점 점수의 가중평균)', () => {
    renderResult()
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText('5대 관점 점수의 가중평균 · 인천 순위(백분위) 아님')).toBeInTheDocument()
    expect(overall).not.toHaveTextContent('행정동 대비 백분위')
    expect(overall).not.toHaveTextContent(/상위\s*\d/)
  })

  it('5대 관점을 고정 순서로, 점수를 숫자 텍스트로 보여 준다', () => {
    renderResult()
    const rows = perspectiveRows()
    expect(rows.map((r) => r.dataset.key)).toEqual(['market', 'customer', 'competition', 'location', 'stability'])
    rows.forEach((row, i) => {
      const ind = fixture.result.지표[i]!
      expect(within(row).getByText(PERSPECTIVE_LABELS[i]!)).toBeInTheDocument()
      expect(row).toHaveTextContent(`${ind.label}${ind.score!.toFixed(1)}점`)
    })
  })

  it('최고 관점과 병목 관점을 표시한다', () => {
    renderResult()
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
    renderResult()
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
    renderResult()
    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    expect(warnings.getByText('특별한 경고가 없습니다.')).toBeInTheDocument()
    expect(warnings.getByText(/상권 임대료\(소규모상가\)' 지표를 제외/)).toBeInTheDocument()
  })

  it('면책은 엔진 원문 그대로 항상 보인다', () => {
    renderResult()
    expect(screen.getByText(fixture.result.면책)).toBeInTheDocument()
  })

  it('관점 막대 범례는 50을 "인천 중앙"이 아니라 척도 중간으로 설명한다', () => {
    renderResult()
    const perspectives = screen.getByRole('region', { name: '5대 관점' })
    expect(within(perspectives).getByText('50 = 척도 중간 · 순위 아님')).toBeInTheDocument()
    expect(perspectives).not.toHaveTextContent('인천 중앙')
  })

  it('산출된 안정성에는 해상도 칩과 "시군구 단위 데이터로 계산" 안내를 붙인다', () => {
    renderResult()
    expect(FIXTURE.result.지표[4].score).not.toBeNull()
    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(within(stability).getByText('시군구 단위 데이터')).toBeInTheDocument()
    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    expect(warnings.getByText('안정성: 시군구 단위 데이터로 계산했습니다.')).toBeInTheDocument()
  })

  it('데이터 출처는 정규화_기준 한 줄 대신 관점별 비교 대상을 보여 준다', () => {
    renderResult()
    const sources = screen.getByRole('region', { name: '데이터 출처' })
    expect(sources).not.toHaveTextContent(fixture.result.meta.정규화_기준)
    const table = within(sources).getByRole('table', { name: '관점별 점수 비교 대상' })
    const row = (name: string) => within(table).getByRole('row', { name: new RegExp(`^${name}`) })
    expect(row('시장성')).toHaveTextContent('인천 11개 구')
    expect(row('고객성')).toHaveTextContent('인천 158개 행정동')
    expect(row('경쟁성')).toHaveTextContent(`지점 반경 ${fixture.result.meta.분석반경_m}m`)
    expect(row('입지성')).toHaveTextContent('점포 중심 지점')
    expect(row('안정성')).toHaveTextContent('3년 표본이 30건 이상인 인천 구')
    expect(sources).toHaveTextContent('인천 내 순위가 아닙니다')
  })
})

describe('AnalysisResult — 실제 /analyze 응답(부평역 · 네일숍): 안정성 미산출 + 병목 < 25', () => {
  // 웹 경로 캡처: 안정성 score null · coverage 0 · fallback incheon_avg · flag 해상도_저하__incheon_avg,
  // note "표본이 부족해 인천 전체 업종평균 단위로 계산했습니다." / 경쟁성 1.2 병목, 경고[0]은 "인천 하위 1%" 문장
  const analysis = AnalyzeResponseSchema.parse(nailShopFixture)
  const engineStability = analysis.result.지표[4]
  const NOT_COMPUTED = '세부지표 충족률 0%로 기준(50%)에 못 미쳐 점수를 내지 않았고, 종합점수에서 제외했습니다'

  it('fixture는 이 사례의 엔진 출력 형태다', () => {
    expect(engineStability).toMatchObject({ score: null, coverage: 0, fallback: 'incheon_avg' })
    expect(engineStability.flags).toContain('해상도_저하__incheon_avg')
    expect(engineStability.note).toContain('인천 전체 업종평균 단위로 계산했습니다')
    expect(analysis.result.종합.병목_지표).toBe('competition')
    expect(analysis.result.경고[0]).toContain('인천 하위')
  })

  it('미산출 안정성에 "인천 전체 업종평균" 칩·문구 대신 coverage 기반 안내를 보여 준다', () => {
    render(<AnalysisResult analysis={analysis} />)
    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(within(stability).getByText('데이터 없음')).toBeInTheDocument()
    expect(stability).toHaveTextContent(NOT_COMPUTED)
    expect(stability).not.toHaveTextContent('인천 전체 업종평균')

    const warnings = screen.getByRole('region', { name: '주의할 점' })
    expect(warnings).not.toHaveTextContent('인천 전체 업종평균')
    expect(warnings).not.toHaveTextContent('지표를 제외하고 계산했습니다')              // S4 제외 안내는 산출된 안정성에만
    expect(within(warnings).getByText(analysis.result.경고[1]!)).toBeInTheDocument()   // 엔진 "계산 불가 지표: 안정성 …" 원문
  })

  it('세부 분석에서도 미산출 안정성의 "계산했습니다" note 대신 coverage 기반 안내를 보여 준다', () => {
    render(<AnalysisResult analysis={analysis} />)
    fireEvent.click(screen.getByRole('button', { name: /^안정성/ }))
    expect(screen.queryByText(engineStability.note)).not.toBeInTheDocument()
    expect(screen.getAllByText(NOT_COMPUTED)).toHaveLength(2)                         // 막대 행 + 세부 분석
    expect(screen.getByText('계산 단위').nextSibling).toHaveTextContent('산출하지 않음')
  })

  it('병목 경고는 순위 표현 없이 점수·기준·위험 안내로 보여 주고, 나머지 엔진 경고는 원문 그대로 둔다', () => {
    render(<AnalysisResult analysis={analysis} />)
    const competition = perspectiveRows().find((r) => r.dataset.key === 'competition')!
    expect(within(competition).getByText('병목')).toBeInTheDocument()

    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    expect(
      warnings.getByText(
        '경쟁성 점수가 1.2점으로 병목 기준(25점 미만)에 해당합니다. 종합 점수와 별개로 이 관점이 실제 위험 요인일 수 있습니다.',
      ),
    ).toBeInTheDocument()
    expect(warnings.queryByText(analysis.result.경고[0]!)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '주의할 점' })).not.toHaveTextContent('하위')
    for (const text of analysis.result.경고.slice(1)) expect(warnings.getByText(text)).toBeInTheDocument()
  })

  it('경고[0]이 병목 문장이 아니면(엔진 계약과 다르면) 원문을 바꾸지 않는다', () => {
    const reordered = AnalyzeResponseSchema.parse({
      ...nailShopFixture,
      result: { ...nailShopFixture.result, 경고: [...nailShopFixture.result.경고].reverse() },
    })
    render(<AnalysisResult analysis={reordered} />)
    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    for (const text of reordered.result.경고) expect(warnings.getByText(text)).toBeInTheDocument()
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
    // 펼친 패널 안의 관점 설명 버튼("안정성은 무엇을 보나요")과 구분한다
    expect(screen.getByRole('button', { name: /^안정성(?!은 무엇을 보나요)/ })).toHaveTextContent('데이터 없음')
  })

  it('커버리지 부족으로 미산출된 안정성은 엔진 note 대신 실제 충족률(15%)로 안내한다', () => {
    expect(analysis.result.지표[4].coverage).toBe(0.15)
    render(<AnalysisResult analysis={analysis} />)
    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(stability).toHaveTextContent('세부지표 충족률 15%로 기준(50%)에 못 미쳐')
    expect(stability).not.toHaveTextContent('인천 전체 업종평균')
  })

  it('병목 < 25는 warning 톤 "병목"과, 병목 문장을 뺀 엔진 경고 원문을 보여 준다', () => {
    render(<AnalysisResult analysis={analysis} />)
    const competition = perspectiveRows().find((r) => r.dataset.key === 'competition')!
    expect(within(competition).getByText('병목')).toBeInTheDocument()

    const warnings = within(screen.getByRole('region', { name: '주의할 점' }))
    expect(warnings.getByText(/^경쟁성 점수가 1\.2점으로 병목 기준\(25점 미만\)에 해당합니다/)).toBeInTheDocument()
    for (const text of analysis.result.경고.slice(1)) expect(warnings.getByText(text)).toBeInTheDocument()
  })
})
