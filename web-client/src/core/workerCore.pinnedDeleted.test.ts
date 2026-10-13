// Пин ПРОВОДКИ в workerCore.ts: удаление сообщения (`onMessagesDeleted` менеджера
// сообщений) объявляет вкладкам `peer_pinned_deleted {peerId, mids, pinned}` — порт
// tweb `handleDeletedMessages` (appMessagesManager.ts:14078-14080: удалённое с
// `pFlags.pinned` зовёт `resetPinnedMessagesCache`). Воркер и главный поток у нас
// разделены, а сообщения закрепов лежат в кэше главного потока, поэтому воркер шлёт
// ВСЕ удалённые клиентские номера и подмножество, о котором ЗНАЕТ, что оно закреплено;
// решение «сбросить ли кэш» принимает вкладка (`client/realtime/pinnedDeleted.test.ts`).
// Что менеджер сообщений отдаёт номера всех удалённых, включая неизвестные, покрыто
// `managers/messagesManager.test.ts`.
//
// Приём — тот же, что в workerCore.peerBlock.test.ts: частичный vi.mock фабрики
// менеджера перехватывает её зависимости (core.start() не нужен).
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { MyMessage } from './models'

type MessagesDeps = Parameters<typeof import('./managers/messagesManager').newMessagesManager>[0]
let capturedDeps: MessagesDeps | null = null
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: MessagesDeps) => { capturedDeps = deps; return actual.newMessagesManager(deps) },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

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

const PEER = 7
const msg = (id: number, pinned: boolean) => ({ id, pFlags: pinned ? { pinned: true } : {} }) as unknown as MyMessage

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const got: unknown[] = []
  tab.on('peer_pinned_deleted', (p) => { got.push(p) })
  expect(capturedDeps?.onMessagesDeleted).toBeTypeOf('function')
  return { got, deleted: capturedDeps!.onMessagesDeleted! }
}

describe('workerCore: удаление сообщения → peer_pinned_deleted', () => {
  it('известное закреплённое: номер в mids и в pinned', () => {
    const { got, deleted } = boot()
    deleted(PEER, [msg(5, true)], 0, [5])
    expect(got).toEqual([{ peerId: PEER, mids: [5], pinned: [5] }])
  })

  it('известное, но не закреплённое: pinned пуст, событие всё равно шлётся', () => {
    const { got, deleted } = boot()
    deleted(PEER, [msg(6, false)], 0, [6])
    expect(got).toEqual([{ peerId: PEER, mids: [6], pinned: [] }])
  })

  it('неизвестное воркеру (закреп вне окна): mids несёт номер, pinned пуст', () => {
    const { got, deleted } = boot()
    deleted(PEER, [], 1, [9])
    expect(got).toEqual([{ peerId: PEER, mids: [9], pinned: [] }])
  })
})
