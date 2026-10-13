// VA2-02 (Ф-6, f6-me): свой `user_update` обновляет `me` воркера.
//
// Кадр `updateUserSnapshot` со СВОИМ id приходит, когда другое устройство сменило
// эмодзи-статус или включило Premium. Карточка «я» в кэше пиров лежит не всегда
// (в списках чатов мой профиль бывает только в «Избранном»), а гвард
// `peers.applyUserUpdate` неизвестную карточку не заводит — поэтому `me`
// обновляется отдельным приёмником `onSelfUser` ДО гварда. Событие `rt:me` везёт
// вкладкам новую карточку: из неё главный поток выводит `is-premium`
// (tweb `checkPremium`, appUsersManager.ts:793-800).
//
// Приём — как в workerCore.dialogFrames.test.ts: перехватываем onFrame
// ConnectionManager и зовём его напрямую.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { PeerProfile } from './managers/authManager'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => {
      capturedConnDeps = deps
      return actual.newConnectionManager(deps)
    },
  }
})

import { createWorkerCore } from './workerCore'
import { saveMe } from './store/persist'
import { RT } from './realtime/events'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

const ME: PeerProfile = {
  user: { _: 'user', pFlags: { self: true }, id: 7, phone: '+79990000007', username: 'me', first_name: 'Я', photo: { _: 'userProfilePhotoEmpty' } },
  fullUser: { _: 'userFull', id: 7 },
  canMessage: true,
}

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

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => { throw new Error('unexpected fetch ' + String(url)) }))
  capturedConnDeps = null
})

/** Воркер с `me` с диска; события `rt:me` собираются только от кадров теста. */
async function bootWithMe(): Promise<{ meEvents: PeerProfile[] }> {
  await saveMe(ME)
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const meEvents: PeerProfile[] = []
  new SuperMessagePort(epTab).on(RT.me, (p) => meEvents.push(p as PeerProfile))
  core.start()
  // Гидрация `me` с диска (`start()` → loadMe) идёт без rt:me и асинхронно: ждём,
  // пока IndexedDB отдаст профиль, прежде чем слать кадр.
  await new Promise((r) => setTimeout(r, 100))
  expect(capturedConnDeps).not.toBeNull()
  return { meEvents }
}

describe('createWorkerCore(): кадр updateUserSnapshot со своим id', () => {
  it('Premium из кадра → rt:me с user.pFlags.premium; номер, fullUser и canMessage сохранены', async () => {
    const { meEvents } = await bootWithMe()

    capturedConnDeps!.onFrame('user_update', {
      _: 'updateUserSnapshot',
      user: { ...ME.user, pFlags: { self: true, premium: true } },
    })

    expect(meEvents).toHaveLength(1)
    expect(meEvents[0].user.pFlags?.premium).toBe(true)
    expect(meEvents[0].user.phone).toBe('+79990000007')
    expect(meEvents[0].fullUser).toEqual(ME.fullUser)
    expect(meEvents[0].canMessage).toBe(true)
  })

  it('чужая карточка me не трогает', async () => {
    const { meEvents } = await bootWithMe()

    capturedConnDeps!.onFrame('user_update', {
      _: 'updateUserSnapshot',
      user: { _: 'user', id: 99, first_name: 'Чужой', photo: { _: 'userProfilePhotoEmpty' } },
    })

    expect(meEvents).toEqual([])
  })
})
