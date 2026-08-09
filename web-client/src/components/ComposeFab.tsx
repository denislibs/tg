// src/components/ComposeFab.tsx
// The sidebar's compose FAB (bottom-right ✎). It owns the open/closed state of the
// compose menu (so Sidebar no longer holds composeOpen) and renders ComposeMenu
// itself. Hidden while the search is open.
import { memo, useRef, useState } from 'react'
import classNames from '../shared/lib/classNames'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import ComposeMenu from './ComposeMenu'

export interface ComposeFabProps {
  searching: boolean
  onNewGroup: () => void
  onNewPrivate: () => void
  onNewChannel: () => void
  onNewSecret: () => void
}

function ComposeFab({ searching, onNewGroup, onNewPrivate, onNewChannel, onNewSecret }: ComposeFabProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const fabRef = useRef<HTMLButtonElement>(null)
  // Меню растёт из правого верхнего угла FAB (tweb: btn-menu над кнопкой,
  // выровнено по её правому краю) — позиция от живого ректа, а не хардкод.
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null)
  const toggle = () => {
    const r = fabRef.current?.getBoundingClientRect()
    if (r) setAnchor({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 })
    setOpen((o) => !o)
  }

  return (
    <>
      {/* FAB — tweb #new-menu (живой DOM §2): ButtonCorner-набор классов
          `btn-new-menu btn-circle rp btn-corner z-depth-1 btn-menu-toggle
          animated-button-icon`. Геометрию (54×54, right/bottom 20, пружинку
          --btn-corner-transition, акцентный фон) даёт `.btn-corner`/`.btn-circle`
          из _button.scss — свои inline-стили убраны.
          Видимость — класс `is-visible` (tweb), а не размонтирование.
          Морф ✎↔✕ — тоже tweb 1:1 (`sidebarLeft/index.ts:1071-1072`): ОБЕ иконки
          всегда в DOM с классами `animated-button-icon-icon` +
          `animated-button-icon-icon-first/-last`; по умолчанию каждая играет
          `hide-icon .4s` (_animatedIcon.scss:159-170), а нужную выводит правило
          `.btn-corner:not(.menu-open) …-first, .btn-corner.menu-open …-last`
          (_leftSidebar.scss:455-460) через `grow-icon .4s`. Своего JS-поворота
          на 90° в оригинале нет. */}
      <IconButton
        ref={fabRef}
        id="new-menu"
        tabIndex={-1}
        onClick={toggle}
        className={classNames(
          'btn-new-menu', 'btn-circle', 'rp', 'btn-corner', 'z-depth-1',
          'btn-menu-toggle', 'animated-button-icon',
          searching ? '' : 'is-visible',
          open ? 'menu-open' : '',
        )}
        color="#fff"
      >
        <TgIcon name="newchat_filled" size={24} className="animated-button-icon-icon animated-button-icon-icon-first" />
        <TgIcon name="close" size={24} className="animated-button-icon-icon animated-button-icon-icon-last" />
      </IconButton>

      <ComposeMenu
        open={open}
        anchor={anchor}
        onClose={close}
        onNewGroup={onNewGroup}
        onNewPrivate={onNewPrivate}
        onNewChannel={onNewChannel}
        onNewSecret={onNewSecret}
      />
    </>
  )
}

export default memo(ComposeFab)
