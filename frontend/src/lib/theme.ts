/**
 * 화면 테마 (묶음 A, DESIGN.md §19.7): 사용자 선택(라이트·다크)을 저장하고, 선택이 없으면 시스템 설정을 따른다.
 *
 * - 선택 저장: localStorage `theme` = 'light' | 'dark'. 없거나 읽을 수 없으면 'system'(시스템 설정 따름).
 * - 시스템 설정: `prefers-color-scheme`. matchMedia가 없으면(옛 환경·테스트) 다크 — 제품 기본 화면이 다크다(§19.2).
 * - 적용: `<html data-theme="light|dark">`. 첫 그리기 전에는 index.html의 인라인 스크립트가 같은 규칙으로 먼저 건다(깜빡임 방지).
 *   CSS는 `data-theme="light"`일 때만 §17 밝은 토큰, 그 밖은 다크(tokens-a3.css) — JS가 없어도 다크다.
 * - 지도 톤(`data-map-tone`)은 이 값과 별개다: 테마는 **의도**, 지도 톤은 **실제 렌더 결과**(§19.3). MapView가 테마에 맞는
 *   지도를 만들고, 다크 스타일 실패 때 밝은 지도로 복구해도 테마 선택은 바꾸지 않는다.
 */
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

export const THEME_STORAGE_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function writePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // 저장이 막혀 있어도(사생활 보호 모드 등) 이번 세션의 선택은 그대로 쓴다
  }
}

export function systemTheme(): Theme {
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
  if (!mq) return 'dark'
  return mq.matches ? 'dark' : 'light'
}

export function resolveTheme(pref: ThemePreference, system: Theme = systemTheme()): Theme {
  return pref === 'system' ? system : pref
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

/**
 * 테마 상태. 선택을 바꾸면 저장하고 바로 적용한다. 'system'인 동안만 시스템 설정 변화를 따라간다.
 */
export function useTheme(): { theme: Theme; preference: ThemePreference; setPreference: (pref: ThemePreference) => void } {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [system, setSystem] = useState<Theme>(systemTheme)
  const theme = resolveTheme(preference, system)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    onChange()
    // 옛 브라우저·테스트 대역은 change 구독이 없을 수 있다 — 그러면 마운트 시점 값만 쓴다
    if (typeof mq.addEventListener !== 'function') return
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((pref: ThemePreference) => {
    writePreference(pref)
    setPreferenceState(pref)
  }, [])

  return { theme, preference, setPreference }
}
