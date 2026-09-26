import { useState, type CSSProperties } from 'react'
import { useFolders, useFoldersStore, loadFolders } from '../../stores/foldersStore'
import { ALL_FOLDER_ID } from '../folderIds'
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

// Папки (tweb dialog filters): контекст-меню папки и удаление/редактирование.
// Меню и подтверждение — вьюпортные попапы, через глобальный popupStore (порт
// tweb createFolderContextMenu / Confirm.Remove). Редактор папки — экран
// колонки, отдаётся готовым overlays-узлом.
//
// Ряд вкладок, контейнеры папок и переключение живут у владельца
// `lib/appDialogsManager.ts` (задача 6 плана папок): порядок вкладок, выбор
// папки и счётчики отсюда ушли. React-меню (`openTabMenu`/`onTabContextMenu`)
// ждёт задачи 7 — порта `createFolderContextMenu` на оба ряда; до неё оно есть
// только у вертикальной колонки (у горизонтального ряда владельца меню нет —
// расхождение 11 его шапки).
export function useSidebarFolders({ chats, onOpenFolderSettings }: {
  chats: Chat[]
  onOpenFolderSettings: () => void
}) {
  const managers = useManagers()
  const t = useT()
  const folders = useFolders()
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)

  const doDeleteFolder = (f: Folder) => {
    useFoldersStore.getState().remove(f.id) // оптимистично
    // Откат оптимистичного удаления: память уже разъехалась с сервером, поэтому
    // cache-first обходим явным overwrite (tweb getDialogFilters(true)).
    managers.folders.del(f.id).catch(() => loadFolders(managers, { overwrite: true }))
  }

  const openDeleteFolder = (f: Folder) => openPopup((p) => (
    <Popup
      open={p.open}
      title={t('ChatList.Filter.Confirm.Remove.Header')}
      onClose={p.requestClose}
      onExitComplete={p.onExitComplete}
      width={360}
      action={{ label: t('Delete'), onClick: () => { p.requestClose(); doDeleteFolder(f) } }}
    >
      <div style={{ padding: '0 16px 8px' }}>
        <Text size={15}>
          {t('ChatList.Filter.Confirm.Remove.Text')}
        </Text>
      </div>
    </Popup>
  ))

  const openTabMenu = (id: number, pos: CSSProperties) => openPopup((p) => (
    // Правый клик всегда несёт left+top (координаты курсора) — панель растёт
    // вниз-вправо от точки клика, transform-origin 'top left' (_button.scss:250).
    <Menu open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} corner="bottom-right" style={pos}>
      {id === ALL_FOLDER_ID ? (
        <MenuItem
          icon={<TgIcon name="edit" size={20} />}
          label={t('FilterEditAll')}
          onClick={() => { p.requestClose(); onOpenFolderSettings() }}
        />
      ) : (
        <>
          <MenuItem
            icon={<TgIcon name="edit" size={20} />}
            label={t('FilterEdit')}
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

  return { onTabContextMenu, overlays }
}
