import { useEffect, useState } from 'react'

/** 결과 공개 연출(13-46, D-045)의 숫자 오르기 시간 */
export const COUNT_UP_MS = 900

/** 움직임을 원한다고 브라우저가 분명히 알릴 때만 움직인다 — matchMedia 가 없거나(테스트·옛 브라우저) 줄이기 설정이면 바로 최종값 */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: no-preference)')?.matches === true
}

type CountState = { target: number | null; value: number | null; running: boolean }

const startOf = (target: number | null): CountState =>
  target !== null && motionAllowed() ? { target, value: 0, running: true } : { target, value: target, running: false }

/**
 * 점수 숫자가 0 → 값으로 올라가는 연출. 처음 보일 때와 값이 바뀔 때마다(새 분석·반경 바꾸기) 다시 오른다.
 * 반환: 지금 보일 값과 움직이는 중인지. 움직이는 동안 화면 읽기 프로그램에는 최종값을 따로 준다(부르는 쪽).
 * 값 자체를 바꾸거나 반올림하지 않는다 — 끝나면 엔진 값 그대로다.
 */
export function useCountUp(target: number | null): { value: number | null; running: boolean } {
  const [state, setState] = useState<CountState>(() => startOf(target))
  if (state.target !== target) setState(startOf(target))  // 렌더 중 상태 맞추기(React 권장 패턴)
  const running = state.target === target && state.running
  useEffect(() => {
    if (!running || target === null) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      if (t >= 1) {
        setState({ target, value: target, running: false })
        return
      }
      setState((s) => (s.target === target ? { ...s, value: target * (1 - Math.pow(1 - t, 3)) } : s))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, target])
  return state.target === target ? { value: state.value, running } : { value: target, running: false }
}
