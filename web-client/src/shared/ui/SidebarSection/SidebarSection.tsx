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

// Карточка-секция левого сайдбара — классы tweb (_section.scss):
//   .sidebar-left-section-container > .sidebar-left-section[.no-shadow][.no-margin-bottom]
//     > [.sidebar-left-section-name > span + span.sidebar-left-section-name-right]
//     + .sidebar-left-section-content[.full-width]
// Фон, радиус, тень, отступы (--section-padding-inline / --section-margin-inline /
// --section-padding-bottom) — из партиала.
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
    <div className="sidebar-left-section-container">
      <div
        className={classNames(
          'sidebar-left-section',
          noShadow ? 'no-shadow' : '',
          noMargin ? 'no-margin-bottom' : '',
          className ?? '',
        )}
      >
        {title != null && (
          <div className={classNames('sidebar-left-section-name', s.name)}>
            <span>{title}</span>
            {action != null && (
              <span className={classNames('sidebar-left-section-name-right', s.nameRight)} onClick={onActionClick}>
                {action}
              </span>
            )}
          </div>
        )}
        <div className={classNames('sidebar-left-section-content', fullWidth ? 'full-width' : '')}>{children}</div>
      </div>
    </div>
  )
}
