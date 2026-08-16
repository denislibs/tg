// src/components/chat/VanillaFeed.test.tsx
//
// Проводка React-хоста императивной ленты. Норма (web-client/CLAUDE.md,
// «Тесты»): строка проводки обязана краснить тест на своём удалении. Здесь под
// нормой ЧЕТЫРЕ строки layout-эффекта `VanillaFeed`:
//   `new ChatBubbles(...)`      — поднять ленту;
//   `host.append(container)`    — вставить её дерево в React-хост;
//   `void bubbles.getHistory()` — попросить у неё первую страницу;
//   `bubbles.destroy()` в cleanup — снять подписки на размонтировании.
// Каждая покрыта отдельным `it` ниже.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import rootScope from '@lib/rootScope'
import { ManagersProvider } from '@core/hooks/useManagers'
import { resetMessagesMirror, winKey } from '@core/history/messagesMirror'
import type { Managers } from '../../client/bootstrap'
import type { Message } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import VanillaFeed from './VanillaFeed'

const CHAT = 50

function msg(over: Partial<Message> & { id: number; seq: number }): Message {
  return {
    chatId: CHAT, senderId: 2, type: 'text', text: `m${over.seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-15T12:00:00Z', threadRootId: null,
    ...over,
  }
}

function managersWith(messages: Message[]) {
  const getHistory = vi.fn(
    async (): Promise<HistoryResult> => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true }),
  )
  return { managers: { messages: { getHistory } } as unknown as Managers, getHistory }
}

function mount(messages: Message[], props: { chatId: number; threadRootId?: number } = { chatId: CHAT }) {
  const { managers, getHistory } = managersWith(messages)
  const view = render(
    <ManagersProvider managers={managers}>
      <VanillaFeed {...props} />
    </ManagersProvider>,
  )
  return { ...view, getHistory }
}

afterEach(() => {
  cleanup()
  resetMessagesMirror()
})

/** Баблы СООБЩЕНИЙ: `.service` — это дата-бабл секции дня и его is-fake-дубль
 *  (порт tweb `createDateBubble`), сообщений за ними не стоит. */
const bubblesIn = (root: ParentNode) => root.querySelectorAll('.bubble:not(.service)')

describe('VanillaFeed — проводка императивной ленты в React-дерево', () => {
  it('поднимает ChatBubbles и вешает её дерево в хост (`new ChatBubbles` + `host.append`)', () => {
    const { container } = mount([])

    // Хост объявлен display:contents намеренно — .bubbles обязан остаться
    // flex-ребёнком .chat, как в tweb (см. докблок VanillaFeed.tsx).
    const host = container.firstElementChild as HTMLElement
    expect(host.style.display).toBe('contents')

    const bubbles = host.querySelector('.bubbles')
    expect(bubbles).not.toBeNull()
    // Дерево именно ChatBubbles, а не пустой div: внутри — контейнер Scrollable
    // с .bubbles-inner (полная сверка дерева — bubbles.test.ts).
    expect(bubbles!.querySelector('.bubbles-scrollable > .bubbles-inner')).not.toBeNull()
  })

  it('просит у ленты первую страницу и рисует её (`void bubbles.getHistory()`)', async () => {
    const { container, getHistory } = mount([msg({ id: 1, seq: 1 }), msg({ id: 2, seq: 2, text: 'привет' })])

    expect(getHistory).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })
    expect(container.querySelectorAll('.message')[1].textContent).toBe('привет')
  })

  it('ключ окна берётся из winKey — на треде лента открывает окно ТРЕДА', async () => {
    const { container, getHistory } = mount([], { chatId: CHAT, threadRootId: 60 })

    expect(getHistory).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT, threadRoot: 60 }))
    // Подписки сверяют событие по этому же ключу: событие окна треда доезжает,
    // событие основного окна того же чата — нет.
    rootScope.dispatchEventSingle('history_append', { storageKey: winKey(CHAT), message: msg({ id: 1, seq: 1 }) })
    expect(bubblesIn(container)).toHaveLength(0)

    rootScope.dispatchEventSingle('history_append', {
      storageKey: winKey(CHAT, 60), message: msg({ id: 2, seq: 2, threadRootId: 60 }),
    })
    expect(bubblesIn(container)).toHaveLength(1)
  })

  it('размонтирование гасит ленту: узел снят, подписки сняты (`bubbles.destroy()`)', async () => {
    const { container, unmount } = mount([msg({ id: 1, seq: 1 })])
    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(1)
    })
    // Держим ссылку на оторвавшееся дерево: после размонтирования оно уходит из
    // документа, и «нарисовала ли живая подписка ещё один бабл» видно только по
    // нему, а не по document.
    // Именно chatInner, а не одноимённый по классу `.bubbles-remover.bubbles-inner`.
    const detached = container.querySelector('.bubbles-scrollable > .bubbles-inner')!

    unmount()

    expect(container.querySelector('.bubbles')).toBeNull()
    // Живая подписка после размонтирования — утечка: лента продолжала бы
    // рисовать в оторванное от документа дерево.
    rootScope.dispatchEventSingle('history_append', { storageKey: winKey(CHAT), message: msg({ id: 2, seq: 2 }) })
    expect(bubblesIn(detached)).toHaveLength(1)
  })
})
