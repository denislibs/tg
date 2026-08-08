import type { ReactNode } from 'react'
import classNames from '../../lib/classNames'
import s from './Badge.module.scss'

interface BadgeProps {
  children: ReactNode
  /** muted dialogs use a gray badge instead of the accent (tweb .badge-gray) */
  muted?: boolean
  /** размер пилюли: у tweb классы есть на 18/20/24, база (без класса) — 22 */
  size?: 18 | 20 | 22 | 24
  className?: string
}

// Пилюля-счётчик — классы tweb (`createBadge('span', N, 'primary')`):
// `span.badge.badge-{N}.badge-{primary|gray}` (_badge.scss). Размеры, цвета,
// радиус и transition — оттуда; `badge-22` = база, своего правила у tweb нет.
export default function Badge({ children, muted, size = 22, className }: BadgeProps) {
  return (
    <span className={classNames('badge', `badge-${size}`, muted ? 'badge-gray' : 'badge-primary', s.root, className ?? '')}>
      {children}
    </span>
  )
}
