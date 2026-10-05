import { render, screen } from '@testing-library/react'
import App from './App.tsx'

describe('App', () => {
  it('서비스명을 제목으로 렌더링한다', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: '우리동네 상권분석 매니저' }),
    ).toBeInTheDocument()
  })
})
