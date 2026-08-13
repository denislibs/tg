import { useMemo, useState, type CSSProperties, type RefObject } from 'react'
import { useFolders, useFoldersStore, loadFolders, ALL_FOLDER_ID } from '../../stores/foldersStore'
import { chatMatchesFolder } from '../folderFilter'
import { openPopup } from '../../stores/popupStore'
import { useManagers } from './useManagers'
import { useT } from '../../i18n'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import Popup from '../../shared/ui/Popup'
import Text from '../../shared/ui/Text'
import TgIcon from '../../components/TgIcon'
import FolderEditor from '../../components/folders/FolderEditor'
import type { Folder } from '../managers/foldersManager'
import type { Chat } from '../../data'

// Папки (tweb dialog filters): данные для табов/списка + контекст-меню таба и
// удаление/редактирование папки. Меню и подтверждение — вьюпортные попапы, через
// глобальный popupStore (порт tweb createFolderContextMenu / Confirm.Remove).
// Редактор папки — экран колонки, отдаётся готовым overlays-узлом.
export function useSidebarFolders({ chats, listScrollRef, onOpenFolderSettings }: {
  chats: Chat[]
  listScrollRef: RefObject<HTMLDivElement | null>
  onOpenFolderSettings: () => void
}) {
  const managers = useManagers()
  const t = useT()
  const folders = useFolders()
  const folderId = useFoldersStore((st) => st.selectedId)
  const selectFolder = useFoldersStore((st) => st.select)
  const contactIds = useFoldersStore((st) => st.contactIds)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)

  const activeFolder = folders.find((f) => f.id === folderId)
  const tabOrder = useMemo(() => [ALL_FOLDER_ID, ...folders.map((f) => f.id)], [folders])

  const visibleChats = useMemo(() => chats.filter((c) => !c.archived), [chats])
  const archivedChats = useMemo(() => chats.filter((c) => !!c.archived), [chats])

  // Мемоизировано, чтобы <ChatList>/<FolderTabs> получали стабильные пропсы —
  // ре-рендер сайдбара под тогл оверлея не пересоздаёт массивы и не бьёт их memo.
  const filtered = useMemo(
    () => (activeFolder ? visibleChats.filter((c) => chatMatchesFolder(c, activeFolder, contactIds)) : visibleChats),
    [visibleChats, activeFolder, contactIds],
  )

  // Badge таба = число непрочитанных чатов папки (tweb folders-tabs Badge);
  // у «Все» — только незамьюченные (tweb unreadUnmutedCount).
  const folderUnread: Record<number, number> = useMemo(() => {
    const counts: Record<number, number> = {
      [ALL_FOLDER_ID]: visibleChats.filter((c) => c.unread && !c.muted).length,
    }
    for (const f of folders) counts[f.id] = visibleChats.filter((c) => c.unread && chatMatchesFolder(c, f, contactIds)).length
    return counts
  }, [visibleChats, folders, contactIds])

  const changeFolder = (id: number) => {
    if (id === folderId) return
    selectFolder(id)
    const el = listScrollRef.current
    if (el) el.scrollTop = 0
  }

  const doDeleteFolder = (f: Folder) => {
    useFoldersStore.getState().remove(f.id) // оптимистично
    // Откат оптимистичного удаления: память уже разъехалась с сервером, поэтому
    // cache-first обходим явным overwrite (tweb getDialogFilters(true)).
    managers.folders.del(f.id).catch(() => loadFolders(managers, { overwrite: true }))
  }

  const openDeleteFolder = (f: Folder) => openPopup((p) => (
    <Popup
      open={p.open}
      title={t('Remove Folder')}
      onClose={p.requestClose}
      onExitComplete={p.onExitComplete}
      width={360}
      action={{ label: t('Delete'), onClick: () => { p.requestClose(); doDeleteFolder(f) } }}
    >
      <div style={{ padding: '0 16px 8px' }}>
        <Text size={15}>
          {t('Are you sure you want to remove this folder? Your chats will not be deleted.')}
        </Text>
      </div>
    </Popup>
  ))

  const openTabMenu = (id: number, pos: CSSProperties) => openPopup((p) => (
    <Menu open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} style={pos}>
      {id === ALL_FOLDER_ID ? (
        <MenuItem
          icon={<TgIcon name="edit" size={20} />}
          label={t('Edit folders')}
          onClick={() => { p.requestClose(); onOpenFolderSettings() }}
        />
      ) : (
        <>
          <MenuItem
            icon={<TgIcon name="edit" size={20} />}
            label={t('Edit folder')}
            onClick={() => { p.requestClose(); const f = folders.find((x) => x.id === id); if (f) setEditingFolder(f) }}
          />
          <MenuItem
            icon={<TgIcon name="delete" size={20} />}
            label={t('Delete')}
            danger
            onClick={() => { p.requestClose(); const f = folders.find((x) => x.id === id); if (f) openDeleteFolder(f) }}
          />
        </>
      )}
    </Menu>
  ))

  // Правый клик по табу — меню папки (tweb createFolderContextMenu)
  const onTabContextMenu = (id: number, e: React.MouseEvent) => {
    e.preventDefault()
    openTabMenu(id, { left: e.clientX, top: e.clientY })
  }

  // Редактор папки из контекстного меню таба — экран колонки, то есть вкладка
  // слайдера сайдбара (tweb `SidebarSlider.createTab` + `TransitionSlider` типа
  // 'navigation', `components/slider.ts:41-46`). Вход/уход вкладки ведёт сам
  // экран (`components/settings/kit.tsx` → SettingsScreen), обёртка-презенс тут
  // не нужна: держать узел на время ухода — это его собственная забота.
  const overlays = editingFolder && (
    <FolderEditor folder={editingFolder} chats={chats} onClose={() => setEditingFolder(null)} />
  )

  return {
    folders, folderId, activeFolder, tabOrder, contactIds,
    filtered, archivedChats, folderUnread,
    changeFolder, onTabContextMenu, overlays,
  }
}
