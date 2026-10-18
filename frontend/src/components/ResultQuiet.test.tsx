import { fireEvent, render, screen, within } from '@testing-library/react'
import { AnalyzeResponseSchema } from '../api/schemas.ts'
import fixture from '../fixtures/bupyeong-pcbang.json'
import nailFixture from '../fixtures/bupyeong-nailshop.json'
import { AnalysisResult } from './AnalysisResult.tsx'
import { CompareResult } from './CompareResult.tsx'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// vitest는 CSS import를 비우므로 실제 스타일 파일을 읽어 가시성도 검증한다.
const quietCss = readFileSync(join(process.cwd(), 'src/components/ResultQuiet.css'), 'utf-8')

const analysis = AnalyzeResponseSchema.parse(fixture)
const nail = AnalyzeResponseSchema.parse(nailFixture)

function single(value = analysis) {
  return render(<><style>{quietCss}</style><AnalysisResult analysis={value} address={<span>테스트 참고 주소</span>} /></>)
}

describe('기본 결과는 간단히, 근거는 요청할 때', () => {
  it('다섯 점수는 보이고 raw 근거와 가중치·충족 정보는 접혀 있다', () => {
    single()
    const rows = within(screen.getByRole('region', { name: '5대 관점' })).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.querySelector('.perspective__main')).toBeVisible()
      const evidence = row.querySelector('.perspective__evidence-text')
      if (evidence) expect(evidence).not.toBeVisible()
    }
    expect(document.querySelector('.coverage')).not.toBeVisible()
    expect(screen.getByText('테스트 참고 주소')).not.toBeVisible()
    expect(screen.getByText('참고 지표 · 순위나 성공 확률이 아닙니다.')).toBeVisible()
  })

  it('설명을 펼치고 다시 접어도 같은 점수와 근거를 유지한다', () => {
    single()
    const evidence = document.querySelector('.perspective__evidence-text')!
    const text = evidence.textContent
    fireEvent.click(screen.getByRole('button', { name: '설명 함께 보기' }))
    expect(evidence).toBeVisible()
    expect(document.querySelector('.coverage')).toBeVisible()
    expect(screen.getByRole('button', { name: '간단히 보기' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '간단히 보기' }))
    expect(evidence).not.toBeVisible()
    expect(evidence.textContent).toBe(text)
  })

  it('주의 건수와 종류를 먼저 보이고 펼치면 원문과 이동 링크가 나온다', () => {
    single(nail)
    const band = screen.getByRole('region', { name: '주의 요약' })
    const details = band.querySelector('details')!
    expect(details.open).toBe(false)
    expect(band.querySelector('summary')).toHaveTextContent('확인할 점 3')
    expect(band.querySelector('summary')).toHaveTextContent('병목 · 미산출')
    const link = within(band).getAllByRole('link', { hidden: true })[0]!
    expect(link).not.toBeVisible()
    fireEvent.click(band.querySelector('summary')!)
    expect(link).toBeVisible()
    fireEvent.click(link)
    expect(document.activeElement).toBe(document.getElementById('warnings-title'))
  })

  it('위치 정보는 한 번 펼쳐 주소를 확인할 수 있다', () => {
    single()
    fireEvent.click(document.querySelector('.result__location > summary')!)
    expect(screen.getByText('테스트 참고 주소')).toBeVisible()
  })

  it('미산출과 신뢰도 낮음·병목은 간단 화면에서도 남는다', () => {
    single(nail)
    expect(document.querySelector('.perspective__missing')).toBeVisible()
    expect(document.querySelector('.perspective__bottleneck')).toBeVisible()
    expect(document.querySelector('.perspective__low-confidence')).toBeVisible()
  })

  it('비교도 설명을 접고 계산 구성 차이는 접힌 주의 제목에 알린다', () => {
    render(<><style>{quietCss}</style><CompareResult a={analysis} b={nail}
      onShowDetail={() => {}} onEnd={() => {}} onChangeConditions={() => {}} /></>)
    expect(screen.getByRole('region', { name: '주의 요약' }).querySelector('summary')).toHaveTextContent('계산 구성 다름')
    expect(document.querySelector('.result__secondary')).not.toBeVisible()
    expect(document.querySelectorAll('.result__location')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '설명 함께 보기' }))
    expect(document.querySelector('.result__secondary')).toBeVisible()
  })
})
