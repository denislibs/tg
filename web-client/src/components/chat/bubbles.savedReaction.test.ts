// Фильтр «Избранного» по тегу-реакции — порт `savedReaction` как КЛЮЧА ПОИСКА
// (tweb chat.ts:73-74 `CHAT_SEARCH_KEYS`, :1092-1099 `sameSearch`,
// bubbles.ts:4558-4568 фильтр входящего).
//
// Пины ровно на то, чем этот порт отличается от снесённой React-выборки
// («отобрать из уже загруженного окна»):
//   (1) тег ЗАПРАШИВАЕТ выдачу заново — уходит `messages.searchMessages`, окно
//       пересобирается, прежние баблы не остаются;
//   (2) снятие тега возвращает обычную историю тем же путём;
//   (3) следующая страница фильтра берётся СМЕЩЕНИЕМ (наша ручка не умеет
//       `offset_id`, см. `ChatBubbles.savedReactionOffset`);
//   (4) входящее без тега в отфильтрованное окно не попадает, с тегом —
//       попадает (tweb :4559-4568).
// Гейт сохранения позиции под фильтром (tweb appImManager.ts:2125) — у
// `appImManager.saveChatPosition`, его пины в `lib/appImManager.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { useSettingsStore } from '@/settings'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReal, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

const SAVED = 7

const chatContext = () => createTestChat({ peerId: SAVED })

/** Сообщение «Избранного»; `tag` — эмодзи моей реакции на нём. */
function msg(id: number, tag?: string): MessageReal {
  const m = makeMessage({ peerId: SAVED, fromId: 1, id, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z', out: true })
  if(!tag) return m
  return {
    ...m,
    reactions: {
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: tag }, count: 1, chosen_order: 0 }],
    },
  }
}

function managersWith(history: MyMessage[], search: { messages: MyMessage[], count: number }) {
  const getHistory = vi.fn(async (): Promise<HistoryResult> =>
    ({ messages: history, count: history.length, reachedTop: true, reachedBottom: true }))
  // Выдача поиска — от НОВОГО к старому (`ORDER BY m.seq DESC`), строго ниже
  // курсора `offsetId`, как у ручки: смещения она не знает.
  const searchMessages = vi.fn(async (_peerId: number, _q: string, opts: { offsetId?: number, limit?: number }) => ({
    messages: search.messages.slice().reverse()
      .filter((m) => !opts.offsetId || m.id < opts.offsetId)
      .slice(0, opts.limit ?? 20),
    count: search.count,
  }))
  const managers: BubblesManagers = {
    messages: {
      getHistory,
      getAround: vi.fn(async () => ({ messages: history, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
      searchMessages,
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: {
      getReadMaxSeqIfUnread: vi.fn(async () => 0),
      // НАСТОЯЩИЙ последний номер чата, а не ноль: без него `setPeer` не доходит
      // до кэш-ветки (`samePeer && sameSearch`), и тест перестаёт видеть, что
      // именно `sameSearch` заставляет ленту пересобрать окно.
      getHistoryMaxSeq: vi.fn(async () => (history.length ? Math.max(...history.map((m) => m.id)) : 0)),
      getDialogReadState: vi.fn(async () => undefined),
    },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
  }
  return Object.assign(managers, { getHistory, searchMessages })
}

async function settle() {
  for(let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const renderedMids = (feed: ChatBubbles) =>
  Array.from(feed.chatInner.querySelectorAll<HTMLElement>('.bubble[data-mid]:not(.service)'))
    .map((b) => Number(b.dataset.mid))
    .sort((a, b) => a - b)

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  rootScope.myId = 1
})

describe('ChatBubbles — фильтр «Избранного» по тегу-реакции', () => {
  it('тег перезапрашивает выдачу, а не отбирает из отрисованного', async () => {
    const managers = managersWith([msg(1), msg(2, '🔥'), msg(3)], { messages: [msg(2, '🔥')], count: 1 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await settle()
    expect(renderedMids(bubbles)).toEqual([1, 2, 3])
    expect(managers.searchMessages).not.toHaveBeenCalled()

    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()

    // Выдача пришла ручкой поиска, а окно пересобрано целиком.
    expect(managers.searchMessages).toHaveBeenCalledWith(SAVED, '', expect.objectContaining({ reaction: '🔥', offsetId: 0 }))
    expect(renderedMids(bubbles)).toEqual([2])
  })

  it('снятие тега возвращает обычную историю', async () => {
    const managers = managersWith([msg(1), msg(2, '🔥'), msg(3)], { messages: [msg(2, '🔥')], count: 1 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()
    expect(renderedMids(bubbles)).toEqual([2])

    await (await bubbles.setMessageId({ savedReaction: undefined }))?.promise
    await settle()

    expect(renderedMids(bubbles)).toEqual([1, 2, 3])
  })

  it('следующая страница фильтра берётся курсором от верхнего отрисованного', async () => {
    // Совпадений заведомо больше страницы — иначе верх сведётся первым же
    // ответом и листать станет нечего.
    const tagged = Array.from({ length: 100 }, (_, i) => msg(i + 1, '🔥'))
    const managers = managersWith([], { messages: tagged, count: 100 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()

    // Вторую страницу лента берёт сама — предзагрузкой сразу за первой
    // (`getHistory1`, порт tweb :11346-11358), поэтому вызовов уже два.
    const calls = managers.searchMessages.mock.calls
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0][2].offsetId).toBe(0)

    const first = (await managers.searchMessages.mock.results[0].value).messages as MyMessage[]
    expect(first.length).toBeGreaterThan(0)
    // Курсор следующей страницы — САМОЕ СТАРОЕ отрисованное (`maxId`, как у
    // обычной истории: `requestHistory` оригинала под `savedReaction` уходит
    // в `messages.search` с тем же `offset_id`, appMessagesManager.ts:9970-9984).
    expect(calls[1][2].offsetId).toBe(Math.min(...first.map((m) => m.id)))

    // Предзагрузка (`justLoad`) не сдвигает окно: следующая НАСТОЯЩАЯ
    // страница просит то же самое, а не перескакивает через непоказанное —
    // отрисованное остаётся сплошным отрезком от самого нового.
    bubbles.loadMoreHistory(true)
    await settle()
    const rendered = renderedMids(bubbles)
    expect(rendered.length).toBeGreaterThan(first.length)
    expect(rendered).toEqual(Array.from({ length: rendered.length }, (_, i) => 100 - rendered.length + 1 + i))
  })

  it('входящее без тега в отфильтрованное окно не попадает, с тегом — попадает', async () => {
    const managers = managersWith([], { messages: [msg(1, '🔥')], count: 1 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()
    expect(renderedMids(bubbles)).toEqual([1])

    rootScope.dispatchEventSingle('history_append', { storageKey: String(SAVED), message: msg(2) })
    await settle()
    expect(renderedMids(bubbles)).toEqual([1])

    rootScope.dispatchEventSingle('history_append', { storageKey: String(SAVED), message: msg(3, '🔥') })
    await settle()
    expect(renderedMids(bubbles)).toEqual([1, 3])
  })
})
