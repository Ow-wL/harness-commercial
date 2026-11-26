import { fireEvent, render, screen } from '@testing-library/react'
import { FoldSection } from './FoldSection.tsx'

describe('접힌 줄 (13-51)', () => {
  it('처음에는 접혀 있고 내용은 DOM 에 남는다 — 누르면 펼치고 다시 누르면 접는다', () => {
    render(
      <FoldSection id="fold-x" label="언제 사람이 많나요?" hint="시간대">
        <p>본문</p>
      </FoldSection>,
    )
    const toggle = screen.getByRole('button', { name: /언제 사람이 많나요/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('본문')).not.toBeVisible()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('본문')).toBeVisible()
    fireEvent.click(toggle)
    expect(screen.getByText('본문')).not.toBeVisible()
  })

  it('줄마다 따로 펼친다 — 하나를 열어도 다른 줄은 그대로', () => {
    render(
      <>
        <FoldSection id="a" label="첫 줄"><p>A 본문</p></FoldSection>
        <FoldSection id="b" label="둘째 줄"><p>B 본문</p></FoldSection>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '첫 줄' }))
    fireEvent.click(screen.getByRole('button', { name: '둘째 줄' }))
    expect(screen.getByText('A 본문')).toBeVisible()
    expect(screen.getByText('B 본문')).toBeVisible()
  })

  it('openSignal 값이 바뀌면 펼친다 (밖의 이동 링크)', () => {
    const { rerender } = render(<FoldSection id="s" label="지원사업" openSignal={0}><p>공고</p></FoldSection>)
    expect(screen.getByText('공고')).not.toBeVisible()
    rerender(<FoldSection id="s" label="지원사업" openSignal={1}><p>공고</p></FoldSection>)
    expect(screen.getByText('공고')).toBeVisible()
  })
})
