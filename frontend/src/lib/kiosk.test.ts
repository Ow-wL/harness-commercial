import { renderHook } from '@testing-library/react'
import { readKioskFlag, useIdleWatch } from './kiosk.ts'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('전시 모드 (13-46, D-045)', () => {
  it('주소의 kiosk=1 은 이 브라우저에 기억하고(새로고침해도 유지), kiosk=0 이면 끈다', () => {
    expect(readKioskFlag('')).toBe(false)
    expect(readKioskFlag('?kiosk=1')).toBe(true)
    expect(readKioskFlag('?lat=37.4&lng=126.7')).toBe(true)
    expect(readKioskFlag('?kiosk=0')).toBe(false)
    expect(readKioskFlag('')).toBe(false)
  })

  it('저장소가 막혀 있으면 주소만 본다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readKioskFlag('?kiosk=1')).toBe(true)
    expect(readKioskFlag('')).toBe(false)
    vi.restoreAllMocks()
  })

  it('조작이 없으면 idleMs 뒤 onIdle, 누르거나 키를 누르면 onInput 과 함께 시간을 처음부터 센다', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const onIdle = vi.fn()
    const { unmount } = renderHook(() => useIdleWatch(true, 1000, onInput, onIdle))
    vi.advanceTimersByTime(900)
    window.dispatchEvent(new Event('pointerdown'))
    expect(onInput).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(900)
    expect(onIdle).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    vi.advanceTimersByTime(1000)
    expect(onInput).toHaveBeenCalledTimes(2)
    expect(onIdle).toHaveBeenCalledTimes(1)
    unmount()
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(5000)
    expect(onInput).toHaveBeenCalledTimes(2)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('꺼져 있으면 아무것도 지켜보지 않는다', () => {
    vi.useFakeTimers()
    const onInput = vi.fn()
    const onIdle = vi.fn()
    renderHook(() => useIdleWatch(false, 1000, onInput, onIdle))
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(5000)
    expect(onInput).not.toHaveBeenCalled()
    expect(onIdle).not.toHaveBeenCalled()
  })
})
