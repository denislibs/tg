import { cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import classNames from '../../lib/classNames'
import Icons from '@core/tgico-icons'

/** глиф шеврона подменю (tweb createSubmenuTrigger.ts:75 — `Icon('arrowhead')`) */
const ARROWHEAD = String.fromCharCode(parseInt(Icons.arrowhead, 16))

interface MenuItemProps {
  icon?: ReactNode
  label: ReactNode
  /** правый слот: галочка выбора (tweb кладёт `btn-menu-item-icon-right` на сам глиф) */
  right?: ReactNode
  danger?: boolean
  /** пункт раскрывает подменю: подпись уезжает в submenu-label + шеврон */
  submenu?: boolean
  className?: string
  onClick?: () => void
  onMouseEnter?: () => void
}

/** Добавить класс(ы) прямо на переданный узел-иконку.
 *
 * tweb вешает `btn-menu-item-icon` НА САМ глиф (`Icon(name, 'btn-menu-item-icon')`,
 * buttonMenu.ts:97), а не оборачивает его в span. Обёртка ломала бы геометрию:
 * `align-self: flex-start` + `margin-top: .125rem` + `width/height: var(--icon-size)`
 * из `_button.scss:350-363` рассчитаны на сам глиф. */
function withClass(node: ReactNode, ...cls: string[]): ReactNode {
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ className?: string }>
  return cloneElement(el, { className: classNames(el.props.className ?? '', ...cls) })
}

// Пункт меню — DOM 1:1 с tweb (`buttonMenu.ts::ButtonMenuItem`):
//   div.btn-menu-item.rp-overflow[.danger][.submenu-trigger]
//     span.tgico.btn-menu-item-icon
//     span.btn-menu-item-text
//     span.tgico.btn-menu-item-icon.btn-menu-item-icon-right   (галочка выбора)
// `rp-overflow` стоит всегда: в tweb это клип под ripple, который навешивается
// только на мобильных (IS_MOBILE), но класс в разметке безусловный.
// Собственных классов у пункта нет — вся геометрия, ховер, active scale(.96) и
// красный ховер `.danger` приходят из портированного `styles/tweb/_button.scss`.
export default function MenuItem({ icon, label, right, danger, submenu, className, onClick, onMouseEnter }: MenuItemProps) {
  return (
    <div
      className={classNames('btn-menu-item', 'rp-overflow', danger ? 'danger' : '', submenu ? 'submenu-trigger' : '', className ?? '')}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      {withClass(icon, 'btn-menu-item-icon')}
      <span className="btn-menu-item-text">
        {submenu ? (
          // tweb createSubmenuTrigger.ts:70-77 — подпись и шеврон лежат ВНУТРИ
          // `btn-menu-item-text`, а не рядом с ним.
          <span className="submenu-label">
            <span className="submenu-label-text">{label}</span>
            <span className="tgico">{ARROWHEAD}</span>
          </span>
        ) : (
          label
        )}
      </span>
      {withClass(right, 'btn-menu-item-icon', 'btn-menu-item-icon-right')}
    </div>
  )
}
