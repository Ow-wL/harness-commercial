import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import nailFixture from '../fixtures/bupyeong-nailshop.json'
import pcFixture from '../fixtures/bupyeong-pcbang.json'
import schoolFixture from '../fixtures/school-zone-pcbang-v05.json'
import { regulationAlert, weakAlert } from '../lib/alerts.ts'
import { formatScore } from '../lib/format.ts'
import { gradeLabel, gradeOf } from '../lib/grade.ts'
import { AnalysisResult } from './AnalysisResult.tsx'

const SCHOOL = AnalyzeResponseSchema.parse(schoolFixture)   // v0.5 학교구역: 경고[0] ⚠ + 200m 안 초·중·고 2곳, PC방
const NAIL = AnalyzeResponseSchema.parse(nailFixture)       // 경쟁성 1.2 (< 25) 주의 관점
const PC = AnalyzeResponseSchema.parse(pcFixture)           // 경쟁성 30.2 (≥ 25) — 주의 없음, 학교구역 없음

/** 판정·확률·추천을 단정하는 표현 — 배너·한 줄은 엔진 값 인용과 "확인하세요"까지만 */
const FORBIDDEN = /영업할 수 없|불가능|허가가 나지 않|성공|실패|추천|순위|확률/

describe('lib/alerts — 규제 배너·주의 관점 (R0 13-1·13-3)', () => {
  it('학교구역 경고가 있는 결과: 업종·학교 수로 만든 배너 문장, 영업 가능 여부는 확정하지 않는다', () => {
    const alert = regulationAlert(SCHOOL)!
    expect(alert).not.toBeNull()
    expect(alert.schools).toBe(SCHOOL.result.초보자_접근성.학교구역_200m_학교수)
    expect(alert.business).toBe('PC방')
    expect(alert.text).toBe(
      `학교 200m 안 초·중·고 ${alert.schools}곳 — PC방은(는) 학교 주변 영업 규제 업종입니다(교육환경보호구역). 점수보다 영업 가능 여부를 먼저 확인하세요.`,
    )
    expect(alert.text).not.toMatch(FORBIDDEN)
  })

  it('학교구역 경고가 없으면 배너 없음 (v0.3 부평역 PC방·네일숍)', () => {
    expect(regulationAlert(PC)).toBeNull()
    expect(regulationAlert(NAIL)).toBeNull()
  })

  it('25점 미만 관점(엔진 병목_지표)만 주의 한 줄: 관점 이름 + 점수 + 근거 줄 인용', () => {
    const weak = weakAlert(NAIL)!
    expect(weak.key).toBe('competition')
    expect(weak.text).toMatch(/^경쟁성이 매우 낮아요\(1\.2점\) — /)
    expect(weak.text).toContain('네일숍')                                     // 근거 줄 "반경 … 네일숍 N곳 …"
    expect(weak.text).not.toMatch(FORBIDDEN)
    expect(weakAlert(PC)).toBeNull()                                          // 30.2 ≥ 25
  })
})

describe('AnalysisResult — 규제 배너·등급·주의 한 줄 (R0)', () => {
  it('학교 옆 PC방: 점수 카드 위에 배너(role=alert, 펼쳐 있음)와 숫자 옆 "규제 확인 필요" 배지', () => {
    render(<AnalysisResult analysis={SCHOOL} />)
    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent('학교 200m 안 초·중·고 2곳')
    expect(banner).toHaveTextContent('점수보다 영업 가능 여부를 먼저 확인하세요')
    // 배너는 종합 점수보다 앞(DOM 순서 = 읽는 순서·인쇄 순서)
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    expect(banner.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(overall).getByText('규제 확인 필요')).toBeInTheDocument()
    // 원문은 상세 근거 › 주의할 점에 그대로(바꾸지 않는다)
    expect(SCHOOL.result.경고[0]).toMatch(/^⚠/)
  })

  it('종합·관점 점수에 글자 등급(13-4): 종합은 등급 pill(색 + 글자), 네일숍 경쟁성 1.2 → 주의', () => {
    const { unmount } = render(<AnalysisResult analysis={SCHOOL} />)
    const overall = screen.getByRole('region', { name: '종합 적합도' })
    const score = SCHOOL.result.종합.점수!
    expect(overall).toHaveTextContent(formatScore(score))
    expect(within(overall).getByText(gradeLabel(score)!)).toHaveClass(`grade--${gradeOf(score)}`)
    unmount()

    render(<AnalysisResult analysis={NAIL} />)
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('perspective'))
    const competition = rows.find((r) => (r as HTMLElement).dataset.key === 'competition')!
    expect(within(competition).getByText('주의', { selector: '.grade' })).toHaveClass('grade--alert')
    expect(within(competition).getByText('주의', { selector: '.perspective__bottleneck' })).toBeInTheDocument()
    expect(competition.querySelector('.perspective__score--alert')).toHaveTextContent('1.2')
    expect(competition.querySelector('.perspective__track--alert')).not.toBeNull()
  })

  it('주의 관점 한 줄은 점수 카드 아래, 없는 결과에는 배너·한 줄·배지 모두 없음', () => {
    const { unmount } = render(<AnalysisResult analysis={NAIL} />)
    expect(screen.getByText(/^주의 관점:/).parentElement).toHaveTextContent(/경쟁성이 매우 낮아요\(1\.2점\)/)
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()

    render(<AnalysisResult analysis={PC} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/매우 낮아요/)).toBeNull()
    expect(screen.queryByText('규제 확인 필요')).toBeNull()
  })
})
