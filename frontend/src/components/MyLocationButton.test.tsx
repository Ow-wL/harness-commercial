import { fireEvent, render, screen } from '@testing-library/react'
import { MyLocationButton } from './MyLocationButton.tsx'

type Ok = (pos: { coords: { latitude: number; longitude: number } }) => void
type Fail = (err: { code: number }) => void

function stubGeolocation(run: (ok: Ok, fail: Fail) => void) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: Ok, fail: Fail) => run(ok, fail) },
  })
}

afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
})

describe('현재 위치로 고르기 (13-50)', () => {
  it('위치 기능이 없는 브라우저에서는 그리지 않는다', () => {
    const { container } = render(<MyLocationButton disabled={false} onLocate={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('위치를 읽으면 그 좌표로 고른다', () => {
    stubGeolocation((ok) => ok({ coords: { latitude: 37.49, longitude: 126.72 } }))
    const onLocate = vi.fn()
    render(<MyLocationButton disabled={false} onLocate={onLocate} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 위치로 고르기' }))
    expect(onLocate).toHaveBeenCalledWith({ lat: 37.49, lng: 126.72 })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('권한이 거부되면 사유와 지도 선택 안내를 보이고 고르지 않는다', () => {
    stubGeolocation((_ok, fail) => fail({ code: 1 }))
    const onLocate = vi.fn()
    render(<MyLocationButton disabled={false} onLocate={onLocate} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 위치로 고르기' }))
    expect(screen.getByRole('alert')).toHaveTextContent('위치 권한이 꺼져 있습니다')
    expect(onLocate).not.toHaveBeenCalled()
  })

  it('찾는 동안에는 버튼이 잠기고 문구가 바뀐다', () => {
    stubGeolocation(() => {})
    render(<MyLocationButton disabled={false} onLocate={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '현재 위치로 고르기' }))
    expect(screen.getByRole('button', { name: '현재 위치 찾는 중…' })).toBeDisabled()
  })
})
