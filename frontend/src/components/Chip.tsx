import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'
import './Chip.css'

/** Chip (DESIGN.md §7.6). 짧은 식별자에만 쓴다. 상태 칩은 항상 아이콘 + 글자. */
export function Chip({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'warning' | 'info'
  icon?: IconName
  children: ReactNode
}) {
  return (
    <span className={`chip chip--${tone}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}
