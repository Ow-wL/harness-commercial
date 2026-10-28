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
  it('다섯 점수·근거 한 줄·자료 단위 칩·"확인 필요"는 보이고, 높음/낮음 라벨·헤드라인·가중치·충족 정보는 접혀 있다 (12-20 안 B)', () => {
    single()
    const rows = within(screen.getByRole('region', { name: '5대 관점' })).getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.querySelector('.perspective__main')).toBeVisible()
      expect(row.querySelector('.perspective__evidence-text')).toBeVisible()
      expect(row.querySelector('.perspective__unit')).toBeVisible()
    }
    expect(document.querySelector('.perspective__strongest')).not.toBeVisible()
    expect(document.querySelector('.perspective__lowest')).not.toBeVisible()
    expect(document.querySelector('.result__headline')).not.toBeVisible()
    const gaps = document.querySelector('.gaps')!
    expect(gaps).toBeVisible()
    expect(gaps).toHaveTextContent('확인 필요임대료 미반영유입·생존율은 구 단위 자료잠재수요는 거주 인구만(방문객 유동 없음)')
    expect(document.querySelector('.coverage')).not.toBeVisible()
    expect(screen.getByText('테스트 참고 주소')).not.toBeVisible()
    expect(screen.getByText('참고 지표 · 순위나 성공 확률이 아닙니다.')).toBeVisible()
  })

  it('설명을 펼치면 높음/낮음·헤드라인·충족 정보가 나오고, 접으면 다시 숨되 근거 줄은 그대로 보인다', () => {
    single()
    const evidence = document.querySelector('.perspective__evidence-text')!
    const text = evidence.textContent
    fireEvent.click(screen.getByRole('button', { name: '설명 함께 보기' }))
    expect(evidence).toBeVisible()
    expect(document.querySelector('.perspective__strongest')).toBeVisible()
    expect(document.querySelector('.result__headline')).toBeVisible()
    expect(document.querySelector('.coverage')).toBeVisible()
    expect(screen.getByRole('button', { name: '간단히 보기' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '간단히 보기' }))
    expect(evidence).toBeVisible()
    expect(document.querySelector('.perspective__strongest')).not.toBeVisible()
    expect(document.querySelector('.coverage')).not.toBeVisible()
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

  it('미산출과 자료 등급 낮음·병목은 간단 화면에서도 남는다', () => {
    single(nail)
    expect(document.querySelector('.perspective__missing')).toBeVisible()
    expect(document.querySelector('.perspective__bottleneck')).toBeVisible()
    expect(document.querySelector('.perspective__low-confidence')).toBeVisible()
  })

  it('비교도 설명을 접고 계산 구성 차이는 접힌 주의 제목에 알린다', () => {
    render(<><style>{quietCss}</style><CompareResult a={analysis} b={nail}
      onShowDetail={() => {}} onEnd={() => {}} onChangeConditions={() => {}} /></>)
    expect(screen.getByRole('region', { name: '주의 요약' }).querySelector('summary')).toHaveTextContent('계산 구성 다름')
    // A(PC방)·B(네일숍)의 확인 필요 줄이 달라 A·B 각각
    expect(document.querySelectorAll('.gaps')).toHaveLength(2)
    expect(document.querySelectorAll('.gaps')[1]).toHaveTextContent('B 확인 필요유입은 구 단위 자료')
    expect(document.querySelector('.result__secondary')).not.toBeVisible()
    expect(document.querySelectorAll('.result__location')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '설명 함께 보기' }))
    expect(document.querySelector('.result__secondary')).toBeVisible()
  })
})
