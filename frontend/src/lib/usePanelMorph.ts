import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const MORPH_MS = 360
const MORPH_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * 패널이 다른 자리로 바뀔 때(오른쪽 패널 ↔ 대시보드 시트) 이전 자리에서 새 자리로 이어서 움직인다(DESIGN.md §20.1).
 * 패널 DOM 은 그대로고 CSS 배치만 바뀌므로, 새 자리에서 이전 자리로 되돌린 transform 을 풀어 준다. 크기 차이로 글자가 늘어나 보이지
 * 않게 내용은 움직임 뒤쪽에서 나타난다. `animate` 가 없거나(jsdom·옛 브라우저) 동작 줄이기면 바로 새 자리다.
 */
export function usePanelMorph(ref: RefObject<HTMLElement | null>, placement: string) {
  const lastRect = useRef<DOMRect | null>(null)
  const lastPlacement = useRef(placement)

  // 창 크기 변경·시트 올리기/내리기가 끝난 뒤의 자리를 기억한다 — 다음 전환의 출발점
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      lastRect.current = el.getBoundingClientRect()
    }
    window.addEventListener('resize', read)
    el.addEventListener('transitionend', read)
    return () => {
      window.removeEventListener('resize', read)
      el.removeEventListener('transitionend', read)
    }
  }, [ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const from = lastRect.current
    const to = el.getBoundingClientRect()
    lastRect.current = to
    if (lastPlacement.current === placement) return
    lastPlacement.current = placement
    if (!from || typeof el.animate !== 'function' || !to.width || !to.height) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const moved = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
    el.animate([{ transform: moved, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], {
      duration: MORPH_MS,
      easing: MORPH_EASING,
    })
    for (const child of el.children) {
      child.animate({ opacity: [0, 0, 1], offset: [0, 0.5, 1] }, { duration: MORPH_MS, easing: 'linear' })
    }
  }, [ref, placement])
}
