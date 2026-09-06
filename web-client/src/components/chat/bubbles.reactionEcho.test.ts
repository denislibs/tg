// Эхо своего клика по реакции НЕ пересобирает ряд реакций.
//
// Кадр реакции сервер шлёт всем членам чата, включая автора клика
// (backend/internal/usecase/chat/reaction.go), поэтому через 10–130 мс после
// оптимистичной дельты приходит абсолютный агрегат, описывающий ТО ЖЕ самое
// состояние. Пока слияние всегда возвращало новый объект, окно получало вторую
// операцию `patch`, а лента на неё пересобирает ряд целиком — и выбрасывает из
// документа узел чипа, вокруг которого В ЭТОТ МОМЕНТ летит эффект реакции
// (`components/wrappers/stickerAnimation.ts` снимает полёт по «узла нет в
// документе»). Отсюда и была жалоба «анимация то играет, то нет»: успеет ли
// `around.tgs` догрузиться до второго пересбора, решал кэш.
//
// Стенд намеренно СКВОЗНОЙ: клик идёт в НАСТОЯЩИЙ менеджер воркера, его
// операции применяются к зеркалу тем же `applyOpsToMirror`, которым их
// применяет вкладка (`workerCore` → `dispatch`), а считаются не вызовы функций,
// а ФАКТИЧЕСКИЕ пересборки — появления нового узла `.reactions` в документе.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOpsToMirror, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror } from '@core/chatFullCache'
import { makeRawMessage } from '@core/messages/testMessage'
import { newMessagesManager } from '@core/managers/messagesManager'
import { RT } from '@core/realtime/events'
import type { AvailableReaction } from '@core/managers/reactionsManager'
import type { MessageOp } from '@core/realtime/messageOps'
import type { MessageReactions, RawMessage } from '@core/models'
import type { RestClient } from '@core/net/restClient'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import wrapSticker from '@components/wrappers/sticker'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
const wrapStickerMock = vi.mocked(wrapSticker)

/** Личка: ключ диалога — ключ собеседника (положительный). */
const CHAT = 80
const ME = 7
const AUTHOR = 5
const CENTER_ID = 222
const SERVER_MID = 2

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

/** Чужая реакция на сообщении до клика. */
const foreign: MessageReactions = {
  _: 'messageReactions',
  results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
}

/** Тело КАДРА: абсолютный агрегат без пер-зрительской части (`pFlags.min`) —
 *  ровно то, что бэкенд рассылает всем членам чата после моего клика. */
const echoFrame = (count: number) => ({
  _: 'updateMessageReactions' as const,
  peer: { _: 'peerUser' as const, user_id: CHAT },
  msg_id: SERVER_MID,
  reactions: {
    _: 'messageReactions' as const,
    results: [{ _: 'reactionCount' as const, reaction: { _: 'reactionEmoji' as const, emoticon: '👍' }, count }],
    recent_reactions: [{
      _: 'messagePeerReaction' as const,
      peer_id: { _: 'peerUser' as const, user_id: ME },
      date: 0,
      reaction: { _: 'reactionEmoji' as const, emoticon: '👍' },
    }],
    pFlags: { min: true as const },
  },
})

async function settle() {
  for (let i = 0; i < 8; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined; document.body.replaceChildren() })

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  resetChatFullMirror()
  vi.clearAllMocks()
  wrapStickerMock.mockImplementation(() => {
    const player = Object.create(LottiePlayer.prototype) as LottiePlayer
    Object.assign(player, { canvas: [document.createElement('canvas')], onFirstFrame: () => {} })
    return { render: Promise.resolve(player), width: 40, height: 40, destroy: vi.fn() }
  })
})

/** Лента поверх НАСТОЯЩЕГО менеджера воркера: клик идёт в него, а его операции
 *  едут в зеркало тем же путём, что у вкладки. */
async function stand() {
  const wire = { ...makeRawMessage({ id: SERVER_MID, peerId: CHAT, fromId: AUTHOR, text: 'привет' }), reactions: foreign }
  const rest = {
    get: async () => ({ messages: [wire as RawMessage], count: 1 }),
    post: async () => ({}),
    del: async () => ({}),
  } as unknown as RestClient
  const mgr = newMessagesManager({
    rest,
    getMeId: () => ME,
    broadcast: (e, p) => { if (e === RT.messageOp) applyOpsToMirror((p as { ops: MessageOp[] }).ops) },
  })
  const page = await mgr.getHistory({ peerId: CHAT, offsetId: 0, addOffset: 0, limit: 40 })
  const messages = page.messages

  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async () => ({ messages, count: 1, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
      react: (peerId: number, msgId: number, emoji: string) => mgr.react(peerId, msgId, emoji),
      unreact: (peerId: number, msgId: number, emoji: string) => mgr.unreact(peerId, msgId, emoji),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
    reactions: {
      list: vi.fn(async (): Promise<AvailableReaction[]> => [{
        emoji: '👍', title: '', position: 0, premium: false, inactive: false, centerMediaId: CENTER_ID,
      } as AvailableReaction]),
    },
  }

  bubbles = new ChatBubbles(chatContext(), managers)
  await (await bubbles.setPeer())?.promise
  await settle()
  document.body.append(bubbles.container)

  // Пересборки СЧИТАЮТСЯ ПО ДОКУМЕНТУ: каждый новый узел `.reactions` — это
  // выброшенный старый со всеми чипами и летящими вокруг них эффектами.
  let rebuilds = 0
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('reactions')) ++rebuilds
      }
    }
  })
  observer.observe(bubbles.container, { childList: true, subtree: true })
  afterEach(() => observer.disconnect())

  return { mgr, container: bubbles.container, rebuilds: () => rebuilds }
}

const chipRow = (container: HTMLElement) => container.querySelector<HTMLElement>('.reactions')!
const chip = (container: HTMLElement) => container.querySelector<HTMLElement>('.reaction')!

describe('эхо своего клика по реакции', () => {
  it('после клика ряд пересобирается ОДИН раз, эхо второго пересбора не даёт', async () => {
    const { mgr, container, rebuilds } = await stand()

    chip(container).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    const afterClick = chipRow(container)
    const chipAfterClick = chip(container)
    expect(rebuilds()).toBe(1)
    // Клик применён оптимистично: чип стал моим и посчитал меня.
    expect(chipAfterClick.classList.contains('is-chosen')).toBe(true)
    expect(chipAfterClick.dataset.count).toBe('2')

    // Кадр от сервера — тем же путём, каким его применяет вкладка
    // (workerCore.dispatch: messages.cacheReaction → applyOpsToMirror).
    applyOpsToMirror(mgr.cacheReaction(echoFrame(2)))
    await settle()

    expect(rebuilds()).toBe(1)
    // Узел чипа тот же и ОСТАЁТСЯ В ДОКУМЕНТЕ — иначе эффект реакции снимает
    // сам себя по «узла нет в документе».
    expect(chipRow(container)).toBe(afterClick)
    expect(chip(container)).toBe(chipAfterClick)
    expect(chipAfterClick.isConnected).toBe(true)
  })

  it('кадр с ЧУЖИМ кликом ряд пересобирает — обновление не потеряно', async () => {
    const { mgr, container, rebuilds } = await stand()

    chip(container).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await settle()
    expect(rebuilds()).toBe(1)

    applyOpsToMirror(mgr.cacheReaction(echoFrame(3)))
    await settle()

    expect(rebuilds()).toBe(2)
    expect(chip(container).dataset.count).toBe('3')
    expect(chip(container).classList.contains('is-chosen')).toBe(true)
  })
})
