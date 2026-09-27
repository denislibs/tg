// Проводка статуса из карточки профиля в createWorkerCore() (норма CLAUDE.md
// «Тесты»: каждая строка проводки краснеет на своём удалении). Сами менеджеры
// покрыты `managers/peersManager.test.ts` (карточка → `onUserStatus`) и
// `managers/privacyManager.test.ts` (профиль → `saveApiPeers`); здесь — что в
// проде они соединены: ответ `/users/{id}` доезжает до вкладок кадром
// `rt:presence`, из которого стор присутствия и берёт подпись шапки чата и
// профиля (порт tweb `getProfile → saveApiUsers → saveUserStatus`).
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { RT } from './realtime/events'

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

const status = { _: 'userStatusOnline', expires: 1790503807 }

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.endsWith('/users/777201')) {
      return new Response(JSON.stringify({
        _: 'users.userFull',
        full_user: { _: 'userFull', id: 777201 },
        chats: [],
        users: [{ _: 'user', id: 777201, first_name: 'Денис', status }],
        can_message: true,
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): статус собеседника из профиля', () => {
  it('privacy.profile рассылает статус из вектора users кадром rt:presence', async () => {
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const frames: Array<{ event: string; payload: unknown }> = []
    tab.onAny((event, payload) => frames.push({ event, payload }))

    await tab.invoke('manager', { name: 'privacy', method: 'profile', args: [777201] })

    expect(frames).toContainEqual({
      event: RT.presence,
      payload: { _: 'updateUserStatus', user_id: 777201, status },
    })
  })
})
