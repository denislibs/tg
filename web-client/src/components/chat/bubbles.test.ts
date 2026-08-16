// src/components/chat/bubbles.test.ts
//
// Каркас императивной ленты (`ChatBubbles`, порт tweb `chat/bubbles.ts`),
// этап 2. Пины:
//   (1) дерево DOM совпадает с tweb `constructBubbles` (bubbles.ts:1439-1458);
//   (2) `getHistory` кладёт страницу в зеркало и рисует по узлу на сообщение;
//   (3) каждая из четырёх подписок каталога истории меняет РОВНО один узел,
//       а событие про чужое окно игнорируется;
//   (4) `history_update` переклеивает КЛЮЧ, не пересоздавая узел (сверка
//       идентичности элемента до и после);
//   (5) `destroy()` снимает подписки — после него события ничего не делают.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { mirrorWindow, resetMessagesMirror } from '@core/history/messagesMirror'
import type { Message } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { makeFullMid, type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = 50
const OTHER_CHAT = 51

const chatContext = (peerId = CHAT): ChatContext => ({ peerId, messagesStorageKey: String(peerId) })

function msg(over: Partial<Message> & { id: number; seq: number }): Message {
  return {
    chatId: CHAT, senderId: 2, type: 'text', text: `m${over.seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-15T12:00:00Z', threadRootId: null,
    ...over,
  }
}

const historyResult = (messages: Message[]): HistoryResult =>
  ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })

function managersWith(messages: Message[]): BubblesManagers & { getHistory: ReturnType<typeof vi.fn> } {
  const getHistory = vi.fn(async () => historyResult(messages))
  return { messages: { getHistory }, getHistory }
}

let bubbles: ChatBubbles | undefined

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
})

beforeEach(() => {
  resetMessagesMirror()
})

/** Все отрисованные баблы ленты в порядке DOM. */
const rendered = (b: ChatBubbles) => Array.from(b.chatInner.querySelectorAll<HTMLElement>('.bubble'))

describe('makeFullMid', () => {
  it('адресует бабл парой (peerId, id) — включая отрицательный id бабла «отправляется…»', () => {
    expect(makeFullMid(50, 7)).toBe('50_7')
    // Отрицательный id неотправленного бабла обязан ключеваться без потерь:
    // на нём стоит вся финализация оптимистичной отправки (ре-кей в
    // history_update).
    expect(makeFullMid(50, -3)).toBe('50_-3')
  })
})

describe('ChatBubbles — дерево DOM 1:1 с tweb constructBubbles', () => {
  beforeEach(() => {
    bubbles = new ChatBubbles(chatContext(), managersWith([]))
  })

  it('.bubbles.scrolled-down — корень', () => {
    expect(bubbles!.container.classList.contains('bubbles')).toBe(true)
    expect(bubbles!.container.classList.contains('scrolled-down')).toBe(true)
  })

  it('дети корня — remover-container, контейнер Scrollable, floating-separators (в этом порядке)', () => {
    const children = Array.from(bubbles!.container.children)
    expect(children).toHaveLength(3)
    expect(children[0].className).toBe('bubbles-remover-container')
    expect(children[1]).toBe(bubbles!.scrollable.container)
    expect(children[2].className).toBe('bubbles-floating-separators-container')
  })

  it('.bubbles-remover-container > .bubbles-remover.bubbles-inner', () => {
    const remover = bubbles!.container.querySelector('.bubbles-remover-container > .bubbles-remover')
    expect(remover).toBe(bubbles!.remover)
    expect(remover!.classList.contains('bubbles-inner')).toBe(true)
  })

  it('контейнер Scrollable — .scrollable.scrollable-y.bubbles-scrollable, внутри распорки и .bubbles-inner', () => {
    const sc = bubbles!.scrollable.container
    expect(sc.classList.contains('scrollable')).toBe(true)
    expect(sc.classList.contains('scrollable-y')).toBe(true)
    expect(sc.classList.contains('bubbles-scrollable')).toBe(true)

    // Скроллбар-thumb Scrollable добавляет в начало контейнера сам (порт tweb),
    // поэтому сверяем только наши три узла — по порядку между собой.
    const own = Array.from(sc.children).filter((el) => !el.classList.contains('scrollable-thumb-container'))
    expect(own.map((el) => el.className)).toEqual([
      'bubbles-padding bubbles-padding-top',
      'bubbles-inner',
      'bubbles-padding bubbles-padding-bottom',
    ])
    expect(own[1]).toBe(bubbles!.chatInner)
  })
})

// Модификатор is-out/is-in бабла. Порт tweb: лента читает `message.pFlags.out`
// (свойство самого сообщения) и `rootScope.myId` — своего вывода
// «исходящее/входящее» у неё нет. У нас `out` ставит владелец в воркере
// (core/models.ts::deriveOut на границах маппинга), а `rootScope.myId` пишет
// проектор на rt:me. Пин ловит возврат к выводу на вкладке: раньше лента лезла
// за meId в zustand (`useChatsStore.getState().meId`) и сравнивала с senderId —
// зависимость, недопустимая для ленты (grep по components/chat/ на импорт стора).
describe('ChatBubbles — классы бабла берут `out` из самого сообщения', () => {
  it('out=true → is-out, out=false → is-in (senderId ни на что не влияет)', async () => {
    rootScope.myId = 999 // «я» — заведомо не автор ни одного из сообщений ниже
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: 2, out: true }),
      msg({ id: 2, seq: 2, senderId: 999 }),
    ]))

    await bubbles.getHistory()

    const [first, second] = rendered(bubbles)
    expect(first.classList.contains('is-out')).toBe(true)
    // senderId === rootScope.myId, но владелец флага не поставил — лента НЕ
    // выводит его сама.
    expect(second.classList.contains('is-in')).toBe(true)
  })
})

describe('ChatBubbles.getHistory — страница в зеркало и в DOM', () => {
  it('кладёт результат в зеркало и рисует по узлу на сообщение', async () => {
    const page = [msg({ id: 1, seq: 1 }), msg({ id: 2, seq: 2, text: 'привет' })]
    bubbles = new ChatBubbles(chatContext(), managersWith(page))

    await bubbles.getHistory()

    expect(mirrorWindow(String(CHAT))).toEqual(page)
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['1', '2'])
    expect(rendered(bubbles)[1].querySelector('.bubble-content')!.textContent).toBe('привет')
  })

  it('бабл — .bubble > .bubble-content-wrapper > .bubble-content с текстом', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1, text: 'ок' })]))
    await bubbles.getHistory()

    const bubble = rendered(bubbles)[0]
    expect(bubble.classList.contains('bubble')).toBe(true)
    expect(bubble.dataset.peerId).toBe(String(CHAT))
    const wrapper = bubble.firstElementChild!
    expect(wrapper.className).toBe('bubble-content-wrapper')
    expect(wrapper.children).toHaveLength(1)
    expect(wrapper.firstElementChild!.className).toBe('bubble-content')
    expect(wrapper.firstElementChild!.textContent).toBe('ок')
  })

  it('запрашивает окно ТРЕДА, когда лента открыта на треде', async () => {
    const managers = managersWith([])
    bubbles = new ChatBubbles({ peerId: CHAT, threadId: 60, messagesStorageKey: `${CHAT}:60` }, managers)
    await bubbles.getHistory()
    expect(managers.getHistory).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT, threadRoot: 60 }))
  })

  it('протухший ответ (лента убита, пока летел запрос) не пишет ни в зеркало, ни в DOM', async () => {
    let release!: (r: HistoryResult) => void
    const pending = new Promise<HistoryResult>((res) => { release = res })
    const b = new ChatBubbles(chatContext(), { messages: { getHistory: () => pending } })

    const promise = b.getHistory()
    b.destroy()
    release(historyResult([msg({ id: 1, seq: 1 })]))
    await promise

    expect(mirrorWindow(String(CHAT))).toBeUndefined()
    expect(rendered(b)).toHaveLength(0)
  })
})

describe('ChatBubbles — подписки на события истории', () => {
  const page = [msg({ id: 1, seq: 1 }), msg({ id: 2, seq: 2 })]

  beforeEach(async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith(page))
    await bubbles.getHistory()
  })

  describe('history_append', () => {
    it('рисует РОВНО один новый узел', () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: 3, seq: 3, text: 'новое' }) })

      expect(rendered(bubbles!).map((el) => el.dataset.mid)).toEqual(['1', '2', '3'])
      expect(rendered(bubbles!)[2].querySelector('.bubble-content')!.textContent).toBe('новое')
      expect(bubbles!.getBubble(makeFullMid(CHAT, 3))).toBe(rendered(bubbles!)[2])
    })

    it('событие про ЧУЖОЕ окно игнорируется', () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(OTHER_CHAT), message: msg({ id: 3, seq: 3 }) })
      expect(rendered(bubbles!)).toHaveLength(2)
    })
  })

  describe('history_update', () => {
    it('переклеивает ключ бабла на новый идентификатор, НЕ пересоздавая узел', () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: -7, seq: 3, clientId: 'c1' }) })
      const before = bubbles!.getBubble(makeFullMid(CHAT, -7))
      expect(before).toBeDefined()

      rootScope.dispatchEventSingle('history_update', {
        storageKey: String(CHAT),
        message: msg({ id: 9, seq: 3, clientId: 'c1' }),
        tempId: -7,
      })

      expect(bubbles!.getBubble(makeFullMid(CHAT, -7))).toBeUndefined()
      // ТОТ ЖЕ элемент под новым ключом — не пересоздан.
      expect(bubbles!.getBubble(makeFullMid(CHAT, 9))).toBe(before)
      expect(before!.dataset.mid).toBe('9')
      expect(rendered(bubbles!)).toHaveLength(3)
    })

    it('событие про ЧУЖОЕ окно игнорируется', () => {
      rootScope.dispatchEventSingle('history_update', {
        storageKey: String(OTHER_CHAT),
        message: msg({ id: 9, seq: 1 }),
        tempId: 1,
      })
      expect(bubbles!.getBubble(makeFullMid(CHAT, 1))).toBeDefined()
      expect(bubbles!.getBubble(makeFullMid(CHAT, 9))).toBeUndefined()
    })
  })

  describe('message_edit', () => {
    it('обновляет содержимое РОВНО одного бабла, оставляя тот же узел', () => {
      const before = bubbles!.getBubble(makeFullMid(CHAT, 2))

      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(CHAT), peerId: CHAT, mid: 2, message: msg({ id: 2, seq: 2, text: 'правка' }),
      })

      expect(bubbles!.getBubble(makeFullMid(CHAT, 2))).toBe(before)
      expect(before!.querySelector('.bubble-content')!.textContent).toBe('правка')
      expect(rendered(bubbles!)[0].querySelector('.bubble-content')!.textContent).toBe('m1')
      expect(rendered(bubbles!)).toHaveLength(2)
    })

    it('событие про ЧУЖОЕ окно игнорируется', () => {
      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(OTHER_CHAT), peerId: OTHER_CHAT, mid: 2, message: msg({ id: 2, seq: 2, text: 'правка' }),
      })
      expect(bubbles!.getBubble(makeFullMid(CHAT, 2))!.querySelector('.bubble-content')!.textContent).toBe('m2')
    })
  })

  describe('history_delete', () => {
    it('снимает РОВНО один узел', () => {
      rootScope.dispatchEventSingle('history_delete', { peerId: CHAT, msgs: new Set([1]) })

      expect(rendered(bubbles!).map((el) => el.dataset.mid)).toEqual(['2'])
      expect(bubbles!.getBubble(makeFullMid(CHAT, 1))).toBeUndefined()
    })

    it('событие про ЧУЖОЙ чат игнорируется', () => {
      rootScope.dispatchEventSingle('history_delete', { peerId: OTHER_CHAT, msgs: new Set([1]) })
      expect(rendered(bubbles!)).toHaveLength(2)
    })
  })
})

describe('ChatBubbles.destroy/cleanup', () => {
  it('destroy() снимает подписки — после него ни одно из четырёх событий ничего не делает', async () => {
    const b = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1 })]))
    await b.getHistory()
    expect(rendered(b)).toHaveLength(1)

    b.destroy()

    rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: 2, seq: 2 }) })
    rootScope.dispatchEventSingle('message_edit', { storageKey: String(CHAT), peerId: CHAT, mid: 1, message: msg({ id: 1, seq: 1, text: 'правка' }) })
    rootScope.dispatchEventSingle('history_update', { storageKey: String(CHAT), message: msg({ id: 5, seq: 1 }), tempId: 1 })
    rootScope.dispatchEventSingle('history_delete', { peerId: CHAT, msgs: new Set([1]) })

    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(['1'])
    expect(rendered(b)[0].querySelector('.bubble-content')!.textContent).toBe('m1')
    expect(b.getBubble(makeFullMid(CHAT, 1))).toBeDefined()
  })

  it('cleanup(true) забывает адреса и снимает узлы', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1 })]))
    await bubbles.getHistory()

    bubbles.cleanup(true)

    expect(rendered(bubbles)).toHaveLength(0)
    expect(bubbles.getBubble(makeFullMid(CHAT, 1))).toBeUndefined()
  })
})
