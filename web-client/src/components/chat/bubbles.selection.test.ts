// Режим выделения В ЛЕНТЕ — стыковка `bubbles.ts` с портом `selection.ts`.
//
// Сам режим покрыт своими тестами (`selection.test.ts`, 25 штук: drag,
// `getElementsBetween`, чекбоксы, альбомы); здесь проверяется то, чего они
// видеть не могут — что `chat.selection` (его создаёт `Chat.init`, tweb
// chat.ts:620) видит баблы ленты, а лента пропускает через него клики в том
// порядке, который требует оригинал.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { useSettingsStore } from '@/settings'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'
import ChatSelection from './selection'

/** Открыть окно ленты и дождаться ОТРИСОВКИ. `setPeer` (как в оригинале)
 *  возвращает управление, едва отправив запрос: рендер и доводка живут во
 *  ВТОРОМ промисе результата — `{cached, promise}`, и ждёт его `Chat.setPeer`
 *  (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 92

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    // Прыжок к сообщению и календарь этот файл не проверяет, но обе ручки
    // обязательны в `BubblesManagers`: лента умеет и то и другое всегда.
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  // Ручка отметки прочтения: наблюдатель непрочитанных живёт в самой ленте
  // (порт tweb bubbles.ts:2941-3012), поэтому она обязательна у КАЖДОГО стенда.
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const msg = (id: number) =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'привет', createdAt: '2026-08-15T12:34:00' })

let bubbles: ChatBubbles | undefined
afterEach(() => {
  bubbles?.destroy()
  bubbles?.container.remove()
  bubbles = undefined
})
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  // Файл про режим выделения, а не про «лестницу» первой загрузки: под ней
  // лента держит шину тяжёлых анимаций и не рисует догруженную страницу
  // (tweb bubbles.ts:10436-10440). Гейт тот же, что в оригинале
  // (`liteMode.isAvailable('animations')`, tweb bubbles.ts:11540).
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
})

/** Лента с настоящим режимом выделения — в порядке `Chat.init`. */
async function feedWithSelection(messages: MyMessage[]) {
  const chat = createTestChat({ peerId: CHAT })
  const feed = mountTestBubbles(chat, managersWith(messages))
  bubbles = feed
  await openFeed(feed)
  await settle()
  document.body.append(feed.container)
  return { feed, selection: chat.selection }
}

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

/**
 * Клик ЧЕЛОВЕКА. `isTrusted` доводится руками, потому что jsdom помечает любое
 * синтетическое событие как недоверенное, а ветка выделения оригинала
 * (tweb :3156) на `isTrusted` гейтится — иначе автоклик аудио-элемента
 * переключал бы выбор.
 */
const click = (node: HTMLElement) => {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'isTrusted', { value: true })
  node.dispatchEvent(e)
}

/** Клик НЕ от человека — таким autoplay аудио-элемента дёргает свой узел. */
const untrustedClick = (node: HTMLElement) =>
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('ChatBubbles — режим выделения', () => {
  it('выделение `Chat` видит баблы ленты', async () => {
    const { feed, selection } = await feedWithSelection([msg(1)])

    expect(selection).toBeInstanceOf(ChatSelection)
    // Порт ленты рабочий: выделение видит отрисованную историю.
    expect(selection.canSelectBubble(bubbleOf(feed, 1))).toBe(true)
  })

  it('клик по времени включает выделение — tweb :3118-3121', async () => {
    const { feed, selection } = await feedWithSelection([msg(1)])

    click(bubbleOf(feed, 1).querySelector<HTMLElement>('.time')!)

    expect(selection.isSelecting).toBe(true)
    expect(selection.getSelectedMids()).toEqual([1])
  })

  it('в режиме выделения клик по баблу тогглит выбор — tweb :3156-3172', async () => {
    const { feed, selection } = await feedWithSelection([msg(1), msg(2)])
    click(bubbleOf(feed, 1).querySelector<HTMLElement>('.time')!)

    click(bubbleOf(feed, 2))
    expect(selection.getSelectedMids()).toEqual([1, 2])

    click(bubbleOf(feed, 2))
    expect(selection.getSelectedMids()).toEqual([1])
  })

  it('в режиме выделения клик по вложению НЕ открывает вьювер', async () => {
    // Ветка выделения у оригинала стоит ВЫШЕ медиа (:3156 против :3479) и
    // перебивает её — иначе выбор картинки открывал бы просмотр.
    const { feed, selection } = await feedWithSelection([msg(1), msg(2)])
    click(bubbleOf(feed, 1).querySelector<HTMLElement>('.time')!)

    const opened = vi.spyOn(feed as unknown as { openMediaViewerFor: () => boolean }, 'openMediaViewerFor')
    const attachment = document.createElement('div')
    attachment.classList.add('attachment')
    bubbleOf(feed, 2).append(attachment)

    click(attachment)

    // Вьювер не открылся, а клик достался выбору — как у оригинала.
    expect(opened).not.toHaveBeenCalled()
    expect(selection.getSelectedMids()).toEqual([1, 2])
  })

  it('НЕдоверенный клик выбор не трогает — tweb :3156 «due to audio autoclick»', async () => {
    const { feed, selection } = await feedWithSelection([msg(1), msg(2)])
    click(bubbleOf(feed, 1).querySelector<HTMLElement>('.time')!)

    untrustedClick(bubbleOf(feed, 2))

    expect(selection.getSelectedMids()).toEqual([1])
  })

  it('страница, догруженная В РЕЖИМЕ выделения, приезжает с чекбоксами', async () => {
    // tweb bubbles.ts:5931-5935. Без этого подгруженные сверху баблы стояли бы
    // без чекбокса и выбрать их было бы нечем.
    const { feed } = await feedWithSelection([msg(2)])
    click(bubbleOf(feed, 2).querySelector<HTMLElement>('.time')!)

    rootScope.dispatchEventSingle('history_append', { storageKey: String(CHAT), message: msg(3) })
    await settle()

    expect(bubbleOf(feed, 3).querySelector('.bubble-select-checkbox')).not.toBeNull()
  })
})
