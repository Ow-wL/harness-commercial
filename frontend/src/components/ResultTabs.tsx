import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import './ResultTabs.css'

/**
 * 결과 패널 탭 (A3, DESIGN.md §19.1): 요약 · 주변 점포 · 상세 근거. WAI-ARIA tabs 패턴(←/→·Home·End로 이동하며 바로 고른다).
 * 패널은 모두 그려 두고 고르지 않은 것은 `hidden` — 주의 띠·관점 행·"데이터 출처"가 숨은 탭 안 대상으로 갈 수 있게
 * (TabRevealContext.reveal: 그 대상이 든 탭을 고른 뒤 포커스한다).
 */
import type { TabDef } from '../lib/resultTabs.ts'

export function TabList<K extends string>({
  label,
  tabs,
  selected,
  onSelect,
  idBase,
}: {
  label: string
  tabs: readonly TabDef<K>[]
  selected: K
  onSelect: (key: K) => void
  idBase: string
}) {
  const refs = useRef(new Map<K, HTMLButtonElement>())
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null) return
    e.preventDefault()
    const key = tabs[next]!.key
    onSelect(key)
    refs.current.get(key)?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.key}
          ref={(el) => {
            if (el) refs.current.set(t.key, el)
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.key}`}
          aria-controls={`${idBase}-panel-${t.key}`}
          aria-selected={t.key === selected}
          tabIndex={t.key === selected ? 0 : -1}
          className="tabs__tab"
          onClick={() => onSelect(t.key)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {t.label}
          {t.count != null && <span className="tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function TabPanel<K extends string>({
  tab,
  selected,
  idBase,
  children,
}: {
  tab: K
  selected: K
  idBase: string
  children: ReactNode
}) {
  return (
    <section
      id={`${idBase}-panel-${tab}`}
      role="tabpanel"
      data-tab={tab}
      aria-labelledby={`${idBase}-tab-${tab}`}
      hidden={tab !== selected}
      className="tabpanel"
    >
      {children}
    </section>
  )
}
