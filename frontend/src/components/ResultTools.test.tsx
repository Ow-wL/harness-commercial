import { fireEvent, render, screen } from '@testing-library/react'
import { ResultTools } from './ResultTools.tsx'

const URL = 'https://example.test/?lat=37.4894&lng=126.7246&biz=I21201&r=500&data=2026-09&engine=mvp-0.5.1'

describe('결과 활용 줄 — 휴대폰으로 (13-46)', () => {
  it('"휴대폰으로"를 누르면 공유 링크 QR 과 안내를 펼치고, 다시 누르면 접는다', () => {
    render(<ResultTools shareUrl={URL} />)
    const button = screen.getByRole('button', { name: '휴대폰으로' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('img', { name: '이 분석을 휴대폰에서 여는 QR 코드' })).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const qr = screen.getByRole('img', { name: '이 분석을 휴대폰에서 여는 QR 코드' })
    // 흰 바탕 + 어두운 칸 path 하나(비어 있지 않음). 칸 수는 링크 길이에 따라 정해진다(버전 자동)
    expect(qr.querySelector('rect')).toHaveAttribute('fill', '#ffffff')
    expect(qr.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(100)
    expect(screen.getByText('휴대폰 카메라로 찍어 보세요')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByRole('img', { name: '이 분석을 휴대폰에서 여는 QR 코드' })).not.toBeInTheDocument()
  })

  it('공유 링크가 없으면 휴대폰으로 버튼도 없다', () => {
    render(<ResultTools shareUrl={null} onPrint={() => {}} />)
    expect(screen.queryByRole('button', { name: '휴대폰으로' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '인쇄' })).toBeInTheDocument()
  })
})
