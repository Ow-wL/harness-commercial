import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import { GUIDE_LABELS, PERSPECTIVE_GUIDE } from '../content/scoreGuide.ts'
import pcbangFixture from '../fixtures/bupyeong-pcbang.json'
import nailShopFixture from '../fixtures/bupyeong-nailshop.json'
import { AnalysisResult } from './AnalysisResult.tsx'
import { EVIDENCE_TAB, getInTab, openTab } from '../test/tabs.ts'

/** 실제 /analyze 응답: 부평역 PC방(5개 관점 산출) · 부평역 네일숍(안정성 미산출) */
const PCBANG = AnalyzeResponseSchema.parse(pcbangFixture)
const NAILSHOP = AnalyzeResponseSchema.parse(nailShopFixture)

const LABELS = { market: '시장성', customer: '고객성', competition: '경쟁성', location: '입지성', stability: '안정성' }

function openAccordion(label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(?!은 무엇을 보나요)`) }))
}

const guideToggle = (label: string) => screen.getByRole('button', { name: `${label}은 무엇을 보나요` })

describe('관점 설명 (DESIGN.md §8.9a)', () => {
  it('5개 관점 모두 아코디언 안에 기본 접힌 설명이 있고, 펼치면 해당 관점의 다섯 항목이 보인다', () => {
    render(<AnalysisResult analysis={PCBANG} />)
    // 비용 줄이기(8-P 검수): 문서 전체 role 검색을 반복하지 않는다 — 상세 근거 탭 패널을 한 번 잡고, 관점마다 그 관점의
    // 설명 묶음(.guide) 안에서만 role로 찾는다. "설명 영역이 없다"는 문서 전체에서 같은 role·이름을 DOM으로 센다
    openTab(EVIDENCE_TAB)
    const evidence = screen.getByRole('tabpanel', { name: EVIDENCE_TAB })
    const regionsNamed = (name: string) =>
      [...document.querySelectorAll('[role="region"]')].filter((el) => el.getAttribute('aria-label') === name)
    for (const [key, label] of Object.entries(LABELS) as [keyof typeof LABELS, string][]) {
      const name = `${label}은 무엇을 보나요`
      fireEvent.click(within(evidence).getByRole('button', { name: new RegExp(`^${label}(?!은 무엇을 보나요)`) }))
      const box = within(
        [...evidence.querySelectorAll<HTMLElement>('.guide')].find((g) => g.querySelector('.guide__toggle')?.textContent?.includes(name))!,
      )
      const toggle = box.getByRole('button', { name })
      expect(toggle).toHaveAttribute('type', 'button')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(regionsNamed(name)).toHaveLength(0)

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      const region = box.getByRole('region', { name })
      expect(regionsNamed(name)).toEqual([region])                  // 문서 전체에서 그 하나뿐
      expect(toggle).toHaveAttribute('aria-controls', region.id)
      for (const term of Object.values(GUIDE_LABELS)) expect(within(region).getByText(term)).toBeInTheDocument()
      const guide = PERSPECTIVE_GUIDE[key]
      expect(region).toHaveTextContent(guide.measures)
      expect(region).toHaveTextContent(guide.origin)
      expect(within(region).getAllByRole('listitem')).toHaveLength(guide.limits.length)

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(regionsNamed(name)).toHaveLength(0)
    }
  })

  it('"이 결과" 줄은 응답의 가중치·타겟 정의·유인시설 기준을 쓴다', () => {
    render(<AnalysisResult analysis={PCBANG} />)
    openAccordion('고객성')
    fireEvent.click(guideToggle('고객성'))
    const customer = screen.getByRole('region', { name: '고객성은 무엇을 보나요' })
    const raw = PCBANG.result.지표[1].raw
    expect(customer).toHaveTextContent(`이 업종의 타겟: ${raw.타겟_정의}`)
    // 기본 0.27 · 적용 0.27 (응답 종합.기본_가중치·적용_가중치)
    expect(customer).toHaveTextContent('업종 그룹 기본 가중치 27% · 이번 종합에 적용 27%')

    openAccordion('입지성')
    fireEvent.click(guideToggle('입지성'))
    const location = screen.getByRole('region', { name: '입지성은 무엇을 보나요' })
    expect(location).toHaveTextContent(`이 업종의 유인시설: ${PCBANG.result.지표[3].raw.유인시설_기준}`)
  })

  it('안정성이 미산출이어도 설명을 열 수 있고, 종합에서 제외됐다고 안내한다', () => {
    expect(NAILSHOP.result.지표[4].score).toBeNull()
    render(<AnalysisResult analysis={NAILSHOP} />)
    openAccordion('안정성')
    fireEvent.click(guideToggle('안정성'))
    const region = screen.getByRole('region', { name: '안정성은 무엇을 보나요' })
    expect(region).toHaveTextContent(PERSPECTIVE_GUIDE.stability.measures)
    // 기본 0.2(고객밀착형), 적용 가중치에는 stability 키가 없다
    expect(region).toHaveTextContent('업종 그룹 기본 가중치 20% · 이번 종합에서는 제외(점수 없음)')
  })

  it('"모두 펼치기"는 관점 아코디언만 열고 설명은 접힌 채로 둔다', () => {
    render(<AnalysisResult analysis={PCBANG} />)
    fireEvent.click(getInTab(EVIDENCE_TAB, 'button', { name: '모두 펼치기' }))
    for (const label of Object.values(LABELS)) {
      expect(guideToggle(label)).toHaveAttribute('aria-expanded', 'false')
    }
    expect(screen.queryAllByRole('region', { name: /은 무엇을 보나요$/ })).toHaveLength(0)
  })
})

describe('점수 읽는 법 (DESIGN.md §8.9b)', () => {
  const READING_TOPICS = [
    '세부지표 점수와 관점·종합 점수',
    '데이터가 없을 때',
    '충족률 · 신뢰도 · 병목',
    '업종별 가중치',
    '성공 확률이나 매출 예측이 아닙니다',
    '일반 웹 분석에서 임대료가 빠지는 이유',
  ]

  it('기본 접힘이고, 펼치면 여섯 주제가 보인다', () => {
    render(<AnalysisResult analysis={PCBANG} />)
    const toggle = getInTab(EVIDENCE_TAB, 'button', { name: '점수 읽는 법' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: '점수 읽는 법' })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const region = screen.getByRole('region', { name: '점수 읽는 법' })
    expect(within(region).getAllByRole('heading').map((h) => h.textContent)).toEqual(READING_TOPICS)
    expect(region).toHaveTextContent('인천 내 순위나 "상위 N%"가 아닙니다')
    expect(region).toHaveTextContent('이 위치에서 산출한 관점 점수끼리 비교한 표현입니다. 다른 위치와 비교한 순위가 아닙니다.')
    expect(region).toHaveTextContent('검증한 값이 아닙니다(실증 전)')
    expect(region).toHaveTextContent('창업 성공 확률이나 매출·수익을 예측하지 않습니다')

    fireEvent.click(toggle)
    expect(screen.queryByRole('region', { name: '점수 읽는 법' })).not.toBeInTheDocument()
  })

  it('이 결과의 가중치·충족률은 응답 값으로 채운다 (정상 산출)', () => {
    render(<AnalysisResult analysis={PCBANG} />)
    fireEvent.click(getInTab(EVIDENCE_TAB, 'button', { name: '점수 읽는 법' }))
    const region = screen.getByRole('region', { name: '점수 읽는 법' })
    expect(region).toHaveTextContent('5개 관점 중 5개 산출')
    expect(region).toHaveTextContent('이 결과 100%')
    expect(region).toHaveTextContent(
      'PC방 · 목적방문형) 기본 가중치: 시장성 15% · 고객성 27% · 경쟁성 22% · 입지성 18% · 안정성 18%',
    )
  })

  it('미산출 관점은 적용 가중치에서 "제외"로 보이고 남은 관점의 재분배 값이 보인다', () => {
    render(<AnalysisResult analysis={NAILSHOP} />)
    fireEvent.click(getInTab(EVIDENCE_TAB, 'button', { name: '점수 읽는 법' }))
    const region = screen.getByRole('region', { name: '점수 읽는 법' })
    expect(region).toHaveTextContent('5개 관점 중 4개 산출')
    // 응답 적용_가중치 {market 0.188, customer 0.375, competition 0.25, location 0.188}
    expect(region).toHaveTextContent('시장성 19% · 고객성 38% · 경쟁성 25% · 입지성 19% · 안정성 제외')
    expect(region).toHaveTextContent('이 결과 80%')
  })
})

describe('설명 콘텐츠 규칙 (docs/SCORE_GUIDE_SOURCES.md)', () => {
  const allText = Object.values(PERSPECTIVE_GUIDE)
    .flatMap((g) => [g.measures, g.why, g.origin, g.data, ...g.limits])
    .join('\n')

  it('결과 값(가중치·충족률·통계 비율)을 정적 문장에 쓰지 않는다 — 화면이 응답 값으로 채운다', () => {
    expect(allText).not.toMatch(/\d+(\.\d+)?\s*%/)
  })

  it('검수 보완 조건을 담는다: 점포당 잠재수요 비교 지점, 종료일 없는 종료 기록', () => {
    expect(PERSPECTIVE_GUIDE.competition.data).toContain('점포당 잠재수요는 반경 안에 같은 업종 점포가 있는 비교 지점만 씁니다')
    // etl_stability.survival: 종료일이 없으면 폐업으로 세지 않고 코호트에 남는다 (docs/SCORE_GUIDE_SOURCES.md 2-1)
    expect(PERSPECTIVE_GUIDE.stability.limits.some((t) => t.includes('종료일이 없는') && t.includes('높게'))).toBe(true)
  })

  it('감사에서 바로잡은 옛 설명을 쓰지 않는다', () => {
    expect(allText).not.toMatch(/유입\S*\s*[×x*]\s*0\.3/)                  // 잠재수요 0.3:0.7 공식 (감사 1장)
    expect(allText).not.toMatch(/1\.0\S*\s*인천 평균(이다|입니다)/)        // 시간대 적합도 1.0 = 인천 평균 (감사 2장)
    expect(allText).not.toMatch(/(상위|하위)\s*\d/)                        // 순위 표현 (감사 3장)
  })
})
