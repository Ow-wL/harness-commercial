/**
 * 결과 패널 탭 상태 (A3, components/ResultTabs.tsx). 탭 패널은 모두 그려 두고 고르지 않은 것은 `hidden`이라,
 * 숨은 탭 안 대상(주의 띠 ›·관점 행·"데이터 출처")으로 갈 때는 그 탭을 먼저 고른 뒤 포커스한다.
 */
import { createContext, useContext, useId, useLayoutEffect, useState } from 'react'

export type TabDef<K extends string> = { key: K; label: string; count?: number | null }

/** 대상 id로 가기: 숨은 탭 안이면 그 탭을 먼저 고르고, 그려진 뒤 대상으로 스크롤·포커스한다 */
export const TabRevealContext = createContext<((id: string) => void) | null>(null)

export function useRevealTarget(): (id: string) => void {
  const reveal = useContext(TabRevealContext)
  return reveal ?? focusTarget
}

/** 섹션 제목 등 원래 포커스를 받지 않는 대상은 tabindex=-1 을 붙여 포커스한다 */
export function focusTarget(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
  el.scrollIntoView?.({ block: 'start' })
  el.focus({ preventScroll: true })
}

export function useResultTabs<K extends string>(initial: K) {
  const [tab, setTab] = useState<K>(initial)
  const [pending, setPending] = useState<{ id: string; n: number } | null>(null)
  // 고른 탭이 그려진 뒤(layout) 대상으로 간다
  useLayoutEffect(() => {
    if (pending) focusTarget(pending.id)
  }, [pending])
  const reveal = (id: string) => {
    const el = document.getElementById(id)
    const panel = el?.closest<HTMLElement>('[role="tabpanel"][data-tab]')
    const key = panel?.dataset.tab as K | undefined
    if (key && key !== tab) setTab(key)
    setPending((p) => ({ id, n: (p?.n ?? 0) + 1 }))
  }
  return { tab, setTab, reveal }
}

/** 탭 id 접두어 (같은 화면에 탭 묶음이 하나뿐이어도 useId로 겹침을 막는다) */
export function useTabIdBase(): string {
  return `tabs${useId().replace(/[^a-zA-Z0-9]/g, '')}`
}
