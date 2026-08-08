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

// Пункт меню — классы tweb (_button.scss:279): `.btn-menu-item[.danger]`
// с `.btn-menu-item-icon` и `.btn-menu-item-text`. Высота, паддинги, шрифт,
// инсетный скруглённый ховер (margin-inline: var(--btn-menu-padding) от .btn-menu),
// active scale(.96) и красный ховер у danger — оттуда.
export default function MenuItem({ icon, label, right, danger, onClick }: MenuItemProps) {
  return (
    <div className={classNames('btn-menu-item', danger ? 'danger' : '', s.item)} onClick={onClick}>
      {icon && <span className={classNames('btn-menu-item-icon', s.icon)}>{icon}</span>}
      <span className={classNames('btn-menu-item-text', s.label)}>{label}</span>
      {right && <span className={classNames('btn-menu-item-icon-right', s.right)}>{right}</span>}
    </div>
  )
}
