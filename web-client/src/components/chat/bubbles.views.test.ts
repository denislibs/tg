// Счётчики поста канала В ЛЕНТЕ — порт tweb bubbles.ts:2094-2124 (просмотры),
// :2129-2147 + :2305-2328 (регистрация просмотра интерсектором) и глобального
// слушателя `replies_updated` (tweb replies.ts:17-22).
//
// Оригинал просмотры НЕ ОПРАШИВАЕТ. Видимые посты копит интерсектор ленты
// (`viewsMids.add` → `sendViewCountersDebounced`), через секунду они уезжают
// `messages.getMessagesViews{increment:true}` — это РЕГИСТРАЦИЯ просмотра, а не
// чтение счётчика; ответ раскладывается в локальные `updateChannelMessageViews`,
// а по ним лента переписывает `.post-views`.
//
// Пины:
//   (1) пост канала показался → через СЕКУНДУ уходит регистрация;
//   (2) наблюдение ОДНОРАЗОВОЕ — второй показ того же поста ничего не шлёт;
//   (3) в обычном чате регистрации нет вовсе;
//   (4) `messages_views` переписывает ОБА узла `.post-views` (время дублируется
//       в `.time-inner`), не пересобирая бабл;
//   (5) `replies_updated` двигает число в футере, оставляя сам футер на месте.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReplies, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { makeFullMid, type BubblesManagers, type ChatContext } from './bubbles'

const CHAT: PeerId = -700
const DISCUSSION_ID = 900

/** Управляемый IntersectionObserver — тот же приём, что в bubbles.read.test.ts. */
class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public targets: Element[] = []
  constructor(public cb: (entries: unknown[], observer: unknown) => void) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(el: Element) { this.targets.push(el) }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el) }
  disconnect() { this.targets = [] }
  takeRecords() { return [] }
}

const observerOf = (el: Element) =>
  FakeIntersectionObserver.instances.find((o) => o.targets.includes(el))

const intersect = (el: Element) => {
  observerOf(el)!.cb([{ target: el, isIntersecting: true }], null)
}

const chatContext = (over: Partial<ChatContext> = {}): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  ...over,
})

function managersWith(messages: MyMessage[]) {
  const registerViews = vi.fn(async () => {})
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async (): Promise<HistoryResult> => ({
        messages, count: messages.length, reachedTop: true, reachedBottom: true,
      })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
    channels: { registerViews },
  }
  return Object.assign(managers, { registerViews })
}

const commentThread = (replies: number): MessageReplies => ({
  _: 'messageReplies',
  pFlags: { comments: true },
  replies,
  channel_id: DISCUSSION_ID,
})

const post = (id: number, over: { views?: number; replies?: MessageReplies } = {}): MyMessage => ({
  ...makeMessage({
    peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00',
    ...(over.replies ? { replies: over.replies } : {}),
  }),
  ...(over.views !== undefined ? { views: over.views } : {}),
})

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

describe('ChatBubbles — регистрация просмотра поста', () => {
  // Что ломается без этого: счётчик просмотров у поста не двигается НИКОГДА —
  // сервер о зрителе не узнаёт (tweb bubbles.ts:2324-2325 → :2145).
  it('показавшийся пост уезжает регистрацией через СЕКУНДУ, а не сразу', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const managers = managersWith([post(11, { views: 3 }), post(12, { views: 4 })])
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managers)
      await openFeed(bubbles)
      await settle()

      intersect(bubbleOf(bubbles, 11))
      intersect(bubbleOf(bubbles, 12))
      // Дебаунс НЕ по переднему фронту: до истечения секунды запроса нет.
      await vi.advanceTimersByTimeAsync(900)
      expect(managers.registerViews).not.toHaveBeenCalled()

      // Прокрутка мимо двух постов — ОДИН запрос с обоими номерами.
      await vi.advanceTimersByTimeAsync(200)
      expect(managers.registerViews).toHaveBeenCalledTimes(1)
      expect(managers.registerViews).toHaveBeenCalledWith(CHAT, [11, 12])
    } finally {
      vi.useRealTimers()
    }
  })

  // tweb :2308 снимает наблюдение ПЕРВЫМ ЖЕ делом: просмотр считается один раз
  // на пару «пост + зритель», и второй показ регистрировать нечего.
  it('наблюдение одноразовое — тот же пост второй раз не регистрируется', async () => {
    const managers = managersWith([post(11, { views: 3 })])
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    expect(observerOf(bubble)).toBeDefined()
    intersect(bubble)
    expect(observerOf(bubble)).toBeUndefined()
  })

  // tweb :4321-4322 — удалённый пост уходит и из набора: регистрировать просмотр
  // того, чего в ленте больше нет, нечему.
  it('удалённый пост из накопленного набора уходит', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const managers = managersWith([post(11, { views: 3 }), post(12, { views: 4 })])
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managers)
      await openFeed(bubbles)
      await settle()

      intersect(bubbleOf(bubbles, 11))
      intersect(bubbleOf(bubbles, 12))
      bubbles.deleteMessagesByIds([makeFullMid(CHAT, 11)])

      await vi.advanceTimersByTimeAsync(1200)
      expect(managers.registerViews).toHaveBeenCalledWith(CHAT, [12])
    } finally {
      vi.useRealTimers()
    }
  })

  // Дебаунс висит на окне и переживает ленту: сработав после `destroy()`, он
  // прочитал бы `peerId` мёртвого инстанса.
  it('destroy() гасит незакончившийся дебаунс', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const managers = managersWith([post(11, { views: 3 })])
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managers)
      await openFeed(bubbles)
      await settle()

      intersect(bubbleOf(bubbles, 11))
      bubbles.destroy()
      bubbles = undefined

      await vi.advanceTimersByTimeAsync(1200)
      expect(managers.registerViews).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // tweb :4982 — накопленное принадлежит ПРОШЛОМУ окну: `cleanup()` внутри
  // `setPeer` его забывает.
  it('перезагрузка окна забывает накопленное', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const managers = managersWith([post(11, { views: 3 })])
      bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managers)
      await openFeed(bubbles)
      await settle()

      intersect(bubbleOf(bubbles, 11))
      await openFeed(bubbles)
      await settle()

      await vi.advanceTimersByTimeAsync(1200)
      expect(managers.registerViews).toHaveBeenCalledWith(CHAT, [])
    } finally {
      vi.useRealTimers()
    }
  })

  // Гейт оригинала — «это пост канала» (:7671). В обычном чате просмотров нет
  // как предмета, и регистрировать нечего. Спрашивается ПОВЕДЕНИЕ: сам бабл на
  // учёте и здесь, но у другого колбэка — отметки прочтения (:7305-7307).
  it('в обычном чате показ бабла регистрации не порождает', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const managers = managersWith([post(11)])
      bubbles = new ChatBubbles(chatContext(), managers)
      await openFeed(bubbles)
      await settle()

      intersect(bubbleOf(bubbles, 11))
      await vi.advanceTimersByTimeAsync(2000)

      expect(managers.registerViews).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ChatBubbles — счётчики поста двигаются кадром', () => {
  // tweb :2094-2124. Переписывается ОДИН узел, а не бабл: пересборка тела
  // перезапустила бы вложение (докблок `onMessageEdit`).
  it('messages_views переписывает ОБА узла .post-views', async () => {
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(11, { views: 9200 })]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    const nodes = () => Array.from(bubble.querySelectorAll('.post-views')).map((n) => n.textContent)
    // Время дублируется в `.time-inner` (tweb messageRender.ts:344-392).
    expect(nodes()).toEqual(['9.2K', '9.2K'])

    rootScope.dispatchEventSingle('messages_views', [{ peerId: CHAT, mid: 11, views: 12_000 }])
    await settle()

    expect(nodes()).toEqual(['12K', '12K'])
  })

  it('чужой чат в кадре просмотров игнорируется', async () => {
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([post(11, { views: 9200 })]))
    await openFeed(bubbles)
    await settle()

    rootScope.dispatchEventSingle('messages_views', [{ peerId: -999, mid: 11, views: 12_000 }])
    await settle()

    expect(bubbleOf(bubbles, 11).querySelector('.post-views')!.textContent).toBe('9.2K')
  })

  // tweb replies.ts:17-22 адресует футер по `data-post-key`, а не карте баблов:
  // у альбома футер один на группу и висит не под тем номером, что `data-mid`.
  it('replies_updated двигает число в футере, не пересобирая его', async () => {
    const message = post(11, { replies: commentThread(0) })
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const footer = bubbleOf(bubbles, 11).querySelector<HTMLElement>('.replies')!
    const before = footer.querySelector('.replies-footer-text')!.textContent

    rootScope.dispatchEventSingle('replies_updated', {
      storageKey: String(CHAT),
      peerId: CHAT,
      mid: 11,
      message: { ...message, replies: commentThread(3) } as MyMessage,
    })
    await settle()

    const after = bubbleOf(bubbles, 11).querySelector<HTMLElement>('.replies')!
    // Узел ТОТ ЖЕ — внутри футера живут аватарки комментаторов.
    expect(after).toBe(footer)
    expect(after.querySelector('.replies-footer-text')!.textContent).not.toBe(before)
    expect(after.querySelector('.replies-footer-text')!.textContent).toContain('3')
  })

  it('кадр чужого окна футер не трогает', async () => {
    const message = post(11, { replies: commentThread(0) })
    bubbles = new ChatBubbles(chatContext({ isBroadcast: true }), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const text = () => bubbleOf(bubbles!, 11).querySelector('.replies-footer-text')!.textContent
    const before = text()

    rootScope.dispatchEventSingle('replies_updated', {
      storageKey: `${CHAT}:5`,
      peerId: CHAT,
      mid: 11,
      message: { ...message, replies: commentThread(3) } as MyMessage,
    })
    await settle()

    expect(text()).toBe(before)
  })
})
