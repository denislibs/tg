// Ф7-Ж: проводка сверки `state.pts` ответа `messages.getPeerDialogs` в
// `createWorkerCore()` (tweb reloadConversation, appMessagesManager.ts:6313-6319).
// Логика цикла проверена в dialogsManager.test.ts на фейковых зависимостях; здесь —
// что воркер передаёт владельцу диалогов НАСТОЯЩИЕ курсор апдейтов, состояние
// сокета и признак догонки, а не заглушки.
//
// Приём — как в workerCore.connectionStatus.test.ts: оборачиваем реальные
// фабрики, перехватывая deps/инстансы, которые получает workerCore.ts.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { DialogsDeps } from './managers/dialogsManager'
import type { CMDeps, ConnectionManager } from './realtime/connectionManager'
import type { SyncDeps, SyncEngine } from './realtime/syncEngine'

let capturedDialogsDeps: DialogsDeps | null = null
let capturedSyncDeps: SyncDeps | null = null
let capturedSync: SyncEngine | null = null
let capturedConn: ConnectionManager | null = null
let capturedConnDeps: CMDeps | null = null

vi.mock('./managers/dialogsManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/dialogsManager')>()
  return {
    ...actual,
    newDialogsManager: (deps: DialogsDeps) => {
      capturedDialogsDeps = deps
      return actual.newDialogsManager(deps)
    },
  }
})

vi.mock('./realtime/syncEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/syncEngine')>()
  return {
    ...actual,
    newSyncEngine: (deps: SyncDeps) => {
      capturedSyncDeps = deps
      capturedSync = actual.newSyncEngine(deps)
      return capturedSync
    },
  }
})

vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: Parameters<typeof actual.newConnectionManager>[0]) => {
      capturedConnDeps = deps
      capturedConn = actual.newConnectionManager(deps)
      return capturedConn
    },
  }
})

import { createWorkerCore } from './workerCore'
import { CHANNEL_CURSOR, UPDATE_RT } from './realtime/updateCatalog'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedDialogsDeps = null
  capturedSyncDeps = null
  capturedSync = null
  capturedConn = null
  capturedConnDeps = null
})

describe('createWorkerCore() — проводка сверки pts для messages.getPeerDialogs (Ф7-Ж)', () => {
  it('getUpdatesPts читает pts НАСТОЯЩЕГО курсора апдейтов', () => {
    createWorkerCore()
    expect(capturedDialogsDeps?.getUpdatesPts).toBeTypeOf('function')
    expect(capturedDialogsDeps!.getUpdatesPts!()).toBe(0)
    capturedSyncDeps!.cursor.set(12, 100)
    expect(capturedDialogsDeps!.getUpdatesPts!()).toBe(12)
  })

  it('isLiveSynced = сокет в состоянии ready И догонка не идёт', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети в тесте'))))
    createWorkerCore()
    expect(capturedDialogsDeps?.isLiveSynced).toBeTypeOf('function')
    const live = capturedDialogsDeps!.isLiveSynced!
    const setState = (s: string) => { (capturedConn as unknown as { state: () => string }).state = () => s }

    setState('offline')
    expect(live()).toBe(false)
    setState('reconnecting')
    expect(live()).toBe(false)

    setState('ready')
    expect(live()).toBe(true)

    // Догонка идёт: isSyncing() выставляется синхронно, до ответа сети.
    const p = capturedSync!.getDifference().catch(() => {})
    expect(capturedSync!.isSyncing()).toBe(true)
    expect(live()).toBe(false)
    await p
    expect(live()).toBe(true)
  })
})

// Сверка `state.pts` сходится, только если КАЖДЫЙ живой кадр пер-юзерного журнала
// после `onFrame` воркера доводит курсор до своего pts (иначе строка диалога
// перечитывалась бы по кругу). Гоним по одному кадру каждого конструктора каталога
// (кроме канальных — у них свой курсор) через настоящий `onFrame` соединения:
// маршрутизация `workerCore.ts` (развилка канальных, конверт против тела,
// воронка) входит в проверку, в отличие от теста самой воронки. Сервер кладёт pts
// ЛИБО в тело (конструктор объявляет параметр), ЛИБО в конверт (backend/internal/
// usecase/chat/frame.go:64-69), поэтому каждый кадр гоним дважды — с pts только в
// конверте и только в теле. `folder_update` — кадр журнала без конструктора.
describe('createWorkerCore() — каждый кадр пер-юзерного журнала доводит курсор до своего pts (Ф7-Ж)', () => {
  it.each([['pts в конверте', true], ['pts в теле', false]])('onFrame, %s → cursor.pts === pts для всех конструкторов каталога и folder_update', async (_name, inEnvelope) => {
    const core = createWorkerCore()
    core.start()
    const cursor = capturedSyncDeps!.cursor
    await cursor.ready()
    await new Promise((r) => setTimeout(r, 20))

    const peer = { _: 'peerUser', user_id: 2 }
    const msg = { _: 'message', id: 1, peer_id: peer, from_id: peer, date: 1, message: '', pFlags: {} }
    // Тела, без которых обработчик владельца не принимает кадр (остальным хватает {_}).
    const bodies: Record<string, object> = {
      updateNewMessage: { message: msg },
      updateEditMessage: { message: msg },
      updateNewScheduledMessage: { message: msg },
      updateDeletePeerMessages: { peer, messages: [1] },
      updatePinnedMessages: { peer, messages: [1] },
      updateReadPeerMessagesContents: { peer, messages: [1] },
      updateMessagePoll: { peer, poll_id: 1, poll: { id: 1 }, results: { _: 'pollResults' } },
      updateMessageToDo: { peer, media: { _: 'messageMediaToDo', todo: { _: 'todoList', list: [] } } },
      updateMessageGiveaway: { peer, media: { _: 'messageMediaGiveaway' } },
      updateNewStickerSet: { stickerset: { _: 'messages.stickerSet', set: { id: 1 }, packs: [], documents: [] } },
      updatePrivacy: { key: { _: 'privacyKeyStatusTimestamp' }, rules: [] },
      updateDialogPinned: { peer: { _: 'dialogPeer', peer } },
      updateNotifySettings: { peer: { _: 'notifyPeer', peer }, notify_settings: { _: 'peerNotifySettings' } },
    }
    const keys = Object.keys(UPDATE_RT).filter((k) => !CHANNEL_CURSOR.has(k))
    expect(keys.length).toBeGreaterThan(30)
    const stuck: string[] = []
    let pts = 0
    // updateNewMessage объявляет pts в теле (frame.go) и читает его оттуда: сервер не
    // кладёт его в конверт, воркер конверт для него и не читает.
    for (const key of [...keys, 'folder_update'].filter((k) => !(inEnvelope && k === 'updateNewMessage'))) {
      pts += 1
      // Минимальное тело: обработчики владельцев терпят неполный кадр, нас
      // интересует только арифметика курсора на пути onFrame → воронка.
      const body = key === 'folder_update' ? {} : { _: key, ...bodies[key] }
      try { if (inEnvelope) capturedConnDeps!.onFrame(key, body, pts); else capturedConnDeps!.onFrame(key, { ...body, pts }) } catch (e) { stuck.push(`throw ${key}: ${String(e).slice(0, 80)}`) }
      if (cursor.get().pts !== pts) { stuck.push(`${key}: cursor ${cursor.get().pts}, ждали ${pts}`); pts = cursor.get().pts }
    }
    expect(stuck).toEqual([])
  })
})
