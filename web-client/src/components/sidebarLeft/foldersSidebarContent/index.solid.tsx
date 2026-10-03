/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/sidebarLeft/foldersSidebarContent/index.tsx` (812502980)
 * — вертикальная колонка папок `#folders-sidebar` (первый ребёнок
 * `#main-columns`): бургер главного меню, «Все чаты» и папки, «добавить чаты» у
 * пустой выбранной папки, настройки папок. Показ — по настройке «Расположение
 * папок → Слева от чатов» (`useHasFoldersSidebar`); на экране ≤ 925px колонку
 * прячет SCSS (`_foldersSidebar.scss`), `body.has-folders-sidebar` ставит стор
 * (`stores/foldersSidebar.solid.ts`). Строит колонку `AppSidebarLeft.construct`
 * (tweb `sidebarLeft/index.ts:177-184`).
 *
 * Расхождения:
 *  1. `useHotReloadGuard`/`HotReloadGuardProvider` нет: зависимости
 *     импортируются напрямую (`appSidebarLeft` — живая привязка ES-модуля, читается
 *     только из обработчиков), а `managers` меню папки (`rootScope.managers` у
 *     tweb) приходят аргументом `renderFoldersSidebarContent` — `rootScope` у нас
 *     без менеджеров.
 *  2. `selectedFolderId` — не сигнал стора `folders` (у нас его там нет, решение 2
 *     шапки `stores/folders.solid.ts`), а подписка на факт `foldersStore.selectedId`.
 *  3. Клик по папке: `onClick()(index)` владельца (`selectFolderByIndex`,
 *     `lib/appDialogsManager.ts`) сам закрывает открытое в колонке
 *     (`closeEverythingInsideNaturally`) и ничего не возвращает (прокси
 *     `horizontalMenu`), поэтому `closeEverythingInside()` после клика (`:71-73`)
 *     здесь нет.
 *  4. `REAL_FOLDERS` — наши `ALL_FOLDER_ID`/`ARCHIVE_FOLDER_ID` (`core/folderIds.ts`).
 *  5. `logger` (`:27-34`) — без отладочного лога.
 */
import { type Accessor, createEffect, createSelector, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { createStore } from 'solid-js/store'
import { render } from 'solid-js/web'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'
import createFolderContextMenu, { type FolderContextMenuManagers } from '@helpers/dom/createFolderContextMenu'
import type { Middleware } from '@helpers/middleware'
import Animated from '@helpers/solid/animations.solid'
import { subscribeExternal } from '@helpers/solid/subscribeExternal'
import classNames from '@helpers/string/classNames'
import I18n, { i18n } from '@lib/langPack'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import useHasFoldersSidebar from '@stores/foldersSidebar.solid'
import useFolders from '@stores/folders.solid'
import { useFoldersStore } from '@stores/foldersStore'
import appChatBackground from '@components/chat/bubbles/chatBackground.solid'
import { IconTsx } from '@components/iconTsx.solid'
import ripple from '@components/ripple'
import Scrollable from '@components/scrollable2.solid'
import appSidebarLeft from '@components/sidebarLeft'
import { AppChatFoldersTab, AppEditFolderTab } from '@components/solidJsTabs/tabs'
import FolderItem from '@components/sidebarLeft/foldersSidebarContent/folderItem.solid'
import { getFolderTitle } from '@components/sidebarLeft/foldersSidebarContent/utils'

// tweb `keepMe(ripple)` — держит импорт директивы `use:ripple`
void ripple

/** `REAL_FOLDERS` (расхождение 4). */
const REAL_FOLDERS = new Set([ALL_FOLDER_ID, ARCHIVE_FOLDER_ID])

export function FoldersSidebarContent(props: {
  allNotificationsCount: Accessor<number>,
  managers: FolderContextMenuManagers
}) {
  const { onClick, folderItems } = useFolders()
  // расхождение 2
  const selectedFolderId = subscribeExternal(
    (cb) => useFoldersStore.subscribe((s, prev) => { if(s.selectedId !== prev.selectedId) cb() }),
    () => useFoldersStore.getState().selectedId,
  )
  const [addFoldersOffset, setAddFoldersOffset] = createSignal(0)
  const [canShowAddFolders, setCanShowAddFolders] = createSignal(false)
  const [menuTarget, setMenuTarget] = createSignal<HTMLDivElement>()

  const showAddFolders = () => canShowAddFolders() &&
    selectedFolderId() &&
    !REAL_FOLDERS.has(selectedFolderId()) &&
    folderItems.find((item) => item.id === selectedFolderId())?.chatsCount === 0

  const [folderItemRefs, setFolderItemRefs] = createStore<Record<number, HTMLDivElement | undefined>>({})
  const isSelected = createSelector(selectedFolderId)

  // Tracks whether a gradient renderer is currently active. When false (image-only wallpapers)
  // we fall back to backdrop-filter via a CSS class so the bar still has some translucency.
  const [hasGradient, setHasGradient] = createSignal(false)
  // Night-style dark patterns darken the visible chat via a black mask, but the mirror copies only
  // the (bright) raw gradient — so the bar needs an extra-dark tint to match. Tinted/light don't.
  const [isDarkPattern, setIsDarkPattern] = createSignal(false)
  let backgroundCanvas!: HTMLCanvasElement

  let folderItemsContainer!: HTMLDivElement

  function _onClick(folderId: number) {
    const index = folderItems.findIndex(({ filter }) => filter.id === folderId)
    onClick()?.(index) // расхождение 3
  }

  createEffect(() => {
    const _menuTarget = menuTarget()
    if(!_menuTarget) return

    appSidebarLeft.createToolsMenu(_menuTarget, { top: 8, left: 48 })
    _menuTarget.classList.add('sidebar-tools-button', 'is-visible')
  })

  let contextMenu: ReturnType<typeof createFolderContextMenu>
  onMount(() => {
    contextMenu = createFolderContextMenu({
      appSidebarLeft,
      AppChatFoldersTab,
      AppEditFolderTab,
      managers: props.managers,
      className: 'folders-sidebar__folder-item',
      listenTo: folderItemsContainer,
    })

    // Mirror the chat-background gradient into our own canvas — cheap stand-in for
    // backdrop-filter: blur(40px). The bar always sits over the chat background, so the visible
    // result of a heavy blur over that area is mathematically close to the gradient itself
    // (the high-frequency pattern blurs to a near-constant tint that we approximate via the
    // dark overlay). Falls back to backdrop-filter when no gradient is active.
    let detachMirror: (() => void) | undefined
    const unsubscribeRenderer = appChatBackground.onActiveGradientRendererChange((renderer, meta) => {
      detachMirror?.()
      detachMirror = undefined
      if(renderer && backgroundCanvas) {
        detachMirror = renderer.attachMirror(backgroundCanvas)
        setHasGradient(true)
      } else {
        setHasGradient(false)
      }
      setIsDarkPattern(!!meta?.isDarkMaskPattern)
    })

    onCleanup(() => {
      contextMenu.destroy()
      unsubscribeRenderer()
      detachMirror?.()
    })
  })

  const updateCanShowAddFolders = () => {
    const selectedItem = folderItemRefs[selectedFolderId()]
    if(!selectedItem) return

    const containerRect = folderItemsContainer.getBoundingClientRect()
    const itemRect = selectedItem.getBoundingClientRect()
    const offset = itemRect.top + itemRect.height / 2 - containerRect.top
    const MARGIN_PX = 50
    setCanShowAddFolders(offset > MARGIN_PX && offset < containerRect.height - MARGIN_PX)
    setAddFoldersOffset(offset)
  }

  createEffect(updateCanShowAddFolders)

  let openingChatFolders = false
  return (
    <>
      <div class={classNames(
        'folders-sidebar__background',
        !hasGradient() && 'folders-sidebar__background--no-gradient',
        isDarkPattern() && 'folders-sidebar__background--dark-pattern',
      )}>
        <canvas ref={backgroundCanvas} class="folders-sidebar__background-gradient" />
        <div class="folders-sidebar__background-tint" />
      </div>
      <FolderItem
        ref={setMenuTarget}
        class="folders-sidebar__menu-button is-first"
        icon="menu"
        aria-label={I18n.format('MultiAccount.More', true)}
        notifications={{
          count: props.allNotificationsCount(),
          muted: false,
        }}
      />

      <div class="folders-sidebar__scrollable-position">
        <Scrollable
          ref={folderItemsContainer}
          class="folders-sidebar__scrollable no-scrollbar"
          onScroll={updateCanShowAddFolders}
          withBorders="both"
        >
          <For each={folderItems}>{(folderItem) => {
            const { id } = folderItem

            onCleanup(() => {
              setFolderItemRefs({ [id]: undefined })
            })

            return (
              <FolderItem
                {...folderItem}
                {...getFolderTitle(folderItem.filter)}
                ref={(el) => setFolderItemRefs({ [id]: el })}
                selected={isSelected(id)}
                onClick={() => _onClick(id)}
              />
            )
          }}</For>
        </Scrollable>

        <Animated type="cross-fade" mode="add-remove">
          {showAddFolders() && <div
            use:ripple
            class="folders-sidebar__add-folders-button"
            role="button"
            tabindex="0"
            onClick={() => contextMenu.openSettingsForFilter(selectedFolderId())}
            onKeyDown={buttonKeyDown}
            style={{
              '--offset': addFoldersOffset(),
            }}
          >
            <IconTsx icon="plus" class="folders-sidebar__add-folders-button-icon" />
            <div class="folders-sidebar__add-folders-button-name">
              {i18n('ChatList.Filter.Include.AddChat')}
            </div>
          </div>}
        </Animated>
      </div>

      <FolderItem
        class="folders-sidebar__menu-button is-last"
        icon="equalizer"
        aria-label={I18n.format('Filters', true)}
        onClick={() => {
          if(openingChatFolders || appSidebarLeft.getTab(AppChatFoldersTab)) return
          openingChatFolders = true
          void appSidebarLeft.closeTabsBefore(() => {
            const tab = appSidebarLeft.createTab(AppChatFoldersTab)
            void tab.open(AppChatFoldersTab.getInitArgs()).finally(() => {
              openingChatFolders = false
            })
          })
        }}
      />
    </>
  )
}

export function renderFoldersSidebarContent(
  parentEl: HTMLElement,
  allNotificationsCount: Accessor<number>,
  managers: FolderContextMenuManagers, // расхождение 1
  middleware: Middleware,
) {
  const [hasFoldersSidebar] = useHasFoldersSidebar()

  const foldersSidebar = document.createElement('div')
  foldersSidebar.id = 'folders-sidebar'
  foldersSidebar.className = 'folders-sidebar sidebar-left-common'
  parentEl.insertBefore(foldersSidebar, parentEl.firstChild)

  const dispose = render(() => (
    <Show when={hasFoldersSidebar()}>
      <FoldersSidebarContent
        allNotificationsCount={allNotificationsCount}
        managers={managers}
      />
    </Show>
  ), foldersSidebar)

  middleware.onDestroy(() => {
    dispose()
    foldersSidebar.remove()
  })
}

