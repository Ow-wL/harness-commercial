/**
 * 전시 모드(13-46, D-045): 전시장 큰 화면에서 아무도 만지지 않으면 업종 지도 → 높은 동 분석을 번갈아 자동으로 보이고,
 * 누가 화면을 누르거나 키를 누르면 멈추고 처음 화면으로 돌아간다. 일반 사용자에게는 없는 기능이다.
 * 켜기: 주소에 `?kiosk=1` (이 브라우저에 기억 — 새로고침해도 유지), 끄기: `?kiosk=0`.
 */
import { useEffect, useRef } from 'react'

const STORAGE_KEY = 'kiosk'

/** 이 브라우저가 전시 모드인지. 주소의 kiosk=1·0 을 기억에 옮긴다. 저장소가 막혀 있으면 주소만 본다 */
export function readKioskFlag(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  const q = new URLSearchParams(search).get('kiosk')
  try {
    if (q === '1') localStorage.setItem(STORAGE_KEY, '1')
    else if (q === '0') localStorage.removeItem(STORAGE_KEY)
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return q === '1'
  }
}

/** 자동 시연 차례: 업종 지도(인천 전체) → 그 업종 점수가 높은 동 한 곳 분석. 화면에 오래 둘 시간(ms) */
export const ATTRACT_HEAT_MS = 8_000
export const ATTRACT_RESULT_MS = 14_000
/** 마지막 조작 뒤 이만큼 아무도 만지지 않으면 자동 시연으로 돌아간다 */
export const KIOSK_IDLE_MS = 90_000
/** 자동 시연이 도는 업종 (생활 업종 위주, 그룹이 섞이게) */
export const ATTRACT_BIZ = ['I21201', 'G20405', 'I21006', 'S20701', 'R10406', 'I21001', 'P10603', 'R10407'] as const

/**
 * 마지막 조작 시각을 지켜본다: 화면을 누르거나(pointerdown) 키를 누르면 onInput, 그 뒤 idleMs 동안 조작이 없으면 onIdle.
 * enabled 가 false 면 아무것도 하지 않는다. 입력은 캡처 단계에서 본다(지도·버튼이 먼저 막아도 알 수 있게).
 */
export function useIdleWatch(enabled: boolean, idleMs: number, onInput: () => void, onIdle: () => void) {
  const inputRef = useRef(onInput)
  const idleRef = useRef(onIdle)
  useEffect(() => {
    inputRef.current = onInput
    idleRef.current = onIdle
  })
  useEffect(() => {
    if (!enabled) return
    let timer = window.setTimeout(() => idleRef.current(), idleMs)
    const touch = () => {
      inputRef.current()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => idleRef.current(), idleMs)
    }
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('keydown', touch, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', touch, true)
      window.removeEventListener('keydown', touch, true)
    }
  }, [enabled, idleMs])
}
