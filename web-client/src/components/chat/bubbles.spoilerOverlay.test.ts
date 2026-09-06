// Оверлей спойлеров В ЛЕНТЕ — порт tweb `addMessageSpoilerOverlay`
// (bubbles.ts:9781-9799) и его вызова в конце сборки бабла (:9770).
//
// Дефект, ради которого эти пины: механизм частиц был портирован целиком, но
// лента узел оверлея не вставляла вовсе — и текстовый спойлер оставался
// сплошной серой плашкой (правило `styles/tweb/_spoiler.scss:60` снимает
// заливку только при живом `.message-spoiler-overlay`).
//
// Проверяется ПОВЕДЕНИЕ, а не форма вызова: узел появляется там и только там,
// где есть спойлерное слово; симуляция получает задачу; правка бабла оверлей не
// теряет; гасят его и снятие бабла, и смерть окна целиком — пересборка
// (`cleanup`) и снос ленты (`destroy`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageEntity, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type { Middleware } from '@helpers/middleware'

const spies = vi.hoisted(() => ({
  attachTextSpoilerOverlay: vi.fn(),
  attachTextSpoilerTarget: vi.fn(),
  attachBluffTextSpoilerTarget: vi.fn(),
  create: vi.fn(),
  getImageSpoilerByElement: vi.fn(),
}))

/** Что лента отдала симуляции: middleware задачи и присланная геометрия. */
const tasks = vi.hoisted(() => ({
  middlewares: [] as Middleware[],
  rects: [] as unknown[][],
}))

spies.attachTextSpoilerOverlay.mockImplementation(({ middleware }: { middleware: Middleware }) => {
  tasks.middlewares.push(middleware)
  return {
    animation: { paused: false },
    dpr: 1,
    overlay: {
      update: ({ rects }: { rects: unknown[] }) => { tasks.rects.push(rects) },
      unwrap: () => {}, wrap: () => {}, reset: () => {}, clear: () => {},
    },
  }
})
vi.mock('@components/dotRenderer', () => ({ default: spies }))

vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => true,
}))

const ChatBubbles = (await import('./bubbles')).default
type BubblesManagers = import('./bubbles').BubblesManagers
type ChatContext = import('./bubbles').ChatContext

const CHAT = 90
const SPOILER: MessageEntity[] = [{ _: 'messageEntitySpoiler', offset: 0, length: 6 }]

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
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
})

const msg = (id: number, entities?: MessageEntity[]): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'secret rest', entities, createdAt: '2026-08-15T12:34:00' }) as MyMessage

async function openFeed(feed: InstanceType<typeof ChatBubbles>) {
  await (await feed.setPeer())?.promise
}

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

// Геометрия: happy-dom не считает боксы, а без них оверлей не смерит ни одного
// слова. Бокс есть только у самого оверлея — как у растянутого на тело узла.
const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
}) as DOMRect
const OVERLAY_BOX = rect(0, 0, 200, 26)
const isOverlay = (el: HTMLElement) => el.classList.contains('message-spoiler-overlay')
HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLElement) {
  return isOverlay(this) ? OVERLAY_BOX : rect(0, 0, 0, 0)
}
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  get(this: HTMLElement) { return isOverlay(this) ? OVERLAY_BOX.width : 0 },
  configurable: true,
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  get(this: HTMLElement) { return isOverlay(this) ? OVERLAY_BOX.height : 0 },
  configurable: true,
})
const SPAN_RECT = rect(10, 4, 60, 18)
Element.prototype.getClientRects = function getClientRects(this: Element) {
  return (this.classList.contains('spoiler-text') ? [SPAN_RECT] : []) as unknown as DOMRectList
}

let bubbles: InstanceType<typeof ChatBubbles> | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  tasks.middlewares.length = 0
  tasks.rects.length = 0
  spies.attachTextSpoilerOverlay.mockClear()
})

const messageDivOf = (feed: InstanceType<typeof ChatBubbles>, mid: number) =>
  feed.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"] .message`)!

describe('ChatBubbles — оверлей спойлеров', () => {
  it('у сообщения СО спойлером лента вешает оверлей в тело сообщения', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    const messageDiv = messageDivOf(bubbles, 1)
    expect(messageDiv.querySelector('.spoiler-text')).not.toBeNull()
    expect(messageDiv.querySelector(':scope > .message-spoiler-overlay')).not.toBeNull()
  })

  it('у сообщения БЕЗ спойлера оверлея нет, и симуляцию никто не поднимает', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1)]))
    await openFeed(bubbles)
    await settle()

    expect(messageDivOf(bubbles, 1).querySelector('.message-spoiler-overlay')).toBeNull()
    expect(spies.attachTextSpoilerOverlay).not.toHaveBeenCalled()
  })

  it('симуляция получает ЗАДАЧУ — прямоугольники спойлерных слов', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    expect(spies.attachTextSpoilerOverlay).toHaveBeenCalledTimes(1)
    expect(tasks.rects[tasks.rects.length - 1]).toEqual([{ left: 10, top: 4, width: 61, height: 19 }])
  })

  // Правка пересобирает тело (`renderMessageContent`) и уносит прежний оверлей;
  // в tweb вопроса нет — там правка пересоздаёт бабл целиком (:6338).
  it('правка сообщения оверлей не теряет', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    const edited = msg(1, SPOILER)
    rootScope.dispatchEventSingle('message_edit', {
      storageKey: String(CHAT), peerId: CHAT, mid: 1, message: edited,
    })
    await settle()

    expect(messageDivOf(bubbles, 1).querySelectorAll('.message-spoiler-overlay')).toHaveLength(1)
  })

  // tweb гасит оверлей побабльным middleware (:4408/:4416); у нас его нет,
  // поэтому лента снимает оверлей адресно — см. `spoilerOverlays`.
  it('снятие бабла гасит оверлей: задача симуляции протухает', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    const middleware = tasks.middlewares[tasks.middlewares.length - 1]
    expect(middleware()).toBe(true)

    bubbles.deleteMessagesByIds([`${CHAT}_1`])
    await settle()

    expect(middleware()).toBe(false)
  })

  // Окно уходит целиком: баблы прошлого окна снимает не `deleteMessagesByIds`,
  // а подмена `chatInner` внутри `setPeer` — оверлеи гасит слив карты
  // (`disposeSpoilerOverlays`).
  it('пересборка окна гасит оверлеи прошлого окна', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    const middleware = tasks.middlewares[tasks.middlewares.length - 1]
    expect(middleware()).toBe(true)

    await openFeed(bubbles)
    await settle()

    expect(middleware()).toBe(false)
  })

  // Смена собеседника у нас — снос инстанса ленты хостом (`VanillaFeed`), а
  // `destroy` через `cleanup` НЕ проходит: слив карты нужен и здесь.
  it('снос ленты гасит оверлеи', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([msg(1, SPOILER)]))
    await openFeed(bubbles)
    await settle()

    const middleware = tasks.middlewares[tasks.middlewares.length - 1]
    expect(middleware()).toBe(true)

    bubbles.destroy()
    bubbles = undefined

    expect(middleware()).toBe(false)
  })
})
