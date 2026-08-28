// Пин ПРОВОДКИ в workerCore.ts: эфемерный кадр geo_live_update применяет
// ВЛАДЕЛЕЦ окна (messages.cacheGeoLive) прямо в onFrame и объявляет результат
// операцией rt:message_op.
//
// Почему строка вообще нужна. Кадр помечен `ephemeral` в
// `realtime/transportFrames.ts:35` (курсора у него нет — предмет не портирован,
// #52), поэтому он не проходит воронку и в реестр CACHE не попадает: без этой
// строки `messages.cacheGeoLive` не звался бы НИОТКУДА (ровно так и было), а
// координаты правила бы витрина из сырого кадра — то есть мимо операций и мимо
// зеркала главного потока, из которого рисует императивная лента.
//
// Приём — тот же, что в workerCore.pendingFrames.test.ts: частичный vi.mock
// connectionManager, чтобы перехватить onFrame и позвать его напрямую, плюс
// частичный vi.mock messagesManager (сама механика патча покрыта у владельца —
// client/realtime/storeProjection.windowWriters.test.ts; здесь предмет другой).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import type { MessageOp } from './realtime/messageOps'
import { RT } from './realtime/events'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => { capturedConnDeps = deps; return actual.newConnectionManager(deps) },
  }
})

const GEO_OPS: MessageOp[] = [{ op: 'patch', key: '1', msgId: 4_294_967_298, fields: { edit_date: 777 } }]
const cacheGeoLive = vi.fn(() => GEO_OPS)
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: Parameters<typeof actual.newMessagesManager>[0]) => ({
      ...actual.newMessagesManager(deps),
      cacheGeoLive,
    }),
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
  const tab = new SuperMessagePort(epTab)
  const ops: MessageOp[] = []
  const raw: unknown[] = []
  tab.on(RT.messageOp, (p) => ops.push(...(p as { ops: MessageOp[] }).ops))
  tab.on(RT.geoLiveUpdate, (p) => raw.push(p))
  expect(capturedConnDeps).not.toBeNull()
  return { ops, raw }
}

const FRAME = {
  peer_id: 1,
  id: 2,
  media: { _: 'messageMediaGeoLive', geo: { _: 'geoPoint', long: 30.5, lat: 50.4 }, period: 900 },
  edit_date: 777,
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  cacheGeoLive.mockClear()
})

describe('createWorkerCore(): geo_live_update применяет владелец', () => {
  // Что ломается без строки: трансляция едет по карте у всех, КРОМЕ окна
  // сообщений — бабл гео-трансляции застывает на первой точке.
  it('geo_live_update → cacheGeoLive + rt:message_op', () => {
    const { ops } = boot()

    capturedConnDeps!.onFrame('geo_live_update', FRAME)

    expect(cacheGeoLive).toHaveBeenCalledWith(FRAME)
    expect(ops).toEqual(GEO_OPS)
  })

  // Сырой кадр летит дальше (PASS_THROUGH), как у message_ack: перехват
  // владельцем не отменяет трансляцию. Потребителей у rt:geo_live_update на
  // витрине сейчас нет — та же ситуация, что у rt:user_update, и та же
  // причина не заводить исключение в общей проводке.
  it('сырой rt:geo_live_update продолжает лететь вкладкам', () => {
    const { raw } = boot()

    capturedConnDeps!.onFrame('geo_live_update', FRAME)

    expect(raw).toEqual([FRAME])
  })

  // Сообщения нет в окне (трансляция в неоткрытом чате) — владелец отдаёт
  // пустой список, лишнего кадра быть не должно.
  it('пустой список операций кадром rt:message_op не рассылается', () => {
    const { ops, raw } = boot()
    cacheGeoLive.mockReturnValueOnce([])

    capturedConnDeps!.onFrame('geo_live_update', FRAME)

    expect(ops).toEqual([])
    expect(raw).toHaveLength(1)
  })
})
