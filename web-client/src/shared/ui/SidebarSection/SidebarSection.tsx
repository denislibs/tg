import type { ReactNode } from 'react'
import classNames from '../../lib/classNames'
import s from './SidebarSection.module.scss'

interface SidebarSectionProps {
  /** заголовок секции (tweb -name: акцент, bold). Без него — карточка без шапки. */
  title?: ReactNode
  /** действие справа в строке заголовка (tweb -name-right: нормальный вес) */
  action?: ReactNode
  onActionClick?: () => void
  /** убрать тень карточки (tweb .no-shadow) */
  noShadow?: boolean
  /** убрать нижний margin (tweb .no-margin-bottom) */
  noMargin?: boolean
  /** контент без бокового инсета (tweb .full-width) */
  fullWidth?: boolean
  className?: string
  children: ReactNode
}

// Карточка-секция левого сайдбара (tweb .sidebar-left-section): surface-фон,
// скруглённая, с тенью; опциональные заголовок и действие справа.
export default function SidebarSection({
  title,
  action,
  onActionClick,
  noShadow,
  noMargin,
  fullWidth,
  className,
  children,
}: SidebarSectionProps) {
  return (
    <div className={s.container}>
      <div
        className={classNames(
          s.section,
          noShadow ? s.noShadow : '',
          noMargin ? s.noMargin : '',
          className ?? '',
        )}
      >
        {title != null && (
          <div className={s.name}>
            <span>{title}</span>
            {action != null && (
              <span className={s.nameRight} onClick={onActionClick}>
                {action}
              </span>
            )}
          </div>
        )}
        <div className={classNames(s.content, fullWidth ? s.fullWidth : '')}>{children}</div>
      </div>
    </div>
  )
}
