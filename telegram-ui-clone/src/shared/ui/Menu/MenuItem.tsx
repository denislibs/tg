import type { ReactNode } from 'react'
import classNames from '../../lib/classNames'
import s from './MenuItem.module.scss'

interface MenuItemProps {
  icon?: ReactNode
  label: ReactNode
  /** right-side content (chevron, shortcut, …) */
  right?: ReactNode
  danger?: boolean
  onClick?: () => void
}

// Menu row — tweb .btn-menu-item metrics. Used inside <Menu> for consistent look.
export default function MenuItem({ icon, label, right, danger, onClick }: MenuItemProps) {
  return (
    <div className={classNames(s.item, danger ? s.danger : '')} onClick={onClick}>
      {icon && <span className={s.icon}>{icon}</span>}
      <span className={s.label}>{label}</span>
      {right && <span className={s.right}>{right}</span>}
    </div>
  )
}
