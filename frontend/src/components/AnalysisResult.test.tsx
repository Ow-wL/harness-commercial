import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang.json'
import nailShopFixture from '../fixtures/bupyeong-nailshop.json'
// 루트 golden을 그 자리에서 읽는다 (frontend로 복사하지 않는다)
import nailShopGolden from '../../../tests/golden/v0.3/json/full_네일숍.json'
import { AnalysisResult } from './AnalysisResult.tsx'
import { EVIDENCE_TAB, getInTab, openTab } from '../test/tabs.ts'
import { DISCLAIMER_NOTE, SERVICE_DISCLAIMER } from './DataSources.tsx'

/** 실제 backend POST /analyze 응답 캡처(부평역 좌표 · PC방)를 schema 검증 후 결과 화면에 넣는다 */
const FIXTURE = AnalyzeResponseSchema.parse(fixture)

function renderResult() {
  render(<AnalysisResult analysis={FIXTURE} />)
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

  it('머리: 행정동 이름이 제목, 보조 정보는 최근접역 직선거리, 좌표는 두지 않는다 (DESIGN.md §8.5·§8.5a, A3 — 조건 바는 App)', () => {
    renderResult()
    expect(screen.getByRole('heading', { level: 1, name: '부평구 부평1동 · PC방 분석' })).toBeInTheDocument()
    const sub = document.querySelector<HTMLElement>('.result__sub')!
    expect(sub).toHaveTextContent('부평역까지 직선거리 85m')
    expect(sub).not.toHaveTextContent('37.4894')
    expect(document.querySelector('.result__head')).not.toHaveTextContent('37.4894')
  })

  it('역 정보가 없으면 머리의 보조 정보(최근접역)를 생략한다', () => {
    const r = structuredClone(FIXTURE)
    Object.assign(r.result.지표[3].raw, { 최근접역: null, 최근접역_거리m: null })
    render(<AnalysisResult analysis={r} />)
    expect(document.querySelector('.result__sub')).not.toHaveTextContent('직선거리')
  })

  it('업종코드는 데이터 출처(출처·방법)에 둔다 (UX_REDESIGN 2.5 — Context Bar에서 옮김)', () => {
    renderResult()
    expect(getInTab(EVIDENCE_TAB, 'region', { name: '데이터 출처' })).toHaveTextContent('업종코드 R10406')
  })

  it('종합 점수를 fixture 값 그대로 보여 준다', () => {
    renderResult()
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText(String(fixture.result.종합.점수))).toBeInTheDocument()
  })

  it('종합 점수를 백분위·순위로 설명하지 않는다 (관점 점수의 가중평균)', () => {
    renderResult()
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(within(overall).getByText('다섯 관점 가중평균 · 순위 아님')).toBeInTheDocument()
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
    // 8-C1b: 막대 아래 짧은 라벨 "가장 높음" / "가장 낮음"(병목 30.2 ≥ 25 → 중립, DESIGN.md §8.3)
    expect(within(customer).getByText('가장 높음')).toBeInTheDocument()
    expect(within(competition).getByText('가장 낮음')).toBeInTheDocument()

    // A3: 종합 점수 옆 "가장 강한 관점·병목" 요약은 헤드라인과 겹쳐 뺐다 — 헤드라인이 같은 사실을 말한다
    const summary = screen.getByRole('region', { name: '종합 적합도' })
    expect(summary).not.toHaveTextContent('가장 강한 관점')
    expect(document.querySelector('.result__headline')).toHaveTextContent('고객성이 가장 높고, 경쟁성이 가장 낮습니다')
  })

  it('관점 행을 누르면 상세 근거 탭의 그 관점을 펼치고 그 제목으로 포커스가 간다 (A3)', () => {
    renderResult()
    fireEvent.click(within(perspectiveRows()[4]!).getByRole('button'))
    expect(screen.getByRole('tab', { name: '상세 근거' })).toHaveAttribute('aria-selected', 'true')
    const toggle = document.getElementById('detail-toggle-stability')!
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.activeElement).toBe(toggle)
  })

  it('세부 분석은 기본 접힘이고, 버튼으로 열면 breakdown이 보인다', () => {
    renderResult()
    openTab(EVIDENCE_TAB)
    const toggle = document.getElementById('detail-toggle-stability')!
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
    fireEvent.click(getInTab(EVIDENCE_TAB, 'button', { name: '원시값 보기' }))
    expect(screen.getByText('인천_업종평균_3년생존율')).toBeInTheDocument()
  })

  it('엔진 경고가 없으면 "특별한 경고가 없습니다"와 데이터 한계를 접지 않고 보여 준다', () => {
    renderResult()
    const warnings = within(getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' }))
    expect(warnings.getByText('특별한 경고가 없습니다.')).toBeInTheDocument()
    expect(warnings.getByText(/상권 임대료\(소규모상가\)' 지표를 제외/)).toBeInTheDocument()
  })

  it('면책: 요약에는 서비스 고정 문장(§19.6 P1), 엔진 면책 원문은 바꾸지 않고 데이터 출처에 라벨과 함께', () => {
    renderResult()
    expect(screen.getByText(SERVICE_DISCLAIMER)).toBeVisible()
    const sources = getInTab(EVIDENCE_TAB, 'region', { name: '데이터 출처' })
    expect(within(sources).getByRole('heading', { name: '엔진 면책 원문(mvp-0.3)' })).toBeInTheDocument()
    expect(within(sources).getByText(fixture.result.면책)).toBeInTheDocument()
    // 12-4: 원문 "상대 순위"가 요약의 "순위가 아닙니다"와 충돌하지 않게 원문 아래 화면 주석 한 줄 (원문 불변)
    expect(fixture.result.면책).toContain('상대 순위')
    expect(within(sources).getByText(DISCLAIMER_NOTE)).toBeInTheDocument()
  })

  it('관점 막대 범례는 50을 "인천 중앙"이 아니라 척도 중간으로 설명한다', () => {
    renderResult()
    const perspectives = screen.getByRole('region', { name: '5대 관점' })
    expect(within(perspectives).getByText('막대의 50은 0~100 척도의 중간이며 순위가 아닙니다.')).toBeInTheDocument()
    expect(perspectives).not.toHaveTextContent('인천 중앙')
  })

  it('산출된 안정성의 해상도는 근거 줄 끝 자료 단위 칩 "구 단위" 한 번 — 행 chip·주의할 점 해상도 줄은 없다 (8-C1b, 12-18)', () => {
    renderResult()
    expect(FIXTURE.result.지표[4].score).not.toBeNull()
    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(stability.querySelector('.perspective__evidence-text')).toHaveTextContent('3년 생존율 52.3%')
    expect(stability.querySelector('.perspective__unit')).toHaveTextContent('구 단위')
    expect(stability).not.toHaveTextContent('시군구 단위 데이터')
    const warnings = getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' })
    expect(warnings).not.toHaveTextContent('단위 데이터로 계산했습니다')
  })

  it('고정 기준선 55.2%는 근거 줄의 "인천 업종평균"이 아니라 상세 근거 계산 기준에 출처·한계와 함께 보인다 (12-16)', () => {
    renderResult()
    const stability = perspectiveRows().find((r) => r.dataset.key === 'stability')!
    expect(stability).not.toHaveTextContent('업종평균')
    openTab(EVIDENCE_TAB)
    const toggle = document.getElementById('detail-toggle-stability')!
    fireEvent.click(toggle)
    const panel = toggle.closest('.detail')!
    expect(panel).toHaveTextContent('참고 기준선 55.2%')
    expect(panel).toHaveTextContent('업종 구분이 없어 이 업종의 인천 평균이 아닙니다')
    expect(panel).toHaveTextContent('점수 계산에는 쓰지 않습니다')
    expect(FIXTURE.result.지표[4].raw.인천_업종평균_3년생존율).toBe(0.552)   // 엔진 고정값 C_BASELINE_SURVIVAL_3Y
  })

  it('데이터 출처는 정규화_기준 한 줄 대신 관점별 비교 대상을 보여 준다', () => {
    renderResult()
    const sources = getInTab(EVIDENCE_TAB, 'region', { name: '데이터 출처' })
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

    const warnings = getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' })
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

    const warnings = within(getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' }))
    expect(
      warnings.getByText(
        '경쟁성 점수가 1.2점으로 병목 기준(25점 미만)에 해당합니다. 종합 점수와 별개로 이 관점이 실제 위험 요인일 수 있습니다.',
      ),
    ).toBeInTheDocument()
    expect(warnings.queryByText(analysis.result.경고[0]!)).not.toBeInTheDocument()
    expect(getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' })).not.toHaveTextContent('하위')
    for (const text of analysis.result.경고.slice(1)) expect(warnings.getByText(text)).toBeInTheDocument()
  })

  it('경고[0]이 병목 문장이 아니면(엔진 계약과 다르면) 원문을 바꾸지 않는다', () => {
    const reordered = AnalyzeResponseSchema.parse({
      ...nailShopFixture,
      result: { ...nailShopFixture.result, 경고: [...nailShopFixture.result.경고].reverse() },
    })
    render(<AnalysisResult analysis={reordered} />)
    const warnings = within(getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' }))
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

    const warnings = within(getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' }))
    expect(warnings.getByText(/^경쟁성 점수가 1\.2점으로 병목 기준\(25점 미만\)에 해당합니다/)).toBeInTheDocument()
    for (const text of analysis.result.경고.slice(1)) expect(warnings.getByText(text)).toBeInTheDocument()
  })
})

describe('AnalysisResult — 헤드라인·주의 요약 띠 (8-C1a)', () => {
  it('A3 머리 순서: 제목 → 종합 점수 → 헤드라인 → 띠(부평역 PC방: 학교 0곳 1줄) → 탭', () => {
    renderResult()
    const title = screen.getByRole('heading', { level: 1 })
    const head = document.querySelector<HTMLElement>('.result__headline')!
    expect(head).toHaveTextContent('고객성이 가장 높고, 경쟁성이 가장 낮습니다')
    const band = screen.getByRole('region', { name: '주의 요약' })
    fireEvent.click(band.querySelector('summary')!)
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    const tabs = screen.getByRole('tablist', { name: '결과 보기' })
    expect(title.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(overall.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(head.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const links = within(band).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('안내: 학교 주변 규제 업종 · 300m 안 초·중·고 0곳')
    expect(links[0]).toHaveAttribute('href', '#access-title')
  })

  it('띠 줄을 누르면 그 섹션 제목으로 포커스가 옮겨 간다', () => {
    renderResult()
    const band = screen.getByRole('region', { name: '주의 요약' })
    fireEvent.click(band.querySelector('summary')!)
    fireEvent.click(within(band).getByRole('link'))
    expect(document.activeElement).toBe(document.getElementById('access-title'))
  })

  it('부평역 네일숍: 병목 → 미산출 → 기타 3줄, 주의할 점 섹션 문장은 그대로', () => {
    render(<AnalysisResult analysis={AnalyzeResponseSchema.parse(nailShopFixture)} />)
    const band = screen.getByRole('region', { name: '주의 요약' })
    fireEvent.click(band.querySelector('summary')!)
    expect(within(band).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual([
      '경고: 경쟁성 1.2점 · 병목 기준(25점 미만) — 종합과 별개 위험 요인',
      '경고: 안정성 미산출 · 종합에서 제외 · 자료 등급 낮음',
      '경고: 네일숍 제도 진입장벽 높음: 본인 미용사(네일) 면허 필요.',
    ])
    const warnings = getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' })
    expect(warnings).toHaveTextContent('계산 불가 지표: 안정성')               // 원문은 섹션에 그대로
  })
})

describe('AnalysisResult — 근거 줄·행 chip 통합·충족 1줄 (8-C1b, docs/UX_REDESIGN.md 2.5)', () => {
  const rowOf = (key: string) => perspectiveRows().find((r) => r.dataset.key === key)!
  /** 충족 1줄 조각(구분 "·"은 CSS 장식이라 글자에 없다) */
  const coverageItems = () =>
    [...document.querySelectorAll('.coverage .coverage__item')].map((el) => el.textContent)

  it('삭제: "시군구 단위 데이터"·"가장 강한 관점"·"가장 낮은 관점" chip, 충족 줄의 신뢰도 개수·"신뢰도 낮은 관점 있음"', () => {
    renderResult()
    const perspectives = screen.getByRole('region', { name: '5대 관점' })
    for (const gone of ['시군구 단위 데이터', '가장 강한 관점', '가장 낮은 관점']) {
      expect(perspectives).not.toHaveTextContent(gone)
    }
    expect(document.querySelector('.coverage')).not.toHaveTextContent('신뢰도')
  })

  it('유지·합침: 막대 아래 한 줄 = 짧은 라벨 + 근거 줄(raw), 해상도는 줄 끝 "· 구 단위"', () => {
    renderResult()
    expect(rowOf('customer').querySelector('.perspective__evidence')).toHaveTextContent(
      '가장 높음타겟 연령 거주 5,290명 · 비중 15.4%',
    )
    expect(rowOf('competition').querySelector('.perspective__evidence')).toHaveTextContent(
      '가장 낮음반경 500m PC방 12곳 · 점포당 잠재수요 4,433명',
    )
    expect(rowOf('market').querySelector('.perspective__evidence-text')).toHaveTextContent('부평구 하루 유입 679,748명')
    expect(rowOf('location').querySelector('.perspective__evidence-text')).toHaveTextContent('부평역까지 직선거리 85m')
  })

  it('"확인 필요" 한 줄(12-20): 종합 점수 아래, 이 결과의 빠진 자료·공간 단위를 규칙 문장으로', () => {
    renderResult()
    const gaps = document.querySelector('.result__head .gaps')!
    expect(gaps).toHaveTextContent('확인 필요')
    expect([...gaps.querySelectorAll('.gaps__item')].map((el) => el.textContent)).toEqual([
      '임대료 미반영',
      '유입·생존율은 구 단위 자료',
      '잠재수요는 거주 인구만(방문객 유동 없음)',
    ])
  })

  it('자료 단위 칩(12-18): 산출된 관점마다 근거 줄 끝에 상시 — 구 단위·행정동 단위·반경·지점 좌표', () => {
    renderResult()
    const unitOf = (key: string) => rowOf(key).querySelector('.perspective__unit')?.textContent ?? null
    expect(['market', 'customer', 'competition', 'location', 'stability'].map(unitOf)).toEqual([
      '구 단위',
      '행정동 단위',
      '반경 500m',
      '지점 좌표',
      '구 단위',
    ])
    // 스크린리더: 숫자 뒤에 칩이 바로 붙지 않게 숨은 구분말 — "… 679,748명 · 자료 단위 구 단위"
    expect(rowOf('market').querySelector('.perspective__evidence')).toHaveTextContent('679,748명 · 자료 단위 구 단위')
  })

  it('자료 단위 칩: 미산출 관점에는 없고, v0.5 반경 배분 인구는 "반경 500m 추정"', () => {
    render(<AnalysisResult analysis={AnalyzeResponseSchema.parse(nailShopFixture)} />)
    expect(rowOf('stability').querySelector('.perspective__unit')).toBeNull()
    document.body.innerHTML = ''
    const v05 = structuredClone(FIXTURE)
    Object.assign(v05.result.지표[1].raw, { 인구_기준: '반경 500m 배분' })         // 표시 테스트 전용 변형(v0.5 raw)
    render(<AnalysisResult analysis={v05} />)
    expect(rowOf('customer').querySelector('.perspective__unit')).toHaveTextContent('반경 500m 추정')
  })

  it('충족 1줄(12-17): "관점 5/5 산출 · 세부지표 없음 4: … · 가중치 기본(목적방문형) · 진입장벽 중간" — "데이터 충족 100%"는 쓰지 않는다', () => {
    renderResult()
    expect(coverageItems()).toEqual([
      '관점 5/5 산출',
      '세부지표 없음 4: 업종 소비 증감, 최근 1년 순증감, 버스정류장 밀도, 상권 임대료(소규모상가)',
      '가중치 기본(목적방문형)',
      '진입장벽 중간',
    ])
    expect(document.querySelector('.coverage')).not.toHaveTextContent('데이터 충족')
    expect(document.querySelector('.coverage')).not.toHaveTextContent('100%')
  })

  it('부평역 네일숍: 병목 chip은 유지(경고 톤) + 근거 줄, 미산출 안정성은 근거 줄 없이 미산출 안내만', () => {
    render(<AnalysisResult analysis={AnalyzeResponseSchema.parse(nailShopFixture)} />)
    const competition = rowOf('competition')
    expect(within(competition).getByText('병목')).toBeInTheDocument()
    expect(competition).toHaveTextContent('반경 500m 네일숍 125곳 · 점포당 잠재수요 426명')
    const stability = rowOf('stability')
    expect(stability.querySelector('.perspective__evidence-text')).toBeNull()
    expect(stability).toHaveTextContent('점수를 내지 않았고, 종합점수에서 제외했습니다')
    // 미산출 안정성의 세부지표 4개는 "관점 4/5"에 이미 드러나므로 목록에 넣지 않는다. 가중치 기준 비율은 관점이 빠졌을 때만
    expect(coverageItems()).toEqual([
      '관점 4/5 산출(가중치 기준 80%)',
      '세부지표 없음 3: 업종 소비 증감, 최근 1년 순증감, 버스정류장 밀도',
      '가중치 기본(고객밀착형)',
      '진입장벽 높음',
    ])
  })

  it('"자료 등급 낮음" chip은 유지한다(산출된 관점, 표시 테스트 전용 변형) — 12-18: 신뢰도 → 자료 등급', () => {
    const r = structuredClone(FIXTURE)
    ;(r.result.지표[0] as { confidence: string }).confidence = 'low'
    render(<AnalysisResult analysis={r} />)
    expect(within(rowOf('market')).getByText('자료 등급 낮음')).toBeInTheDocument()
    expect(within(rowOf('market')).queryByText('신뢰도 낮음')).toBeNull()
    expect(rowOf('market').querySelector('.perspective__evidence-text')).toHaveTextContent('부평구 하루 유입 679,748명')
    expect(rowOf('market').querySelector('.perspective__unit')).toHaveTextContent('구 단위')
  })

  it('사용자 가중치면 충족 줄에 출처 원문(표시 테스트 전용 변형)', () => {
    const r = structuredClone(FIXTURE)
    ;(r.result.종합 as { 가중치_출처: string }).가중치_출처 = '사용자(중요도 1~5)'
    render(<AnalysisResult analysis={r} />)
    expect(coverageItems()[2]).toBe('가중치 사용자(중요도 1~5)')   // 12-17: [관점 산출, 세부지표 없음, 가중치, 진입장벽]
  })
})

describe('AnalysisResult — 8-C1d 한글화·[이 점수는?]', () => {
  it('상세 근거: 계산 단위는 화면 말("구 단위"), 특이사항은 한글 라벨 + 설명, 해상도 flag는 빼고 원문은 원시값 보기에 그대로', () => {
    renderResult()
    openTab(EVIDENCE_TAB)
    fireEvent.click(document.getElementById('detail-toggle-market')!)
    const panel = document.getElementById('detail-toggle-market')!.closest('.detail')!
    expect(panel).toHaveTextContent('계산 단위구 단위')
    expect(panel).not.toHaveTextContent('gugu')
    const flags = within(panel as HTMLElement).getByRole('heading', { name: '특이사항' }).parentElement!
    expect(flags).toHaveTextContent('영업시간대 유입 집중 — 24시간 균등 기준(1.0) 대비 값이라 인천 대부분 구에서 붙습니다')
    expect(flags).not.toHaveTextContent('해상도')
    expect(flags).not.toHaveTextContent('영업시간대_유입_집중')
    fireEvent.click(within(panel as HTMLElement).getByRole('button', { name: '원시값 보기' }))
    const raw = within(panel as HTMLElement).getByRole('table', { name: '원시값' })
    expect(within(raw).getByRole('row', { name: /^fallback/ })).toHaveTextContent('gugu')
    expect(within(raw).getByRole('row', { name: /^flags/ })).toHaveTextContent('영업시간대_유입_집중, 해상도_시군구')
  })

  it('[이 점수는?]는 접혀 있고, 펼치면 "가장 높음·낮음"의 뜻이 첫 줄, 가중평균·순위 아님, 예측 아님 3항목', () => {
    renderResult()
    const toggle = screen.getByRole('button', { name: '이 점수는?' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const items = within(screen.getByRole('list', { name: '이 점수는?' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('이 위치에서 산출한 관점 점수끼리 비교한 표현입니다. 다른 위치와 비교한 순위가 아닙니다.')
    expect(items[1]).toHaveTextContent('종합 적합도는 산출된 관점 점수에 적용 가중치를 반영한 가중평균입니다. 인천 내 순위나 "상위 N%"가 아닙니다.')
    expect(items[1]).not.toHaveTextContent(/다섯 관점|업종 그룹 가중치/)   // 부분 미산출·사용자 가중치에서도 맞는 표현
    expect(items[2]).toHaveTextContent('창업 성공 확률이나 매출·수익을 예측하지 않습니다')
    expect(toggle).toHaveAttribute('aria-controls', screen.getByRole('list', { name: '이 점수는?' }).id)
  })
})
