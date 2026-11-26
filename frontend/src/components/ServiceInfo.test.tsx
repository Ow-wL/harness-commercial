import { fireEvent, render, screen } from '@testing-library/react'
import { SERVICE_CONTACT, SERVICE_INFO_SECTIONS } from '../content/serviceInfo.ts'
import { ServiceInfo } from './ServiceInfo.tsx'

const openButton = () => screen.getByRole('button', { name: '서비스 안내' })

describe('서비스 안내 (13-50)', () => {
  it('버튼을 누르면 모달이 열리고 소개·자료·개인정보 구역이 모두 보인다', () => {
    render(<ServiceInfo />)
    expect(openButton()).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(openButton())
    const dialog = screen.getByRole('dialog', { name: '서비스 안내' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveFocus()
    for (const s of SERVICE_INFO_SECTIONS) expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('좌표와 접속 주소(IP)는 저장하지 않습니다')
    expect(dialog).toHaveTextContent('30일 보관')
  })

  it('Escape 로 닫으면 버튼으로 포커스가 돌아간다', () => {
    render(<ServiceInfo />)
    fireEvent.click(openButton())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('문의 창구가 정해지지 않았으면 빈 "문의" 구역을 만들지 않는다', () => {
    render(<ServiceInfo />)
    fireEvent.click(openButton())
    const contact = screen.queryByRole('heading', { name: '만든 곳 · 문의' })
    if (SERVICE_CONTACT) expect(contact).toBeInTheDocument()
    else expect(contact).not.toBeInTheDocument()
  })
})
