// Пин ПРОВОДКИ в workerCore.ts: блок и правило приватности едут апдейтами
// `updatePeerBlocked` / `updatePrivacy` (tweb `toggleBlock` / `setPrivacy` →
// `processLocalUpdate`; те же конструкторы приходят журналом с другого
// устройства), а воркер разводит их на события `peer_block` / `privacy_update`.
// Без строки `processLocalUpdate: (u) => dispatch(u._, u)` менеджер молчал бы, а
// вкладка «Заблокированные» (`sidebarLeft/tabs/blockedUsers.solid.tsx`) и хаб
// «Конфиденциальность» не узнали бы о блокировке из шапки чата.
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

function boot() {
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  return new SuperMessagePort(epTab)
}

describe('workerCore: блок и приватность', () => {
  it('местный updatePeerBlocked менеджера уходит во вкладку как peer_block', () => {
    const tab = boot()
    const got: unknown[] = []
    tab.on('peer_block', (p) => got.push(p))

    expect(capturedDeps?.processLocalUpdate).toBeTypeOf('function')
    capturedDeps!.processLocalUpdate!({
      _: 'updatePeerBlocked', pFlags: { blocked: true }, peer_id: { _: 'peerUser', user_id: 6 },
    })
    capturedDeps!.processLocalUpdate!({ _: 'updatePeerBlocked', peer_id: { _: 'peerUser', user_id: 6 } })

    expect(got).toEqual([{ peerId: 6, blocked: true }, { peerId: 6, blocked: undefined }])
  })

  it('местный updatePrivacy уходит во вкладку как privacy_update, целиком', () => {
    const tab = boot()
    const got: unknown[] = []
    tab.on('privacy_update', (p) => got.push(p))
    const u = {
      _: 'updatePrivacy' as const,
      key: { _: 'privacyKeyStatusTimestamp' },
      rules: [{ _: 'privacyValueDisallowAll' as const }],
    }

    capturedDeps!.processLocalUpdate!(u)

    expect(got).toEqual([u])
  })

  // Кадр журнала считается: менеджер по счётчику отличает «пока шёл PUT, пришёл
  // кадр» и не затирает его местным апдейтом.
  it('каждый апдейт предмета поднимает счётчик кадров этого предмета', () => {
    boot()
    const key = 'privacyKeyAbout'
    expect(capturedDeps!.frameVersion!(key)).toBe(0)

    capturedDeps!.processLocalUpdate!({ _: 'updatePrivacy', key: { _: key }, rules: [] })

    expect(capturedDeps!.frameVersion!(key)).toBe(1)
    expect(capturedDeps!.frameVersion!('privacyKeyPhoneNumber')).toBe(0)
  })
})
