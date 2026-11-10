import { act, renderHook } from '@testing-library/react'
import { COUNT_UP_MS, motionAllowed, useCountUp } from './useCountUp.ts'

const allowMotion = () =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: no-preference)', media: q }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('결과 공개 숫자 오르기 (13-46, D-045)', () => {
  it('움직임을 원한다고 분명히 알릴 때만 움직인다 — matchMedia 없음·줄이기 설정이면 바로 최종값', () => {
    expect(motionAllowed()).toBe(false)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }))
    expect(motionAllowed()).toBe(false)
    const { result } = renderHook(() => useCountUp(60.3))
    expect(result.current).toEqual({ value: 60.3, running: false })
  })

  it('움직이면 0 에서 시작해 COUNT_UP_MS 뒤 엔진 값 그대로 끝난다. 값이 바뀌면 처음부터, null 이면 움직이지 않는다', () => {
    allowMotion()
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 60.3 as number | null } })
    expect(result.current).toEqual({ value: 0, running: true })
    act(() => vi.advanceTimersByTime(COUNT_UP_MS / 2))
    expect(result.current.running).toBe(true)
    expect(result.current.value).toBeGreaterThan(0)
    expect(result.current.value).toBeLessThan(60.3)
    act(() => vi.advanceTimersByTime(COUNT_UP_MS))
    expect(result.current).toEqual({ value: 60.3, running: false })

    rerender({ v: 44.4 })
    expect(result.current).toEqual({ value: 0, running: true })
    act(() => vi.advanceTimersByTime(COUNT_UP_MS * 2))
    expect(result.current).toEqual({ value: 44.4, running: false })

    rerender({ v: null })
    expect(result.current).toEqual({ value: null, running: false })
  })
})
