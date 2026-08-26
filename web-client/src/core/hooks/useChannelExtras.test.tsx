// src/core/hooks/useChannelExtras.test.tsx
//
// Канальная обвязка чата спрашивает у бэка счётчики комментариев и просмотров
// ДЛЯ ЗАГРУЖЕННЫХ ПОСТОВ — то есть ей нужны номера того окна, которое реально
// нарисовано. Окно она берёт из ЗЕРКАЛА (`core/history/messagesMirror.ts`), а не
// из zustand-копии React-ленты: копия уходит вместе с лентой (этап 7), а под
// флагом `VITE_VANILLA_FEED` живая лента (`chat/bubbles.ts`) её вообще не
// заводит — счётчики молча перестали бы запрашиваться.
//
// Ответ `channels.viewCounts` в окно кладёт не этот хук, а владелец
// (`messages.cacheViews` → операция `rt:message_op`); здесь пинится ровно вход:
// какие номера уезжают в запрос и когда запрос повторяется.
import { renderHook, act, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { useChannelExtras } from './useChannelExtras'
import { ManagersProvider } from './useManagers'
import { applyOpsToMirror, putMirrorPage, resetMessagesMirror, winKey } from '../history/messagesMirror'
import { makeMessage } from '../messages/testMessage'
import type { MyMessage } from '../models'

const CHANNEL = -100
const KEY = winKey(CHANNEL)

const post = (id: number): MyMessage =>
  makeMessage({ id, peerId: CHANNEL, text: `post ${id}`, date: 1_750_000_000 + id })

let commentCalls: number[][]
let viewCalls: number[][]
let subscribed: number[]
let unsubscribed: number[]

// Ссылка на менеджеров ДОЛЖНА быть стабильной: она в зависимостях эффектов
// (как и в бою — `useManagers` отдаёт один объект на приложение).
const managers = {
  realtime: {
    subscribeChannel: async ({ peerId }: { peerId: number }) => { subscribed.push(peerId) },
    unsubscribeChannel: async ({ peerId }: { peerId: number }) => { unsubscribed.push(peerId) },
  },
  channels: {
    commentCounts: async (_peerId: number, ids: number[]) => {
      commentCalls.push(ids)
      return { counts: { [ids[0]]: 3 }, recent: {} }
    },
    viewCounts: async (_peerId: number, ids: number[]) => { viewCalls.push(ids) },
  },
}

function mount(over: { discussionsEnabled?: boolean; isChannel?: boolean } = {}) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: managers as never, children })
  return renderHook(
    () => useChannelExtras({
      isRealChat: true,
      isChannel: over.isChannel ?? true,
      numericChatId: CHANNEL,
      windowKey: KEY,
      discussionsEnabled: over.discussionsEnabled ?? true,
    }),
    { wrapper },
  )
}

beforeEach(() => {
  resetMessagesMirror()
  commentCalls = []
  viewCalls = []
  subscribed = []
  unsubscribed = []
  vi.useFakeTimers()
})

afterEach(() => {
  // Автоочистки в прогоне нет (`globals` выключены) — размонтируем сами, иначе
  // хук предыдущего теста доживает до следующего и стреляет его таймерами.
  cleanup()
  vi.useRealTimers()
  resetMessagesMirror()
})

/** Дебаунс запросов — 300 мс от изменения окна. */
const runDebounce = async () => { await act(async () => { vi.advanceTimersByTime(400) }) }

describe('useChannelExtras — номера постов берутся из зеркала окон', () => {
  it('счётчики комментариев и просмотров запрашиваются для постов зеркала', async () => {
    putMirrorPage(KEY, [post(1), post(2)])
    const { result } = mount()
    await runDebounce()
    expect(commentCalls).toEqual([[1, 2]])
    expect(viewCalls).toEqual([[1, 2]])
    // Ответ ручки доехал до состояния хука (фейковые таймеры + промисы: даём
    // очереди микрозадач один прогон).
    await act(async () => { await Promise.resolve() })
    expect(result.current.commentCounts.get(1)).toBe(3)
  })

  it('новый пост в зеркале перезапрашивает оба счётчика', async () => {
    putMirrorPage(KEY, [post(1)])
    mount()
    await runDebounce()
    expect(commentCalls).toEqual([[1]])

    await act(async () => { applyOpsToMirror([{ op: 'insert', key: KEY, msg: post(2) }]) })
    await runDebounce()
    expect(commentCalls).toEqual([[1], [1, 2]])
    expect(viewCalls).toEqual([[1], [1, 2]])
  })

  it('пустое окно зеркала запросов не порождает', async () => {
    mount()
    await runDebounce()
    expect(commentCalls).toEqual([])
    expect(viewCalls).toEqual([])
  })

  it('без обсуждений комментарии не запрашиваются, а просмотры — да', async () => {
    putMirrorPage(KEY, [post(1)])
    mount({ discussionsEnabled: false })
    await runDebounce()
    expect(commentCalls).toEqual([])
    expect(viewCalls).toEqual([[1]])
  })

  it('подписка на канал ставится и снимается', async () => {
    putMirrorPage(KEY, [post(1)])
    const { unmount } = mount()
    await runDebounce()
    expect(subscribed).toEqual([CHANNEL])
    unmount()
    expect(unsubscribed).toEqual([CHANNEL])
  })
})
