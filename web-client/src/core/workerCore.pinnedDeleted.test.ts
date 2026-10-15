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
  it('известное закреплённое: номер в mids и в pinned', async () => {
    const { got, deleted } = boot()
    deleted(PEER, [msg(5, true)], 0, [5])
    await vi.waitFor(() => expect(got).toEqual([{ peerId: PEER, mids: [5], pinned: [5] }]))
  })

  it('известное, но не закреплённое: pinned пуст, событие всё равно шлётся', async () => {
    const { got, deleted } = boot()
    deleted(PEER, [msg(6, false)], 0, [6])
    await vi.waitFor(() => expect(got).toEqual([{ peerId: PEER, mids: [6], pinned: [] }]))
  })

  it('неизвестное воркеру (закреп вне окна): mids несёт номер, pinned пуст', async () => {
    const { got, deleted } = boot()
    deleted(PEER, [], 1, [9])
    await vi.waitFor(() => expect(got).toEqual([{ peerId: PEER, mids: [9], pinned: [] }]))
  })

  // Вектор кадра расходится по номерам, очистка истории шлёт кадры по 1000 номеров:
  // одно событие на пира за такт, а не `postMessage` на каждый номер.
  it('пачка удалений одного такта склеена в одно событие на пира', async () => {
    const { got, deleted } = boot()
    deleted(PEER, [msg(1, false)], 0, [1])
    deleted(PEER, [msg(2, true)], 0, [2])
    deleted(PEER, [], 1, [3])
    deleted(8, [], 1, [4])
    await vi.waitFor(() => expect(got).toHaveLength(2))
    expect(got).toEqual([
      { peerId: PEER, mids: [1, 2, 3], pinned: [2] },
      { peerId: 8, mids: [4], pinned: [] },
    ])
  })

  it('следующий такт — новое событие', async () => {
    const { got, deleted } = boot()
    deleted(PEER, [], 1, [1])
    await vi.waitFor(() => expect(got).toHaveLength(1))
    deleted(PEER, [], 1, [2])
    await vi.waitFor(() => expect(got).toHaveLength(2))
    expect(got[1]).toEqual({ peerId: PEER, mids: [2], pinned: [] })
  })
})
