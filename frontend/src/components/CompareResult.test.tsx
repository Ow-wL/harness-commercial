import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema, type AnalyzeResponse } from '../api/schemas.ts'
import bupyeongFixture from '../fixtures/bupyeong-pcbang.json'
import bupyeong1bFixture from '../fixtures/compare-bupyeong1b-pcbang.json'
import ganghwaFixture from '../fixtures/compare-ganghwa-pcbang.json'
import guwolFixture from '../fixtures/compare-guwol-pcbang.json'
import songdoFixture from '../fixtures/compare-songdo-pcbang.json'
import { brokenControls, brokenReferences, duplicateIds, expandAll } from '../test/a11yRefs.ts'
import { CompareResult } from './CompareResult.tsx'
import { EVIDENCE_TAB, getInTab, openTab, queryInTab } from '../test/tabs.ts'

// 실제 POST /analyze 응답 (모두 PC방, docs/COMPARE_DESIGN.md 10.1)
const A = AnalyzeResponseSchema.parse(bupyeongFixture)            // 부평구 부평1동
const SAME_DONG = AnalyzeResponseSchema.parse(bupyeong1bFixture)  // 부평구 부평1동, A와 약 322m
const OTHER_GU = AnalyzeResponseSchema.parse(guwolFixture)        // 남동구 구월3동
const NO_STABILITY = AnalyzeResponseSchema.parse(ganghwaFixture)  // 강화군 강화읍: 안정성 미산출
const NO_COMPETITION = AnalyzeResponseSchema.parse(songdoFixture) // 연수구 송도2동: 동종 점포 0곳 → 경쟁성 미산출

function renderCompare(a: AnalyzeResponse, b: AnalyzeResponse) {
  const handlers = { onShowDetail: vi.fn(), onReselect: vi.fn(), onEnd: vi.fn(), onChangeConditions: vi.fn(), onShowMap: vi.fn() }
  const view = render(<CompareResult a={a} b={b} {...handlers} />)
  return { ...view, ...handlers }
}

const scoreTable = () => getInTab(EVIDENCE_TAB, 'table', { name: /종합·5대 관점 점수 비교/ })
/** 표 행 → [항목, A, B, 차이] 텍스트 */
const rows = () =>
  within(scoreTable())
    .getAllByRole('row')
    .slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent))
const rowOf = (label: string) => rows().find(([head]) => head!.startsWith(label))!

/** 위치의 우열·순위를 단정하는 표현 (올바른 설명 "순위가 아닙니다"·"판정이 아닙니다"는 허용) */
const ASSERTIVE = /(A|B)(가|이|는)? ?(더 (좋|낫|유리|우수)|우세)|유리합니다|불리합니다|추천합니다|\d+위\b|상위 \d+%|하위 \d+%|승리|이겼/

describe('CompareResult — 점수 비교 표', () => {
  it('종합 → 5대 관점 순서, 엔진 값 그대로, 표시용 차이(A−B)는 중립 표기', () => {
    renderCompare(A, OTHER_GU)
    expect(within(scoreTable()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '항목',
      'A부평1동',
      'B구월3동',
      '표시용 차이 (A−B)',
    ])
    expect(rows().map(([head]) => head!.slice(0, 3))).toEqual(['종합5', '시장성', '고객성', '경쟁성', '입지성', '안정성'])
    expect(rowOf('종합').slice(1)).toEqual(['65.8', '59.1', '+6.7A에서 B를 뺀 값 플러스 6.7'])
    expect(rowOf('시장성').slice(1)).toEqual(['61.6', '68.7', '−7.1A에서 B를 뺀 값 마이너스 7.1'])
    // 위치 안의 사실(병목·가장 강한 관점)만 붙는다. 병목 24.4 < 25 → warning 톤
    expect(rowOf('경쟁성')[1]).toBe('30.2주의')
    expect(rowOf('경쟁성')[2]).toBe('24.4주의')
    expect(within(scoreTable()).getAllByText('주의')[1]).toHaveClass('compare-table__tag--warn')
    expect(rowOf('고객성')[1]).toBe('82.8가장 강한 관점')
    // 해상도(단위)
    expect(rowOf('시장성')[0]).toBe('시장성구')
    expect(rowOf('경쟁성')[0]).toBe('경쟁성반경 500m')
    // 계산 구성이 같으면 각주·†가 없다
    expect(screen.queryByText(/^† /)).not.toBeInTheDocument()
    expect(scoreTable()).not.toHaveTextContent('†')
  })

  it('미산출은 0으로 바꾸지 않고 "미산출", 차이는 계산하지 않는다 (안정성 미산출)', () => {
    renderCompare(A, NO_STABILITY)
    const [, a, b, diff] = rowOf('안정성')
    expect(a).toBe('73.2')
    expect(b).toBe('미산출')
    expect(diff).toBe('—미산출이라 계산하지 않음')
    expect(scoreTable()).not.toHaveTextContent(/안정성[^]*\b0\.0\b/)
  })

  it('종합 계산 구성이 다르면 종합 차이에 †와 설명(각주 연결)을 붙인다', () => {
    renderCompare(A, NO_STABILITY)
    const overallDiff = within(scoreTable()).getAllByRole('row')[1]!.querySelectorAll('td')[2]!
    expect(overallDiff).toHaveTextContent('†')
    const note = document.getElementById(overallDiff.getAttribute('aria-describedby')!)!
    expect(note).toHaveTextContent(
      '† 두 종합 점수의 계산 구성이 다릅니다. A는 시장성·고객성·경쟁성·입지성·안정성 5개 관점, B는 시장성·고객성·경쟁성·입지성 4개 관점의 가중평균입니다',
    )
    // 관점 행에는 †가 없다
    expect(rowOf('안정성')[3]).not.toContain('†')
  })

  it('두 위치 모두 4개 관점이어도 구성이 다르면 †를 붙인다 (안정성 미산출 vs 경쟁성 미산출)', () => {
    renderCompare(NO_STABILITY, NO_COMPETITION)
    expect(rowOf('종합')[3]).toContain('†')
    expect(screen.getByText(/^† /)).toHaveTextContent(
      'A는 시장성·고객성·경쟁성·입지성 4개 관점, B는 시장성·고객성·입지성·안정성 4개 관점',
    )
    expect(rowOf('안정성').slice(1, 3)).toEqual(['미산출', '41.2주의'])           // 송도2동의 병목은 안정성
    expect(rowOf('경쟁성').slice(1, 3)).toEqual(['37.4', '미산출'])
  })
})

describe('CompareResult — 해석 안내', () => {
  it('같은 동: 같은 구·동 안내, 행별 "같은 구/동 데이터", 반경 겹침(322m)', () => {
    renderCompare(A, SAME_DONG)
    expect(screen.getByText(/^두 위치가 같은 행정동\(부평구 부평1동\)에 있습니다/)).toHaveTextContent(
      '시장성·안정성은 구 단위, 고객성은 행정동 단위 데이터라 두 위치 점수가 같습니다. 이 비교에서 위치 차이는 경쟁성(반경 500m)과 입지성(좌표)에만 나타납니다.',
    )
    expect(rowOf('시장성')[0]).toBe('시장성구 · 같은 구 데이터')
    expect(rowOf('고객성')[0]).toBe('고객성행정동 · 같은 동 데이터')
    expect(rowOf('안정성')[0]).toBe('안정성구 × 업종 · 같은 구 데이터')
    expect(rowOf('경쟁성')[0]).toBe('경쟁성반경 500m')
    expect(rowOf('고객성')[3]).toMatch(/^0\.0/)                    // 같은 동이라 실제로 같다
    expect(screen.getByText(/^두 분석 반경이 겹칩니다/)).toHaveTextContent('A–B 직선거리 322m')
  })

  it('다른 구: 같은 구·동 안내와 반경 겹침 안내가 없다', () => {
    renderCompare(A, OTHER_GU)
    expect(screen.queryByText(/^두 위치가 같은/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^두 분석 반경이 겹칩니다/)).not.toBeInTheDocument()
    expect(scoreTable()).not.toHaveTextContent('같은 구 데이터')
  })

  it('미산출·데이터 차이: 실제 미산출 관점과 충족률로 위치별 안내 (경쟁성 0곳은 0곳 이유)', () => {
    renderCompare(A, NO_COMPETITION)
    const section = getInTab(EVIDENCE_TAB, 'region', { name: '미산출·데이터 차이' })
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'B 연수구 송도2동: 경쟁성 미산출 — 반경 500m 안에 같은 업종 점포가 없어 점수를 내지 않았고, 종합점수에서 제외했습니다',
      '점수를 낸 관점의 가중치 비율: A 100% · B 78%',
    ])
  })

  it('모두 산출되고 충족률이 같으면 미산출 섹션을 두지 않는다', () => {
    renderCompare(A, OTHER_GU)
    expect(queryInTab(EVIDENCE_TAB, 'region', { name: '미산출·데이터 차이' })).not.toBeInTheDocument()
  })

  it('주의할 점은 위치별로: 병목 문장은 표시용 문장, 그 밖의 엔진 경고·데이터 한계는 그대로', () => {
    renderCompare(A, OTHER_GU)
    const warnings = getInTab(EVIDENCE_TAB, 'region', { name: '주의할 점' })
    const a = within(warnings).getByRole('region', { name: 'A 부평구 부평1동' })
    const b = within(warnings).getByRole('region', { name: 'B 남동구 구월3동' })
    expect(a).toHaveTextContent('특별한 경고가 없습니다.')
    expect(b).toHaveTextContent('경쟁성 점수가 24.4점으로 주의 기준(25점 미만)에 해당합니다.')
    expect(b).not.toHaveTextContent('인천 하위')
    expect(b).toHaveTextContent('PC방은(는) 학교 주변 입지 규제 업종이고, 이 지점 300m 안에 초·중·고 1곳이 있습니다.')
    expect(within(b).getByRole('heading', { level: 4, name: '데이터 한계' })).toBeInTheDocument()
    expect(b).toHaveTextContent('지표를 제외하고 계산했습니다')                      // 임대료 제외 줄은 그대로
    expect(b).not.toHaveTextContent('단위 데이터로 계산했습니다')                  // 해상도 줄은 근거 줄로 옮김(8-C1b)
  })

  it('어느 사례에서도 위치의 우열·순위를 단정하는 표현이 없다', () => {
    for (const [a, b] of [
      [A, OTHER_GU],
      [A, SAME_DONG],
      [A, NO_STABILITY],
      [A, NO_COMPETITION],
      [NO_STABILITY, NO_COMPETITION],
    ] as const) {
      const { container, unmount } = renderCompare(a, b)
      expandAll(container)
      expect(container.textContent).not.toMatch(ASSERTIVE)
      expect(container).toHaveTextContent('어느 위치가 낫다는 판정이 아닙니다')   // 올바른 설명은 있다
      expect(container).toHaveTextContent('작은 원시값 차이도 백분위 차이로 크게 나타날 수 있습니다')
      expect(container).toHaveTextContent('적용 가중치에 따라 달라지므로, 원시값도 함께 확인하세요')
      expect(container.textContent).not.toMatch(/\d+~\d+점이 달라|점 단위로 끊/)   // 관점 점수를 고정 폭으로 끊어 말하지 않는다
      unmount()
    }
  })
})

describe('CompareResult — 원시값·출처', () => {
  it('원시값 표는 접혀 있고, 펼치면 없는 키("해당 없음")와 null("데이터 없음")을 구분한다', () => {
    renderCompare(A, NO_COMPETITION)
    const toggle = getInTab(EVIDENCE_TAB, 'button', { name: '원시값 보기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: '핵심 원시값 표' })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    const region = screen.getByRole('region', { name: '핵심 원시값 표' })
    expect(toggle).toHaveAttribute('aria-controls', region.id)
    const row = (label: string) =>
      [...within(region).getByRole('rowheader', { name: label }).closest('tr')!.querySelectorAll('td')].map((c) => c.textContent)
    expect(row('반경 안 같은 업종 점포 수')).toEqual(['12곳', '0곳'])             // 0곳은 엔진이 낸 실제 값
    expect(row('같은 업종 비중')).toEqual(['0.4%', '해당 없음'])                 // 0곳 응답에는 키가 없다
    expect(row('점포당 잠재수요')).toEqual(['4,433명', '데이터 없음'])            // null
    expect(within(region).getAllByRole('rowheader', { name: /경쟁성 · 반경 500m/ })).toHaveLength(1)
  })

  it('데이터 출처는 한 번만 (#data-sources)', () => {
    renderCompare(A, OTHER_GU)
    expect(document.querySelectorAll('#data-sources')).toHaveLength(1)
    openTab(EVIDENCE_TAB)                                                     // 상세 근거 탭 안(A3)
    expect(screen.getAllByRole('region', { name: '데이터 출처' })).toHaveLength(1)
  })

  it('id는 유일하고 접근성 참조가 모두 이어진다 (접힌 영역은 펼친 뒤 aria-controls 검사)', () => {
    for (const [a, b] of [
      [A, SAME_DONG],
      [A, NO_STABILITY],
      [NO_STABILITY, NO_COMPETITION],
    ] as const) {
      const { container, unmount } = renderCompare(a, b)
      expect(duplicateIds()).toEqual([])
      expect(brokenReferences()).toEqual([])
      expandAll(container)
      expect(container.querySelectorAll('[aria-expanded="false"][aria-controls]')).toHaveLength(0)
      expect(duplicateIds()).toEqual([])
      expect(brokenReferences()).toEqual([])
      expect(brokenControls()).toEqual([])
      unmount()
    }
  })

  it('A/B 위치 줄을 누르면 그 위치 전체 결과로 (A3 — "B 다시 고르기"는 조건 바, 전체 결과 버튼은 패널 아래 App)', () => {
    const { onShowDetail } = renderCompare(A, OTHER_GU)
    fireEvent.click(within(screen.getByRole('region', { name: 'B 비교 위치' })).getByRole('button', { name: /전체 결과로/ }))
    expect(onShowDetail).toHaveBeenCalledWith('B')
    fireEvent.click(within(screen.getByRole('region', { name: 'A 기준 위치' })).getByRole('button', { name: /전체 결과로/ }))
    expect(onShowDetail).toHaveBeenCalledWith('A')
    expect(screen.getByRole('region', { name: 'B 비교 위치' })).toHaveTextContent('59.1')
    expect(screen.queryByRole('button', { name: /다시 고르기/ })).toBeNull()
  })
})

describe('CompareResult — 비교 주의 요약 띠 (8-C1a)', () => {
  it('A 부평역 · B 강화읍: † 계산 구성 차이 첫 줄, 각 줄은 비교 섹션 제목으로 이동', () => {
    renderCompare(A, NO_STABILITY)
    const band = screen.getByRole('region', { name: '주의 요약' })
    fireEvent.click(band.querySelector('summary')!)
    const links = within(band).getAllByRole('link')
    expect(links[0]).toHaveAccessibleName('계산 구성: 종합 계산 구성이 다릅니다 · A 5개 관점, B 4개(안정성 미산출)')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#compare-score-title',
      '#compare-warnings-title',
      '#compare-not-computed-title',
      '#compare-warnings-title',
      '#compare-warnings-title',
    ])
    for (const a of links) expect(document.getElementById(a.getAttribute('href')!.slice(1))).not.toBeNull()
    fireEvent.click(links[2]!)
    expect(document.activeElement).toBe(document.getElementById('compare-not-computed-title'))
  })

  it('줄이 5개를 넘으면 5줄 + "주의 N건 더 보기"(주의할 점으로)', () => {
    const many = structuredClone(NO_STABILITY)
    many.result.경고 = [...many.result.경고, '테스트 경고 1', '테스트 경고 2']     // 표시 테스트 전용
    renderCompare(A, many)
    const band = screen.getByRole('region', { name: '주의 요약' })
    fireEvent.click(band.querySelector('summary')!)
    expect(within(band).getAllByRole('listitem')).toHaveLength(5)
    const more = within(band).getByRole('link', { name: /주의 \d+건 더 보기/ })
    expect(more).toHaveAttribute('href', '#compare-warnings-title')
  })

  it('비교 화면 id 가 겹치지 않는다(띠 추가 뒤)', () => {
    renderCompare(A, NO_STABILITY)
    expect(duplicateIds()).toEqual([])
    expect(brokenReferences()).toEqual([])
  })
})
