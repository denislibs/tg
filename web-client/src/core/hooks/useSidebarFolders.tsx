import { useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useFolders, useFoldersStore, loadFolders } from '../../stores/foldersStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useNotifyStore } from '../../stores/notifyStore'
import { ALL_FOLDER_ID } from '../folderIds'
import { folderUnreadCounts } from '../folders/folderUnreadCounts'
import { cachedChat, peerMirrorVersion, subscribePeerMirror } from '../peerCache'
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
export function useSidebarFolders({ chats, onOpenFolderSettings }: {
  chats: Chat[]
  onOpenFolderSettings: () => void
}) {
  const managers = useManagers()
  const t = useT()
  const folders = useFolders()
  const folderId = useFoldersStore((st) => st.selectedId)
  const selectFolder = useFoldersStore((st) => st.select)
  const contactIds = useFoldersStore((st) => st.contactIds)
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null)

  const tabOrder = useMemo(() => [ALL_FOLDER_ID, ...folders.map((f) => f.id)], [folders])

  // Мемоизировано, чтобы <ChatList> получал стабильный проп — ре-рендер
  // сайдбара под тогл оверлея не пересоздаёт массив и не бьёт его memo.
  const archivedChats = useMemo(() => chats.filter((c) => !!c.archived), [chats])

  // Отбор строк ПАПКИ здесь больше не делается: список фильтрует себя сам
  // (`core/hooks/useDialogListSource`), где правило папки одно и на строки, и на
  // размер набора для пагинации. Второе такое правило здесь означало бы, что
  // витрина и пагинация считают папку по-разному.

  // Badge таба — правило одно на оба ряда: `core/folders/folderUnreadCounts.ts`
  // (порт tweb `stores/folders.ts:19-30`), им же считает Solid-стор
  // `stores/folders.solid.ts`. Хук уходит задачей 6 плана папок
  // (docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md), до тех
  // пор ряд и колонка читают отсюда только `count`. Карточка чата решает
  // «канал или группа» для правил папки и мьюта типа — отсюда подписка на
  // зеркало пиров.
  const dialogs = useChatsStore((s) => s.dialogs)
  const notifySettings = useNotifyStore((s) => s.settings)
  const peersVersion = useSyncExternalStore(subscribePeerMirror, peerMirrorVersion)
  const folderUnread: Record<number, number> = useMemo(() => {
    const counts: Record<number, number> = {}
    const all = folderUnreadCounts(dialogs, folders, contactIds, notifySettings, cachedChat)
    for (const id in all) counts[id] = all[id].count
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps -- peersVersion: движение зеркала пиров, читаемого через cachedChat
  }, [dialogs, folders, contactIds, notifySettings, peersVersion])

  // Прокрутку списка тут больше НЕ трогаем: у каждой папки свой
  // `.folders-scrollable` со своим `scrollTop` (`components/ChatList.tsx`, порт
  // tweb `generateScrollable`), и позиция папки обязана переживать уход на
  // соседнюю — как в tweb. Прежний ручной `scrollTop = 0` замещал то, чего у
  // нас не было (свой контейнер на папку), и был зарегистрированным исключением
  // в `core/scrollWriters.test.ts`; исключение снято вместе со строкой.
  const changeFolder = (id: number) => {
    if (id === folderId) return
    selectFolder(id)
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

  return {
    folders, folderId, tabOrder, contactIds,
    archivedChats, folderUnread,
    changeFolder, onTabContextMenu, overlays,
  }
}
