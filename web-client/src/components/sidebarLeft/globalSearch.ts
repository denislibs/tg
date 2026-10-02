// Порт tweb/src/components/sidebarLeft/index.ts:1084-1554 (`initSearch`) и
// :1556-1585 (`watchChannelsTabVisibility`, `closeSearch`), плюс две точки
// входа в поиск из того же класса: once-подписка на фокус поля (:220) и
// Ctrl+F (:451-454). Владелец глобального поиска левой колонки: вокруг класса
// `AppSearchSuper` (`components/appSearchSuper.ts`) — пять групп выдачи,
// `ChatTypeMenu`, `EmptySearchPlaceholder`, чипы пира и даты, «недавние»,
// переход `zoom-fade` чатлист ↔ выдача и снос всего созданного по окончании
// обратного перехода.
//
// Разбор с адресами — `docs/tweb/global-search.md` § 1.3, § 1.9; план —
// `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`, задача 12.
//
// ── Форма шва (вместо полей `AppSidebarLeft`) ─────────────────────────────
// Хозяин (у нас — `Sidebar.tsx` через шов `core/hooks/useGlobalSearch.ts`,
// задача 13) отдаёт узлы статического каркаса
// оригинала (`index.html:91-102`) и колбэки:
//  • `searchContainer` — `#search-container.transition-item.sidebar-search`,
//    ПОСТОЯННЫЙ и пустой; его родитель — `.sidebar-content.transition.zoom-fade`
//    (переходом владеет `TransitionSlider` этого файла), родитель родителя —
//    `.item-main` (`is-search-active`, :1431); первый ребёнок `.sidebar-content`
//    — `#chatlist-container.transition-item`. Классы `active/from/to/animating/
//    backwards` на этих узлах и `is-search-active` ставит ТОЛЬКО владелец.
//  • `inputSearch` — объект с контрактом tweb `InputSearch` (`inputSearch.ts`;
//    у колонки — `shared/ui/InputSearch/inputSearchHandle.ts`):
//    `container`, `input`, `value` (чтение и запись), а `onChange`/`onClear`/
//    `onEnter` владелец ПИШЕТ в объект сам и снимает в `cleanup`, как оригинал.
//  • `backBtn` — стрелка «назад» бургера: единственный путь закрыть поиск
//    (:1091-1093), им же пользуются `onFound` групп, Escape и Enter со ссылкой.
//  • `onSearchActive(active)` — роль сеттера `isSearchActive` +
//    `onSomethingOpenInsideChange()` (:1484-1485, :1498-1499): морф бургера,
//    FAB, ряд папок — дело хозяина.
//  • `openUrl(url)` — роль `appImManager.openUrl` (:1320); чем исполняется у
//    нас — расхождение 1 шапки шва `core/hooks/useGlobalSearch.ts`.
//
// ── ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ ───────────────────────────────────
//  1. Вкладок 7 из 9 (`:1128-1161`): `apps` и `posts` не объявляются — ручек
//     нет (задачи 16-17 плана, «Отложено»); вместе с `posts` ушли ветки
//     `onChangeTab` (:1173-1181: `prevTab`, клик по `clearBtn`,
//     `globalPostsSearch.setQuery`) и `updateSearchQuery` (:1329-1332).
//     `asChatList: true` (:1165) не передаётся — расхождение 41 класса.
//  2. Группам, `ChatTypeMenu` и чипам нужен срез менеджеров (`managers`
//     опцией, `GlobalSearchManagers`): у оригинала — синглтоны.
//  3. ВЛАДЕНИЕ. Группы у оригинала создаются на `middleware` САЙДБАРА (:1094),
//     который не гаснет никогда, — Solid-корни пяти групп копятся с каждым
//     открытием поиска. Здесь каждый сеанс поиска получает свой
//     `searchMiddlewareHelper`, и `cleanup` гасит его (корни групп вместе с
//     ним), а скроллер, созданный владельцем, роняет `scrollable.destroy()`
//     (у оригинала он не роняется вовсе). Правило DoD 5: владелец снимает всё,
//     что создал, — после закрытия у `#search-container` нет детей. Туда же:
//     `cleanup` снимает с поля и `onEnter` (оригинал снимает только
//     `onChange`/`onClear`, :1411-1412, и Enter со ссылкой после закрытия
//     доходил бы до мёртвого сеанса).
//  4. `watchChannelsTabVisibility` (:1556-1581) спрашивает не RPC
//     `dialogsStorage.getCachedDialogs` + `appPeersManager.isBroadcast`, а
//     зеркало диалогов `useChatsStore` и зеркало карточек (`isBroadcastPeer`) —
//     синхронно, тем же источником, что `loadChannels` класса (его
//     расхождение 44). Событий `channel_update`/`peer_deleted` у нас нет;
//     пересчёт идёт на каждую смену набора диалогов в зеркале (вступление в
//     канал и удаление диалога — оба меняют набор), без паузы 200 мс.
//  5. `onClear` (:1286-1293) обходит КОПИЮ `pickedElements`: `unselectEntity`
//     вырезает чип из того же массива, и `forEach` оригинала по живому массиву
//     пропускает каждый второй — при двух чипах крестик поля снимает один.
//  6. Итог helper'а (:1376-1380) проверяет актуальность запроса
//     (`searchSuper.middleware`): у оригинала проверка стоит только внутри
//     ветки пиров (:1362-1367), и ответ прошлого запроса, пришедший позже
//     нового, затирает helper нового (а вместо отброшенных пиров кладёт в
//     него `undefined` — `flatten` не фильтрует).
//  7. Отмена подтверждения очистки недавних гасится (`.catch`): у оригинала
//     промис `confirmationPopup` (:1506) реджектится на отмене без
//     обработчика.
//  8. Не портировано — у нас этим владеет хозяин: `newBtnMenu`/`updateBtn`
//     `is-hidden` и таймер их возврата (:1398, :1434-1447, :1455-1456) — FAB
//     прячет React-проп `ComposeFab.searching`; `buttonsContainer.is-visible`
//     и `appear-animated` (:1471-1482, :1495) — морф бургера по
//     сигналу `useIsLeftSearchActive` (`sidebarLeft/toolsMenu.ts`), свёрнутой
//     колонки с триггером поиска у нас нет. `isAnimatingCollapse` в `onPop` (:1463) — анимации сворачивания
//     колонки нет.
//  9. Ctrl+F: у оригинала `addShortcutListener(['ctrl+f', …])` (:451-454), у
//     нас сочетание разбирает `core/hotkeys.ts` и объявляет событием
//     `tg-focus-search` — владелец слушает его; гейт «не под попапом» тот же.
// 10. `destroy()` — метода у оригинала нет (колонка живёт столько же, сколько
//     вкладка); у нас хозяин — React-компонент, и на размонтировании владелец
//     снимает сеанс поиска сразу, без перехода, и свои подписки.
// 11. `AppSearchSuper` собирается внутри `createRoot`, снятого на `middleware`
//     сеанса: у оригинала (:1137) класс строится из once-слушателя фокуса без
//     владельца, и Solid-вычисления конструктора (`Tabs.MenuGradient` прямым
//     вызовом, `appSearchSuper.ts` tweb `:650-657`) не освобождаются никогда —
//     dev-сборка Solid пишет «computations created outside a `createRoot`».
//     Тем же порядком, что правая колонка (`sharedMediaTab.tsx:115-118`): корень
//     гаснет после `searchSuper.destroy()` — вместе с `searchMiddlewareHelper`.
import AppSearchSuper, { type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import Scrollable from '@components/scrollable'
import TransitionSlider from '@components/transition'
import ChatTypeMenu from '@components/chatTypeMenu.solid'
import EmptySearchPlaceholder from '@components/emptySearchPlaceholder.solid'
import { createSearchGroup, type SearchGroup } from '@components/searchGroup.solid'
import { renderEntity as renderSelectorEntity } from '@components/selectorEntity'
import { DIALOG_LIST_ELEMENT_TAG } from '@lib/appDialogsManager'
import { confirmationPopup } from '@components/popups/popupPeer'
import type { Managers } from '@/client/bootstrap'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { isBroadcastPeer } from '@core/peerCache'
import { IS_MOBILE_SAFARI } from '@environment/userAgent'
import { attachClickEvent, simulateClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import findUpTag from '@helpers/dom/findUpTag'
import flatten from '@helpers/array/flatten'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import { fillTipDates, type DateData } from '@helpers/date'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import { fastRaf } from '@helpers/schedulers'
import pause from '@helpers/schedulers/pause'
import { i18n } from '@lib/langPack'
import { wrapUrl } from '@lib/richtext/url'
import { useChatsStore } from '@stores/chatsStore'
import { createRoot } from 'solid-js'

/** Контракт tweb `InputSearch` (`inputSearch.ts`) в объёме, который читает и пишет владелец. */
export type GlobalSearchInputSearch = {
  container: HTMLElement
  input: HTMLInputElement
  value: string
  onChange?: (value: string) => void
  onClear?: () => void
  onEnter?: (value: string) => void
}

/** Расхождение 2 в шапке: класс + запись недавних (`appUsersManager`, :1395, :1513). */
export type GlobalSearchManagers = SearchSuperManagers & {
  contacts: Pick<Managers['contacts'], 'getContactsPeerIds' | 'pushRecentSearch' | 'clearRecentSearch'>
}

export type GlobalSearchOptions = {
  searchContainer: HTMLElement
  inputSearch: GlobalSearchInputSearch
  backBtn: HTMLElement
  managers: GlobalSearchManagers
  onSearchActive?: (active: boolean) => void
  openUrl: (url: string) => void
}

/** tweb `SearchInitResult` — возврат `initSearch` (:1525-1553). */
export type SearchInitResult = {
  open: (focus?: boolean) => void
  openWithPeerId: (peerId: PeerId) => void
  close: () => void
}

type SearchGroups = { [k in 'contacts' | 'globalContacts' | 'messages' | 'people' | 'recent']: SearchGroup }

/** tweb `:1128-1161` без `apps`/`posts` — расхождение 1 в шапке. */
const MEDIA_TABS = (): SearchSuperMediaTab[] => [{
  inputFilter: 'inputMessagesFilterEmpty',
  name: 'FilterChats',
  type: 'chats',
}, {
  name: 'ChannelsTab',
  type: 'channels',
}, {
  inputFilter: 'inputMessagesFilterPhotoVideo',
  name: 'SharedMediaTab2',
  type: 'media',
}, {
  inputFilter: 'inputMessagesFilterUrl',
  name: 'SharedLinksTab2',
  type: 'links',
}, {
  inputFilter: 'inputMessagesFilterDocument',
  name: 'SharedFilesTab2',
  type: 'files',
}, {
  inputFilter: 'inputMessagesFilterMusic',
  name: 'SharedMusicTab2',
  type: 'music',
}, {
  inputFilter: 'inputMessagesFilterRoundVoice',
  name: 'SharedVoiceTab2',
  type: 'voice',
}]

export default class GlobalSearch {
  public searchSuper?: AppSearchSuper
  private searchInitResult?: SearchInitResult
  /** роль `AppSidebarLeft.middlewareHelper`: от него рождаются сеансы поиска */
  private middlewareHelper = getMiddleware()
  /** снос текущего сеанса без перехода — для `destroy()` (расхождение 10) */
  private teardownSearch?: () => void
  private destroyed = false

  private searchContainer: HTMLElement
  private inputSearch: GlobalSearchInputSearch
  private backBtn: HTMLElement
  private managers: GlobalSearchManagers
  private onSearchActive?: (active: boolean) => void
  private openUrl: (url: string) => void

  constructor(options: GlobalSearchOptions) {
    this.searchContainer = options.searchContainer
    this.inputSearch = options.inputSearch
    this.backBtn = options.backBtn
    this.managers = options.managers
    this.onSearchActive = options.onSearchActive
    this.openUrl = options.openUrl

    // :220
    this.inputSearch.input.addEventListener('focus', this.onFirstFocus, { once: true })
    // :451-454 — расхождение 9
    window.addEventListener('tg-focus-search', this.onFocusShortcut)
  }

  private onFirstFocus = () => {
    this.initSearch()
  }

  private onFocusShortcut = () => {
    if(appNavigationController.findItemByType('popup')) return
    this.initSearch().open()
  }

  public initSearch(): SearchInitResult {
    if(this.searchInitResult) return this.searchInitResult

    const { searchContainer, inputSearch, backBtn, managers } = this

    // :1089 — скроллер выдачи создаёт хозяин, класс получает его опцией
    // (один из пяти владельцев `Scrollable` в продакшн-коде, см. «Скролл» в
    // `web-client/CLAUDE.md`); `cleanup` его роняет — расхождение 3
    const scrollable = new Scrollable(searchContainer)

    const close = () => {
      simulateClickEvent(backBtn)
    }

    const searchListenerSetter = new ListenerSetter()
    // расхождение 3: сеанс поиска — свой middleware, гасится в `cleanup`
    const searchMiddlewareHelper = this.middlewareHelper.get().create()
    const middleware = searchMiddlewareHelper.get()
    const searchGroups: SearchGroups = {
      contacts: createSearchGroup({ name: 'SearchAllChatsShort', type: 'contacts', onFound: close, middleware, managers }),
      globalContacts: createSearchGroup({ name: 'GlobalSearch', type: 'contacts', onFound: close, middleware, managers }),
      messages: createSearchGroup({ name: 'SearchMessages', type: 'messages', middleware, managers }),
      people: createSearchGroup({ name: false, type: 'contacts', className: 'search-group-people', autonomous: false, onFound: close, noIcons: true, middleware, scrollableX: true, managers }),
      recent: createSearchGroup({ name: 'Recent', type: 'contacts', className: 'search-group-recent', onFound: close, middleware, managers }),
    }

    const chatTypeMenu = new ChatTypeMenu()

    // :1105-1116
    searchGroups.messages.createPlaceholder = () => {
      const placeholder = new EmptySearchPlaceholder()
      if(chatTypeMenu.props.selected !== 'all' && !chatTypeMenu.props.hidden) {
        placeholder.feedProps({
          onAllChats: () => {
            chatTypeMenu.props.selected = 'all'
            updateSearchQuery({ search: inputSearch.value, chatType: 'all' })
          },
        })
      }

      return placeholder
    }

    // :1118-1126
    chatTypeMenu.feedProps({
      onChange: (chatType) => {
        updateSearchQuery({ search: inputSearch.value, chatType })
      },
      selected: 'all',
    })

    searchGroups.messages.setNameRight({
      children: chatTypeMenu,
    })

    // :1128-1170
    // расхождение 11: корень класса — на `middleware` сеанса
    const searchSuper = this.searchSuper = createRoot((dispose) => {
      middleware.onClean(dispose)
      return new AppSearchSuper({
        mediaTabs: MEDIA_TABS(),
        scrollable,
        searchGroups,
        hideEmptyTabs: false,
        showSender: true,
        managers,
        scrollOffset: 16,
      })
    })

    // :1172-1183 — без ветки `posts` (расхождение 1)
    searchSuper.onChangeTab = () => {
      searchSuper.searchContext.chatType = 'all'
    }

    const unwatchChannelsTab = this.watchChannelsTabVisibility()

    scrollable.append(searchSuper.container)

    // :1189-1197
    const resetSearch = () => {
      searchSuper.setQuery({
        peerId: 0,
        folderId: 0,
      })
      searchSuper.selectTab(0)
      void searchSuper.load(true)
    }

    resetSearch()

    // :1200-1224
    const pickedElements: HTMLElement[] = []
    let selectedPeerId: PeerId = 0
    let selectedMinDate = 0
    let selectedMaxDate = 0
    const updatePicked = () => {
      inputSearch.container.classList.toggle('is-picked-twice', pickedElements.length === 2)
      inputSearch.container.classList.toggle('is-picked', !!pickedElements.length)
      pickedElements.forEach((element, idx) => {
        element.classList.remove('is-first', 'is-last')
        element.classList.add(idx === 0 ? 'is-first' : 'is-last')
      })

      if(pickedElements.length) {
        void pause(0).then(() => chatTypeMenu.props.hidden = true)

        inputSearch.input.style.setProperty(
          '--paddingLeft',
          (pickedElements[pickedElements.length - 1].getBoundingClientRect().right - inputSearch.input.getBoundingClientRect().left) + 'px',
        )
      } else {
        chatTypeMenu.props.hidden = false
        inputSearch.input.style.removeProperty('--paddingLeft')
      }
    }

    // :1226-1255
    const helperMiddlewareHelper = this.middlewareHelper.get().create()
    const helper = document.createElement('div')
    helper.classList.add('search-helper', 'hide')
    helper.addEventListener('click', (e) => {
      const target = findUpClassName(e.target!, 'selector-user')
      if(!target) {
        return
      }

      target.classList.remove('selector-user-primary')
      const key = target.dataset.key!
      if(key.startsWith('date_')) {
        const [, minDate, maxDate] = key.split('_')
        selectedMinDate = +minDate
        selectedMaxDate = +maxDate
      } else {
        selectedPeerId = +key
      }

      target.addEventListener('click', () => {
        unselectEntity(target)
      })

      inputSearch.container.append(target)
      inputSearch.onChange?.(inputSearch.value = '')
      pickedElements.push(target)
      updatePicked()
    })

    searchSuper.nav.parentElement!.append(helper)

    // :1257-1266
    const renderEntity = (key: PeerId | string, title?: string | HTMLElement) => {
      return renderSelectorEntity({
        key,
        title,
        middleware: helperMiddlewareHelper.get(),
        managers,
        avatarSize: 30,
        fallbackIcon: 'calendarfilter',
        primary: true,
      }).element
    }

    // :1268-1284
    const unselectEntity = (target: HTMLElement) => {
      const key = target.dataset.key!
      if(key.startsWith('date_')) {
        selectedMinDate = selectedMaxDate = 0
      } else {
        selectedPeerId = 0
      }

      target.middlewareHelper?.destroy()
      target.remove()
      indexOfAndSplice(pickedElements, target)

      setTimeout(() => {
        updatePicked()
        inputSearch.onChange?.(inputSearch.value)
      }, 0)
    }

    // :1286-1293 — копия массива: расхождение 5
    inputSearch.onClear = () => {
      pickedElements.slice().forEach((el) => {
        unselectEntity(el)
      })

      helper.replaceChildren()
      onHelperLength()
    }

    // :1295-1303
    const onHelperLength = (hide = !helper.firstElementChild) => {
      helper.classList.toggle('hide', hide)
      searchSuper.nav.classList.toggle('hide', !hide)
    }

    const appendToHelper = (elements: HTMLElement[]) => {
      helper.append(...elements)
      onHelperLength()
    }

    // :1305-1310
    inputSearch.onChange = (value) => {
      if(searchSuper.mediaTab.type !== 'chats') {
        chatTypeMenu.props.selected = 'all'
      }
      updateSearchQuery({ search: value, chatType: chatTypeMenu.props.selected })
    }

    // :1312-1321 — `wrapped.onclick` оригинала у нас `action` (`lib/richtext/url.ts`)
    inputSearch.onEnter = (value) => {
      const trimmed = value.trim()
      if(!trimmed) return
      const wrapped = wrapUrl(trimmed)
      if(!wrapped.action) return
      inputSearch.value = ''
      inputSearch.onChange?.('')
      simulateClickEvent(backBtn)
      this.openUrl(trimmed)
    }

    // :1323-1381
    const updateSearchQuery = ({ search: value, chatType }: {
      search: string
    } & Pick<SearchHistoryOptions, 'chatType'>) => {
      // spot input
      searchSuper.cleanupHTML()
      searchSuper.setQuery({
        peerId: selectedPeerId,
        folderId: selectedPeerId ? undefined : 0,
        query: value,
        chatType,
        minDate: selectedMinDate,
        maxDate: selectedMaxDate,
      })
      void searchSuper.load(true)

      helperMiddlewareHelper.clean()
      onHelperLength(true)

      // расхождение 6: итог helper'а — только для живого запроса
      const queryMiddleware = searchSuper.middleware.get()
      // `MaybePromise` оригинала (:1349) — синхронный массив дат обёрнут в промис,
      // `Promise.all` и так отдаёт итог микрозадачей
      const promises: Promise<HTMLElement[] | undefined>[] = []

      if(!selectedMinDate && value.trim()) {
        const dates: DateData[] = []
        fillTipDates(value, dates)
        const elements = dates.map((dateData) => {
          return renderEntity('date_' + dateData.minDate + '_' + dateData.maxDate, dateData.title)
        })

        promises.push(Promise.resolve(elements))
      }

      if(!selectedPeerId && value.trim()) {
        const promise = Promise.all([
          managers.dialogs.getDialogs({ query: value }).then(({ dialogs }) => dialogs.map((d) => d.peerId)),
          managers.contacts.getContactsPeerIds(value, true),
        ]).then((results) => {
          if(!queryMiddleware()) return
          const peerIds = new Set(results[0].concat(results[1]).slice(0, 20))

          return [...peerIds].map((peerId) => renderEntity(peerId))
        })

        promises.push(promise)
      }

      void Promise.all(promises).then((arrays) => {
        if(!queryMiddleware()) return
        helper.replaceChildren()
        const flattened = flatten(arrays.filter((array): array is HTMLElement[] => !!array))
        appendToHelper(flattened)
      })
    }

    // :1383-1396
    searchSuper.tabs.inputMessagesFilterEmpty!.addEventListener('mousedown', (e) => {
      const target = findUpTag(e.target!, DIALOG_LIST_ELEMENT_TAG)
      if(!target) {
        return
      }

      const searchGroup = findUpClassName(target, 'search-group')
      if(!searchGroup || searchGroup.classList.contains('search-group-recent') || searchGroup.classList.contains('search-group-people')) {
        return
      }

      const peerId: PeerId = +target.getAttribute('data-peer-id')!
      void managers.contacts.pushRecentSearch(peerId)
    }, { capture: true })

    let first = true
    // :1401-1423. `reinit === false` — снос из `destroy()` (расхождение 10).
    const cleanup = (reinit = true) => {
      pickedElements.forEach((el) => {
        el.middlewareHelper?.destroy()
        el.remove()
      })
      pickedElements.length = 0

      inputSearch.value = ''
      inputSearch.container.classList.remove('is-picked', 'is-picked-twice')
      inputSearch.input.style.removeProperty('--paddingLeft')
      inputSearch.onChange = undefined
      inputSearch.onClear = undefined
      inputSearch.onEnter = undefined

      searchSuper.destroy()
      helperMiddlewareHelper.destroy()
      // расхождение 3: группы и скроллер — созданное владельцем
      searchMiddlewareHelper.destroy()
      scrollable.destroy()
      searchContainer.replaceChildren()
      searchListenerSetter.removeAll()
      unwatchChannelsTab()

      this.searchInitResult = undefined
      this.searchSuper = undefined
      this.teardownSearch = undefined

      if(reinit) {
        inputSearch.input.addEventListener('focus', this.onFirstFocus, { once: true })
      }
    }

    // :1425-1449
    const transition = TransitionSlider({
      content: searchContainer.parentElement!,
      type: 'zoom-fade',
      transitionTime: 150,
      listenerSetter: searchListenerSetter,
      onTransitionStart: (id) => {
        searchContainer.parentElement!.parentElement!.classList.toggle('is-search-active', id === 1)
      },
      onTransitionEnd: (id) => {
        if(id === 0 && !first) {
          cleanup()
        }

        first = false
      },
    })

    transition(0)

    // :1451-1486
    const onFocus = () => {
      const navigationType: NavigationItem['type'] = 'global-search'
      if(!IS_MOBILE_SAFARI && !appNavigationController.findItemByType(navigationType)) {
        appNavigationController.pushItem({
          onPop: () => {
            close()
          },
          type: navigationType,
        })
      }

      transition(1)

      this.onSearchActive?.(true)
    }

    // :1488-1489
    searchListenerSetter.add(inputSearch.input)('focus', onFocus)
    onFocus()

    // :1491-1502
    attachClickEvent(backBtn, () => {
      appNavigationController.removeByType('global-search')

      transition(0)
      this.onSearchActive?.(false)

      chatTypeMenu.props.selected = 'all'
    }, { listenerSetter: searchListenerSetter })

    // :1504-1519
    searchGroups.recent.setNameRight({
      onClick: () => {
        confirmationPopup({
          descriptionLangKey: 'Search.Confirm.ClearHistory',
          button: {
            langKey: 'ClearButton',
            isDanger: true,
          },
        }).then(() => {
          return managers.contacts.clearRecentSearch().then(() => {
            searchGroups.recent.clear()
          })
        }).catch(() => {}) // расхождение 7
      },
      children: i18n('ClearRecentSearch'),
    })

    const focusInput = () => {
      inputSearch.input.focus({ preventScroll: true })
    }

    this.teardownSearch = () => {
      appNavigationController.removeByType('global-search')
      cleanup(false)
    }

    // :1525-1553
    return this.searchInitResult = {
      open: (focus = true) => {
        onFocus()
        if(focus) focusInput()
      },
      openWithPeerId: (peerId: PeerId) => {
        onFocus()
        focusInput()

        selectedPeerId = peerId

        inputSearch.onChange?.(inputSearch.value = '')

        const element = renderEntity(peerId)
        inputSearch.container.append(element)

        element.addEventListener('click', () => {
          unselectEntity(element)
        })

        pickedElements.push(element)
        fastRaf(() => {
          updatePicked()
        })
      },
      close: () => {
        close()
      },
    }
  }

  /** :1556-1581 — расхождение 4 в шапке. Возвращает отписку. */
  private watchChannelsTabVisibility() {
    const checkChannelsVisiblity = () => {
      if(!this.searchSuper) return
      const hasChannels = useChatsStore.getState().dialogs.some((dialog) => isBroadcastPeer(dialog.peerId))

      const channelsTab = this.searchSuper.mediaTabs.find((tab) => tab.type === 'channels')
      channelsTab?.menuTab?.classList.toggle('hide', !hasChannels)
    }

    checkChannelsVisiblity()

    return useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs) checkChannelsVisiblity()
    })
  }

  /** :1583-1585 */
  public closeSearch() {
    simulateClickEvent(this.backBtn)
  }

  /** Расхождение 10 в шапке. */
  public destroy() {
    if(this.destroyed) return
    this.destroyed = true
    this.inputSearch.input.removeEventListener('focus', this.onFirstFocus)
    window.removeEventListener('tg-focus-search', this.onFocusShortcut)
    this.teardownSearch?.()
    this.middlewareHelper.destroy()
  }
}
