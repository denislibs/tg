// Пин ПРОВОДКИ в workerCore.ts: счётчики поста канала (`views_update`,
// `replies_update`) применяет ВЛАДЕЛЕЦ окна — `messages.cacheViews` /
// `messages.cacheReplies`, — а не витрина из сырого кадра.
//
// Почему строки вообще нужны. Оба числа живут ВНУТРИ сообщения (`views`,
// `replies.replies`), поэтому единственная законная точка их записи — окно.
// Без реестровых строк `messages.cacheViews` не звался бы ниоткуда (ровно так и
// было после снятия опроса `/view_counts`), а `cacheReplies` не существовал бы
// вовсе: счётчики поста приезжали бы только с историей и застывали до
// перезагрузки — это и есть задача #81.
//
// Здесь же пинится ГРАНИЦА ПРОСТРАНСТВ: кадр несёт `channel_id` числом и `id` в
// серверном пространстве номеров, а владелец окна знает пир ключом и номер —
// клиентским. Перепутанная граница — молчаливый промах по чужому сообщению.
//
// Приём — тот же, что в workerCore.geoLiveFrame.test.ts: частичный vi.mock
// connectionManager ради перехвата onFrame и частичный vi.mock messagesManager
// (сама механика патча покрыта у владельца —
// client/realtime/storeProjection.windowWriters.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

const cacheViews = vi.fn()
const cacheReplies = vi.fn()
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: Parameters<typeof actual.newMessagesManager>[0]) => ({
      ...actual.newMessagesManager(deps),
      cacheViews,
      cacheReplies,
    }),
  }
})

type ChannelDeps = Parameters<typeof import('./managers/channelsManager').newChannelsManager>[0]
let capturedChannelDeps: ChannelDeps | null = null
vi.mock('./managers/channelsManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/channelsManager')>()
  return {
    ...actual,
    newChannelsManager: (deps: ChannelDeps) => { capturedChannelDeps = deps; return actual.newChannelsManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { generateMessageId } from './history/messageId'
import type { Endpoint } from '../rpc/superMessagePort'

function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

function boot() {
  const core = createWorkerCore()
  const [epWorker] = pair()
  core.bind(epWorker)
  expect(capturedConnDeps).not.toBeNull()
}

const CHANNEL = 42
const SEQ = 7

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  capturedChannelDeps = null
  cacheViews.mockClear()
  cacheReplies.mockClear()
})

describe('createWorkerCore(): счётчики поста канала применяет владелец окна', () => {
  it('views_update → cacheViews с КЛЮЧОМ канала и КЛИЕНТСКИМ номером', () => {
    boot()

    capturedConnDeps!.onFrame('views_update', {
      _: 'updateChannelMessageViews', channel_id: CHANNEL, id: SEQ, views: 12,
    })

    expect(cacheViews).toHaveBeenCalledWith(-CHANNEL, new Map([[generateMessageId(SEQ), 12]]))
  })

  it('replies_update → cacheReplies с тем же переводом границ', () => {
    boot()

    capturedConnDeps!.onFrame('replies_update', {
      _: 'updateChannelMessageReplies', channel_id: CHANNEL, id: SEQ, replies: 3,
    })

    expect(cacheReplies).toHaveBeenCalledWith(-CHANNEL, generateMessageId(SEQ), 3)
  })

  // РЕГИСТРАЦИЯ просмотра (ответ ручки `POST /channels/{id}/views`) применяется
  // ТЕМ ЖЕ владельцем, что и кадр, — иначе свой собственный просмотр доезжал бы
  // до ленты только перезагрузкой. Зависимость объявляется здесь, у вызывателя;
  // сам ответ разбирает `channelsManager.registerViews` (его тест — рядом).
  it('регистрация просмотра ведёт к тому же messages.cacheViews', () => {
    boot()
    expect(capturedChannelDeps).not.toBeNull()

    const views = new Map([[generateMessageId(SEQ), 12]])
    capturedChannelDeps!.cacheViews(-CHANNEL, views)

    expect(cacheViews).toHaveBeenCalledWith(-CHANNEL, views)
  })

  // Курсора у обоих кадров нет вовсе — воронка их не гейтит и не придерживает
  // (`globalFunnel.applyUpdate`: «курсора нет — транслируем как есть»). Пин на
  // это: кадр без `pts` доезжает до владельца, а не оседает в буфере разрывов.
  it('кадр без курсора не гейтится воронкой', () => {
    boot()

    capturedConnDeps!.onFrame('views_update', {
      _: 'updateChannelMessageViews', channel_id: CHANNEL, id: SEQ, views: 1,
    })
    capturedConnDeps!.onFrame('views_update', {
      _: 'updateChannelMessageViews', channel_id: CHANNEL, id: SEQ, views: 2,
    })

    expect(cacheViews).toHaveBeenCalledTimes(2)
  })
})
