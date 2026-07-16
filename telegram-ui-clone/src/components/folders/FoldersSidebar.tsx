// Вертикальная колонка папок слева от списка чатов — порт tweb .folders-sidebar
// (_foldersSidebar.scss + foldersSidebarContent): сверху бургер главного меню,
// затем «Все чаты» и папки (иконка по типу или эмодзи из названия + имя +
// badge непрочитанных), снизу кнопка настроек папок (equalizer). Показывается
// при «Расположение папок → Слева от чатов» (settings.tabsInSidebar).
import { useState, type ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import TgIcon from '../TgIcon'
import type { IconName } from '../TgIcon'
import MainMenu from '../MainMenu'
import { useT } from '../../i18n'
import { ALL_FOLDER_ID } from '../../stores/foldersStore'
import type { Folder } from '../../core/managers/foldersManager'
import { extractFolderEmoji } from './labels'
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
  onLogout?: () => void
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

  return (
    <div className={s.root}>
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
        onLogout={menu.onLogout}
      />
    </div>
  )
}
