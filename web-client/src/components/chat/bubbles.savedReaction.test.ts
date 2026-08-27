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
//       попадает (tweb :4559-4568);
//   (5) позиция чата под фильтром НЕ сохраняется (tweb appImManager.ts:2125).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { clearChatPositions, getChatPosition } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import { makeMessage } from '@core/messages/testMessage'
import type { MessageReal, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const SAVED = 7

const chatContext = (): ChatContext => ({
  peerId: SAVED,
  messagesStorageKey: String(SAVED),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

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
  // Выдача поиска — от НОВОГО к старому (`ORDER BY m.seq DESC`), как у ручки.
  const searchMessages = vi.fn(async (_peerId: number, _q: string, opts: { offset?: number, limit?: number }) => ({
    messages: search.messages.slice().reverse().slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 20)),
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
  clearChatPositions()
  useSettingsStore.setState({ reduceMotion: true })
  rootScope.myId = 1
})

describe('ChatBubbles — фильтр «Избранного» по тегу-реакции', () => {
  it('тег перезапрашивает выдачу, а не отбирает из отрисованного', async () => {
    const managers = managersWith([msg(1), msg(2, '🔥'), msg(3)], { messages: [msg(2, '🔥')], count: 1 })
    bubbles = new ChatBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await settle()
    expect(renderedMids(bubbles)).toEqual([1, 2, 3])
    expect(managers.searchMessages).not.toHaveBeenCalled()

    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()

    // Выдача пришла ручкой поиска, а окно пересобрано целиком.
    expect(managers.searchMessages).toHaveBeenCalledWith(SAVED, '', expect.objectContaining({ reaction: '🔥', offset: 0 }))
    expect(renderedMids(bubbles)).toEqual([2])
  })

  it('снятие тега возвращает обычную историю', async () => {
    const managers = managersWith([msg(1), msg(2, '🔥'), msg(3)], { messages: [msg(2, '🔥')], count: 1 })
    bubbles = new ChatBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()
    expect(renderedMids(bubbles)).toEqual([2])

    await (await bubbles.setMessageId({ savedReaction: undefined }))?.promise
    await settle()

    expect(renderedMids(bubbles)).toEqual([1, 2, 3])
  })

  it('следующая страница фильтра берётся смещением', async () => {
    // Совпадений заведомо больше страницы — иначе верх сведётся первым же
    // ответом и листать станет нечего.
    const tagged = Array.from({ length: 100 }, (_, i) => msg(i + 1, '🔥'))
    const managers = managersWith([], { messages: tagged, count: 100 })
    bubbles = new ChatBubbles(chatContext(), managers)
    await (await bubbles.setPeer())?.promise
    await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
    await settle()

    // Вторую страницу лента берёт сама — предзагрузкой сразу за первой
    // (`getHistory1`, порт tweb :11346-11358), поэтому вызовов уже два.
    const calls = managers.searchMessages.mock.calls
    expect(calls.length).toBeGreaterThan(1)
    expect(calls[0][2].offset).toBe(0)

    const taken = (await managers.searchMessages.mock.results[0].value).messages.length
    expect(taken).toBeGreaterThan(0)
    // Смещение следующей страницы — ровно столько, сколько уже забрано.
    expect(calls[1][2].offset).toBe(taken)
  })

  it('входящее без тега в отфильтрованное окно не попадает, с тегом — попадает', async () => {
    const managers = managersWith([], { messages: [msg(1, '🔥')], count: 1 })
    bubbles = new ChatBubbles(chatContext(), managers)
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

  // Позиция сохраняется, только когда чат оставлен В СЕРЕДИНЕ истории, а
  // «середина» измеряется пикселями — в jsdom их нет. Виртуальная раскладка
  // (та же, что в `bubbles.firstLoad.test.ts`) даёт ленте высоты и прямоугольники.
  describe('позиция чата под фильтром', () => {
    const VIEWPORT_H = 500
    const BUBBLE_H = 100
    const rect = (top: number, height: number): DOMRect => ({
      top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top,
      toJSON: () => ({}),
    } as DOMRect)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    let current: ChatBubbles | undefined

    beforeEach(() => {
      HTMLElement.prototype.getBoundingClientRect = function(this: HTMLElement) {
        const container = current?.scrollable.container
        if(!container) return rect(0, 0)
        if(this === container) return rect(0, VIEWPORT_H)
        if(this.classList.contains('bubble')) {
          const all = Array.from(container.querySelectorAll('.bubble'))
          const idx = all.indexOf(this)
          return idx === -1 ? rect(0, 0) : rect(idx * BUBBLE_H - container.scrollTop, BUBBLE_H)
        }
        return rect(0, 0)
      }
    })
    afterEach(() => { HTMLElement.prototype.getBoundingClientRect = originalRect; current = undefined })

    const mount = (managers: BubblesManagers) => {
      const feed = new ChatBubbles(chatContext(), managers)
      const container = feed.scrollable.container
      let scrollTop = 0
      Object.defineProperty(container, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (v: number) => { scrollTop = Math.max(0, Math.min(v, container.scrollHeight - container.clientHeight)) },
      })
      Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => VIEWPORT_H })
      Object.defineProperty(container, 'offsetHeight', { configurable: true, get: () => VIEWPORT_H })
      Object.defineProperty(container, 'scrollHeight', {
        configurable: true,
        get: () => container.querySelectorAll('.bubble').length * BUBBLE_H,
      })
      current = feed
      return feed
    }

    const twelve = () => Array.from({ length: 12 }, (_, i) => msg(i + 1, '🔥'))

    it('без фильтра середина истории запоминается (контроль)', async () => {
      bubbles = mount(managersWith(twelve(), { messages: twelve(), count: 12 }))
      await (await bubbles.setPeer())?.promise
      await settle()

      bubbles.scrollable.container.scrollTop = 300
      bubbles.destroy()
      bubbles = undefined
      expect(getChatPosition(SAVED, undefined)?.top).toBe(300)
    })

    it('под фильтром — нет (tweb appImManager.ts:2125)', async () => {
      bubbles = mount(managersWith(twelve(), { messages: twelve(), count: 12 }))
      await (await bubbles.setPeer())?.promise
      await (await bubbles.setMessageId({ savedReaction: '🔥' }))?.promise
      await settle()

      bubbles.scrollable.container.scrollTop = 300
      bubbles.destroy()
      bubbles = undefined
      expect(getChatPosition(SAVED, undefined)).toBeUndefined()
    })
  })
})
