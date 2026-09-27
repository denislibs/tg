// Порт tweb `src/helpers/dom/createFolderContextMenu.ts:1-75` — контекстное
// меню папки, ОДНО на оба ряда (`docs/tweb/folders-tabs.md` § 1.7):
// горизонтальный ряд владельца папок (`lib/appDialogsManager.ts`; tweb
// `appDialogsManager.ts:814-821`, `listenTo: folders.menu`,
// `className: 'menu-horizontal-div-item'`) и вертикальная колонка
// (`components/folders/FoldersSidebar.tsx`; tweb
// `foldersSidebarContent/index.tsx:84-92`, `className: 'folders-sidebar__folder-item'`).
//
// Поверх портированного `createContextMenu`: пункты фильтруются `verify` перед
// каждым открытием, не прошедший НЕ СОЗДАЁТСЯ. Папка — из
// `target.dataset.filterId` (`:69-71`), ставят его сами ряды.
//
// Адаптации (каждая — из-за отсутствующей у нас подсистемы):
//   • `appSidebarLeft` + классы вкладок `AppEditFolderTab`/`AppChatFoldersTab`
//     (`:10-12`, `:28-30`, `:46-48`) → объект колонки `FolderContextMenuSidebar`:
//     `closeTabsBefore` — тот же метод (`sidebarLeft/index.ts:1613-1616`), а
//     `createTab(X).open(...)` — `openEditFolderTab(filter)`/`openChatFoldersTab()`:
//     колоночного слайдера у нас ещё нет (шов, задача 28 плана 2D), вкладки
//     открывает колонка (`Sidebar.tsx::openColumnTab` — хост слайдера над ней);
//   • `managers.filtersStorage.getFilter(id)` (`:26`, RPC в воркер) →
//     синхронное чтение `appState.folders`: папки у нас живут на главном потоке;
//     папки нет (успела уйти пушем) — нет и экрана (у tweb редактор открылся бы
//     с `initFilter: undefined`, то есть как новая папка);
//   • `AppEditFolderTab.deleteFolder` (`:63`) → порт `deleteFolder` из
//     `components/sidebarLeft/tabs/editFolderShared.ts` (у tweb его же
//     пробрасывает `solidJsTabs/tabs.ts:628-640`); отказ в подтверждении (у
//     tweb — необработанное отклонение) гасится здесь;
//   • `REAL_FOLDERS` (`:25`, «Все чаты» + архив) — наши `ALL_FOLDER_ID` и
//     `ARCHIVE_FOLDER_ID` (`core/folderIds.ts`), набора-константы у нас нет;
//   • пункт `MarkAllAsRead` (`:51-57`) НЕ объявлен: нет ни
//     `dialogsStorage.markFolderAsRead`, ни папочного `getFolderUnreadCount` в
//     воркере/бэкенде — отложенная задача 12 плана
//     `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
import createContextMenu from '@helpers/dom/createContextMenu'
import findUpClassName from '@helpers/dom/findUpClassName'
import noop from '@helpers/noop'
import { useAppStateStore } from '@stores/appState'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import type { Folder } from '@core/managers/foldersManager'
import { deleteFolder, type EditFolderManagers } from '@components/sidebarLeft/tabs/editFolderShared'

/** То, что меню берёт у колонки (у tweb — `appSidebarLeft` и классы вкладок). */
export type FolderContextMenuSidebar = {
  /** `appSidebarLeft.closeTabsBefore` (`sidebarLeft/index.ts:1613-1616`) */
  closeTabsBefore: (clb: () => void) => void
  /** `createTab(AppEditFolderTab).open({initFilter: filter})` */
  openEditFolderTab: (filter: Folder) => void
  /** `createTab(AppChatFoldersTab).open()` */
  openChatFoldersTab: () => void
}

export type FolderContextMenuManagers = EditFolderManagers

export default function createFolderContextMenu({
  appSidebarLeft,
  managers,
  className,
  listenTo,
}: {
  appSidebarLeft: FolderContextMenuSidebar,
  managers: FolderContextMenuManagers,
  className: string,
  listenTo: HTMLElement
}) {
  function openSettingsForFilter(filterId: number) {
    if(filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID) return
    const filter = useAppStateStore.getState().folders.find((folder) => folder.id === filterId)
    if(!filter) return

    appSidebarLeft.closeTabsBefore(() => {
      appSidebarLeft.openEditFolderTab(filter)
    })
  }

  let clickFilterId: number
  const { destroy } = createContextMenu({
    buttons: [{
      icon: 'edit',
      text: 'FilterEdit',
      onClick: () => {
        openSettingsForFilter(clickFilterId)
      },
      verify: () => clickFilterId !== ALL_FOLDER_ID,
    }, {
      icon: 'edit',
      text: 'FilterEditAll',
      onClick: () => {
        appSidebarLeft.closeTabsBefore(() => {
          appSidebarLeft.openChatFoldersTab()
        })
      },
      verify: () => clickFilterId === ALL_FOLDER_ID,
    }, // `MarkAllAsRead` (`:51-57`) — отложенная задача 12, см. шапку
    {
      icon: 'delete',
      className: 'danger',
      text: 'Delete',
      onClick: () => {
        deleteFolder(managers, clickFilterId).catch(noop)
      },
      verify: () => clickFilterId !== ALL_FOLDER_ID,
    }],
    listenTo,
    findElement: (e) => findUpClassName(e.target!, className),
    onOpen: (_e, target) => {
      clickFilterId = +target.dataset.filterId!
    },
  })

  return { destroy, openSettingsForFilter }
}
