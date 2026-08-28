// Вертикальная колонка папок слева от списка чатов — порт tweb .folders-sidebar
// (_foldersSidebar.scss + foldersSidebarContent): сверху бургер главного меню,
// затем «Все чаты» и папки (иконка по типу или эмодзи из названия + имя +
// badge непрочитанных), снизу кнопка настроек папок (equalizer). Показывается
// при «Расположение папок → Слева от чатов» (settings.tabsInSidebar).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import type { IconName } from '../TgIcon'
import MainMenu from '../MainMenu'
import { useT } from '../../i18n'
import { ALL_FOLDER_ID } from '../../core/folderIds'
import type { Folder } from '../../core/managers/foldersManager'
import { extractFolderEmoji } from './labels'
import { onActiveGradientRendererChange } from '../../core/chat/activeGradient'
import s from './FoldersSidebar.module.scss'

// tweb getIconForFilter: один включённый тип без точечных чатов — иконка типа,
// иначе — общая иконка папки.
function folderIcon(f: Folder): IconName {
  if (f.includeChats.length === 0) {
    const active: IconName[] = []
    if (f.contacts) active.push('newprivate_filled')
    if (f.nonContacts) active.push('noncontacts')
    if (f.groups) active.push('group_filled')
    if (f.broadcasts) active.push('channel_filled')
    if (active.length === 1) return active[0]
  }
  return 'limit_folders'
}

function Item({
  icon,
  name,
  badge,
  selected,
  onClick,
  onContextMenu,
}: {
  icon: ReactNode
  name?: string
  badge?: number
  selected?: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className={classNames(s.item, selected ? s.selected : '')}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {icon}
      {name != null && <span className={s.name}>{name}</span>}
      {badge != null && badge > 0 && <span className={s.badge}>{badge > 99 ? '99+' : badge}</span>}
    </div>
  )
}

export interface MainMenuHandlers {
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

export default function FoldersSidebar({
  folders,
  selectedId,
  counts,
  onSelect,
  onContextMenu,
  onOpenFolderSettings,
  menu,
}: {
  folders: Folder[]
  selectedId: number
  counts: Record<number, number>
  onSelect: (id: number) => void
  onContextMenu: (id: number, e: React.MouseEvent) => void
  onOpenFolderSettings: () => void
  menu: MainMenuHandlers
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const [hasGradient, setHasGradient] = useState(false)
  const [isDarkPattern, setIsDarkPattern] = useState(false)

  // Зеркалим градиент обоев чата в свой холст — дешёвая замена
  // `backdrop-filter: blur(40px)` (порт tweb foldersSidebarContent/index.tsx:94-116).
  // Колонка всегда лежит поверх фона чата, поэтому видимый результат тяжёлого
  // блюра над этой областью математически близок к самому градиенту.
  useEffect(() => {
    let detachMirror: (() => void) | undefined
    const unsubscribe = onActiveGradientRendererChange((renderer, meta) => {
      detachMirror?.()
      detachMirror = undefined
      const canvas = backgroundCanvasRef.current
      if (renderer && canvas) {
        detachMirror = renderer.attachMirror(canvas)
        setHasGradient(true)
      } else {
        setHasGradient(false)
      }
      setIsDarkPattern(!!meta?.isDarkMaskPattern)
    })
    return () => {
      unsubscribe()
      detachMirror?.()
    }
  }, [])

  // Портал в #main-columns: в tweb #folders-sidebar — соседняя колонка каркаса
  // (живой DOM §1), а не потомок #column-left.
  return createPortal(
    <div id="folders-sidebar" className={classNames('folders-sidebar', 'sidebar-left-common', s.root)}>
      {/* tweb folders-sidebar__background: зеркало градиента обоев + тинт
          (ветка --no-gradient — падение обратно на backdrop-filter) */}
      <div
        className={classNames(
          s.background,
          hasGradient ? '' : s.backgroundNoGradient,
          isDarkPattern ? s.backgroundDarkPattern : '',
        )}
      >
        <canvas ref={backgroundCanvasRef} className={s.backgroundGradient} />
        <div className={s.backgroundTint} />
      </div>
      {/* tweb folders-sidebar__menu-button.is-first — бургер главного меню */}
      <div className={classNames(s.item, s.menuButton)} onClick={() => setMenuOpen(true)}>
        <TgIcon name="menu" size={24} />
      </div>

      <div className={s.scroll}>
        <Item
          icon={<TgIcon name="round_chats_filled" size={30} />}
          name={t('All Chats')}
          badge={counts[ALL_FOLDER_ID]}
          selected={selectedId === ALL_FOLDER_ID}
          onClick={() => onSelect(ALL_FOLDER_ID)}
          onContextMenu={(e) => onContextMenu(ALL_FOLDER_ID, e)}
        />
        {folders.map((f) => {
          const [emoji, name] = extractFolderEmoji(f.title)
          return (
            <Item
              key={f.id}
              icon={emoji ? <span className={s.emoji}>{emoji}</span> : <TgIcon name={folderIcon(f)} size={30} />}
              name={name}
              badge={counts[f.id]}
              selected={selectedId === f.id}
              onClick={() => onSelect(f.id)}
              onContextMenu={(e) => onContextMenu(f.id, e)}
            />
          )
        })}
      </div>

      {/* tweb folders-sidebar__menu-button.is-last — настройки папок */}
      <div className={classNames(s.item, s.menuButton)} onClick={onOpenFolderSettings}>
        <TgIcon name="equalizer" size={24} />
      </div>

      <MainMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenSettings={() => {
          setMenuOpen(false)
          menu.onOpenSettings()
        }}
        onOpenContacts={() => {
          setMenuOpen(false)
          menu.onOpenContacts()
        }}
        onOpenSaved={() => {
          setMenuOpen(false)
          menu.onOpenSaved()
        }}
        onOpenPremium={() => {
          setMenuOpen(false)
          menu.onOpenPremium()
        }}
        onOpenMyStories={menu.onOpenMyStories ? () => { setMenuOpen(false); menu.onOpenMyStories!() } : undefined}
        onOpenCloseFriends={menu.onOpenCloseFriends ? () => { setMenuOpen(false); menu.onOpenCloseFriends!() } : undefined}
        onOpenWallet={menu.onOpenWallet ? () => { setMenuOpen(false); menu.onOpenWallet!() } : undefined}
        onOpenCalls={menu.onOpenCalls ? () => { setMenuOpen(false); menu.onOpenCalls!() } : undefined}
        onLogout={menu.onLogout}
        onToggleMode={menu.onToggleMode}
      />
    </div>,
    document.getElementById('main-columns') ?? document.body,
  )
}
