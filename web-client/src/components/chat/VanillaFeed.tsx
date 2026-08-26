// src/components/chat/VanillaFeed.tsx
//
// React-хост императивной ленты (`chat/bubbles.ts`) — единственная точка, где
// vanilla-ядро встречается с деревом React. Аналог того, как у нас уже живут
// другие vanilla-порты внутри React-экранов (`connectionStatus.ts` в
// `Sidebar.tsx`, `preloader.ts` в `Chat.tsx`): layout-эффект поднимает инстанс,
// вешает его `container` в хост и гасит на размонтировании.
//
// Хост объявлен `display: contents` намеренно: в tweb `.bubbles` — прямой
// ребёнок `.chat` и участвует в его flex-раскладке, а лишний узел-обёртка эту
// раскладку сломал бы. `display: contents` убирает обёртку из бокс-дерева, и
// `.bubbles` остаётся flex-ребёнком `.chat`, как в оригинале.
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { winKey } from '@core/history/messagesMirror'
import { getMediaId } from '@core/messages/messageKind'
import ChatBubbles, { type ChatContext } from './bubbles'
import ChatContextMenu, { type ContextMenuPopups } from './contextMenu'
import ChatSelection from './selection'
import { useManagers } from '@core/hooks/useManagers'
import { useSearchStore } from '../../stores/searchStore'
import noop from '@helpers/noop'

/**
 * Ручки ленты для её ОКРУЖЕНИЯ — ровно те роли, которые в tweb исполняет
 * `Chat`/`ChatTopbar` поверх `ChatBubbles`, а у нас исполняет `Chat.tsx`:
 * прыжок к сообщению (поиск, закреплённые, упоминания, вьювер), кнопка «вниз»
 * и выбор актуального закрепа по видимой истории.
 *
 * Ручки, а не React-состояние: у оригинала это тоже прямые вызовы в ленту
 * (`chat.setMessageId(...)`, `chat.bubbles.onGoDownClick()`), а окно ленты
 * React не рисует и перерисовывать по ним нечего.
 */
export interface ChatFeedApi {
  /** Порт tweb `Chat.setMessageId({lastMsgId})` (chat.ts:1164) — «тот же чат,
   *  другая цель»: окно пересобирается вокруг номера, бабл подсвечивается. */
  jumpToMessage(mid: number): void
  /** Порт tweb `ChatBubbles.onGoDownClick` (bubbles.ts:3852) в применимом
   *  объёме: стека возврата (`followStack`) у ленты нет (см. bubbles.ts:2437),
   *  значит остаётся ровно первая ветка оригинала — `chat.setMessageId()`. */
  goDown(): void
  /** Порт tweb `ChatTopbar` (topbar.ts:560) — пункт «Выбрать сообщения»:
   *  `selection.toggleSelection(true, true)`. Режимом владеет лента. */
  startSelection(): void
  /** Порт tweb `selection.cancelSelection` (selection.ts:475) — клик по
   *  счётчику плашки выделения. */
  cancelSelection(): void
  /** Полная пересборка окна от низа истории — тот же `setPeer`, что на
   *  открытии чата. Нужна там, где история изменилась ЦЕЛИКОМ, а события об
   *  этом нет: «Очистить историю» (`chats.clearHistory` апдейта не порождает). */
  reload(): void
}

export default function VanillaFeed({ api, scrollerRef, paddingTopPx, paddingBottomPx, peerId, threadRootId, isLikeGroup, isBroadcast, isMegagroup, canSend, canSendPlain, onReply, onEdit, onDownload, menuPopups, mediaViewerActions, onSelection, onOpenDatePicker, onOpenDiscussion }: {
  /** Ручки ленты наружу — заполняются на маунте, гасятся на размонтировании. */
  api?: RefObject<ChatFeedApi | null>
  /** Скролл-контейнер ленты (`Scrollable.container`) — тем же способом, что
   *  React отдаёт наружу свои узлы. Нужен закреплённым: tweb выбирает
   *  показанный закреп по нижнему видимому баблу
   *  (`pinnedMessage.setCorrectIndex` из `bubbles.onScroll`). */
  scrollerRef?: RefObject<HTMLElement | null>
  /** Высоты распорок `.bubbles-padding-top/-bottom` в px — порт «ленточной»
   *  половины tweb `Chat.recomputePaddings` (chat.ts:345): числа считает
   *  окружение чата, лента лишь применяет (`ChatBubbles.setPaddings`). */
  paddingTopPx: number
  paddingBottomPx: number
  /** знаковый ключ открытого чата (порт tweb `chat.peerId`) */
  peerId: PeerId
  threadRootId?: number
  /** Порт tweb `chat.isLikeGroup` — гейт показа имени автора в бабле. Считает
   *  его хост: в tweb это `Chat` (`appPeersManager.isLikeGroup`), у нас тип
   *  чата знает React-экран, а ленте про сторы знать нельзя. */
  isLikeGroup?: boolean
  /** Порт tweb `chat.isBroadcast` — у канала своя (меньшая) страница истории. */
  isBroadcast?: boolean
  /** Порт tweb `chat.isMegagroup` — от него зависит СТОРОНА бабла у отправки от
   *  лица канала (`isOurMessage`, chat.ts:1375). Считает его тот же хост, что и
   *  `isLikeGroup`: вид чата знает React-экран, а не лента. */
  isMegagroup?: boolean
  /** Порт tweb `chat.canSend()` — гейт свайп-ответа на таче. Право знает
   *  хост (`canType`), лента про права не знает. */
  canSend?: boolean
  /** Порт tweb `chat.input.canSendPlain()` — гейт даблклик-ответа на
   *  десктопе. У оригинала это ОТДЕЛЬНОЕ право: слать медиа можно быть вправе,
   *  а текст — нет. */
  canSendPlain?: boolean
  /** Порт tweb `chat.input.initMessageReply(...)`: жест ответа отдаёт хосту
   *  номер, плашку над композером собирает владелец композера. */
  onReply?: (mid: number) => void
  /** Порт tweb `chat.input.initMessageEditing(mid)` (contextMenu.ts:1912) —
   *  пункт «Изменить». Как и ответ, наружу едет ТОЛЬКО номер: черновик правки
   *  наполняет владелец композера (`Chat.tsx` через `startEditFor`). */
  onEdit?: (mid: number) => void
  /** Порт tweb `appDownloadManager.downloadToDisc({media})` (contextMenu.ts:2189)
   *  в нашей адресации медиа: меню знает сообщение, хост — как достать байты по
   *  `mediaId` (тот же вызов делает пункт «Download» React-меню). */
  onDownload?: (mediaId: number) => void
  /**
   * Носители попапов контекстного меню — порт `ContextMenuPopups`
   * (`chat/contextMenu.ts`). В tweb пункты меню сами зовут
   * `PopupElement.createPopup(...)`; ни одного из этих попапов в ванильном виде
   * у нас нет, их владелец React-хост — та же граница, что у плашки выделения.
   */
  menuPopups?: ContextMenuPopups
  /**
   * Действия медиавьювера — прыжок к сообщению, пересылка, удаление, догрузка
   * соседей. Владелец тот же, что у попапов меню: окружение чата (см.
   * `ChatContext.mediaViewerActions`).
   */
  mediaViewerActions?: ChatContext['mediaViewerActions']
  /**
   * Режим выделения — порт роли `Chat` (tweb chat.ts:615 создаёт
   * `ChatSelection`, а `selection.ts:1008-1173` рисует плашку вместо
   * композера). Плашка — окружение чата, поэтому её владелец здесь: лента
   * отдаёт наверх выбранные номера, признак режима и способ его снять, а
   * рисует плашку хост (`conversation/SelectionBar.tsx`).
   */
  onSelection?: (state: { mids: number[], selecting: boolean, cancel: () => void }) => void
  /**
   * Показать календарь — порт роли `Chat` в ветке клика по дата-баблу
   * (tweb bubbles.ts:3075-3078: `showDatePickerPopup({initDate, onPick:
   * this.onDatePick})`). Попап у нас React-компонент
   * (`components/DatePickerPopup.tsx`), монтирует его владелец слоя попапов —
   * `Chat.tsx`; лента отдаёт наверх день секции и колбэк выбора, а «день →
   * номер → прыжок» остаётся у неё (`bubbles.onDatePick`).
   */
  onOpenDatePicker?: (initDate: number, onPick: (timestamp: number) => void) => void
  /**
   * Клик по футеру «N комментариев» — порт роли `Chat` в ветке tweb
   * bubbles.ts:3315-3343 (`chat.appImManager.setInnerPeer({peerId, type:
   * ChatType.Discussion, threadId})`). Стеком колонки чата владеет хост
   * (`chatStackStore` через `Chat.tsx::onOpenThread`), поэтому лента отдаёт
   * наверх ровно то же, что оригинал: ключ ГРУППЫ ОБСУЖДЕНИЯ и номер поста.
   */
  onOpenDiscussion?: (args: { peerId: PeerId, postMid: number }) => void
}) {
  const managers = useManagers()
  const hostRef = useRef<HTMLDivElement>(null)
  // Инстанс ленты и последние распорки — через рефы: смена высоты плейтов или
  // композера НЕ должна пересобирать ленту (это потеря позиции скролла), она
  // лишь двигает распорки эффектом ниже.
  const bubblesRef = useRef<ChatBubbles | null>(null)
  const paddingRef = useRef({ top: paddingTopPx, bottom: paddingBottomPx })
  paddingRef.current = { top: paddingTopPx, bottom: paddingBottomPx }
  const gesture = useRef({ canSend, canSendPlain, onReply, onEdit, onDownload, menuPopups, mediaViewerActions, onSelection, onOpenDatePicker, onOpenDiscussion })
  gesture.current = { canSend, canSendPlain, onReply, onEdit, onDownload, menuPopups, mediaViewerActions, onSelection, onOpenDatePicker, onOpenDiscussion }

  // Одно место, где состояние выделения уходит наверх: и счётчик, и признак
  // режима, и способ его снять (плашка снимает выбор кликом по счётчику —
  // tweb selection.ts:1080-1082).
  const report = (selection: ChatSelection, selecting: boolean) => {
    gesture.current.onSelection?.({
      mids: selection.getSelectedMids(),
      selecting,
      cancel: () => selection.cancelSelection(),
    })
  }

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Порт tweb `Chat.constructor` (chat.ts:640-643): `.bubbles-viewport` —
    // отдельный узел-СОСЕД `.bubbles` внутри `.chat`, по которому лента считает
    // реально видимую зону (скролл-контейнер уезжает под топбар и композер).
    // В tweb его создаёт `Chat`; `Chat`-хоста у нас нет, эту роль исполняет
    // VanillaFeed — как и роль владельца `chat.container` (`.chat`, ближайший
    // предок хоста: колонку чата рисует React, см. `Chat.tsx`).
    const chatColumn = host.closest<HTMLElement>('.chat')
    if (!chatColumn) return

    const bubblesViewport = document.createElement('div')
    bubblesViewport.classList.add('bubbles-viewport', 'disable-hover')

    // `navigation` (адресат кликов, см. `BubblesNavigation`) заполнен ДВУМЯ
    // полями — календарём и тредом. Два других сознательно не передаются: открыть пир
    // умеет `useNavigationActions().openPeer`, но ему нужна карточка пира
    // (`OpenPeer.title`), которой у ленты нет, а разбора внутренних
    // t.me-ссылок (tweb `internalLinkProcessor`) в приложении пока нет вовсе.
    // Без них поведение ровно то же, что у React-ленты сегодня: ссылка
    // открывается новой вкладкой (`target="_blank"`), клик по имени ничего не
    // делает. Придёт навигация — пробрасывается тем же полем здесь.
    // Инстанс выделения заводит сама лента через фабрику ниже; ссылка нужна
    // ручкам наружу (вход в режим из меню шапки, снятие с плашки).
    let feedSelection: ChatSelection | undefined
    const bubbles = new ChatBubbles(
      {
        peerId,
        threadId: threadRootId,
        messagesStorageKey: winKey(peerId, threadRootId),
        isLikeGroup,
        isBroadcast,
        isMegagroup,
        container: chatColumn,
        bubblesViewport,
        // Колбэк читается ЧЕРЕЗ РЕФ по той же причине, что права ниже: сменился
        // обработчик — лента не пересобирается.
        navigation: {
          openDatePicker: (initDate, onPick) => gesture.current.onOpenDatePicker?.(initDate, onPick),
          openDiscussion: (args) => gesture.current.onOpenDiscussion?.(args),
        },
        // Меню сообщения — владелец хост, как `Chat` в оригинале: пункты
        // открывают попапы, а попапы наши React-овские. ВСЁ, что меню зовёт
        // наружу, читается ЧЕРЕЗ РЕФ (по той же причине, что права ниже): ни
        // один из этих колбэков не стабилен между рендерами хоста, а меню
        // создаётся один раз на жизнь ленты.
        createContextMenu: (bubblesPort) => new ChatContextMenu(
          {
            peerId,
            messagesStorageKey: winKey(peerId, threadRootId),
            canSend: () => gesture.current.canSend ?? false,
            // Порт tweb `!!chat.input.messageInput` (contextMenu.ts:944, 961,
            // 1012, 1393) — БУКВАЛЬНО «узел ввода существует»: в оригинале его
            // заводит `input.constructPeerHelpers()` (chat.ts:630 →
            // input.ts:1396). У нас это `.input-message-input` композера
            // (`components/composer/MessageInput.tsx`), сосед ленты внутри
            // `.chat`. Спрашиваем ДОМ, а не право: право в том же `verify` —
            // отдельное слагаемое (`canSend()`).
            hasMessageInput: () => !!chatColumn.querySelector('.input-message-input'),
            initMessageReply: (mid) => gesture.current.onReply?.(mid),
            initMessageEditing: (mid) => gesture.current.onEdit?.(mid),
            // Порт `chat.initSearch({query, filterPeerId})` (contextMenu.ts:1046).
            // Поиск по чату у нас живёт в сторе с той же сигнатурой
            // (`stores/searchStore.ts:82`), поэтому хосту его проксировать нечего.
            initSearch: (options) => useSearchStore.getState().initSearch(peerId, options),
            // `canForward` не передаётся: факта `pFlags.noforwards` в модели нет
            // вовсе — см. докблок самого поля в `contextMenu.ts`.
          },
          bubblesPort,
          {
            messages: managers.messages,
            chats: managers.chats,
            media: {
              downloadToDisc: (message) => {
                const mediaId = getMediaId(message)
                if (mediaId != null) gesture.current.onDownload?.(mediaId)
              },
            },
          },
          {
            showPinMessage: (p, mid, unpin) => gesture.current.menuPopups?.showPinMessage(p, mid, unpin),
            showDeleteMessages: (p, mids) => gesture.current.menuPopups?.showDeleteMessages(p, mids),
            showForward: (fromPeerIdsMids) => gesture.current.menuPopups?.showForward(fromPeerIdsMids),
            showMessageReport: (p, mids, onSuccess) => gesture.current.menuPopups?.showMessageReport(p, mids, onSuccess),
            showReactedList: (p, mid, at) => gesture.current.menuPopups?.showReactedList(p, mid, at),
            showStatistics: (p, mid) => gesture.current.menuPopups?.showStatistics(p, mid),
            showFactCheckEditor: (p, mid) => gesture.current.menuPopups?.showFactCheckEditor(p, mid),
          },
        ),
        // Владелец выделения — хост, как `Chat` в оригинале: это он знает про
        // плашку действий. Менеджер прав не передаётся: факта «нельзя
        // переслать/удалить» на клиенте нет вовсе (задача #73) — порт объявлен
        // опциональным именно поэтому.
        createSelection: (bubblesPort) => {
          const selection: ChatSelection = new ChatSelection(bubblesPort, { messages: {} }, {
            toggle: (forwards) => report(selection, forwards),
            update: () => report(selection, selection.isSelecting),
            remove: () => report(selection, false),
          })
          feedSelection = selection
          return selection
        },
        // Права и вход в reply читаются ЧЕРЕЗ РЕФ, а не захватываются
        // значением: у оригинала это тоже живое чтение в момент жеста
        // (`this.chat.canSend()`, bubbles.ts:1548). Положи их в зависимости
        // эффекта — смена права пересобирала бы ленту целиком, с потерей
        // позиции скролла.
        canSend: () => gesture.current.canSend ?? false,
        canSendPlain: () => gesture.current.canSendPlain ?? false,
        initMessageReply: (mid) => gesture.current.onReply?.(mid),
        // Через реф — по той же причине, что попапы меню: ни один из колбэков
        // не стабилен между рендерами хоста, а лента создаётся один раз.
        mediaViewerActions: {
          jumpToMessage: (item) => gesture.current.mediaViewerActions?.jumpToMessage?.(item),
          onForward: (mid, close) => gesture.current.mediaViewerActions?.onForward?.(mid, close),
          onDelete: (mid, close) => gesture.current.mediaViewerActions?.onDelete?.(mid, close),
          loadMoreMedia: (older, anchor, count) => gesture.current.mediaViewerActions?.loadMoreMedia?.(older, anchor, count) ?? Promise.resolve([]),
        },
      },
      managers,
    )
    host.append(bubbles.container, bubblesViewport)
    if (api) {
      api.current = {
        jumpToMessage: (mid) => { void bubbles.setMessageId({ lastMsgId: mid }).catch(noop) },
        goDown: () => { void bubbles.setMessageId().catch(noop) },
        startSelection: () => { feedSelection?.toggleSelection(true, true) },
        cancelSelection: () => { feedSelection?.cancelSelection() },
        reload: () => { void bubbles.setPeer().then((result) => result?.promise).catch(noop) },
      }
    }
    if (scrollerRef) scrollerRef.current = bubbles.scrollable.container
    // Распорки — до первого `setPeer`: иначе первая страница встала бы под
    // топбаром и под композером.
    bubbles.setPaddings(paddingRef.current.top, paddingRef.current.bottom)
    bubblesRef.current = bubbles
    // Порт `Chat.setPeer` (tweb chat.ts:1119) в единственной применимой здесь
    // форме: пир только что открыт, значит `samePeer: false` — лента набирает
    // окно от низа истории и уводит скролл вниз без анимации. Цепочка до
    // ВТОРОГО промиса и `.catch(noop)` — 1:1 оригинал (chat.ts:1120-1126):
    // окно, вытесненное следующим `setPeer` (у нас — размонтированием ленты),
    // отвергается `PEER_CHANGED_ERROR`, и это не сбой.
    void bubbles.setPeer().then((result) => result?.promise).catch(noop)

    // Узел `bubbles.container` отдельно не снимаем: он лежит ВНУТРИ хоста,
    // который React убирает из документа сам. `remove()` здесь был бы строкой,
    // удаление которой ничего не меняет, — то есть мёртвым кодом (CLAUDE.md).
    // А вот класс `is-go-down-visible` лента вешает на ЧУЖОЙ узел (колонку
    // чата, tweb `updateGoDownVisibility`) — его снимать надо руками, узел
    // переживает размонтирование ленты.
    return () => {
      if (api) api.current = null
      if (scrollerRef) scrollerRef.current = null
      bubblesRef.current = null
      bubbles.destroy()
      chatColumn.classList.remove('is-go-down-visible')
    }
  }, [api, scrollerRef, peerId, threadRootId, isLikeGroup, isBroadcast, isMegagroup, managers])

  // Плейты топбара и излишек композера меняют распорки на живой ленте — тот же
  // вызов, что в tweb делает `Chat.recomputePaddings` на каждое изменение.
  useLayoutEffect(() => {
    bubblesRef.current?.setPaddings(paddingTopPx, paddingBottomPx)
  }, [paddingTopPx, paddingBottomPx])

  return <div ref={hostRef} style={{ display: 'contents' }} />
}
