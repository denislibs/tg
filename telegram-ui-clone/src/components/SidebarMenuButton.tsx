// src/components/SidebarMenuButton.tsx
// The sidebar's leading ≡ button. It owns the open/closed state of the main menu
// (so Sidebar no longer holds menuOpen) and renders the MainMenu itself. When the
// search is open it morphs into a back arrow that closes the search instead.
import { memo, useState } from 'react'
import IconButton from '../shared/ui/IconButton'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'
import MainMenu from './MainMenu'

export interface SidebarMenuButtonProps {
  searching: boolean
  onBack: () => void // close search (when searching)
  onOpenSettings: () => void
  onOpenContacts: () => void
  onOpenSaved: () => void
  onOpenPremium: () => void
  onLogout?: () => void
  onToggleMode?: (coords?: { x: number; y: number }) => void
}

function SidebarMenuButton({
  searching, onBack, onOpenSettings, onOpenContacts, onOpenSaved, onOpenPremium, onLogout, onToggleMode,
}: SidebarMenuButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)
  // Run a menu action then close the menu.
  const act = (fn: () => void) => () => { close(); fn() }

  return (
    <>
      <IconButton
        onClick={() => (searching ? onBack() : setMenuOpen((o) => !o))}
        color="var(--tg-textSecondary)"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={searching ? 'back' : 'menu'}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ display: 'inline-flex' }}
          >
            {searching ? <TgIcon name="back" size={24} /> : <TgIcon name="menu" size={24} />}
          </motion.span>
        </AnimatePresence>
      </IconButton>
      <MainMenu
        open={menuOpen}
        onClose={close}
        onOpenSettings={act(onOpenSettings)}
        onOpenContacts={act(onOpenContacts)}
        onOpenSaved={act(onOpenSaved)}
        onOpenPremium={act(onOpenPremium)}
        onLogout={onLogout ? act(onLogout) : undefined}
        onToggleMode={onToggleMode}
      />
    </>
  )
}

export default memo(SidebarMenuButton)
