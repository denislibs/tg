// src/components/ComposeFab.tsx
// The sidebar's compose FAB (bottom-right ✎). It owns the open/closed state of the
// compose menu (so Sidebar no longer holds composeOpen) and renders ComposeMenu
// itself. Hidden while the search is open.
import { memo, useRef, useState } from 'react'
import classNames from '../shared/lib/classNames'
import { motion } from 'framer-motion'
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
          Видимость — класс `is-visible` (tweb), а не размонтирование. */}
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
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ display: 'inline-flex' }}
        >
          {open ? <TgIcon name="close" size={24} /> : <TgIcon name="newchat_filled" size={24} />}
        </motion.span>
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
