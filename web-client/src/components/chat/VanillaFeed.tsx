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

export default function VanillaFeed({ chatId, threadRootId }: { chatId: number; threadRootId?: number }) {
  const managers = useManagers()
  const hostRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const bubbles = new ChatBubbles(
      { peerId: chatId, threadId: threadRootId, messagesStorageKey: winKey(chatId, threadRootId) },
      managers,
    )
    host.append(bubbles.container)
    void bubbles.getHistory()

    // Узел `bubbles.container` отдельно не снимаем: он лежит ВНУТРИ хоста,
    // который React убирает из документа сам. `remove()` здесь был бы строкой,
    // удаление которой ничего не меняет, — то есть мёртвым кодом (CLAUDE.md).
    return () => bubbles.destroy()
  }, [chatId, threadRootId, managers])

  return <div ref={hostRef} style={{ display: 'contents' }} />
}
