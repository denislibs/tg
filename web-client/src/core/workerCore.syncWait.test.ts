// Проводка ожидания догона для уведомлений — tweb 1dc32d889.
//
// Три строки `workerCore.ts`, удаление каждой из которых ломает уведомления
// молча: `syncWait.attach(...)` в onReady (tweb `attach`; без неё «начальная
// синхронизация» не кончается никогда, и при активной вкладке уведомления
// глохнут навсегда), признак `initialSync` на рассылке `rt:new_message` (без
// него бэклог первого difference при активной вкладке снова сыплет
// уведомлениями) и `realtime.waitForSync` поверх НАСТОЯЩЕГО `sync` (заглушка
// отпускала бы сразу — уведомление не ждало бы difference, который его отменяет).
//
// Приём — тот же, что у соседей (workerCore.channelFrames.test.ts): частичный
// vi.mock connectionManager, чтобы позвать onFrame напрямую.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { EventMeta } from '../rpc/superMessagePort'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { idbSet } from './store/idbKv'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { makeRawMessage } from './messages/testMessage'

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

/** Ответы updates.getDifference / updates.getState — придерживаются тестом,
 *  пока он не решит отпустить догон. */
let releaseSync: (() => void) | null = null
let releaseState: (() => void) | null = null

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  releaseSync = null
  releaseState = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/updates/difference?')) {
      return new Promise<Response>((resolve) => {
        releaseSync = () => resolve(new Response(JSON.stringify({ _: 'updates.differenceEmpty', date: 2, seq: 0 }), { status: 200 }))
      })
    }
    if (u.includes('/updates/state')) {
      return new Promise<Response>((resolve) => {
        releaseState = () => resolve(new Response(JSON.stringify({
          _: 'updates.state', pts: 750, qts: 0, date: 1790998660, seq: 0, unread_count: 0,
        }), { status: 200 }))
      })
    }
    return Promise.reject(new Error('unexpected fetch ' + u))
  }))
  capturedConnDeps = null
})

afterEach(() => { vi.unstubAllGlobals() })

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const metas: Array<EventMeta | undefined> = []
  tab.on('rt:new_message', (_p, meta) => metas.push(meta))
  expect(capturedConnDeps).not.toBeNull()
  const waitForSync = (peerId: number) => tab.invoke<void>('manager', { name: 'realtime', method: 'waitForSync', args: [{ peerId }] })
  return { metas, waitForSync }
}

let nextId = 1
function newMessage() {
  // Без pts: воронка рассылает кадр как есть, курсор не трогает.
  capturedConnDeps!.onFrame('new_message', {
    _: 'updateNewMessage',
    message: makeRawMessage({ id: nextId++, peerId: 1, fromId: 9, text: 'привет' }),
  })
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('createWorkerCore(): ожидание догона для уведомлений (tweb 1dc32d889)', () => {
  it('до первого подключения кадр помечен initialSync', () => {
    const { metas } = boot()

    newMessage()

    expect(metas).toEqual([{ initialSync: true }])
  })

  /** Состояние апдейтов прошлой сессии — без него подключение берёт
   *  updates.getState, а не разницу (tweb `apiUpdatesManager.attach`, :886-906). */
  const savedCursor = async () => { await idbSet('pts', 1); await idbSet('date', 1) }

  it('подключение с сохранённым состоянием — начальная синхронизация длится до конца разницы', async () => {
    await savedCursor()
    const { metas } = boot()

    capturedConnDeps!.onReady()
    await settle()
    newMessage()
    expect(metas[metas.length - 1]).toEqual({ initialSync: true })

    releaseSync!()
    await settle()
    newMessage()
    expect(metas[metas.length - 1]).toBeUndefined()
  })

  // Свежий вход: сохранённого состояния нет — база = текущее состояние сервера
  // (updates.getState), разница не запрашивается (tweb attach :893-905).
  it('подключение без сохранённого состояния: updates.getState, разницы нет', async () => {
    const { metas } = boot()

    capturedConnDeps!.onReady()
    await settle()
    expect(releaseSync).toBeNull()
    newMessage()
    expect(metas[metas.length - 1]).toEqual({ initialSync: true })
    releaseState!()
    await settle()
    newMessage()
    expect(metas[metas.length - 1]).toBeUndefined()

    // Реконнект — новая сессия: forceGetDifference ОТ ВЗЯТОЙ базы, а не от нуля.
    capturedConnDeps!.onReady()
    await settle()
    expect(releaseSync).not.toBeNull()
    const syncUrl = vi.mocked(fetch).mock.calls.map((c) => c[0] as string).find((u) => u.includes('/updates/difference?'))
    expect(syncUrl).toContain('pts=750')
    expect(syncUrl).toContain('date=1790998660')
  })

  it('realtime.waitForSync отпускает только после РЕАЛЬНОГО догона', async () => {
    await savedCursor()
    const { waitForSync } = boot()

    capturedConnDeps!.onReady()
    await settle()
    let released = false
    void waitForSync(1).then(() => { released = true })
    await settle()
    expect(released).toBe(false)

    releaseSync!()
    await settle()
    expect(released).toBe(true)
  })
})
