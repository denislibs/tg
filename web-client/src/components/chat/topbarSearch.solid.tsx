/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarSearch.tsx` (812502980, 1352 строки) — поиск по
// чату в шапке: поле, выпадающий список найденного (строки чатлиста с превью и
// подсветкой), стрелки «пред./след.», фильтр по отправителю, переход к дате, мобильная
// раскладка (подвал со счётчиком, список поверх ленты, угловые стрелки). Монтирует
// `Chat.init` (`searchSignal`, tweb `chat.ts:740-834`), открывает `chat.initSearch()`.
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ (бэклог — строки Б-91, Б-92 плана К)
//  1. Теги «Избранного» (`savedReactionTags`, `ReactionsElement`, премиум-замок, проп
//     `reaction`, `:925-1098`) не портированы — панель тегов — Б-26 (П-5): у нас нет
//     ни `appReactionsManager.getSavedReactionTags`, ни кастом-элемента
//     `reactions-element`. Контейнеры строки реакций в разметке оставлены пустыми
//     (`:1324-1332`) — высоту им даёт `calculateReactionsHeight`, всегда 0.
//  2. Поиск по хэштегу «в моих сообщениях»/«в публичных постах» (`SEARCH_TYPES`,
//     `SearchTypeEntity`, `updateChatSearchContext`, `ChatType.Search` ленты,
//     `:470-523`, `:744-753`) не портирован: ленты-выдачи (`ChatType.Search`) нет,
//     ручки публичных постов (`channels.searchPosts`) нет. Хэштег ищется в ЭТОМ чате, как
//     у оригинала до выбора типа; плейсхолдер и пустые тексты хэштега — оригинальные.
//  3. `noList`/`onValueChange` (`ChatType.Logs`) — журнала админов нет.
//  4. Строка найденного — `addDialogNew` + `setLastMessageN` (наш порт
//     `addDialogAndSetLastMessage`, `:74-100`): без `loadPromises` (партия ждёт
//     `setLastMessageN`), без ветки «Избранного по пиру-источнику» — у сообщения нет
//     `saved_peer_id` (монофорумов/сохранённых диалогов на проводе нет).
//  5. Переход к найденному — `setMessageId({lastMsgId})` без `highlight: {type:
//     'search', query}` (`:916-920`): подсветки найденного слова в бабле лента не умеет.
//  6. Загрузчик: `messages.searchHistory` (поиск в чате — `GET /chats/{id}/search`,
//     фильтр отправителя — `sender_id`) вместо `getHistory` с подпиской на ключ истории
//     (`toggleHistoryKeySubscription`, `:126-130`) — живых вставок в выдачу у нас нет.
//     `threadId` (`top_msg_id`) ручка не принимает — в треде ищется весь чат.
//  7. Участники для фильтра — `groups.channelParticipants(peerId, offset, 30, q)`
//     (`GET /chats/{id}/members?q=`), порт `getParticipants({filter:
//     channelParticipantsSearch})`.
//  8. `ButtonIconTsx` без подписи по глифу (шапка `components/buttonIconTsx.solid.tsx`).
import {
  batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack,
  type Accessor, type JSX,
} from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import InputSearch from '@components/inputSearch'
import { ButtonIconTsx } from '@components/buttonIconTsx.solid'
import Scrollable from '@components/scrollable2.solid'
import Row from '@components/rowTsx.solid'
import ButtonCorner from '@components/buttonCorner'
import PeerTitle from '@components/chat/peerTitle'
import { avatarNew } from '@components/avatar'
import { renderEntity } from '@components/selectorEntity'
import showDatePickerPopup from '@components/popups/datePicker.bridge'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { cachedPeer } from '@core/peerCache'
import { getParticipantPeerId } from '@core/peers/participant'
import type { MyMessage } from '@core/models'
import { addDialogNew, setLastMessageN } from '@lib/appDialogsManager'
import I18n, { i18n } from '@lib/langPack'
import { wrapEmojiText } from '@lib/richtext'
import { ScreenSize, useMediaSizes } from '@helpers/mediaSizes'
import type { Middleware } from '@helpers/middleware'
import classNames from '@helpers/string/classNames'
import stringMiddleOverflow from '@helpers/string/stringMiddleOverflow'
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd'
import attachListNavigation from '@helpers/dom/attachListNavigation'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import whichChild from '@helpers/dom/whichChild'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import getTextWidth from '@helpers/canvas/getTextWidth'
import { FontFull } from '@config/font'
import { wrapSolidComponent } from '@helpers/solid/wrapSolidComponent'
import createMiddleware from '@helpers/solid/createMiddleware'
import deferSideEffect from '@helpers/solid/deferSideEffect'
import { subscribeOn } from '@helpers/solid/subscribeOn'
import Animated from '@helpers/solid/animations.solid'

/** Срез `Chat`, который читает поиск (tweb передаёт сам класс, `:345`). */
export interface TopbarSearchChat {
  peerId: PeerId
  threadId?: number
  managers: Managers
  bubbles: {
    container: HTMLElement
    updateGoDownVisibility(): void
  }
  topbar: { container: HTMLElement }
  input: { chatInput: HTMLElement }
  setMessageId(options: { lastMsgId?: number }): unknown
}

type LoadOptions = {
  middleware: Middleware,
  managers: Managers,
  peerId: PeerId,
  threadId?: number,
  query: string,
  fromPeerId?: PeerId
}

/** tweb `sidebarRight/tabs/statistics.tsx:143-152` — список с догрузкой. */
type LoadableList<T> = { rendered: HTMLElement[], values: T[], left: number, count: number, loadMore?: () => Promise<void> }
const createLoadableList = <T, >(props: Partial<LoadableList<T>> = {}) => {
  return createSignal<LoadableList<T>>({
    rendered: [],
    values: [],
    left: 0,
    count: 0,
    ...props,
  }, { equals: false })
}

/** tweb `:74-100` — расхождение 4 шапки. */
const renderHistoryResult = ({ middleware, managers, peerId, messages, query }: LoadOptions & { messages: MyMessage[] }) => {
  const promises = messages.map(async(message) => {
    const fromPeerId = message.fromId
    const dialogElement = addDialogNew({
      peerId: fromPeerId || peerId,
      container: false,
      avatarSize: 'abitbigger',
      // tweb :81 `meAsSaved: searchType === 'my'` — своё сообщение подписано
      // своим именем, а не «Избранным». Типов поиска у нас нет (расхождение 2),
      // то есть `searchType` всегда пуст и слагаемое ложно; без него строка
      // брала умолчание конструктора (`meAsSaved = true`, appDialogsManager).
      meAsSaved: false,
      wrapOptions: { middleware },
      autonomous: true,
      managers,
    })

    await setLastMessageN({
      dialog: { peerId },
      lastMessage: message,
      dialogElement,
      highlightWord: query,
    })

    return dialogElement.container
  })

  return Promise.all(promises)
}

/** tweb `:102-176` — расхождение 6 шапки. */
const createSearchLoader = (options: LoadOptions) => {
  const { middleware, managers, peerId, query, fromPeerId } = options
  let lastMessage: MyMessage | undefined, loading = false
  const loadMore = async() => {
    if(loading) {
      return
    }
    loading = true

    const offsetId = lastMessage?.id || 0
    const limit = 30
    const result = await managers.messages.searchHistory({
      peerId,
      inputFilter: { _: 'inputMessagesFilterEmpty' },
      query,
      offsetId,
      limit,
      fromPeerId,
    })
    if(!middleware()) {
      return
    }

    // * a mid can have no message behind it (deleted, or a synthetic bound), skip such holes
    const messages = result.messages.filter(Boolean)

    const rendered = await renderHistoryResult({ ...options, messages })
    if(!middleware()) {
      return
    }

    setF((value) => {
      value.count = result.count
      value.values.push(...messages)
      lastMessage = messages[messages.length - 1]
      if(messages.length < limit || value.values.length >= result.count) {
        value.loadMore = undefined
      }

      value.rendered.push(...rendered)
      return value
    })
    loading = false
  }

  const [f, setF] = createLoadableList<MyMessage>({ loadMore })
  return f
}

/** tweb `:178-236` — расхождение 7 шапки. */
const createParticipantsLoader = (options: LoadOptions) => {
  const { middleware, managers, peerId, query } = options
  let loading = false, offset = 0
  const loadMore = async() => {
    if(loading) {
      return
    }
    loading = true

    const result = await managers.groups.channelParticipants(peerId, offset, 30, query)
    if(!middleware()) {
      return
    }

    const peerIds = result.participants.map(getParticipantPeerId)
    const promises = peerIds.map(async(peerId) => {
      const title = new PeerTitle({ peerId, middleware, managers }).element
      const peer = cachedPeer(peerId)
      const username = peer && 'username' in peer ? peer.username : undefined
      const size = 40
      const avatar = avatarNew({ peerId, size, middleware, managers })
      const row = wrapSolidComponent(() => (
        <Row clickable class="topbar-search-left-sender">
          <Row.Title>
            <span>
              <b>{title}</b> {username && <span class="secondary">{`@${username}`}</span>}
            </span>
          </Row.Title>
          <Row.Media size="40">{avatar.node}</Row.Media>
        </Row>
      ), middleware)
      await avatar.readyThumbPromise

      return row
    })

    const rendered = await Promise.all(promises)
    if(!middleware()) {
      return
    }

    setF((value) => {
      value.count = result.count ?? peerIds.length
      const newLength = value.values.push(...peerIds)
      offset = newLength
      if(newLength >= value.count) {
        value.loadMore = undefined
      }

      value.rendered.push(...rendered)
      return value
    })
    loading = false
  }

  const [f, setF] = createLoadableList<PeerId>({ loadMore })
  return f
}

function SearchFooter(props: {
  index: () => number,
  count: () => number | undefined,
  pickUserBtn: JSX.Element,
  pickDateBtn: JSX.Element,
  resultsShown: () => boolean,
  onToggle: () => void,
  choosingSender: () => boolean
}) {
  return (
    <div class={classNames('chat-search-footer', props.choosingSender() && 'hide')}>
      <div class="chat-search-footer-left">
        {props.pickDateBtn}
        {props.pickUserBtn}
        <span
          class={classNames('chat-search-footer-count', props.count() === undefined && 'hide')}
          role="status"
          aria-live="polite"
        >
          {
            props.count() === 0 ?
              i18n('NoResult') :
              props.resultsShown() ? i18n('messages', [props.count()!]) : i18n('Of', [props.index() + 1, props.count()!])
          }
        </span>
      </div>
      <div class={classNames('chat-search-footer-right', !props.count() && 'hide')}>
        <button
          type="button"
          class="chat-search-footer-type"
          aria-pressed={props.resultsShown()}
          onClick={() => props.onToggle()}
        >
          {i18n(props.resultsShown() ? 'SearchAsChat' : 'SearchAsList')}
        </button>
      </div>
    </div>
  )
}

function SearchMobileResults(props: {
  scrollable: JSX.Element
}) {
  return (
    <div class="chat-search-results chatlist-container">
      {props.scrollable}
    </div>
  )
}

function SearchMobileButtons(props: {
  index: () => number,
  count: () => number | undefined,
  chat: TopbarSearchChat,
  onArrowButtonClick: (direction: 'up' | 'down') => void
}) {
  const makeButton = (icon: 'up' | 'down', onClick: () => void) => {
    const btn = ButtonCorner({
      icon,
      className: 'is-visible bubbles-corner-button chat-secondary-button chat-search-go chat-search-go-' + icon,
    })
    btn.setAttribute('aria-label', I18n.format(icon === 'up' ? 'Chat.Search.PreviousResult' : 'Chat.Search.NextResult', true))
    const detach = attachClickEvent(btn, onClick)
    onCleanup(detach)

    const isEnd = createMemo(() => {
      if(icon === 'down') {
        return props.index() === 0
      } else {
        return props.index() === (props.count() || 0) - 1
      }
    })

    createEffect(() => {
      btn.classList.toggle('is-end', isEnd())
      btn.classList.toggle('hide', (props.count() || 0) < 2)
    })

    return btn
  }

  const buttons = [
    makeButton('up', props.onArrowButtonClick.bind(null, 'up')),
    makeButton('down', props.onArrowButtonClick.bind(null, 'down')),
  ]

  props.chat.bubbles.container.after(...buttons)
  onCleanup(() => {
    buttons.forEach((button) => {
      button.remove()
    })
  })
}

export default function TopbarSearch(props: {
  chat: TopbarSearchChat,
  peerId: PeerId,
  threadId?: number,
  filterPeerId: Accessor<PeerId | undefined>,
  canFilterSender?: boolean,
  query: Accessor<string | undefined>,
  onClose?: () => void,
  onDatePick?: (timestamp: number) => void,
  onActive?: (active: boolean, showingReactions: boolean, isSmallScreen: boolean) => void
}) {
  const managers = props.chat.managers
  const mediaSizes = useMediaSizes()
  const isSmallScreen = createMemo(() => mediaSizes.activeScreen === ScreenSize.mobile)
  const [isInputFocused, setIsInputFocused] = createSignal(false)
  const [value, setValue] = createSignal<string>('')
  const [count, setCount] = createSignal<number>()
  const [totalCount, setTotalCount] = createSignal<number>()
  const [list, setList] = createSignal<{ element: HTMLElement, type: 'messages' | 'senders' }>()
  const [messages, setMessages] = createSignal<MyMessage[]>()
  const [sendersPeerIds, setSendersPeerIds] = createSignal<PeerId[]>()
  const [loadMore, setLoadMore] = createSignal<(() => Promise<void>) | undefined>()
  const [target, setTarget] = createSignal<HTMLElement | undefined>(undefined, { equals: false })
  const [filteringSender, setFilteringSender] = createSignal<boolean>(false)
  const [filterPeerId, setFilterPeerId] = createSignal<PeerId>()
  const [senderInputEntity, setSenderInputEntity] = createSignal<HTMLElement>()
  const [showingSmallResults, setShowingSmallResults] = createSignal(false)
  const choosingSender = createMemo(() => filteringSender() && !filterPeerId())
  const shouldShowResults = createMemo(() => isSmallScreen() ? showingSmallResults() : isInputFocused())
  const shouldHaveListNavigation = createMemo(() => (shouldShowResults() && count() && list()) || undefined)
  const lookingHashtag = createMemo(() => {
    if(filteringSender()) return
    const _value = value()
    return _value.startsWith('#') ? _value.slice(1) : undefined
  })
  const isHashtag = createMemo(() => lookingHashtag() !== undefined)
  // расхождение 1 шапки: тегов «Избранного» нет — строка реакций не показывается
  const shouldShowReactions = () => false
  const shouldShowFromPlaceholder = createMemo(() => (!isSmallScreen() || !filterPeerId()) && filteringSender())
  const isActive = createMemo(() => isSmallScreen() || shouldShowReactions() || shouldShowResults())

  if(props.onActive) {
    createEffect(() => {
      props.onActive!(isActive(), shouldShowReactions(), isSmallScreen())
    })

    onCleanup(() => {
      props.onActive!(false, false, isSmallScreen())
    })
  }

  const onInputClear: (e?: MouseEvent, wasEmpty?: boolean) => void = (e, wasEmpty = inputSearch.inputField.isEmpty()) => {
    if(filterPeerId()) {
      if(e) cancelEvent(e)
      if(wasEmpty) setFilterPeerId(undefined)
      return
    }

    if(filteringSender()) {
      if(e) cancelEvent(e)
      if(wasEmpty) setFilteringSender(false)
      return
    }

    if(wasEmpty) {
      if(isSmallScreen()) {
        return
      }

      props.onClose?.()
    }
  }

  const inputSearch: InputSearch = new InputSearch({
    placeholder: 'Search',
    onChange: setValue,
    onClear: onInputClear,
    onFocusChange: setIsInputFocused,
    onBack: () => {
      props.onClose?.()
    },
    alwaysShowClear: true,
    noBorder: true,
    verifyDebounce: (value) => {
      return value !== '#' &&
        !inputSearch.container.classList.contains('show-placeholder') &&
        !!value.trim() // skip debounce for hashtag
    },
    arrowBack: isSmallScreen(),
  })
  inputSearch.container.classList.add('topbar-search-input-container')
  inputSearch.input.classList.add('topbar-search-input')
  const onKeyDown = (e: KeyboardEvent) => {
    if(e.key !== 'Backspace') {
      return
    }

    const isEmpty = inputSearch.inputField.isEmpty()
    if(isEmpty && (filterPeerId() || filteringSender())) {
      onInputClear(undefined, isEmpty)
    }
  }
  subscribeOn(inputSearch.input)('keydown', onKeyDown)
  onCleanup(() => {
    inputSearch.remove()
  })

  // * full search replacement
  createEffect(() => {
    const query = props.query() ?? ''
    inputSearch.value = query
    setValue(query)
    setFilteringSender(!!props.filterPeerId())
    setFilterPeerId(props.filterPeerId())

    onMount(() => {
      placeCaretAtEnd(inputSearch.input)
    })
  })

  // * list navigation
  createEffect(() => {
    const { element } = shouldHaveListNavigation() || {}
    if(!element) {
      return
    }

    const list = element.firstElementChild as HTMLElement
    const activeClassName = 'menu-open'
    const el = list.querySelector(`.${activeClassName}`)
    if(el) el.classList.remove(activeClassName)
    const { detach } = attachListNavigation({
      list,
      type: 'y',
      onSelect: (target) => {
        const shouldBlur = !!(!filteringSender() || filterPeerId())
        setTarget(target as HTMLElement)
        if(shouldBlur) {
          blurActiveElement()
        }
      },
      activeClassName,
      cancelMouseDown: true,
      target: untrack(target),
    })

    onCleanup(() => {
      detach()
    })
  })

  const navigationItem: NavigationItem = {
    type: 'topbar-search',
    onPop: () => {
      if(isInputFocused() && value()) {
        blurActiveElement()
        return false
      }

      props.onClose?.()
    },
  }
  appNavigationController.pushItem(navigationItem)
  onCleanup(() => {
    appNavigationController.removeItem(navigationItem)
  })

  const hashWidth = getTextWidth('#', FontFull)
  const fromText = I18n.format('Search.From', true) + ' '
  const fromWidth = getTextWidth(fromText, FontFull)
  const fromSpan = (<span class={classNames('topbar-search-input-from', shouldShowFromPlaceholder() && 'is-visible')}>{fromText}</span>) as HTMLElement
  inputSearch.container.append(fromSpan)
  createEffect<HTMLElement | undefined>((_element) => {
    const filtering = filteringSender()
    const _isHashtag = isHashtag()
    if(_element) {
      const prev = _element
      prev.classList.remove('scale-in')
      void prev.offsetWidth
      prev.classList.add('scale-out')
      setTimeout(() => {
        prev.remove()
      }, 200)
    }

    const element = senderInputEntity()
    if(element) {
      element.classList.add('topbar-search-input-entity', 'scale-in')
      const detach = attachClickEvent(element, (e) => {
        cancelEvent(e)
        setFilterPeerId(undefined)
      }, { cancelMouseDown: true })
      onCleanup(detach)
      inputSearch.container.append(element)
    }

    inputSearch.container.style.setProperty('--padding-placeholder', (shouldShowFromPlaceholder() ? fromWidth : 0) + 'px')
    inputSearch.container.style.setProperty('--padding-hashtag', (_isHashtag ? hashWidth : 0) + 'px')
    inputSearch.container.style.setProperty('--padding-sender', (element ? element.offsetWidth + 6 : 0) + 'px')
    inputSearch.setPlaceholder(filtering && !element ? 'Search.Member' : (_isHashtag ? 'Search.Hashtag' : 'Search'))
    return element
  })

  // * keep placeholder while input is empty
  createEffect(() => {
    inputSearch.container.classList.toggle('show-placeholder', lookingHashtag() === '')
  })

  // * handle sender entity (tweb `:603-640`, без ветки типа поиска — расхождение 2)
  createEffect(() => {
    const peerId = filterPeerId()
    const middleware = createMiddleware().get()
    if(!peerId) {
      setSenderInputEntity(undefined)
      return
    }

    const entity = renderEntity({
      key: peerId,
      middleware,
      managers,
      avatarSize: 30,
      meAsSaved: false,
    })
    void Promise.all(entity.promises).then(() => {
      if(!middleware()) {
        return
      }

      setSenderInputEntity(entity.element)
    })
  })

  const MAX_HEIGHT = 271
  const MIN_HEIGHT = 43

  let scrollableDiv!: HTMLDivElement
  const onArrowButtonClick = (direction: 'up' | 'down') => {
    let _target = target()
    if(!_target) {
      _target = scrollableDiv.querySelector<HTMLElement>('.chatlist-chat') || undefined
      setTarget(_target)
      return
    }

    if(direction === 'down') {
      _target = _target.previousElementSibling as HTMLElement
    } else {
      _target = _target.nextElementSibling as HTMLElement
    }

    if(!_target || !_target.classList.contains('chatlist-chat')) {
      return
    }

    // set scroll position to center
    const top = _target.offsetTop
    const clientHeight = MAX_HEIGHT
    scrollableDiv.scrollTop = top - clientHeight / 2 + _target.clientHeight / 2

    setTarget(_target)
  }

  const ArrowButton = ({ direction }: { direction: 'up' | 'down' }) => {
    return (
      <ButtonIconTsx
        icon={direction}
        aria-label={I18n.format(direction === 'up' ? 'Chat.Search.PreviousResult' : 'Chat.Search.NextResult', true)}
        class={classNames(
          'input-search-part',
          'topbar-search-input-arrow',
          (!count() || (filteringSender() && !filterPeerId())) && 'hide',
        )}
        noRipple
        // Safe to opt into the tab order: the only hidden state is the `hide`
        // class above, which is `display: none !important`, so it leaves the DOM
        // focus order entirely while hidden.
        tabIndex={0}
        onClick={() => {
          onArrowButtonClick(direction)
        }}
      />
    )
  }

  const b = inputSearch.clearBtn.previousSibling as ChildNode
  const inputSearchTools = (<div class="topbar-search-input-tools">
    {!isSmallScreen() && (
      <>
        <ArrowButton direction="up" />
        <ArrowButton direction="down" />
      </>
    )}
    {inputSearch.clearBtn}
  </div>) as HTMLElement
  b.after(inputSearchTools)

  // * search
  createEffect(() => {
    const { peerId, threadId } = props
    const query = value()
    const fromPeerId = filterPeerId()
    const isSender = choosingSender()
    const middleware = createMiddleware().get()
    const isEmptyQuery = !query.trim() || query === '#'
    const _isHashtag = isHashtag()

    setLoadMore(undefined)
    setMessages()
    setSendersPeerIds()
    setTarget()

    const loader = (isSender ? createParticipantsLoader : createSearchLoader)({
      middleware,
      managers,
      peerId,
      threadId,
      query,
      fromPeerId,
    }) as Accessor<LoadableList<MyMessage | PeerId>>

    const isEmpty = createMemo(() => count() === 0 || (_isHashtag && count() === undefined))

    let ref!: HTMLDivElement
    const list = (
      <div
        ref={(el) => ref = el}
        class={classNames(!untrack(isSmallScreen) && 'topbar-search-left-chatlist', 'chatlist', isEmpty() && 'is-empty')}
      >
        {isEmpty() ? (
          <div class="topbar-search-left-results-empty">
            {_isHashtag && (count() === undefined ?
              i18n('Search.HelpHashtag') :
              i18n('Search.EmptyHashtag', [wrapEmojiText(stringMiddleOverflow(query, 18))]))}
            {!_isHashtag && (fromPeerId ?
              i18n('Search.EmptyFrom', [new PeerTitle({ peerId: fromPeerId, middleware, managers }).element]) :
              i18n('Search.Empty', [wrapEmojiText(stringMiddleOverflow(query, 18))])
            )}
          </div>
        ) : (
          <>
            <div>
              {loader().rendered}
            </div>
            {loader().rendered && <div class="topbar-search-left-results-padding" />}
          </>
        )}
      </div>
    )

    let first = true
    const onLoad = (firstElement?: HTMLElement) => {
      if(first) {
        inputSearch.toggleLoading(false)
        setList({ element: ref, type: isSender ? 'senders' : 'messages' })
        scrollableDiv.scrollTop = 0
        first = false

        // * jump to first target
        if(untrack(isSmallScreen) && !isSender) {
          setTarget(untrack(messages) && firstElement)
        }
      }
    }

    void list // узел уже собран; в DOM его кладёт `setList` из `onLoad`

    if(!isSender && !fromPeerId && isEmptyQuery) {
      setCount()
      setTotalCount()
      onLoad()
      return
    }

    createEffect(
      on(
        () => loader(),
        ({ rendered, values, count, loadMore }) => {
          setCount(rendered.length)
          setTotalCount(count)
          setLoadMore(() => loadMore)
          if(isSender) setSendersPeerIds(values as PeerId[])
          else setMessages(values as MyMessage[])
          onLoad(rendered[0])
        },
        { defer: true },
      ),
    )

    inputSearch.toggleLoading(true)
    void untrack(() => loader().loadMore?.())
  })

  // * handle target change to jump to message
  createEffect(
    on(
      target,
      (target) => {
        if(!target) {
          return
        }

        const idx = whichChild(target)
        if(idx === -1) {
          return
        }

        if(choosingSender()) {
          const peerId = sendersPeerIds()![idx]
          batch(() => {
            setFilterPeerId(peerId)
            inputSearch.value = ''
            setValue('')
          })
          return
        }

        const previousActive = target.parentElement?.querySelector('.active')
        if(previousActive) {
          previousActive.classList.remove('active')
        }

        target.classList.add('active')

        setShowingSmallResults(false)

        const message = messages()![idx]
        deferSideEffect(() => {
          props.chat.setMessageId({
            lastMsgId: message.id,
          })
        })
      },
      { defer: true },
    ),
  )

  const calculateResultsHeight = createMemo(() => {
    if(!shouldShowResults()) {
      return 0
    }

    const length = count()
    if(length === undefined && !isHashtag()) {
      return 0
    }

    const paddingVertical = 8 * 2
    let height: number
    if(!length) {
      height = MIN_HEIGHT
    } else if(list()!.type === 'senders') {
      height = 1 + paddingVertical + length * 48
    } else {
      height = 1 + paddingVertical + length * 56
    }

    return Math.min(MAX_HEIGHT, height)
  })

  // расхождение 1 шапки — строки реакций нет
  const calculateReactionsHeight = () => 0

  const pickUserBtn = props.canFilterSender && (
    <ButtonIconTsx
      class={classNames(!isSmallScreen() && 'topbar-search-right-filter-button')}
      icon="newprivate"
      aria-label={I18n.format('Search.Member', true)}
      ref={(element: HTMLButtonElement) => {
        const detach = attachClickEvent(element, (e) => {
          cancelEvent(e)
          inputSearch.value = ''
          setValue('')
          setFilteringSender(true)
          placeCaretAtEnd(inputSearch.input, true)
        }, { cancelMouseDown: true })
        onCleanup(detach)
      }}
    />
  )

  const pickDateBtn = props.onDatePick && (
    <ButtonIconTsx
      icon="calendar"
      aria-label={I18n.format('JumpToDate', true)}
      onClick={() => {
        showDatePickerPopup({
          initDate: new Date(),
          onPick: props.onDatePick!,
        })
      }}
    />
  )

  const scrollable = (
    <Scrollable
      ref={(el) => scrollableDiv = el}
      class={!isSmallScreen() ? 'topbar-search-left-results topbar-search-left-collapsable' : undefined}
      style={!isSmallScreen() && calculateResultsHeight() ? { height: calculateResultsHeight() + 'px' } : undefined}
      onScrolledBottom={() => {
        void loadMore()?.()
      }}
    >
      {!isSmallScreen() && <div class="topbar-search-left-delimiter"></div>}
      <Animated type="cross-fade">
        {list()?.element}
      </Animated>
    </Scrollable>
  )

  // * mobile search
  createEffect(() => {
    inputSearch.setArrowBack(isSmallScreen())
    if(!isSmallScreen()) {
      return
    }

    const index = () => whichChild(target())

    const footerElement = SearchFooter({
      index,
      count: totalCount,
      pickUserBtn,
      pickDateBtn,
      resultsShown: shouldShowResults,
      onToggle: () => {
        setShowingSmallResults((prev) => !prev)
      },
      choosingSender,
    }) as HTMLElement

    const resultsElement = SearchMobileResults({
      scrollable,
    }) as HTMLElement

    SearchMobileButtons({
      index,
      count: totalCount,
      chat: props.chat,
      onArrowButtonClick,
    })

    const onShowingSmallResultsChange = (value = showingSmallResults()) => {
      props.chat.bubbles.container.classList.toggle('search-results-active', value)
      props.chat.bubbles.updateGoDownVisibility()
      resultsElement.classList.toggle('active', value)
    }

    // tweb `onTopActive` (`:1180-1187`): верхней строки (теги/типы поиска) нет — расхождения 1, 2
    const onTopActive = (value = !!calculateReactionsHeight()) => {
      props.chat.topbar.container.classList.toggle('search-top-active', value)
      resultsElement.classList.toggle('search-top-active', value)
    }

    createEffect(() => onShowingSmallResultsChange())
    createEffect(() => onTopActive())

    createEffect(() => {
      if(choosingSender()) {
        setShowingSmallResults(true)
      } else if(!filteringSender()) {
        setShowingSmallResults(false)
      }
    })

    onCleanup(() => {
      footerElement.remove()
      setShowingSmallResults(false)
      onShowingSmallResultsChange()
      onTopActive(false)

      setTimeout(() => {
        resultsElement.remove()
      }, 400)
    })

    props.chat.input.chatInput.before(resultsElement, footerElement)
  })

  return (
    <div class="topbar-search-container">
      <div class={classNames('topbar-search-left-container', isActive() && 'is-focused')}>
        <div class="topbar-search-left-background" />
        {inputSearch.container}
        {!isSmallScreen() && scrollable}
      </div>
      {!isSmallScreen() && (
        <div class="topbar-search-right-container">
          {pickUserBtn && (
            <div class={classNames('topbar-search-right-filter', (filteringSender() || isHashtag()) && 'is-hidden')}>
              {pickUserBtn}
            </div>
          )}
          {pickDateBtn && (
            <div class={classNames('topbar-search-right-filter', isHashtag() && 'is-hidden')}>
              {pickDateBtn}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

