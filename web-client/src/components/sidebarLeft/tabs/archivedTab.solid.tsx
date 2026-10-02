/** @jsxImportSource solid-js */
// Порт tweb `src/components/sidebarLeft/tabs/archivedTab.tsx` (812502980, 117 строк) —
// вкладка «Архив» колоночного слайдера. Список — тот же `AutonomousDialogList`
// владельца (`appDialogsManager.l({id: FOLDER_ID_ARCHIVE})`, `xds[FOLDER_ID_ARCHIVE]`),
// его скроллер встаёт на место скроллера вкладки; на время открытой вкладки
// активная выборка владельца — архив (`setFilterIdAndChangeTab`), на закрытии —
// прежняя папка. Задача 1-5 волны 7 (строка Б-1 бэклога плана каркаса).
//
// Расхождения с оригиналом:
//  1. Ряд историй архива (`StoriesList` с `archive: true`, `renderStories`,
//     `.stories-list` под шапкой, `resizeStoriesContainer`) — Б-51.
//  2. Меню ⋮ в шапке (`appendMenu`, `getArchiveContextMenuButtons` —
//     скрыть из списка, прочитать всё, настройки архива, о функции) — Б-50.
//  3. Промиса первой страницы в `promiseCollector` нет: `setFilterIdAndChangeTab`
//     владельца синхронный (расхождение 15 шапки `lib/appDialogsManager.ts`) — у
//     tweb его обещание тоже ничего не ждёт (закомментированный `renderPromise`, `:110-114`).
import type { Component } from 'solid-js'
import appDialogsManager from '@lib/appDialogsManager'
import { i18n } from '@lib/langPack'
import { ARCHIVE_FOLDER_ID } from '@core/folderIds'
import type { AutonomousDialogList } from '@components/autonomousDialogList/dialogs'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import type { AppArchivedTab, ArchivedTabHooks } from '@components/solidJsTabs/tabs'

const ArchivedTab: Component = () => {
  const [tab] = useSuperTab<typeof AppArchivedTab>()
  const hooks = tab as ArchivedTabHooks

  const filterId = ARCHIVE_FOLDER_ID
  const wasFilterId = appDialogsManager.filterId

  let autonomousDialogList: AutonomousDialogList | undefined

  // вообще, так делать нельзя, но нет времени чтобы переделать главный чатлист на слайд...
  hooks._onOpenAfterTimeout = () => {
    appDialogsManager.xds.get(wasFilterId)?.clear()
  }

  hooks._onClose = () => {
    appDialogsManager.xds.delete(filterId)
    tab.scrollable.onAdditionalScroll = undefined
    appDialogsManager.setFilterIdAndChangeTab(wasFilterId)
  }

  hooks._onCloseAfterTimeout = () => {
    autonomousDialogList?.destroy()
    autonomousDialogList = undefined
  }

  tab.container.id = 'chats-archived-container'
  tab.title.replaceChildren(i18n('ArchivedChats'))

  tab.header.classList.add('can-have-forum')
  tab.content.classList.add('can-have-forum')

  if(!appDialogsManager.xds.get(filterId)) {
    const { ul, scrollable } = appDialogsManager.l({
      id: filterId,
      localId: ARCHIVE_FOLDER_ID,
    })
    scrollable.append(ul)
  }

  autonomousDialogList = appDialogsManager.xds.get(filterId)!

  const scrollable = autonomousDialogList.scrollable
  tab.scrollable.container.replaceWith(scrollable.container)
  scrollable.attachBorderListeners(tab.container)
  // ! DO NOT UNCOMMENT NEXT LINE - chats will stop loading on scroll after closing the tab
  // tab.scrollable = scrollable;

  appDialogsManager.setFilterIdAndChangeTab(filterId)

  return null
}

export default ArchivedTab
