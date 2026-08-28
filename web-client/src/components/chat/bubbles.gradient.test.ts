// src/components/chat/bubbles.gradient.test.ts
//
// СДВИГ ГРАДИЕНТА ОБОЕВ вместе с прокруткой к своему только что отправленному
// сообщению — порт tweb `ChatBubbles.updateGradient` (bubbles.ts:652 поле,
// :1862-1864 взвод в `history_append`, :4710-4714 трата в `startCallback`
// прокрутки, :4960 сброс на смене окна).
//
// Регрессия, ради которой это писалось (сообщено с экрана: «много нажимаешь —
// фон сам меняется»): `toNextPosition()` БЕЗ аргумента уходит в ветку
// самоанимации (`core/chat/gradientRenderer.ts:258-288`), и фон едет сам по
// себе. Контракт оригинала: сдвиг ровно один, ровно на длину прокрутки —
// значит обязательно с `dimensions.getProgress`.
//
// `scrollIntoViewNew` подменён НЕ ради «пропустить скролл», а чтобы позвать
// `startCallback` детерминированно: настоящий `fastSmoothScroll` зовёт его
// только при ненулевых `duration && path` (fastSmoothScroll.ts:336), а
// happy-dom раскладки не считает. Сам `getProgress` — вендорный код
// прокрутки, он проверяется у себя.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { clearChatPositions } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import { setActiveGradientRenderer } from '@core/chat/activeGradient'
import type ChatBackgroundGradientRenderer from '@core/chat/gradientRenderer'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type { ScrollStartCallbackDimensions } from '@helpers/fastSmoothScroll'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = 60
const ME = 1

const toNextPosition = vi.fn()

const msg = (id: number, fromId: number): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId, text: `m${id}`, createdAt: '2026-08-20T10:00:00Z', out: fromId === ME })

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

const chatContext = (): ChatContext => {
  const container = document.createElement('div')
  container.classList.add('chat')
  return {
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container,
    bubblesViewport: document.createElement('div'),
  }
}

/** Прокрутка, которой хватает только на одно: позвать `startCallback`. */
const dimensions = (): ScrollStartCallbackDimensions => ({
  scrollSize: 900, scrollPosition: 300, distanceToEnd: 100, path: 100, duration: 200,
  containerRect: {} as DOMRect, elementRect: {} as DOMRect,
  getProgress: () => 0.5,
})

/** Подменить прокрутку её `startCallback`-ом — см. шапку файла. */
function catchStartCallback(b: ChatBubbles) {
  return vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockImplementation(async (options) => {
    options.startCallback?.(dimensions())
  })
}

async function settle(times = 5) {
  for (let i = 0; i < times; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  rootScope.myId = ME
  toNextPosition.mockClear()
  setActiveGradientRenderer({ toNextPosition } as unknown as ChatBackgroundGradientRenderer)
  // Открытие чата — БЕЗ «лестницы»: она тут не проверяется, а объявляет себя
  // тяжёлой анимацией на всю длительность. Гейт градиента поднимаем обратно
  // сразу после открытия, в самих кейсах.
  useSettingsStore.setState({ reduceMotion: true })
})

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
  setActiveGradientRenderer(undefined)
  useSettingsStore.setState({ reduceMotion: false })
})

async function openFeed(messages: MyMessage[]) {
  const b = new ChatBubbles(chatContext(), managersWith(messages))
  bubbles = b
  await (await b.setPeer())?.promise
  await settle()
  useSettingsStore.setState({ reduceMotion: false })
  return b
}

/** Отправка своего сообщения (tweb `beforeMessageSending` →
 *  `history_append`, appMessagesManager.ts:2792). */
function append(id: number, fromId: number) {
  rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg(id, fromId) })
}

describe('ChatBubbles — сдвиг градиента обоев (tweb updateGradient)', () => {
  it('своё отправленное: прокрутка к нему двигает градиент РОВНО раз и с getProgress', async () => {
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    const spy = catchStartCallback(b)

    append(3, ME)
    await settle()

    expect(spy).toHaveBeenCalled()
    expect(toNextPosition).toHaveBeenCalledTimes(1)
    // Аргумент — ФУНКЦИЯ прогресса той самой прокрутки: без неё рендерер уходит
    // в самоанимацию (gradientRenderer.ts:258-288).
    const getProgress = toNextPosition.mock.calls[0][0] as () => number
    expect(typeof getProgress).toBe('function')
    expect(getProgress()).toBe(0.5)
  })

  it('флаг ОДНОРАЗОВЫЙ: вторая прокрутка без новой отправки градиент не двигает', async () => {
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    catchStartCallback(b)

    append(3, ME)
    await settle()
    expect(toNextPosition).toHaveBeenCalledTimes(1)

    await b.scrollToEnd()
    expect(toNextPosition).toHaveBeenCalledTimes(1)
  })

  it('чужое входящее градиент НЕ двигает', async () => {
    // У tweb это выражено выбором события: входящее приезжает
    // `history_multiappend` (bubbles.ts:1897), который флага не ставит. У нас
    // событие одно на оба случая, поэтому «моё ли» спрашивается в обработчике.
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    catchStartCallback(b)

    append(3, 2)
    await settle()

    expect(toNextPosition).not.toHaveBeenCalled()
  })

  it('«без анимаций» (liteMode chat_background) — сдвига нет', async () => {
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    catchStartCallback(b)
    useSettingsStore.setState({ reduceMotion: true })

    append(3, ME)
    await settle()

    expect(toNextPosition).not.toHaveBeenCalled()
  })

  it('обои без градиента (своё фото/цвет): отправка не падает, двигать нечего', async () => {
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    setActiveGradientRenderer(undefined)
    catchStartCallback(b)

    append(3, ME)
    await settle()

    expect(toNextPosition).not.toHaveBeenCalled()
  })

  it('невостребованный сдвиг не переживает пересборку окна (tweb :4960)', async () => {
    const b = await openFeed([msg(1, 2), msg(2, ME)])
    // Прокрутки нет — флаг взведён и ждёт (в оригинале он дождался бы
    // СЛЕДУЮЩЕЙ прокрутки).
    const spy = vi.spyOn(b.scrollable, 'scrollIntoViewNew').mockResolvedValue(undefined)
    append(3, ME)
    await settle()
    expect(toNextPosition).not.toHaveBeenCalled()

    // Окно пересобрано целиком — вместе с ним уходит и долг по градиенту.
    await (await b.setPeer())?.promise
    await settle()
    spy.mockRestore()
    catchStartCallback(b)

    await b.scrollToEnd()
    expect(toNextPosition).not.toHaveBeenCalled()
  })
})
