/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/pinnedMessage.tsx` (812502980, 841 строка) — плашка
// закреплённого сообщения под шапкой чата: какой закреп показан (по нижнему видимому баблу),
// переход по клику с перелистыванием на следующий, меню (все закрепы / открепить / скрыть),
// крестик открепления. Пачка П-5 волны 7 (Б-19). Ставит её в шапку агент «шапка»
// (`topbar.setupPinnedMessageForPeer`/`revealPreparedPinnedMessage`, контракт П-5).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Источник закрепов — `core/pinnedMessages.ts` (его расхождения 1–3): страница
//     `getHistory({inputFilter: pinned, offsetId, limit, backLimit})` режется из всего списка
//     закрепов чата, поэтому `loadedTop`/`loadedBottom` сводятся с первой загрузки. Закреп
//     вне окна ленты берётся из кэша списка (`getPinnedMessageByMid`), а не из хранилища
//     сообщений пира, которого на главном потоке нет.
//  2. `isOurPinUpdate` без ветки «тема форума по самому сообщению» (`getMessageThreadId`):
//     закрепы у нас на весь чат, тематической выдачи нет (расхождение 3 `pinnedMessages`).
//  3. Подзаголовок и превью — `wrapMessageForReply` + миниатюра медиа (`managers.media`), а не
//     `wrapReplyDivAndCaption` (`replyContainer.ts:150-294`): у нашего `replyContainer.ts` её нет
//     (превью медиа ответа не портировано, его шапка). Правило `isMediaSet` то же: медиа без
//     миниатюры (голос, аудио, файл без превью) превью не даёт и `is-media` не ставит.
//     `isSensitive` (размытие чувствительного медиа) — предмета нет.
//  4. Кнопка действия справа (`updateActionButton` `:669-747`: одиночная инлайн-кнопка бота
//     через `getKeyboardButtonHandler`, «Присоединиться к звонку» через
//     `getWebPageActionOnClick`) — нет ни обработчиков инлайн-клавиатуры, ни веб-превью
//     звонка: `has-custom-action-button` не ставится никогда. Бэклог Б-89.
//  5. Шапка описана срезом `PinnedMessageTopbar` — ровно теми членами tweb `ChatTopbar`,
//     которые зовёт плашка (`setFloating`, `openPinned`); их пишет агент «шапка».
import { createSignal, type JSX } from 'solid-js'
import type { Managers } from '@/client/bootstrap'
import showPinMessagePopup from '@components/popups/unpinMessage'
import PinnedMessageBorder from '@components/chat/pinnedMessageBorder'
import rootScope from '@lib/rootScope'
import type Chat from '@components/chat/chat'
import ListenerSetter from '@helpers/listenerSetter'
import { getHeavyAnimationPromise } from '@core/dom/heavyAnimation'
import { i18n } from '@lib/langPack'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import handleScrollSideEvent from '@helpers/dom/handleScrollSideEvent'
import debounce from '@helpers/schedulers/debounce'
import throttle from '@helpers/schedulers/throttle'
import { logger } from '@lib/logger'
import { AnimatedSuper } from '@components/animatedSuper'
import { AnimatedCounter } from '@components/animatedCounter'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import ButtonIcon from '@components/buttonIcon'
import TopbarPlate, { createTopbarPlate, type TopbarPlateController } from '@components/chat/topbarPlate.solid'
import classNames from '@helpers/string/classNames'
import type { Middleware } from '@helpers/middleware'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import { cachedMediaUrl } from '@core/mediaCache'
import { getMediaId } from '@core/messages/messageKind'
import type { MyMessage } from '@core/models'
import { canPinMessage, getPinnedHistory, getPinnedMessage, getPinnedMessageByMid } from '@core/pinnedMessages'

/** Расхождение 5: члены `ChatTopbar`, которые зовёт плашка. */
export type PinnedMessageTopbar = {
  setFloating(): void,
  openPinned(byCurrent: boolean): void
}

export type PinnedMessageManagers = Pick<Managers, 'messages' | 'media'>

/**
 * Top-level body component so solid-refresh can swap it on HMR. All
 * inputs are stable DOM elements / callbacks owned by the factory's
 * closure — the closure (signals, listeners, pin-list state) is
 * preserved across reloads because the factory isn't re-invoked.
 */
function PinnedMessagePlateBody(props: {
  menu: HTMLElement,
  actionContainer: HTMLElement,
  border: JSX.Element,
  mediaContainer: HTMLElement,
  subtitleContainer: HTMLElement,
  counterContainer: HTMLElement,
  onFollow: () => void
}) {
  return (
    <>
      {props.menu}
      <TopbarPlate.Body class="hover-primary-effect" onClick={props.onFollow}>
        {props.border}
        <TopbarPlate.Content>
          {props.mediaContainer}
          <TopbarPlate.Title>
            {i18n('PinnedMessage')}
            {' '}
            {props.counterContainer}
          </TopbarPlate.Title>
          <TopbarPlate.Subtitle>
            {props.subtitleContainer}
          </TopbarPlate.Subtitle>
        </TopbarPlate.Content>
      </TopbarPlate.Body>
      {props.actionContainer}
    </>
  )
}

const LOAD_COUNT = 50
const LOAD_OFFSET = 5

export type ChatPinnedMessageController = TopbarPlateController & {
  /** Mutable "user has hidden the plate" flag (matches old `pinnedMessage.hidden`). */
  setUserHidden: (hidden: boolean) => void,
  isUserHidden: () => boolean,
  /** Read-only "currently following a click — ignore scroll" flag. */
  isLocked: () => boolean,

  /** Push the bottom-visible bubble's mid; recomputes which pin to show. */
  testMid: (mid: number, lastScrollDirection?: number) => void,
  setCorrectIndex: (lastScrollDirection?: number) => void,
  setCorrectIndexThrottled: (lastScrollDirection?: number) => void,
  handleFollowingPinnedMessage: () => Promise<void>,
  unsetScrollDownListener: (refreshPosition?: boolean) => void,

  /**
   * Discussion-mode: forces the plate to display a single static message
   * (the thread root) without paging or scroll tracking.
   */
  setStaticMessage: (mid: number) => void,

  /**
   * Currently displayed plate state, or undefined when no pin is shown.
   * Captured on chat exit into `ChatSavedPosition.pinnedMessages` so the
   * next `prepareInitial` can restore the exact same view (mid + index
   * within the pinned list + total count) atomically with bubbles.
   */
  readonly pinnedMessages: { mid: number, index: number, count: number } | undefined,
  /**
   * Populate state and content from a hint (saved plate state or just a
   * mid from `fullPeer.pinned_msg_id`) but keep the plate visually hidden.
   * Pair with `revealPrepared`, called sync from `topbar.finishPeerChange`
   * after `Promise.all(promises)` so plate and bubbles paint together.
   * Returns a promise that resolves once `prepared` flips true.
   */
  prepareInitial: (data: { mid: number, index?: number, count?: number }) => Promise<void>,
  /** Flip the prepared plate visible. No-op if `prepareInitial` was skipped. */
  revealPrepared: () => void
}

/**
 * Расхождение 3: превью медиа закрепа — миниатюра, если она у медиа есть. Возвращает
 * `isMediaSet` (`wrapReplyDivAndCaption` → `wrapReplyMedia`, `replyContainer.ts:79-81`).
 */
async function wrapPinnedMedia(mediaEl: HTMLElement, message: MyMessage, managers: PinnedMessageManagers, middleware: Middleware): Promise<boolean> {
  const mediaId = getMediaId(message)
  if(mediaId === undefined) {
    return false
  }

  const meta = await managers.media.meta(mediaId).catch(() => undefined)
  if(!meta?.hasThumb || !middleware()) {
    return false
  }

  const url = cachedMediaUrl(mediaId, true) ?? await managers.media.downloadMediaURL(mediaId, { thumb: true }).catch(() => undefined)
  if(!url || !middleware()) {
    return false
  }

  const img = document.createElement('img')
  img.src = url
  mediaEl.replaceChildren(img)
  return true
}

export default function createChatPinnedMessage(
  topbar: PinnedMessageTopbar,
  chat: Chat,
  managers: PinnedMessageManagers,
): ChatPinnedMessageController {
  const log = logger('PM')
  const debug = true

  // Imperative animation pieces — kept as-is per refactor scope; only refs are
  // threaded through JSX below.
  const animatedSubtitle = new AnimatedSuper()
  const animatedMedia = new AnimatedSuper()
  animatedMedia.container.classList.add('pinned-message-media-container')
  const animatedCounter = new AnimatedCounter({ reverse: true })
  const pinnedMessageBorder = new PinnedMessageBorder()
  let wasPinnedIndex = 0
  let wasPinnedMediaIndex = 0
  /**
   * Bumped by every `_setPinnedMessage` run. The function awaits content
   * wrapping, and the debounce can have two runs in flight (first + last), so a
   * slower earlier run must not commit its pin over the newer one.
   */
  let renderSeq = 0

  // Listeners — top-level for the lifetime of this plate, plus a transient
  // one for the wait-for-bottom-scroll flow.
  const listenerSetter = new ListenerSetter()
  let scrollDownListenerSetter: ListenerSetter | undefined

  // State (closure vars — were class fields).
  let mids: number[] = []
  let offsetIndex = 0
  let count = 0
  let pinnedIndex = -1
  let pinnedMid = 0
  let pinnedMaxMid = 0
  let loadedTop = false
  let loadedBottom = false
  let waitForScrollBottom = false
  let getCurrentIndexPromise: Promise<void> | undefined
  let loading = false
  let userHidden = false
  let locked = false
  const isStatic = !chat.isPinnedMessagesNeeded()

  // Captured from inside the plate's render fn — drives `hide` class.
  let plateSetHidden!: (hidden: boolean) => void
  // True when `prepareInitial` has populated state/content but the visual
  // reveal is deferred until `revealPrepared` is called — so the plate
  // flips visible in the same paint frame as bubbles mount.
  let prepared = false

  // Reactive flags applied to the plate root via `createTopbarPlate({class})`
  // so we don't mutate `plate.container.classList` from imperative paths.
  const [isMedia, setIsMedia] = createSignal(false)
  const [isMany, setIsMany] = createSignal(false)
  // расхождение 4: кнопки действия нет — флаг всегда снят
  const [hasCustomActionButton] = createSignal(false)

  /** расхождение 1: закреп вне окна ленты — из кэша списка закрепов */
  const getMessage = (mid: number) => chat.getMessage(mid) ?? getPinnedMessageByMid(chat.peerId, mid, chat.threadId)

  // ────────────────────────────────────────────────────────────────────────
  // DOM bits that live as siblings of the Body inside the plate root.
  // ────────────────────────────────────────────────────────────────────────

  const menu = ButtonMenuToggle({
    buttonOptions: { ariaLabel: 'MultiAccount.More' },
    direction: 'bottom-right',
    buttons: [{
      icon: 'pinlist',
      text: 'PinnedMessages',
      onClick: () => {
        topbar.openPinned(true)
      },
      verify: () => true,
    }, {
      icon: 'unpin',
      text: 'UnpinMessage',
      onClick: () => {
        void showPinMessagePopup(chat.peerId, pinnedMid, true, undefined, chat.threadId)
      },
      verify: () => canPinMessage(chat.peerId),
    }, {
      icon: 'eyecross',
      text: 'Popup.Unpin.HideTitle',
      onClick: () => {
        void showPinMessagePopup(chat.peerId, 0, true, undefined, chat.threadId)
      },
      verify: () => !canPinMessage(chat.peerId),
    }],
    listenerSetter,
    icon: 'pin',
  })
  menu.classList.add('pinned-message-menu')

  const btnUnpin = ButtonIcon('close pinned-message-unpin', { ariaLabel: 'UnpinMessage' })
  attachClickEvent(btnUnpin, (e) => {
    cancelEvent(e)
    const canPin = canPinMessage(chat.peerId)
    void showPinMessagePopup(
      chat.peerId,
      canPin ? pinnedMid : 0,
      true,
      undefined,
      chat.threadId,
    )
  }, { listenerSetter })

  const actionContainer = document.createElement('div')
  actionContainer.classList.add('pinned-message-action')
  actionContainer.append(btnUnpin)

  // ────────────────────────────────────────────────────────────────────────
  // Plate
  // ────────────────────────────────────────────────────────────────────────

  const plate = createTopbarPlate({
    modifier: 'message',
    height: 48,
    initiallyHidden: true,
    class: () => classNames(
      isMedia() && 'is-media',
      isMany() && 'is-many',
      hasCustomActionButton() && 'has-custom-action-button',
    ),
    onVisibilityChange: () => topbar.setFloating(),
    render: ({ setHidden }) => {
      plateSetHidden = setHidden
      return (
        <PinnedMessagePlateBody
          menu={menu}
          actionContainer={actionContainer}
          border={pinnedMessageBorder.render(1, 0)}
          mediaContainer={animatedMedia.container}
          subtitleContainer={animatedSubtitle.container}
          counterContainer={animatedCounter.container}
          onFollow={() => followPinnedMessage(pinnedMid)}
        />
      )
    },
  })

  // ────────────────────────────────────────────────────────────────────────
  // rootScope listeners
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Does a pin update touch the list this plate renders? A thread-scoped update
   * (unpin-all inside a topic) names its topic; a plain pin/unpin update names
   * none — расхождение 2: закрепы на весь чат, поэтому он наш.
   */
  function isOurPinUpdate(threadId: number | undefined) {
    if(threadId) return threadId === chat.threadId
    return true
  }

  listenerSetter.add(rootScope)('peer_pinned_messages', ({ peerId, threadId }) => {
    if(peerId !== chat.peerId || !isOurPinUpdate(threadId)) return
    // A pin update clears the persisted hidden state (`resetPinnedMessagesCache`),
    // so drop the local flag too — but leave the plate hidden: `_setPinnedMessage`
    // reveals it once we know what to show. Revealing here would flash the
    // previous pin, or an empty plate when the last one was just removed.
    userHidden = false

    // Anchor the post-update display at the pin the user was looking at
    // while they are actually walking the pin list (`followPinnedMessage` sets
    // `locked` / `waitForScrollBottom`); anywhere else the viewport is the truth —
    // pinning a new message while sitting at the bottom of the chat must move the
    // plate onto that new pin. At the end of the history the plate shows the newest pin.
    const scrollable = chat.bubbles.scrollable
    const atHistoryEnd = scrollable.loadedAll.bottom && scrollable.isScrolledToEnd
    const anchorMid = locked || (waitForScrollBottom && !atHistoryEnd) ? pinnedMid : 0

    loadedTop = loadedBottom = false
    pinnedIndex = -1
    pinnedMid = 0
    count = 0
    mids = []
    offsetIndex = 0
    pinnedMaxMid = 0

    if(anchorMid) {
      // Fetch around the anchor so the new mids window contains its
      // neighbours, then re-position at the anchor. If still pinned,
      // testMid finds it exactly; if unpinned, it falls onto the
      // next-older pin (the one now occupying the same slot).
      const promise = getCurrentIndexPromise ??= getCurrentIndex(anchorMid, false)
      void promise.then(() => {
        if(count) testMid(anchorMid)
      })
    } else {
      setCorrectIndex(0)
    }
  })

  listenerSetter.add(rootScope)('peer_pinned_hidden', ({ peerId, threadId }) => {
    // hiding is per-peer / per-topic, so it must match this plate's scope exactly
    if(peerId !== chat.peerId || (threadId || undefined) !== (chat.threadId || undefined)) return
    userHidden = true
    plateSetHidden(true)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Implementation
  // ────────────────────────────────────────────────────────────────────────

  const setPinnedMessageDebounced = debounce(() => _setPinnedMessage(), 100, true, true)

  function setCorrectIndex(lastScrollDirection?: number) {
    const bound = log.bindPrefix('setCorrectIndex')
    if(isStatic) {
      if(debug) bound('not needed, static')
      return
    }

    if(locked || userHidden) {
      if(debug) bound('not needed 1')
      return
    }

    if((loadedBottom || loadedTop) && !count) {
      if(debug) bound('not needed 2')
      return
    }

    const el = chat.bubbles.getBubbleByPoint('bottom')
    if(!el) {
      if(debug) bound('no element')
      return
    }

    const mid = el.dataset.mid
    if(debug) bound('direction', lastScrollDirection, 'mid', mid)
    if(mid !== undefined) {
      testMid(+mid, lastScrollDirection)
    }
  }

  const setCorrectIndexThrottled = throttle(setCorrectIndex, 100, false)

  function testMid(mid: number, lastScrollDirection?: number) {
    if(isStatic) return
    if(userHidden) return
    // Same guard as `setCorrectIndex`: the list is loaded and there is nothing
    // pinned here. Without it every direct `testMid` (the topbar fires one on
    // each jump-to-message) falls through to another `getCurrentIndex` fetch.
    if((loadedBottom || loadedTop) && !count) return

    let currentIndex: number = mids.findIndex((_mid) => _mid <= mid)
    if(currentIndex !== -1 && !isNeededMore(currentIndex)) {
      currentIndex += offsetIndex
    } else if(loadedTop && mid < mids[mids.length - 1]) {
      currentIndex = mids.length - 1 + offsetIndex
    } else {
      getCurrentIndexPromise ??= getCurrentIndex(mid, lastScrollDirection !== undefined)
      return
    }

    const newPinnedMid = mids.find((_mid) => _mid <= mid) || mids[mids.length - 1]
    // Also detect pin-mid drift at the same numeric index — e.g. a new pin
    // pushed the previous "newest" down, so `pinnedIndex=0` still matches
    // but the actual pin at that slot is different.
    const changed = pinnedIndex !== currentIndex || pinnedMid !== newPinnedMid
    if(changed) {
      if(waitForScrollBottom && lastScrollDirection !== undefined) {
        if(pinnedIndex === 0 || pinnedIndex > currentIndex) { // если не скроллил вниз и пытается поставить нижний пиннед - выйти
          return
        }
      }

      pinnedIndex = currentIndex
      pinnedMid = newPinnedMid
      void setPinnedMessageDebounced()
    }
  }

  function isNeededMore(currentIndex: number) {
    return (count > LOAD_COUNT &&
      (
        (!loadedBottom && currentIndex <= LOAD_OFFSET) ||
        (!loadedTop && (count - 1 - currentIndex) <= LOAD_OFFSET)
      )
    )
  }

  async function getCurrentIndex(mid: number, correctAfter = true) {
    if(loading) return
    loading = true

    try {
      const bound = debug ? log.bindPrefix('getCurrentIndex') : undefined
      if(bound) bound('start', mid, correctAfter)

      let gotRest = false
      const promises: [ReturnType<typeof getPinnedHistory>, ...Promise<unknown>[]] = [
        getPinnedHistory(managers, {
          peerId: chat.peerId,
          offsetId: mid,
          limit: LOAD_COUNT,
          backLimit: LOAD_COUNT,
          threadId: chat.threadId,
        }).then((r) => {
          gotRest = true
          return r
        }),
      ]

      if(!pinnedMaxMid) {
        const promise = getPinnedMessage(
          managers,
          chat.peerId,
          chat.threadId,
        ).then((p) => {
          if(!p.maxId) return
          pinnedMaxMid = p.maxId

          if(!gotRest && correctAfter) {
            mids = [pinnedMaxMid]
            count = p.count
            pinnedIndex = 0
            pinnedMid = mids[0]
            void setPinnedMessageDebounced()
          }
        })

        promises.push(promise)
      }

      const result = (await Promise.all(promises))[0]

      const history = result.history

      let backLimited = history.findIndex((_mid) => _mid <= mid)
      if(backLimited === -1) {
        backLimited = history.length
      }

      offsetIndex = Math.max(0, result.offsetIdOffset) ? result.offsetIdOffset - backLimited : 0
      const oldCount = count
      const oldPinnedMid = pinnedMid
      mids = history.slice()
      count = result.count

      if(!count) {
        // Nothing is pinned in this scope — drop the pin we were showing so
        // the `pinnedMessages` getter stops reporting a phantom hint into
        // `ChatSavedPosition`, which would re-seed (and re-flash) the plate
        // on the next open of this peer/topic.
        pinnedMid = 0
        pinnedIndex = -1
        plateSetHidden(true)
      }

      loadedTop = (offsetIndex + mids.length) === count
      loadedBottom = !offsetIndex

      if(bound) bound('result', mid, result, backLimited, offsetIndex, loadedTop, loadedBottom)

      // If `prepareInitial` seeded a stale hint, reconcile `pinnedMid` against
      // the fresh window here so the sync first `_setPinnedMessage` already
      // paints with the right pin.
      const reconciledMid = mids[pinnedIndex - offsetIndex]
      if(oldCount !== count || (reconciledMid && oldPinnedMid !== reconciledMid)) {
        if(reconciledMid) pinnedMid = reconciledMid
        void setPinnedMessageDebounced()
      }
    } catch(err) {
      log.error('getCurrentIndex error', err)
    }

    loading = false
    // Clear before the calls below: either of them may start a fresh fetch and
    // store its promise here — resetting afterwards would drop that reference
    // and let the next caller kick off a duplicate request.
    getCurrentIndexPromise = undefined

    if(locked) {
      testMid(mid)
    } else if(correctAfter) {
      setCorrectIndex(0)
    }
  }

  function setScrollDownListener() {
    waitForScrollBottom = true

    if(!scrollDownListenerSetter) {
      scrollDownListenerSetter = new ListenerSetter()
      handleScrollSideEvent(chat.bubbles.scrollable.container, 'bottom', () => {
        unsetScrollDownListener()
      }, scrollDownListenerSetter)
    }
  }

  function unsetScrollDownListener(refreshPosition = true) {
    waitForScrollBottom = false

    if(scrollDownListenerSetter) {
      scrollDownListenerSetter.removeAll()
      scrollDownListenerSetter = undefined
    }

    if(refreshPosition) {
      setCorrectIndex(0)
    }
  }

  async function handleFollowingPinnedMessage() {
    locked = true

    if(debug) log('handleFollowingPinnedMessage')
    try {
      setScrollDownListener()

      const setPeerPromise = chat.setPeerPromise
      if(setPeerPromise instanceof Promise) {
        await setPeerPromise
      }

      await getHeavyAnimationPromise()

      if(getCurrentIndexPromise) await getCurrentIndexPromise

      if(debug) log('handleFollowingPinnedMessage: unlock')
      locked = false
    } catch(err) {
      log.error('handleFollowingPinnedMessage error:', err)

      locked = false
      waitForScrollBottom = false
      setCorrectIndex(0)
    }
  }

  function followPinnedMessage(mid: number) {
    const message = getMessage(mid)
    if(!message) {
      return
    }

    void chat.setMessageId({ lastMsgId: mid })
    void (chat.setPeerPromise || Promise.resolve()).then(() => { // * debounce fast clicker
      void handleFollowingPinnedMessage()
      // wrap to the newest pin from the last one. `pinnedMaxMid` is still 0 when
      // the plate was painted from a hint and nothing has been fetched yet —
      // `testMid(0)` would land on the OLDEST pin, reversing the cycle.
      const wrapMid = pinnedMaxMid || mids[0] || mid
      testMid(pinnedIndex >= (count - 1) ? wrapMid : mid - 1)
    })
  }

  async function _setPinnedMessage(skipReveal = false) {
    const seq = ++renderSeq
    if(count) {
      const message = getMessage(pinnedMid)
      if(!message) {
        return
      }

      const isLast = pinnedIndex === 0
      animatedCounter.container.classList.toggle('is-last', isLast)
      if(!isLast) {
        animatedCounter.setCount(count - pinnedIndex)
      }

      if(debug) log('setPinnedMessage: fromTop', pinnedIndex > wasPinnedIndex, pinnedIndex, wasPinnedIndex)

      const writeTo = animatedSubtitle.getRow(pinnedIndex)
      const writeMediaTo = animatedMedia.getRow(pinnedIndex)
      writeMediaTo.classList.add('pinned-message-media')
      // расхождение 3
      const middleware = writeTo.middlewareHelper!.get()
      const subtitle = wrapMessageForReply({ message, plain: false })
      const isMediaSet = await wrapPinnedMedia(writeMediaTo, message, managers, middleware)

      // a newer run started while we were wrapping — it owns the plate now
      if(seq !== renderSeq) {
        return
      }

      writeTo.replaceChildren(subtitle)
      setIsMedia(isMediaSet)

      // Flip the plate visible only after content (text + media) is in
      // the DOM — otherwise the user sees an empty plate for a paint
      // frame while the content is still resolving.
      if(!skipReveal) {
        plateSetHidden(false)
      }

      animatedSubtitle.animate(pinnedIndex, wasPinnedIndex)
      if(isMediaSet) {
        animatedMedia.animate(pinnedIndex, wasPinnedMediaIndex)
        wasPinnedMediaIndex = pinnedIndex
      } else {
        animatedMedia.clearRows()
      }

      pinnedMessageBorder.render(count, count - pinnedIndex - 1)
      wasPinnedIndex = pinnedIndex
      plate.container.dataset.mid = '' + message.id
    } else {
      plateSetHidden(true)
      wasPinnedIndex = 0
      // nothing to open anymore — `topbar.openPinned(true)` reads this
      delete plate.container.dataset.mid
    }

    setIsMany(count > 1)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Controller
  // ────────────────────────────────────────────────────────────────────────

  const controller: ChatPinnedMessageController = {
    container: plate.container,
    height: plate.height,
    hidden: plate.hidden,
    setHidden: plate.setHidden,
    isVisible: plate.isVisible,
    isUserHidden: () => userHidden,
    setUserHidden: (v: boolean) => {
      userHidden = v
      if(v) plateSetHidden(true)
      else if(count > 0) plateSetHidden(false)
    },
    isLocked: () => locked,
    testMid,
    setCorrectIndex,
    setCorrectIndexThrottled,
    handleFollowingPinnedMessage,
    unsetScrollDownListener,
    setStaticMessage: (mid: number) => {
      pinnedMid = mid
      count = 1
      pinnedIndex = 0
      void _setPinnedMessage()
    },
    get pinnedMessages() {
      return pinnedMid ? { mid: pinnedMid, index: pinnedIndex, count } : undefined
    },
    prepareInitial: async({ mid, index, count: hintCount }) => {
      if(userHidden || !mid || pinnedMid === mid) return
      if(!getMessage(mid)) return
      pinnedMid = mid
      pinnedIndex = index ?? 0
      count = Math.max(hintCount ?? 1, pinnedIndex + 1)
      await _setPinnedMessage(true)
      prepared = true
    },
    revealPrepared: () => {
      if(!prepared) return
      prepared = false
      // the real list resolved to empty while we were preparing — nothing to show
      if(!count) return
      plateSetHidden(false)
    },
    destroy: () => {
      // deferred work would otherwise run against destroyed rows / a detached plate
      setPinnedMessageDebounced.clearTimeout()
      setCorrectIndexThrottled.clear()
      animatedMedia.destroy()
      animatedSubtitle.destroy()
      animatedCounter.destroy()
      listenerSetter.removeAll()
      unsetScrollDownListener(false)
      plate.destroy()
    },
  }

  return controller
}
