import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { MapErrorBoundary } from './MapErrorBoundary.tsx'

/** 지도 대신: effect 정리 중 예외(운영 무트래픽 검증에서 본 형태 — SDK 정리 호출이 TypeError)를 낼 수 있는 자식 */
function FlakyMap({ theme, failOnCleanup }: { theme: string; failOnCleanup: boolean }) {
  useEffect(
    () => () => {
      if (failOnCleanup) throw new TypeError("Cannot read properties of null (reading 'isArray')")
    },
    [theme, failOnCleanup],
  )
  return <section aria-label="위치 선택 지도">지도 {theme}</section>
}

function Page() {
  const [theme, setTheme] = useState('dark')
  const [count, setCount] = useState(0)
  return (
    <>
      <MapErrorBoundary>
        <FlakyMap theme={theme} failOnCleanup={count === 0} />
      </MapErrorBoundary>
      <button type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
        테마 전환
      </button>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        분석 {count}
      </button>
    </>
  )
}

describe('MapErrorBoundary — 지도 영역 오류 격리', () => {
  it('지도에서 effect 정리 중 예외가 나도 지도 칸만 실패 안내로 바뀌고, 나머지 화면은 그대로 동작한다', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Page />)
    expect(screen.getByText('지도 dark')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '테마 전환' }))
    expect(screen.getByRole('alert')).toHaveTextContent('지도를 표시하지 못했습니다')
    expect(screen.getByRole('alert')).toHaveTextContent('분석·비교는 패널의 좌표 입력·주소로 찾기로 계속할 수 있습니다.')
    // 지도 밖(패널)은 살아 있다
    fireEvent.click(screen.getByRole('button', { name: '분석 0' }))
    expect(screen.getByRole('button', { name: '분석 1' })).toBeInTheDocument()
    // 예외는 숨기지 않는다
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith('[map] 지도 영역에서 예외'))).toBe(true)
  })

  it('"지도 다시 불러오기"는 지도를 새로 마운트한다 — 원인이 사라졌으면 지도가 돌아온다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: '테마 전환' }))
    fireEvent.click(screen.getByRole('button', { name: '분석 0' }))         // 이제 정리 중 예외 없음
    fireEvent.click(screen.getByRole('button', { name: '지도 다시 불러오기' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('지도 light')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '테마 전환' }))       // 반복 전환도 그대로
    expect(screen.getByText('지도 dark')).toBeInTheDocument()
  })
})
