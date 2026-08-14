// src/components/SidebarMenuButton.tsx
// Содержимое tweb `.sidebar-header__btn-container.left-sidebar-burger` (живой DOM §2,
// index.html:93-96 + sidebarLeft/index.ts:156-197):
//
//   div.animated-menu-icon[.state-back]                              ← сам глиф ≡ ↔ ←
//   button.btn-icon.rp.btn-menu-toggle.sidebar-tools-button[.is-visible]  ← открыть меню
//   div.btn-icon.sidebar-back-button[.is-visible]                    ← закрыть поиск
//
// Три «полоски» бургера рисует CSS (_animatedIcon.scss), морф в стрелку — класс
// `state-back` на нём же. Обе кнопки лежат друг на друге (`.left-sidebar-burger
// .btn-icon { position:absolute; inset:0 }`), видима та, у которой `is-visible` —
// ровно как в эффекте tweb (sidebarLeft/index.ts:408-418):
//   showBack = foldersSidebarShown || isLeftSearchActive
// (панель папок у нас скрывает бургер целиком, поэтому здесь остаётся поиск).
//
// Внутри кнопки — бейдж непрочитанного ДРУГИХ аккаунтов
// (`span.badge.badge-20.badge-primary.sidebar-tools-button-notifications`,
// sidebarLeft/index.ts). Источника числа у нас пока нет: воркер не считает
// непрочитанное неактивных аккаунтов, поэтому бейдж всегда пустой и несёт
// `is-badge-empty` — ровно то состояние, в котором он снят с живого клиента
// (дамп `14-left-01-chatlist.json`). Появится счётчик — сюда придёт число.
import { memo, useState } from 'react'
import classNames from '../shared/lib/classNames'
import IconButton from '../shared/ui/IconButton'
import MainMenu from './MainMenu'

export interface SidebarMenuButtonProps {
  searching: boolean
  onBack: () => void // close search (when searching)
  onOpenSettings: () => void
  onOpenContacts: () => void
  onOpenSaved: () => void
  onOpenPremium: () => void
  onOpenMyStories?: () => void
  onOpenCloseFriends?: () => void
  onOpenWallet?: () => void
  onOpenCalls?: () => void
  onLogout?: () => void
  onToggleMode?: (coords?: { x: number; y: number }) => void
}

function SidebarMenuButton({
  searching, onBack, onOpenSettings, onOpenContacts, onOpenSaved, onOpenPremium, onOpenMyStories, onOpenCloseFriends, onOpenWallet, onOpenCalls, onLogout, onToggleMode,
}: SidebarMenuButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = () => setMenuOpen(false)
  // Run a menu action then close the menu.
  const act = (fn: () => void) => () => { close(); fn() }
  const showBack = searching

  return (
    <>
      <div className={classNames('animated-menu-icon', showBack ? 'state-back' : '')} />
      <IconButton
        className={classNames('btn-menu-toggle', 'sidebar-tools-button', showBack ? '' : 'is-visible')}
        onClick={() => setMenuOpen((o) => !o)}
        color="var(--secondary-text-color)"
        aria-label="Меню"
      >
        <span className="badge badge-20 badge-primary is-badge-empty sidebar-tools-button-notifications" />
      </IconButton>
      <div
        className={classNames('btn-icon', 'sidebar-back-button', showBack ? 'is-visible' : '')}
        onClick={onBack}
      />
      <MainMenu
        open={menuOpen}
        onClose={close}
        onOpenSettings={act(onOpenSettings)}
        onOpenContacts={act(onOpenContacts)}
        onOpenSaved={act(onOpenSaved)}
        onOpenPremium={act(onOpenPremium)}
        onOpenMyStories={onOpenMyStories ? act(onOpenMyStories) : undefined}
        onOpenCloseFriends={onOpenCloseFriends ? act(onOpenCloseFriends) : undefined}
        onOpenWallet={onOpenWallet ? act(onOpenWallet) : undefined}
        onOpenCalls={onOpenCalls ? act(onOpenCalls) : undefined}
        onLogout={onLogout ? act(onLogout) : undefined}
        onToggleMode={onToggleMode}
      />
    </>
  )
}

export default memo(SidebarMenuButton)
