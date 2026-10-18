import { useEffect, useRef, useState, type RefObject } from 'react'
import { hiddenBelow } from '../lib/moreBelow.ts'
import './MoreBelow.css'

/**
 * "↓ 아래에 ○○ 포함 더 있어요" (A3 §19.1, 시안 a3.js moreBelow): 패널·펼친 시트 스크롤 영역 아래에 실제로 잘린 항목이 있을 때만
 * 아래 끝에 붙어 보이고, 끝까지 내리면 사라진다. 누르면 화면 70%만큼 내린다. 안내 문구만 넘치면 보이지 않는다.
 * 스크롤·크기 변화·탭 전환·펼침(aria-expanded·hidden)마다 다시 잰다
 */
export function MoreBelow({ scrollerRef }: { scrollerRef: RefObject<HTMLElement | null> }) {
  const [label, setLabel] = useState<string | null>(null)
  const queued = useRef(false)

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => {
      queued.current = false
      const name = hiddenBelow(scroller)
      setLabel(name === null ? null : `↓ 아래에 ${name ? `${name} 포함 ` : ''}더 있어요`)
    }
    const later = () => {
      if (queued.current) return
      queued.current = true
      requestAnimationFrame(update)
    }
    update()
    scroller.addEventListener('scroll', later, { passive: true })
    const ro = new ResizeObserver(later)
    ro.observe(scroller)
    const mo = new MutationObserver((records) => {
      if (records.some((r) => !(r.target instanceof Element && r.target.closest('.more-below')))) later()
    })
    mo.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-expanded', 'aria-selected'] })
    return () => {
      scroller.removeEventListener('scroll', later)
      ro.disconnect()
      mo.disconnect()
    }
  }, [scrollerRef])

  if (label === null) return null
  return (
    <div className="more-below">
      <span className="more-below__fade" aria-hidden="true" />
      <button
        type="button"
        className="more-below__button"
        onClick={() => {
          const s = scrollerRef.current
          s?.scrollBy({ top: s.clientHeight * 0.7, behavior: 'smooth' })
        }}
      >
        {label}
      </button>
    </div>
  )
}
