// src/components/chat/bubbles.test.ts
//
// Императивная лента (`ChatBubbles`, порт tweb `chat/bubbles.ts`). Пины:
//   (1) дерево DOM совпадает с tweb `constructBubbles` (bubbles.ts:1439-1458);
//   (2) `getHistory` кладёт страницу в зеркало и рисует по узлу на сообщение;
//   (3) каждая из четырёх подписок каталога истории меняет РОВНО один узел,
//       а событие про чужое окно игнорируется;
//   (4) `history_update` переклеивает КЛЮЧ, не пересоздавая узел (сверка
//       идентичности элемента до и после);
//   (5) `destroy()` снимает подписки — после него события ничего не делают;
//   (6) текст бабла собран `wrapMessageText` (`lib/richtext`), а не текстовым
//       узлом: сущности видны в дереве;
//   (7) баблы лежат в сериях (`bubbleGroups.ts`) внутри секций дней, а
//       появление нового трогает СОСЕДА, а не всё окно;
//   (8) делегированный слушатель контейнера разбирает разметку rich-text
//       (`data-anchor-action`, `a.follow[data-follow]`, `.peer-title`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { mirrorWindow, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { Peer } from '@core/managers/peersManager'
import type { Message } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, {
  makeFullMid,
  type BubblesManagers,
  type BubblesNavigation,
  type ChatContext,
} from './bubbles'

const CHAT = 50
const OTHER_CHAT = 51

/** Окружение `Chat`, которого у ленты ещё нет: колонка чата (`chat.container`,
 *  на неё лента вешает `is-go-down-visible`) и `.bubbles-viewport`
 *  (`chat.bubblesViewport`, относительно него считаются позиции скролла) —
 *  оба узла в проде создаёт `VanillaFeed` (порт `Chat.constructor`). */
const chatContext = (peerId = CHAT): ChatContext => ({
  peerId,
  messagesStorageKey: String(peerId),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

function msg(over: Partial<Message> & { id: number; seq: number }): Message {
  return {
    chatId: CHAT, senderId: 2, type: 'text', text: `m${over.seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-15T12:00:00Z', threadRootId: null,
    ...over,
  }
}

const historyResult = (messages: Message[]): HistoryResult =>
  ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })

function managersWith(messages: Message[]) {
  const getHistory = vi.fn(async () => historyResult(messages))
  // Владелец карточек пиров: узел имени объявляет ему пробел зеркала
  // (`peerTitle.ts`), ответ приезжает операцией — в тестах её подаём руками
  // через `applyPeerOps`.
  const fillMirror = vi.fn(async () => {})
  // Владелец горизонта прочтения (граница непрочитанных) — воркерный
  // `dialogsManager`; по умолчанию «непрочитанного нет».
  const getReadMaxSeqIfUnread = vi.fn(async () => 0)
  const getHistoryMaxSeq = vi.fn(async () => 0)
  const managers: BubblesManagers = {
    messages: { getHistory },
    peers: { fillMirror },
    dialogs: { getReadMaxSeqIfUnread, getHistoryMaxSeq },
  }
  return Object.assign(managers, { getHistory, fillMirror, getReadMaxSeqIfUnread, getHistoryMaxSeq })
}

/** Дать очереди рендера (`BatchProcessor`, `pause(0)` + микрозадачи) разобраться.
 *  Прогон макрозадач, а не одна: обработчик `history_update` ждёт сначала
 *  `renderNewPromises`, потом саму очередь. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let bubbles: ChatBubbles | undefined

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
})

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
})

/** Карточка пира в форме владельца (`peersManager`). Кладём её в зеркало через
 *  ту же операцию, которой её объявляет воркер, — руками в зеркало не пишем. */
const peerCard = (id: number, displayName: string): Peer =>
  ({ id, username: `u${id}`, displayName, avatarUrl: '', avatarPreview: '' })

/** Отрисованные баблы СООБЩЕНИЙ в порядке DOM. `.service` исключены: дата-бабл
 *  секции дня (и его `is-fake`-дубль) — тоже `.bubble`, но сообщения за ними не
 *  стоит (порт tweb `createDateBubble`). */
const rendered = (b: ChatBubbles) =>
  Array.from(b.chatInner.querySelectorAll<HTMLElement>('.bubble:not(.service)'))

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

    await bubbles.loadFirstHistory()

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

    await bubbles.loadFirstHistory()

    expect(mirrorWindow(String(CHAT))).toEqual(page)
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['1', '2'])
    expect(rendered(bubbles)[1].querySelector('.bubble-content')!.textContent).toBe('привет')
  })

  it('бабл — .bubble > .bubble-content-wrapper > .bubble-content с текстом', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1, text: 'ок' })]))
    await bubbles.loadFirstHistory()

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
    bubbles = new ChatBubbles({ ...chatContext(), threadId: 60, messagesStorageKey: `${CHAT}:60` }, managers)
    await bubbles.loadFirstHistory()
    expect(managers.getHistory).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT, threadRoot: 60 }))
  })

  it('протухший ответ (лента убита, пока летел запрос) не пишет ни в зеркало, ни в DOM', async () => {
    let release!: (r: HistoryResult) => void
    const pending = new Promise<HistoryResult>((res) => { release = res })
    const b = new ChatBubbles(chatContext(), { messages: { getHistory: () => pending }, peers: { fillMirror: async () => {} }, dialogs: { getReadMaxSeqIfUnread: async () => 0, getHistoryMaxSeq: async () => 0 } })

    const promise = b.loadFirstHistory()
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
    await bubbles.loadFirstHistory()
  })

  describe('history_append', () => {
    it('рисует РОВНО один новый узел', async () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: 3, seq: 3, text: 'новое' }) })
      await settle()

      expect(rendered(bubbles!).map((el) => el.dataset.mid)).toEqual(['1', '2', '3'])
      expect(rendered(bubbles!)[2].querySelector('.bubble-content')!.textContent).toBe('новое')
      expect(bubbles!.getBubble(makeFullMid(CHAT, 3))).toBe(rendered(bubbles!)[2])
    })

    it('событие про ЧУЖОЕ окно игнорируется', async () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(OTHER_CHAT), message: msg({ id: 3, seq: 3 }) })
      await settle()
      expect(rendered(bubbles!)).toHaveLength(2)
    })
  })

  describe('history_update', () => {
    it('переклеивает ключ бабла на новый идентификатор, НЕ пересоздавая узел', async () => {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: -7, seq: 3, clientId: 'c1' }) })
      await settle()
      const before = bubbles!.getBubble(makeFullMid(CHAT, -7))
      expect(before).toBeDefined()

      rootScope.dispatchEventSingle('history_update', {
        storageKey: String(CHAT),
        message: msg({ id: 9, seq: 3, clientId: 'c1' }),
        tempId: -7,
      })
      await settle()

      expect(bubbles!.getBubble(makeFullMid(CHAT, -7))).toBeUndefined()
      // ТОТ ЖЕ элемент под новым ключом — не пересоздан.
      expect(bubbles!.getBubble(makeFullMid(CHAT, 9))).toBe(before)
      expect(before!.dataset.mid).toBe('9')
      expect(rendered(bubbles!)).toHaveLength(3)
    })

    it('событие про ЧУЖОЕ окно игнорируется', async () => {
      rootScope.dispatchEventSingle('history_update', {
        storageKey: String(OTHER_CHAT),
        message: msg({ id: 9, seq: 1 }),
        tempId: 1,
      })
      await settle()
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
    await b.loadFirstHistory()
    expect(rendered(b)).toHaveLength(1)

    b.destroy()

    rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: 2, seq: 2 }) })
    rootScope.dispatchEventSingle('message_edit', { storageKey: String(CHAT), peerId: CHAT, mid: 1, message: msg({ id: 1, seq: 1, text: 'правка' }) })
    rootScope.dispatchEventSingle('history_update', { storageKey: String(CHAT), message: msg({ id: 5, seq: 1 }), tempId: 1 })
    rootScope.dispatchEventSingle('history_delete', { peerId: CHAT, msgs: new Set([1]) })
    await settle()

    expect(rendered(b).map((el) => el.dataset.mid)).toEqual(['1'])
    expect(rendered(b)[0].querySelector('.bubble-content')!.textContent).toBe('m1')
    expect(b.getBubble(makeFullMid(CHAT, 1))).toBeDefined()
  })

  it('cleanup(true) забывает адреса и снимает узлы', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1 })]))
    await bubbles.loadFirstHistory()

    bubbles.cleanup(true)

    expect(rendered(bubbles)).toHaveLength(0)
    expect(bubbles.getBubble(makeFullMid(CHAT, 1))).toBeUndefined()
    expect(bubbles.chatInner.querySelector('.bubbles-date-group')).toBeNull()
    expect(bubbles.container.classList.contains('has-groups')).toBe(false)
  })
})

// Тело бабла собирает `wrapMessageText` (`lib/richtext`) — тот же вход, что
// зовёт tweb (bubbles.ts:7497 `wrapRichText(messageMessage, …)`). Пин ловит
// возврат к текстовому узлу: с ним сущности превратятся в плоский текст.
describe('ChatBubbles — текст сообщения проходит через wrapMessageText', () => {
  const contentOf = (b: ChatBubbles, mid: number) =>
    b.getBubble(makeFullMid(CHAT, mid))!.querySelector('.message')!

  it('.bubble-content > .message.spoilers-container — контейнер тела (tweb bubbles.ts:6618)', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1, text: 'привет' })]))
    await bubbles.loadFirstHistory()

    const messageDiv = contentOf(bubbles, 1)
    expect(messageDiv.className).toBe('message spoilers-container')
    expect(messageDiv.parentElement!.className).toBe('bubble-content')
    expect(messageDiv.textContent).toBe('привет')
  })

  it('bold/ссылка/спойлер приезжают УЗЛАМИ, а не текстом', async () => {
    const text = 'жирный ссылка секрет'
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({
      id: 1, seq: 1, text,
      entities: [
        { type: 'bold', offset: 0, length: 6 },
        { type: 'text_link', offset: 7, length: 6, url: 'https://example.com/page' },
        { type: 'spoiler', offset: 14, length: 6 },
      ],
    })]))
    await bubbles.loadFirstHistory()

    const messageDiv = contentOf(bubbles, 1)
    expect(messageDiv.querySelector('strong')!.textContent).toBe('жирный')
    const anchor = messageDiv.querySelector<HTMLAnchorElement>('a.anchor-url')!
    expect(anchor.textContent).toBe('ссылка')
    expect(anchor.href).toBe('https://example.com/page')
    expect(messageDiv.querySelector('.spoiler > .spoiler-text')!.textContent).toBe('секрет')
    // текст целиком на месте — сущности его не съели
    expect(messageDiv.textContent).toBe(text)
  })

  it('правка (message_edit) перерисовывает тело тем же конвейером', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1, text: 'было' })]))
    await bubbles.loadFirstHistory()

    rootScope.dispatchEventSingle('message_edit', {
      storageKey: String(CHAT), peerId: CHAT, mid: 1,
      message: msg({ id: 1, seq: 1, text: 'стало жирным', entities: [{ type: 'bold', offset: 6, length: 6 }] }),
    })

    expect(contentOf(bubbles, 1).querySelector('strong')!.textContent).toBe('жирным')
  })
})

// Раскладка по сериям и дням — `bubbleGroups.ts` под управлением ленты
// (`safeRenderMessage` → `groupBubbles` → `mountUnmountGroups`).
describe('ChatBubbles — серии и секции дней', () => {
  const AUTHOR = 2
  const OTHER_AUTHOR = 3
  const at = (iso: string) => iso

  /** Секции дней в порядке DOM. */
  const sections = (b: ChatBubbles) =>
    Array.from(b.chatInner.querySelectorAll<HTMLElement>('section.bubbles-date-group'))

  const groupsIn = (section: HTMLElement) =>
    Array.from(section.querySelectorAll<HTMLElement>('.bubbles-group'))

  it('подряд идущие сообщения одного автора — одна серия с краями is-group-first/last', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:30Z') }),
      msg({ id: 3, seq: 3, senderId: AUTHOR, createdAt: at('2026-08-15T12:01:00Z') }),
    ]))
    await bubbles.loadFirstHistory()

    expect(sections(bubbles)).toHaveLength(1)
    const groups = groupsIn(sections(bubbles)[0])
    expect(groups).toHaveLength(1)
    expect(Array.from(groups[0].children).map((el) => el.getAttribute('data-mid'))).toEqual(['1', '2', '3'])

    const [first, middle, last] = rendered(bubbles)
    expect(first.classList.contains('is-group-first')).toBe(true)
    expect(first.classList.contains('is-group-last')).toBe(false)
    expect(middle.classList.contains('is-group-first')).toBe(false)
    expect(middle.classList.contains('is-group-last')).toBe(false)
    expect(last.classList.contains('is-group-last')).toBe(true)
  })

  it('другой автор и разрыв больше NEW_GROUP_DIFF рвут серию', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, senderId: OTHER_AUTHOR, createdAt: at('2026-08-15T12:00:10Z') }),
      // тот же автор, что и №2, но через 10 минут — NEW_GROUP_DIFF = 121 сек
      msg({ id: 3, seq: 3, senderId: OTHER_AUTHOR, createdAt: at('2026-08-15T12:10:10Z') }),
    ]))
    await bubbles.loadFirstHistory()

    const groups = groupsIn(sections(bubbles)[0])
    expect(groups.map((g) => Array.from(g.children).map((el) => el.getAttribute('data-mid'))))
      .toEqual([['1'], ['2'], ['3']])
    // одиночная серия = бабл сразу и первый, и последний
    for (const bubble of rendered(bubbles)) {
      expect(bubble.classList.contains('is-group-first')).toBe(true)
      expect(bubble.classList.contains('is-group-last')).toBe(true)
    }
  })

  it('разные дни — разные секции, по возрастанию дня, с дата-баблом в начале', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, createdAt: at('2026-08-16T12:00:00Z') }),
    ]))
    await bubbles.loadFirstHistory()

    const secs = sections(bubbles)
    expect(secs).toHaveLength(2)
    expect(bubbles.container.classList.contains('has-groups')).toBe(true)

    for (const section of secs) {
      // дата-бабл + его is-fake-дубль + sticky-sentinel = STICKY_OFFSET узлов
      // ПЕРЕД сериями (tweb bubbles.ts:4830-4867)
      const head = Array.from(section.children).slice(0, 3)
      expect(head.map((el) => el.className)).toEqual([
        'bubble service is-date',
        'bubble service is-date is-fake',
        'sticky_sentinel sticky_sentinel--top',
      ])
      expect(head[0].querySelector('.bubble-content > .service-msg > span.i18n')).not.toBeNull()
      expect(section.children[3].className).toContain('bubbles-group')
    }

    // порядок секций — по возрастанию дня
    const days = secs.map((s) => s.querySelector<HTMLElement>('.bubble.is-date')!.dataset.date!)
    expect(days[0] < days[1]).toBe(true)
    // и сами баблы разъехались по своим дням
    expect(secs.map((s) => Array.from(s.querySelectorAll('.bubble:not(.service)')).map((el) => el.getAttribute('data-mid'))))
      .toEqual([['1'], ['2']])
  })

  // Серии одного дня встают по возрастанию времени независимо от того, в каком
  // порядке они смонтировались. Держит третий узел секции (sticky-sentinel):
  // `STICKY_OFFSET` — абсолютный индекс первой серии, и без него серия, чей
  // бабл нарисован раньше более старого, встала бы ВЫШЕ него.
  it('порядок серий в секции — по времени, даже когда страница пришла от новых к старым', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 3, seq: 3, senderId: AUTHOR, createdAt: at('2026-08-15T12:10:00Z') }),
      msg({ id: 2, seq: 2, senderId: OTHER_AUTHOR, createdAt: at('2026-08-15T12:05:00Z') }),
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:00Z') }),
    ]))
    await bubbles.loadFirstHistory()

    expect(groupsIn(sections(bubbles)[0]).map((g) => Array.from(g.children).map((el) => el.getAttribute('data-mid'))))
      .toEqual([['1'], ['2'], ['3']])
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['1', '2', '3'])
  })

  it('новое сообщение серии трогает СОСЕДА, а не всё окно', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:30Z') }),
      msg({ id: 3, seq: 3, senderId: AUTHOR, createdAt: at('2026-08-15T12:01:00Z') }),
    ]))
    await bubbles.loadFirstHistory()

    const before = rendered(bubbles).map((el) => ({ el, className: el.className }))

    rootScope.dispatchEventSingle('history_append', {
      storageKey: String(CHAT),
      message: msg({ id: 4, seq: 4, senderId: AUTHOR, createdAt: at('2026-08-15T12:01:30Z') }),
    })
    await settle()

    const after = rendered(bubbles)
    expect(after).toHaveLength(4)
    // узлы прежних баблов те же — ничего не пересоздано
    expect(after.slice(0, 3)).toEqual(before.map((b) => b.el))
    // изменился РОВНО сосед (бывший последний потерял is-group-last)
    const changed = before.filter((b) => b.el.className !== b.className)
    expect(changed.map((b) => b.el.dataset.mid)).toEqual(['3'])
    expect(before[2].el.classList.contains('is-group-last')).toBe(false)
    expect(after[3].classList.contains('is-group-last')).toBe(true)
  })

  it('удаление последнего бабла дня снимает и серию, и секцию дня', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, createdAt: at('2026-08-16T12:00:00Z') }),
    ]))
    await bubbles.loadFirstHistory()
    expect(sections(bubbles)).toHaveLength(2)

    rootScope.dispatchEventSingle('history_delete', { peerId: CHAT, msgs: new Set([1]) })

    const secs = sections(bubbles)
    expect(secs).toHaveLength(1)
    expect(groupsIn(secs[0]).map((g) => Array.from(g.children).map((el) => el.getAttribute('data-mid'))))
      .toEqual([['2']])
    expect(bubbles.container.classList.contains('has-groups')).toBe(true)
  })

  it('удаление разделявшего бабла сливает соседей обратно в одну серию', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: at('2026-08-15T12:00:00Z') }),
      msg({ id: 2, seq: 2, senderId: OTHER_AUTHOR, createdAt: at('2026-08-15T12:00:30Z') }),
      msg({ id: 3, seq: 3, senderId: AUTHOR, createdAt: at('2026-08-15T12:01:00Z') }),
    ]))
    await bubbles.loadFirstHistory()
    expect(groupsIn(sections(bubbles)[0])).toHaveLength(3)

    rootScope.dispatchEventSingle('history_delete', { peerId: CHAT, msgs: new Set([2]) })

    const groups = groupsIn(sections(bubbles)[0])
    expect(groups.map((g) => Array.from(g.children).map((el) => el.getAttribute('data-mid'))))
      .toEqual([['1', '3']])
  })
})

// Делегированный слушатель контейнера — порт tweb `attachContainerListeners`
// (bubbles.ts:1460) в объёме разметки rich-text. Без него внутренние ссылки
// tweb исполнялись бы inline-обработчиком, которого у нас нет по требованиям
// безопасности (см. докблок `BubblesNavigation`).
describe('ChatBubbles — делегированный слушатель кликов', () => {
  /** Адресат, который «исполнил» действие (вернул true) — лента обязана гасить событие. */
  const nav = () => ({ openInternalLink: vi.fn(() => true), openPeer: vi.fn(() => true) })

  const withNav = (navigation: BubblesNavigation, messages: Message[]) =>
    new ChatBubbles({ ...chatContext(), navigation }, managersWith(messages))

  const click = (el: Element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event
  }

  it('t.me-ссылка (`data-anchor-action`) уходит в openInternalLink, событие гасится', async () => {
    const navigation = nav()
    bubbles = withNav(navigation, [msg({
      id: 1, seq: 1, text: 'канал',
      entities: [{ type: 'text_link', offset: 0, length: 5, url: 'https://t.me/durov' }],
    })])
    await bubbles.loadFirstHistory()

    const anchor = bubbles.chatInner.querySelector<HTMLElement>('[data-anchor-action]')!
    expect(anchor.dataset.anchorAction).toBe('im')

    const event = click(anchor)

    expect(navigation.openInternalLink).toHaveBeenCalledWith('im', anchor)
    expect(event.defaultPrevented).toBe(true)
    expect(navigation.openPeer).not.toHaveBeenCalled()
  })

  it('клик по узлу ВНУТРИ ссылки тоже считается (делегирование, а не listener на самом <a>)', async () => {
    const navigation = nav()
    bubbles = withNav(navigation, [msg({
      id: 1, seq: 1, text: 'жирная ссылка',
      entities: [
        { type: 'text_link', offset: 0, length: 13, url: 'https://t.me/durov' },
        { type: 'bold', offset: 0, length: 6 },
      ],
    })])
    await bubbles.loadFirstHistory()

    click(bubbles.chatInner.querySelector('a[data-anchor-action] strong')!)

    expect(navigation.openInternalLink).toHaveBeenCalledWith('im', expect.any(HTMLAnchorElement))
  })

  it('упоминание без username (`a.follow[data-follow]`) уходит в openPeer', async () => {
    const navigation = nav()
    bubbles = withNav(navigation, [msg({
      id: 1, seq: 1, text: 'Иван',
      entities: [{ type: 'text_mention', offset: 0, length: 4, user_id: 77 }],
    })])
    await bubbles.loadFirstHistory()

    const follow = bubbles.chatInner.querySelector<HTMLElement>('a.follow')!
    const event = click(follow)

    expect(navigation.openPeer).toHaveBeenCalledWith(77, follow)
    expect(event.defaultPrevented).toBe(true)
  })

  // Узел НАСТОЯЩИЙ — тот, что лента строит сама (имя автора, порт tweb
  // `PeerTitle`). Раньше здесь лежал `span.peer-title`, вставленный самим
  // тестом: такой пин держал ровно селектор в слушателе и молчал бы, если бы
  // имя автора никто не рисовал (а его никто и не рисовал).
  it('`.peer-title[data-peer-id]` имени автора уходит в openPeer', async () => {
    rootScope.myId = 999
    const navigation = nav()
    bubbles = new ChatBubbles(
      { ...chatContext(), isLikeGroup: true, navigation },
      managersWith([msg({ id: 1, seq: 1, senderId: 42 })]),
    )
    applyPeerOps([{ op: 'upsert', peers: [peerCard(42, 'Пётр')] }])
    await bubbles.loadFirstHistory()

    const title = bubbles.chatInner.querySelector<HTMLElement>('.bubble .name > .peer-title')!
    expect(title.textContent).toBe('Пётр')

    const event = click(title)

    expect(navigation.openPeer).toHaveBeenCalledWith(42, title)
    expect(event.defaultPrevented).toBe(true)
  })

  it('обычный текст бабла НЕ ловится, а необработанный клик не гасится', async () => {
    const navigation = { openInternalLink: vi.fn(() => false), openPeer: vi.fn(() => false) }
    bubbles = withNav(navigation, [msg({
      id: 1, seq: 1, text: 'просто текст и https://example.com',
    })])
    await bubbles.loadFirstHistory()

    const messageDiv = bubbles.chatInner.querySelector('.message')!
    const plainEvent = click(messageDiv)
    expect(navigation.openInternalLink).not.toHaveBeenCalled()
    expect(navigation.openPeer).not.toHaveBeenCalled()
    expect(plainEvent.defaultPrevented).toBe(false)

    // Внешняя ссылка без действия (`target=_blank`) — это не внутренняя
    // ссылка Telegram: ленте её перехватывать нечем, браузер открывает вкладку.
    const external = messageDiv.querySelector<HTMLAnchorElement>('a.anchor-url')!
    expect(external.hasAttribute('data-anchor-action')).toBe(false)
    expect(external.target).toBe('_blank')
    expect(click(external).defaultPrevented).toBe(false)
    expect(navigation.openInternalLink).not.toHaveBeenCalled()
  })

  it('без адресата навигации клик ничего не ломает и не гасится', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({
      id: 1, seq: 1, text: 'канал',
      entities: [{ type: 'text_link', offset: 0, length: 5, url: 'https://t.me/durov' }],
    })]))
    await bubbles.loadFirstHistory()

    const event = click(bubbles.chatInner.querySelector('[data-anchor-action]')!)
    expect(event.defaultPrevented).toBe(false)
  })

  it('destroy() снимает и делегированный слушатель', async () => {
    const navigation = nav()
    const b = withNav(navigation, [msg({
      id: 1, seq: 1, text: 'канал',
      entities: [{ type: 'text_link', offset: 0, length: 5, url: 'https://t.me/durov' }],
    })])
    await b.loadFirstHistory()
    const anchor = b.chatInner.querySelector<HTMLElement>('[data-anchor-action]')!

    b.destroy()
    click(anchor)

    expect(navigation.openInternalLink).not.toHaveBeenCalled()
  })
})

// ─── Очередь рендера (`renderMessagesQueue` → `batchProcessor`) ─────────────
//
// Порт tweb bubbles.ts:5808/5961/2190 + `helpers/batchProcessor.ts`. Предмет
// пинов ниже — ровно то, ради чего очередь существует:
//   • всё, что отрисовано за один ход, группируется ОДНИМ вызовом и в порядке
//     постановки (до очереди группировка звалась побабльно);
//   • у отрисовки есть точка ожидания (`messagesQueuePromise`), и ждущий её код
//     действительно её дожидается — на этом стоит и репозиция бабла по ack, и
//     будущая компенсация скролла.
describe('ChatBubbles — очередь рендера', () => {
  const page = (n: number) =>
    Array.from({ length: n }, (_, i) => msg({
      id: i + 1, seq: i + 1, senderId: 2 + i,
      createdAt: `2026-08-15T12:${String(i * 5).padStart(2, '0')}:00Z`,
    }))

  it('пачка группируется ОДНИМ вызовом groupBubbles — и в порядке постановки в очередь', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith(page(3)))
    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')

    await bubbles.loadFirstHistory()

    expect(groupBubbles).toHaveBeenCalledTimes(1)
    expect(groupBubbles.mock.calls[0][0].map((d) => d.message.id)).toEqual([1, 2, 3])
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['1', '2', '3'])
  })

  it('несколько history_append одним ходом — тоже одна пачка, порядок сохранён', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([]))
    await bubbles.loadFirstHistory()
    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')

    for (const m of page(3)) {
      rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: m })
    }
    await settle()

    expect(groupBubbles).toHaveBeenCalledTimes(1)
    expect(groupBubbles.mock.calls[0][0].map((d) => d.message.id)).toEqual([1, 2, 3])
    expect(rendered(bubbles!).map((el) => el.dataset.mid)).toEqual(['1', '2', '3'])
  })

  // Отрисовка отложена до пачки — это и есть очередь, а не синхронный рендер.
  // Адрес бабла при этом заводится СРАЗУ (tweb bubbles.ts:6341): на него
  // опирается и дедуп повторного рендера, и подписка history_update.
  it('узел появляется в DOM только после пачки, а адрес бабла — сразу', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([]))
    await bubbles.loadFirstHistory()

    rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg({ id: 7, seq: 7 }) })

    expect(bubbles.getBubble(makeFullMid(CHAT, 7))).toBeDefined()
    expect(rendered(bubbles)).toHaveLength(0)

    await bubbles.messagesQueuePromise
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['7'])
  })

  // `getHistory` разрешается только когда страница ДЕЙСТВИТЕЛЬНО отрисована
  // (tweb `performHistoryResult` → `await this.messagesQueuePromise`, :10152).
  it('getHistory дожидается очереди — после await страница уже в DOM', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith(page(2)))

    await bubbles.loadFirstHistory()

    expect(rendered(bubbles)).toHaveLength(2)
    // очередь разобрана целиком — ждать больше нечего
    expect(bubbles.messagesQueuePromise).toBeUndefined()
  })

  // ГЛАВНЫЙ пин ожидания. Пока пачка не разобрана, окно НЕПОЛНО: узлы уже
  // созданы, а элементов серий у них ещё нет. Обработчик `history_update`,
  // который переставляет бабл по новому идентификатору, обязан считать позицию
  // по ПОЛНОМУ окну — поэтому в tweb он сначала ждёт `renderNewPromises`, потом
  // `messagesQueuePromise` (bubbles.ts:780-787) и только затем трогает серии.
  // Пин смотрит на порядок: группировка пачки — раньше, перекладка бабла —
  // позже. Без ожидания порядок обратный, и бабл раскладывается в окно, в
  // котором соседа ещё нет.
  it('history_update ждёт очередь: сначала группируется пачка, потом переставляется бабл', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([
      msg({ id: -5, seq: 5, senderId: 3, clientId: 'c1', createdAt: '2026-08-15T12:00:00Z' }),
    ]))
    await bubbles.loadFirstHistory()
    const groupBubbles = vi.spyOn(bubbles, 'groupBubbles')

    // Пачка в полёте: узел соседа создан, серии у него ещё нет.
    rootScope.dispatchEventSingle('history_append', {
      storageKey: String(CHAT),
      message: msg({ id: 6, seq: 6, senderId: 3, createdAt: '2026-08-15T12:00:30Z' }),
    })
    // ...и в этот момент приезжает ack бабла «отправляется…».
    rootScope.dispatchEventSingle('history_update', {
      storageKey: String(CHAT),
      message: msg({ id: 9, seq: 5, senderId: 3, clientId: 'c1', createdAt: '2026-08-15T12:00:00Z' }),
      tempId: -5,
    })

    await settle()

    expect(groupBubbles.mock.calls.map((c) => c[0].map((d) => d.message.id))).toEqual([[6], [9]])
    expect(bubbles.getBubble(makeFullMid(CHAT, -5))).toBeUndefined()
    expect(rendered(bubbles).map((el) => el.dataset.mid)).toEqual(['9', '6'])
    // соседа нашли — оба бабла в одной серии
    expect(bubbles.chatInner.querySelectorAll('.bubbles-group')).toHaveLength(1)
  })
})

// ─── Имя автора в бабле (порт tweb `PeerTitle` + `needName`) ────────────────
describe('ChatBubbles — имя автора', () => {
  const AUTHOR = 42
  const groupContext = (over: Partial<ChatContext> = {}): ChatContext =>
    ({ ...chatContext(), isLikeGroup: true, ...over })

  const nameOf = (b: ChatBubbles, mid: number) =>
    b.getBubble(makeFullMid(CHAT, mid))!.querySelector<HTMLElement>('.name')

  beforeEach(() => {
    rootScope.myId = 999
    applyPeerOps([{ op: 'upsert', peers: [peerCard(AUTHOR, 'Пётр')] }])
  })

  it('входящее в групповом чате: .bubble-content > .name.colored-name > span.peer-title[data-peer-id]', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([msg({ id: 1, seq: 1, senderId: AUTHOR })]))
    await bubbles.loadFirstHistory()

    const nameDiv = nameOf(bubbles, 1)!
    // порядок в .bubble-content: имя перед телом сообщения (tweb :9587)
    expect(nameDiv.parentElement!.className).toBe('bubble-content')
    expect(nameDiv.nextElementSibling!.classList.contains('message')).toBe(true)
    expect(nameDiv.className.split(' ').sort()).toEqual(['colored-name', 'floating-part', 'name', 'next-is-message'])
    expect(nameDiv.dataset.peerId).toBe(String(AUTHOR))

    const title = nameDiv.firstElementChild as HTMLElement
    expect(title.tagName).toBe('SPAN')
    expect(title.className).toBe('peer-title')
    expect(title.dataset.peerId).toBe(String(AUTHOR))
    expect(title.textContent).toBe('Пётр')
    // модификатор бабла согласован с узлом
    expect(bubbles.getBubble(makeFullMid(CHAT, 1))!.classList.contains('hide-name')).toBe(false)
  })

  it('своё исходящее в группе имени НЕ получает (bubble.hide-name)', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([msg({ id: 1, seq: 1, senderId: 999, out: true })]))
    await bubbles.loadFirstHistory()

    expect(nameOf(bubbles, 1)).toBeNull()
    expect(bubbles.getBubble(makeFullMid(CHAT, 1))!.classList.contains('hide-name')).toBe(true)
  })

  it('НЕ группа (isLikeGroup не взведён): имени нет и у входящего', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg({ id: 1, seq: 1, senderId: AUTHOR })]))
    await bubbles.loadFirstHistory()

    expect(nameOf(bubbles, 1)).toBeNull()
    expect(bubbles.getBubble(makeFullMid(CHAT, 1))!.classList.contains('hide-name')).toBe(true)
  })

  // send-as (порт `iPostedAsSomeoneElse`, tweb :9325): пост от имени
  // канала/группы подписывается ДАЖЕ будучи своим. Карточки у чат-личности
  // нет — заголовок приезжает в самом сообщении (`fromName` в tweb).
  it('send-as в группе: имя из sendAs.title, data-peer-id — отрицательный id чата', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: 999, sendAs: { chatId: 7, title: 'Канал' } }),
    ]))
    await bubbles.loadFirstHistory()

    const nameDiv = nameOf(bubbles, 1)!
    expect(nameDiv.dataset.peerId).toBe('-7')
    expect(nameDiv.firstElementChild!.textContent).toBe('Канал')
  })

  it('чужое имя цветное, а имя своего сообщения — нет (colored-name по !out)', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR }),
      msg({ id: 2, seq: 2, senderId: 999, out: true, sendAs: { chatId: 7, title: 'Канал' } }),
    ]))
    await bubbles.loadFirstHistory()

    expect(nameOf(bubbles, 1)!.classList.contains('colored-name')).toBe(true)
    expect(nameOf(bubbles, 2)!.classList.contains('colored-name')).toBe(false)
  })

  // 1:1 с tweb: узел строится у КАЖДОГО бабла серии, лишние прячет CSS
  // (`_chatBubble.scss:663-670`). Гейт «первый в серии» в DOM был бы нашей
  // отсебятиной и ломался бы при слиянии/разрыве серии.
  it('узел имени — у каждого бабла серии, а не только у первого', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([
      msg({ id: 1, seq: 1, senderId: AUTHOR, createdAt: '2026-08-15T12:00:00Z' }),
      msg({ id: 2, seq: 2, senderId: AUTHOR, createdAt: '2026-08-15T12:00:30Z' }),
    ]))
    await bubbles.loadFirstHistory()

    expect(bubbles.chatInner.querySelectorAll('.bubbles-group')).toHaveLength(1)
    expect(nameOf(bubbles, 1)).not.toBeNull()
    expect(nameOf(bubbles, 2)).not.toBeNull()
  })

  // Промах зеркала — объявленный ПРОБЕЛ: узел просит владельца
  // (`peers.fillMirror`) и подхватывает карточку, когда та приезжает операцией.
  it('карточки ещё нет: узел объявляет пробел владельцу и дорисовывает имя по операции', async () => {
    resetPeerMirror()
    const managers = managersWith([msg({ id: 1, seq: 1, senderId: AUTHOR })])
    bubbles = new ChatBubbles(groupContext(), managers)
    await bubbles.loadFirstHistory()

    const title = nameOf(bubbles, 1)!.firstElementChild!
    expect(title.textContent).toBe('')
    expect(managers.fillMirror).toHaveBeenCalledWith([AUTHOR])

    applyPeerOps([{ op: 'upsert', peers: [peerCard(AUTHOR, 'Пётр')] }])

    expect(title.textContent).toBe('Пётр')
  })

  it('переименование пира (операция patch) перерисовывает уже нарисованное имя', async () => {
    bubbles = new ChatBubbles(groupContext(), managersWith([msg({ id: 1, seq: 1, senderId: AUTHOR })]))
    await bubbles.loadFirstHistory()
    const title = nameOf(bubbles, 1)!.firstElementChild!
    expect(title.textContent).toBe('Пётр')

    applyPeerOps([{ op: 'patch', id: AUTHOR, fields: { displayName: 'Пётр I' } }])

    expect(title.textContent).toBe('Пётр I')
  })

  // Утечки нет: у убитой ленты узлы уходят из реестра по middleware.onClean.
  it('после destroy() узел уже не перерисовывается', async () => {
    const b = new ChatBubbles(groupContext(), managersWith([msg({ id: 1, seq: 1, senderId: AUTHOR })]))
    await b.loadFirstHistory()
    const title = b.chatInner.querySelector('.name > .peer-title')!

    b.destroy()
    applyPeerOps([{ op: 'patch', id: AUTHOR, fields: { displayName: 'Пётр I' } }])

    expect(title.textContent).toBe('Пётр')
  })
})
