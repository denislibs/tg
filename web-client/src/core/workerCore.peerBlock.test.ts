// Пин ПРОВОДКИ в workerCore.ts: событие `peer_block`, которое `privacyManager`
// объявляет после ответа сервера на блокировку (порт tweb
// `appUsersManager.toggleBlock` → `onUpdatePeerBlocked`), уходит веером во
// вкладки. Без строки `onPeerBlock: (e) => broadcast('peer_block', e)` менеджер
// молчал бы, а вкладка «Заблокированные» (`sidebarLeft/tabs/blockedUsers.solid.tsx`)
// и хаб «Конфиденциальность» не узнали бы о блокировке из шапки чата.
//
// Приём — тот же, что в workerCore.geoLiveFrame.test.ts: частичный vi.mock
// фабрики менеджера перехватывает её зависимости; само содержимое события
// покрыто у владельца (`managers/privacyManager.test.ts`).
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

type PrivacyDeps = Parameters<typeof import('./managers/privacyManager').newPrivacyManager>[0]
let capturedDeps: PrivacyDeps | null = null
vi.mock('./managers/privacyManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/privacyManager')>()
  return {
    ...actual,
    newPrivacyManager: (deps: PrivacyDeps) => { capturedDeps = deps; return actual.newPrivacyManager(deps) },
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

describe('workerCore: peer_block', () => {
  it('событие менеджера приватности уходит во вкладку', () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const got: unknown[] = []
    tab.on('peer_block', (p) => got.push(p))

    expect(capturedDeps?.onPeerBlock).toBeTypeOf('function')
    capturedDeps!.onPeerBlock!({ peerId: 6, blocked: true })

    expect(got).toEqual([{ peerId: 6, blocked: true }])
  })
})
