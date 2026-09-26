// Порт папочного среза tweb `src/lib/appDialogsManager.ts` (2695 строк; здесь —
// `:480-490, :518-575, :577-727, :729-822, :851-858, :924-968, :1014-1101,
// :1170-1176, :1249-1322`): владелец контейнеров папок над списком чатов и их
// переключения. Разбор с адресами — `docs/tweb/folders-tabs.md` § 1.6; план —
// задача 5 `docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`.
//
// Что делает (как оригинал): кладёт в `.connection-status-bottom` оверлей
// `.chatlist-overlay` (плашка-подсказка, градиент и Solid-ряд вкладок
// `foldersTabs.solid.tsx` — узлами без хоста) и `#folders-container.tabs-container`;
// на каждую папку один раз создаёт скроллер `.tabs-tab.chatlist-parts.folders-scrollable`
// с `.chatlist-top` + `.chatlist-bottom` и держит его на позиции `localId`;
// переключает папки через `horizontalMenu` + `TransitionSlider.slideTabs`; перед
// показом чистит список цели, по концу перехода — списки всех неактивных, и
// заново просит первую страницу (памяти `scrollTop` у папок в tweb НЕТ —
// поправка 1 плана); повторный клик по активной — плавная прокрутка к началу.
// Остальной менеджер (строка диалога, клики, контекстное меню диалога,
// форум-табы, сторис) — волна 7 Solid-миграции, не здесь.
//
// Список папки (`ul` и строки) рисует НЕ владелец: роль tweb `AutonomousDialogList`
// (`xd`) делят TS-объект `FolderList` (скроллер и узлы — ниже) и хэндл списка,
// который регистрирует в нём хозяин `ul` — React-`ChatListFolder`
// (`components/ChatList.tsx`): он порталом кладёт свой `ul` в `.chatlist-top`.
// В колонку владелец встроен `components/Sidebar.tsx` (задача 6 плана):
// `.connection-status-bottom` — хост `start()`, `#chatlist-container` — второй
// аргумент.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. Экземпляр со `start(host, chatsContainer, hooks)` и `destroy()`, а не
//     синглтон на `document.getElementById('chatlist-container')` (`:513`):
//     колонка у нас монтируется и размонтируется, тесты поднимают её
//     многократно. `destroy()` — наш (у оригинала синглтон живёт вечно): снимает
//     подписки, наблюдатель, свайп, Solid-корень, навигационную запись, все
//     `FolderList`, свои узлы и свои следы на чужих узлах (`has-filters`,
//     `--chatlist-overlay-height`) — DoD 5 спеки волны 3.
//  2. `bottomPart` не создаётся (`:587-589`, `:704`): это React-узел
//     `.connection-status-bottom` колонки, он приходит как `host`;
//     `#folders-container` (у tweb — статический в `index.html:100`) создаёт
//     владелец и кладёт в `host` последним, оверлей — первым (`:595-597`).
//  3. `FolderList` вместо `AutonomousDialogList` (`:1170-1176`): скроллер и узлы
//     держит владелец, `clear/reset/onChatsScroll` делегируются хэндлу списка.
//     Первый `onChatsScroll` владелец делает синхронно на старте (`:1064-1065` →
//     `:1101`), когда хозяина `ul` ещё нет, — `FolderList` держит его отложенным
//     до `register` (единственная адаптация шва, «Ключевой шов» плана). `clear()`
//     до регистрации отложенный запрос снимает — у tweb `clear()` так же
//     отменяет начатую загрузку (`autonomousDialogList/base.ts:353-362`:
//     `loadDialogsDeferred.reject()`, `cursorFetcher.reset()`). Карта
//     `filtersRendered` (`:526-528`) слита с `xds` (`:559`): у нас в записи
//     `{id, container, scrollable}` нечего хранить отдельно — всё в `FolderList`.
//  4. `localId` — позиция папки в `folderItems` проекции `stores/folders.solid.ts`
//     (0 — «Все чаты»). У tweb пространство `localId` с дыркой под архив
//     (`START_LOCAL_ID`); `positionElementByIndex` это не задевает — кадры
//     ставятся по порядку, а архива среди них нет ни там, ни здесь (`:1251-1253`
//     у нас не нужен: архив — папка диалога, а не фильтр, `core/folderIds.ts`).
//  5. События `filter_update`/`filter_delete`/`filter_order` (`:924-968`) — одна
//     подписка на `folderItems` проекции: у нас это и есть поток «добавили/
//     удалили/переставили» (`appState.folders`, писатель — `foldersStore.ts`).
//     Добавление и перестановка — `addFilter` (у отрисованной папки он и есть
//     `positionElementByIndex`, `:1255-1259`, как в `filter_order` `:966`);
//     `setIndexKey` (`:964`) не нужен — индекс сортировки папки держит воркер.
//  6. Снятие активной папки: сперва контейнер снимается, потом `selectTab(0)`.
//     У tweb наоборот и через стор — `deleteFolder` (`stores/folders.ts:120-134`)
//     зовёт `onClick()(0)` раньше, чем `filter_delete` владельца снимет
//     контейнер; видимый итог тот же (к моменту, когда асинхронный
//     `selectFolderByIndex` доходит до слайдера, уходящего кадра в DOM нет →
//     `prevId === -1` → мгновенно, без `from`/`to`), но полоса оригинала успевает
//     запомнить `prevId` вкладки, которой уже нет, и её «полоска Jolly Cobra»
//     читает `children[prevId]` (`horizontalMenu.ts:108-110`) — у последней
//     вкладки это `undefined`. Условие `length >= selectedId` (`:131`, длина
//     против id) не портировано — дефект оригинала.
//  7. `state_cleared` (`:640-652`): события на главном потоке нет. Сброс
//     `appState.folders` при логауте (`resetAppState`) приходит той же
//     подпиской (п. 5) и снимает пользовательские контейнеры. Повторный
//     `onStateLoaded` и `xd.clear()` + `onTabChange()` «Всех чатов» (`:643-649`)
//     не нужны: логаут размонтирует колонку, `destroy()` снимает всё, новый
//     вход — новый `start()`.
//  8. Из `onStateLoaded` (`:1014-1090`) взят только папочный срез: `addFilter`
//     на каждую папку, гидрация стора, `filterId = -1; onClick(0, false)`,
//     `suggestionContainer`. Папки у нас известны синхронно (подняты из State в
//     `client/boot.ts`), поэтому ветки `!haveFilters` с плейсхолдером
//     (`:1044-1057`) нет; `preloadDialogs`, сторис, `fillConversations` — волна 7.
//     `suggestionContainer` создаётся в `start()`, `authorizationContainer`
//     (`:1084-1088`, плашка «новый вход») не заводится — у колонки её нет.
//     Гидрация стора (`hydrateFilters`, `:1026-1035`) зовётся ДО ряда: полосе к
//     первому `onClick(0)` нужна вкладка «Все чаты» (у tweb её гарантирует
//     порядок `onStateLoaded`); `destroy()` проекцию гасит (`dispose`).
//  9. Лимит папок не-Premium (`:742-748`, `isFilterIdAvailable` +
//     `showLimitPopup('folders')`) не проверяется — папка всегда доступна,
//     отложенная задача 10 плана (ни лимитов, ни `PopupLimit`).
// 10. `onChange` полосы (`:806-809`, перекраска `custom-emoji-renderer-element`
//     в названии) не передаётся — сущностей в названии папки нет, отложенная
//     задача 11.
// 11. `createFolderContextMenu` (`:814-821`) — задача 7 плана.
// 12. `setHasFolders(show)` (`:1315-1316`) пишет в стор режима
//     `stores/foldersSidebar.solid.ts` (задача 8), а `destroy()` сбрасывает
//     его в `false`: `hasFolders` — след владельца на `<body>`
//     (`has-horizontal-folders`/`has-vertical-folders`), п. 1.
// 13. `changeFiltersAllChatsKey` (`:1292-1296`, `:1320`) и слушатель `resize`
//     (`:700-702`) не портированы — мёртвый код форка (поправка 2 плана).
// 14. `onTabChange` (`:1092-1168`): плашка «N новых чатов» shared-папки
//     (`:1103-1165`, `getChatlistUpdates`) — отложенная задача 13.
// 15. `setFilterIdAndChangeTab` синхронный (у tweb `async`, `:855-858`): его
//     обещание разрешается `undefined` — `onChatsScroll` ничего не возвращает
//     (`base.ts:144-146`), — и полоса ждала бы пустоту.
// 16. Индекс активной вкладки для свайпа (`:622`, `selectedFolderIndex()`)
//     считается от `filterId` владельца: `selectedFolderId` в Solid-проекции нет
//     (решение 2 шапки `stores/folders.solid.ts`), факт выбора —
//     `foldersStore.selectedId`, и пишет его ТОЛЬКО `selectFolderByIndex` (`:784`).
// 17. Слушатели полосы и слайдера висят на `ListenerSetter` — у tweb его не
//     передают (узлы живут вечно), у нас `destroy()` их снимает.
// 18. `selectFolderByIndex` после своего `await` сверяется с `middleware`
//     прогона (`@helpers/middleware`): у tweb владелец не умирает, у нас
//     `destroy()` может прийти, пока ждём `closeEverythingInsideNaturally` (в
//     том числе прямо на старте — первый `onClick(0, false)` асинхронный), и
//     продолжение полезло бы в снятые `FolderList`.
// 19. Скроллеру папки и `.chatlist-bottom` владелец ставит ещё и наши классы
//     (`appDialogsManager.module.scss`): тонкий скроллбар (у tweb его включает
//     непортированный класс на `<html>`) и клиренс под compose-FAB (у tweb
//     `.chatlist-bottom` высоты не имеет; пока `ul` папки пуст, клиренс гаснет —
//     иначе браузер вернул бы скроллеру очищенной папки прежнюю позицию, и папка
//     показывалась бы не с начала). `setCollapsed` — наш: свёрнутая в
//     колонку аватаров панель при открытом форуме гасит клиренс; у tweb
//     свёрнутый чатлист устроен иначе (`left-sidebar.md` § 8.2).
import { createEffect, createRoot, on, untrack } from 'solid-js'
import Scrollable from '@components/scrollable'
import { horizontalMenu } from '@components/horizontalMenu'
import FoldersTabs from '@components/foldersTabs.solid'
import type { ScrollableContextValue } from '@components/scrollable2.solid'
import { createSolidNodes } from '@shared/solid/mountSolid.solid'
import useFolders from '@stores/folders.solid'
import { useHasFolders } from '@stores/foldersSidebar.solid'
import { useFoldersStore } from '@stores/foldersStore'
import { ALL_FOLDER_ID } from '@core/folderIds'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import type SwipeHandler from '@core/dom/swipeHandler'
import positionElementByIndex from '@helpers/dom/positionElementByIndex'
import handleTabSwipe from '@helpers/dom/handleTabSwipe'
import { fastSmoothScrollToStart } from '@helpers/fastSmoothScroll'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import clamp from '@helpers/number/clamp'
import pause from '@helpers/schedulers/pause'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import styles from './appDialogsManager.module.scss'

/**
 * Хэндл списка одной папки — то, что у tweb умеет `AutonomousDialogList`
 * (`base.ts:144-146`, `:353-367`): `clear` — пустое окно и сброс курсора,
 * `reset` — забыть промисы загрузки, `onChatsScroll` — попросить первую страницу.
 */
export type DialogListHandle = {
  clear(): void
  reset(): void
  onChatsScroll(): void
}

/** Колбэки колонки: то, что у tweb владелец берёт у соседей-синглтонов. */
export type AppDialogsManagerHooks = {
  /**
   * `appSidebarLeft.closeEverythingInsideNaturally()` (`:756-758`,
   * `sidebarLeft/index.ts:505-516`): закрыть поиск, вкладки «через назад»,
   * форум. `false` — пользователь отказался, переключение отменяется. У нас это
   * состояние колонки (`Sidebar.tsx`).
   */
  closeEverythingInsideNaturally: () => boolean | Promise<boolean>
  /** `!!this.forumTab` — открытый форум гасит свайп между папками (`:631-633`). */
  isForumOpen: () => boolean
}

/**
 * Список одной папки со стороны владельца — роль `xd` (`AutonomousDialogList`,
 * расхождение 3). Скроллер — `generateScrollable` (`dialogs.ts:207-212`):
 * `new Scrollable(null, 'CL', 500)` с `data-filter-id`; узлы `.chatlist-top`
 * (в него хозяин кладёт свой `ul`) и `.chatlist-bottom` — `addFilter`
 * (`:1268-1275`), который и ставит их в скроллер.
 */
export class FolderList {
  public readonly scrollable: Scrollable
  public readonly top: HTMLElement
  public readonly bottom: HTMLElement
  private handle: DialogListHandle | undefined
  private pendingScroll = false

  constructor(public readonly id: number) {
    this.scrollable = new Scrollable(undefined, 'CL', 500)
    this.scrollable.container.dataset.filterId = '' + id

    this.top = document.createElement('div')
    this.top.classList.add('chatlist-top')

    this.bottom = document.createElement('div')
    this.bottom.classList.add('chatlist-bottom')
  }

  public get container() {
    return this.scrollable.container
  }

  /**
   * Хозяин `ul` отдаёт свой хэндл. Отложенный первый запрос страницы
   * выполняется здесь (расхождение 3). Возвращает снятие регистрации.
   */
  public register(handle: DialogListHandle) {
    this.handle = handle
    if(this.pendingScroll) {
      this.pendingScroll = false
      handle.onChatsScroll()
    }

    return () => {
      if(this.handle === handle) {
        this.handle = undefined
      }
    }
  }

  public clear() {
    this.pendingScroll = false
    this.handle?.clear()
  }

  public reset() {
    this.handle?.reset()
  }

  public onChatsScroll() {
    if(this.handle) {
      this.handle.onChatsScroll()
    } else {
      this.pendingScroll = true
    }
  }

  /** `base.ts:375-380`: `clear()` + `scrollable.destroy()`. */
  public destroy() {
    this.clear()
    this.scrollable.destroy()
    this.handle = undefined
  }
}

type FilterLike = { id: number, localId: number }

export class AppDialogsManager {
  public filterId: number = ALL_FOLDER_ID
  public xd: FolderList | undefined

  private folders!: { [k in 'menu' | 'container' | 'menuScrollContainer' | 'menuGradient']: HTMLElement }
  private xds = new Map<number, FolderList>()
  private showFiltersPromise: Promise<void> | undefined
  private filtersNavigationItem: NavigationItem | undefined

  private host: HTMLElement | undefined
  private chatsContainer!: HTMLElement
  private hooks!: AppDialogsManagerHooks
  private foldersOverlay!: HTMLElement
  private _suggestionContainer: HTMLElement | undefined

  private listenerSetter = new ListenerSetter()
  private middlewareHelper = getMiddleware()
  private resizeObserver: ResizeObserver | undefined
  private swipeHandler: SwipeHandler | undefined
  private disposeTabs: (() => void) | undefined
  private disposeListeners: (() => void) | undefined

  private rendered: readonly FolderList[] = []
  private renderedListeners = new Set<() => void>()
  /** расхождение 19; переживает `destroy()` — колонка задаёт его своим состоянием */
  private collapsed = false

  /** узел для плашки-подсказки (`:1079-1082`) — в него рисует React-`PendingSuggestion` */
  public get suggestionContainer() {
    return this._suggestionContainer
  }

  /**
   * Отрисованные папки — для хозяина `ul` (`useSyncExternalStore`): на каждую
   * он порталом кладёт свой список в `list.top`. Ссылка массива меняется только
   * при добавлении/снятии папки.
   */
  public getRendered() {
    return this.rendered
  }

  public subscribe(callback: () => void) {
    this.renderedListeners.add(callback)
    return () => {
      this.renderedListeners.delete(callback)
    }
  }

  public start(host: HTMLElement, chatsContainer: HTMLElement, hooks: AppDialogsManagerHooks) {
    this.host = host
    this.chatsContainer = chatsContainer
    this.hooks = hooks

    const folders = useFolders()
    // `hydrateFilters` (`:1026-1035`) — до ряда, расхождение 8.
    folders.hydrate()

    const container = document.createElement('div')
    container.id = 'folders-container'
    container.classList.add('tabs-container')
    // Узлы ряда (`menu`, `menuScrollContainer`, `menuGradient`) приходят ref-ами
    // при создании `FoldersTabs` ниже — синхронно, до первого чтения (у tweb
    // поле так же заведено пустым, `:518-525`).
    this.folders = {
      menu: undefined!,
      menuScrollContainer: undefined!,
      menuGradient: undefined!,
      container,
    }

    host.append(container)

    // Single absolute overlay sitting above the chatlist (#folders-container) that hosts every
    // panel currently rendered there: pending suggestion, folder tabs scrollable, gradient.
    this.foldersOverlay = document.createElement('div')
    this.foldersOverlay.classList.add('chatlist-overlay')
    host.prepend(this.foldersOverlay)

    // Живая высота оверлея — отступ сверху у `.folders-scrollable`
    // (`padding-top: var(--chatlist-overlay-height, 0)`, `styles/tweb/_leftSidebar.scss:418`).
    this.resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0].borderBoxSize?.[0]?.blockSize ?? entries[0].contentRect.height
      host.style.setProperty('--chatlist-overlay-height', height + 'px')
    })
    this.resizeObserver.observe(this.foldersOverlay)

    if(IS_TOUCH_SUPPORTED) {
      this.swipeHandler = handleTabSwipe({
        element: container,
        onSwipe: (xDiff) => {
          const prevIndex = folders.folderItems.findIndex((item) => item.id === this.filterId) // расхождение 16
          const newIndex = clamp(
            xDiff < 0 ? prevIndex + 1 : prevIndex - 1,
            0,
            folders.folderItems.length - 1,
          )
          folders.onClick()?.(newIndex)
        },
        verifyTouchTarget: () => {
          return !this.hooks.isForumOpen()
        },
      })
    }

    // `:654-686`: ряд — узлами прямо в оверлей, без хоста (`createSolidNodes`).
    let scrollableContext: ScrollableContextValue | undefined
    const tabs = createSolidNodes(FoldersTabs, {
      scrollableProps: {
        class: 'folders-tabs-scrollable hide',
        ref: (ref: HTMLDivElement) => {
          this.folders.menuScrollContainer = ref
        },
        scrollableProps: {
          contextRef: (ref: ScrollableContextValue) => scrollableContext = ref,
        },
      },
      menuProps: {
        id: 'folders-tabs',
        ref: (ref: HTMLDivElement) => {
          this.folders.menu = ref
          this.onRef(scrollableContext)
        },
      },
      gradientProps: {
        className: 'folders-tabs-gradient',
        color: 'surface',
        smaller: true,
        ref: (ref: HTMLDivElement) => {
          this.folders.menuGradient = ref
          // Как у tweb (`:678-681`), и как у tweb НЕ держится: class-эффект
          // `Tabs.MenuGradient` сразу после ref пишет `className` целиком (пин
          // задачи 4 в `foldersTabs.solid.test.tsx`). Дальше `hide` градиента
          // трогает только `onFiltersLengthChange` — при смене показа.
          ref.classList.add('hide')
        },
      },
    })
    this.disposeTabs = tabs.dispose
    this.foldersOverlay.append(...tabs.nodes)

    this.xd = this.xds.get(this.filterId)

    // срез `onStateLoaded` (`:1014-1090`), расхождение 8
    this.addFilters()

    this.filterId = -1
    untrack(folders.onClick)?.(0, false)

    this.initListeners()

    this._suggestionContainer = document.createElement('div')
    this.foldersOverlay.prepend(this._suggestionContainer)
  }

  public destroy() {
    if(!this.host) {
      return
    }

    const folders = useFolders()
    this.middlewareHelper.clean()
    this.showFiltersPromise = undefined
    this.disposeListeners?.()
    this.disposeListeners = undefined
    folders.setOnClick(undefined)
    this.disposeTabs?.()
    this.disposeTabs = undefined
    this.listenerSetter.removeAll()
    this.swipeHandler?.removeListeners()
    this.swipeHandler = undefined
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined

    if(this.filtersNavigationItem) {
      appNavigationController.removeItem(this.filtersNavigationItem)
      this.filtersNavigationItem = undefined
    }

    this.xds.forEach((xd) => xd.destroy())
    this.xds.clear()
    this.xd = undefined
    // Подписчики снимаются сами (их `subscribe` вернул им снятие): при
    // пересоздании владельца на том же экземпляре (StrictMode: `start` →
    // `destroy` → `start`) они должны пережить `destroy()` и услышать и
    // пустой список, и новый.
    this.notifyRendered()

    this.foldersOverlay.remove()
    this.folders.container.remove()
    this.host.style.removeProperty('--chatlist-overlay-height')
    this.chatsContainer.classList.remove('has-filters')
    useHasFolders()[1](false) // расхождение 12
    this._suggestionContainer = undefined
    this.host = undefined

    folders.dispose()
  }

  private onRef(scrollableContext: ScrollableContextValue | undefined) {
    this.setFilterId(ALL_FOLDER_ID)
    this.addFilter({ id: ALL_FOLDER_ID, localId: 0 })

    const { onClick, setOnClick, folderItems } = useFolders()
    const selectFolderByIndex = async(index: number) => {
      const id = folderItems[index]?.filter.id ?? ALL_FOLDER_ID
      const wasFilterId = this.filterId
      const middleware = this.middlewareHelper.get()

      // Лимит папок не-Premium (`:742-748`) — расхождение 9, задача 10.

      if(!await this.hooks.closeEverythingInsideNaturally() || !middleware()) { // `middleware` — расхождение 18
        return false
      }

      if(!IS_MOBILE_SAFARI) {
        if(index) {
          if(!this.filtersNavigationItem) {
            this.filtersNavigationItem = {
              type: 'filters',
              onPop: () => {
                onClick()?.(0)
                this.filtersNavigationItem = undefined
              },
            }

            appNavigationController.spliceItems(1, 0, this.filtersNavigationItem)
          }
        } else if(this.filtersNavigationItem) {
          appNavigationController.removeItem(this.filtersNavigationItem)
          this.filtersNavigationItem = undefined
        }
      }

      if(wasFilterId === id) {
        void fastSmoothScrollToStart(this.xds.get(id)!.scrollable.container, 'y')
        return
      }

      useFoldersStore.getState().select(id)

      this.xds.get(id)!.clear()
      this.setFilterIdAndChangeTab(id)
    }

    this.foldersOverlay.append(this.folders.menuScrollContainer)
    const selectTab = horizontalMenu({
      tabs: this.folders.menu,
      content: this.folders.container,
      onClick: selectFolderByIndex,
      onTransitionEnd: () => {
        this.xds.forEach((xd, folderId) => {
          if(folderId !== this.filterId) {
            xd.clear()
          }
        })
      },
      scrollableX: scrollableContext,
      listenerSetter: this.listenerSetter,
      // `onChange` (`:806-809`) — расхождение 10, задача 11.
    })

    setOnClick(() => selectTab)

    // `createFolderContextMenu` (`:814-821`) — расхождение 11, задача 7.
  }

  /** Расхождение 19: свёрнутая колонка (открыт форум) — без клиренса под FAB. */
  public setCollapsed(collapsed: boolean) {
    this.collapsed = collapsed
    this.xds.forEach((xd) => xd.container.classList.toggle(styles.collapsed, collapsed))
  }

  public setFilterId(filterId: number) {
    this.filterId = filterId
  }

  public setFilterIdAndChangeTab(filterId: number) {
    this.setFilterId(filterId)
    this.onTabChange()
  }

  /** `:1092-1101`; плашка chatlist-апдейтов `:1103-1165` — расхождение 14. */
  public onTabChange = () => {
    const { filterId } = this
    const xd = this.xd = this.xds.get(filterId)!
    xd.reset()
    xd.onChatsScroll()
  }

  /** `addFilters` из `onStateLoaded` (`:1022-1028`): по кадру на каждую папку. */
  private addFilters() {
    untrack(() => useFolders().folderItems).forEach((item, localId) => {
      this.addFilter({ id: item.id, localId })
    })
  }

  /**
   * `filter_update`/`filter_delete`/`filter_order` (`:924-968`) одной подпиской
   * на `folderItems` — расхождение 5. Реагирует на состав и порядок (`id` по
   * позициям), а не на счётчики: `reconcile` проекции держит элементы, и смена
   * бейджа сюда не доходит.
   */
  private initListeners() {
    const { folderItems, onClick } = useFolders()
    this.disposeListeners = createRoot((dispose) => {
      createEffect(on(() => folderItems.map((item) => item.id), (ids) => {
        let deletedActive = false
        const present = new Set(ids)
        Array.from(this.xds.keys()).forEach((id) => {
          if(present.has(id)) return
          if(id === this.filterId) deletedActive = true
          this.deleteFilter(id)
        })

        this.addFilters()

        // Расхождение 6: контейнер уже снят, теперь — на «Все чаты».
        if(deletedActive) {
          untrack(onClick)?.(0)
        }
      }, { defer: true }))

      return dispose
    })
  }

  /** `filter_delete` (`:934-945`). */
  private deleteFilter(id: number) {
    const xd = this.xds.get(id)
    if(!xd) return

    xd.container.remove()

    xd.destroy()
    this.xds.delete(id)
    this.notifyRendered()

    void this.onFiltersLengthChange()
  }

  /** `l(filter)` (`:1170-1176`); клик по строке (`setListClickListener`) — у хозяина `ul`. */
  private l(filter: FilterLike) {
    const xd = new FolderList(filter.id)
    this.xds.set(filter.id, xd)
    return xd
  }

  /** `addFilter` (`:1249-1290`). */
  private addFilter(filter: FilterLike) {
    const { id } = filter

    const renderedFilter = this.xds.get(id)
    if(renderedFilter) {
      positionElementByIndex(renderedFilter.container, this.folders.container, filter.localId)
      return
    }

    const { scrollable, top, bottom } = this.l(filter)
    scrollable.container.classList.add('tabs-tab', 'chatlist-parts', 'folders-scrollable', styles.scroll)
    scrollable.container.classList.toggle(styles.collapsed, this.collapsed) // расхождение 19
    scrollable.attachBorderListeners()
    bottom.classList.add(styles.bottom)

    scrollable.append(top, bottom)

    positionElementByIndex(scrollable.container, this.folders.container, filter.localId)

    this.notifyRendered()

    void this.onFiltersLengthChange()
  }

  /** `onFiltersLengthChange` (`:1298-1322`): один раз на тик. */
  private onFiltersLengthChange() {
    let promise = this.showFiltersPromise
    return promise ??= this.showFiltersPromise = pause(0).then(() => {
      if(this.showFiltersPromise !== promise) {
        return
      }

      const show = this.xds.size > 1
      const wasShowing = !this.folders.menuScrollContainer.classList.contains('hide')

      if(show !== wasShowing) {
        this.folders.menuScrollContainer.classList.toggle('hide', !show)
        this.folders.menuGradient.classList.toggle('hide', !show)
        this.chatsContainer.classList.toggle('has-filters', show)
      }

      const [, setHasFolders] = useHasFolders()
      setHasFolders(show)

      this.showFiltersPromise = undefined
    })
  }

  private notifyRendered() {
    this.rendered = Array.from(this.xds.values())
    this.renderedListeners.forEach((callback) => callback())
  }
}
