import { act, renderHook } from '@testing-library/react'
import { applyTheme, readPreference, resolveTheme, systemTheme, THEME_STORAGE_KEY, useTheme, writePreference } from './theme.ts'

type Listener = (e: { matches: boolean }) => void

/** matchMedia 대역: 다크 질의의 matches 값과 change 리스너만 흉내 낸다 */
function stubMatchMedia(dark: boolean) {
  const listeners = new Set<Listener>()
  const mq = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mq))
  return {
    mq,
    set(next: boolean) {
      mq.matches = next
      listeners.forEach((l) => l({ matches: next }))
    },
    listeners,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('테마 선택 저장·해석 (lib/theme)', () => {
  it('저장된 선택이 없거나 이상한 값이면 system, light·dark는 그대로 읽는다', () => {
    expect(readPreference()).toBe('system')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'blue')
    expect(readPreference()).toBe('system')
    writePreference('light')
    expect(readPreference()).toBe('light')
    writePreference('system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('localStorage를 쓸 수 없어도 예외 없이 system으로 본다', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readPreference()).toBe('system')
    expect(() => writePreference('dark')).not.toThrow()
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('시스템 설정: matchMedia가 없으면 다크(제품 기본), 있으면 prefers-color-scheme을 따른다', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(systemTheme()).toBe('dark')
    stubMatchMedia(false)
    expect(systemTheme()).toBe('light')
    expect(resolveTheme('system')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
    expect(resolveTheme('light', 'dark')).toBe('light')
  })

  it('applyTheme은 <html data-theme>을 건다', () => {
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('useTheme', () => {
  it('첫 방문(선택 없음)은 시스템 설정을 따르고, 시스템이 바뀌면 함께 바뀐다', () => {
    const mm = stubMatchMedia(true)
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    act(() => mm.set(false))
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('직접 고르면 저장하고 고정한다 — 그 뒤 시스템 변화는 따르지 않고, 새로 마운트해도 유지된다', () => {
    const mm = stubMatchMedia(true)
    const { result, unmount } = renderHook(() => useTheme())
    act(() => result.current.setPreference('light'))
    expect(result.current.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(mm.listeners.size).toBe(0)                                   // 시스템 구독을 끊는다
    act(() => mm.set(true))
    expect(result.current.theme).toBe('light')
    unmount()
    const again = renderHook(() => useTheme())
    expect(again.result.current.theme).toBe('light')
    expect(again.result.current.preference).toBe('light')
  })
})
