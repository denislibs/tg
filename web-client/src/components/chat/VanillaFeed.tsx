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
import { useLayoutEffect, useRef } from 'react'
import { winKey } from '@core/history/messagesMirror'
import ChatBubbles from './bubbles'
import { useManagers } from '@core/hooks/useManagers'

export default function VanillaFeed({ peerId, threadRootId, isLikeGroup, isBroadcast, isMegagroup, canSend, canSendPlain, onReply }: {
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
}) {
  const managers = useManagers()
  const hostRef = useRef<HTMLDivElement>(null)
  const gesture = useRef({ canSend, canSendPlain, onReply })
  gesture.current = { canSend, canSendPlain, onReply }

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

    // `navigation` (адресат кликов по ссылкам/именам, см. `BubblesNavigation`)
    // сюда сознательно НЕ передаётся: открыть пир умеет
    // `useNavigationActions().openPeer`, но ему нужна карточка пира
    // (`OpenPeer.title`), которой у ленты нет, а разбора внутренних
    // t.me-ссылок (tweb `internalLinkProcessor`) в приложении пока нет вовсе.
    // Без адресата поведение ровно то же, что у React-ленты сегодня: ссылка
    // открывается новой вкладкой (`target="_blank"`), клик по имени ничего не
    // делает. Придёт навигация — пробрасывается одним полем здесь.
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
        // Права и вход в reply читаются ЧЕРЕЗ РЕФ, а не захватываются
        // значением: у оригинала это тоже живое чтение в момент жеста
        // (`this.chat.canSend()`, bubbles.ts:1548). Положи их в зависимости
        // эффекта — смена права пересобирала бы ленту целиком, с потерей
        // позиции скролла.
        canSend: () => gesture.current.canSend ?? false,
        canSendPlain: () => gesture.current.canSendPlain ?? false,
        initMessageReply: (mid) => gesture.current.onReply?.(mid),
      },
      managers,
    )
    host.append(bubbles.container, bubblesViewport)
    void bubbles.loadFirstHistory()

    // Узел `bubbles.container` отдельно не снимаем: он лежит ВНУТРИ хоста,
    // который React убирает из документа сам. `remove()` здесь был бы строкой,
    // удаление которой ничего не меняет, — то есть мёртвым кодом (CLAUDE.md).
    // А вот класс `is-go-down-visible` лента вешает на ЧУЖОЙ узел (колонку
    // чата, tweb `updateGoDownVisibility`) — его снимать надо руками, узел
    // переживает размонтирование ленты.
    return () => {
      bubbles.destroy()
      chatColumn.classList.remove('is-go-down-visible')
    }
  }, [peerId, threadRootId, isLikeGroup, isBroadcast, isMegagroup, managers])

  return <div ref={hostRef} style={{ display: 'contents' }} />
}
