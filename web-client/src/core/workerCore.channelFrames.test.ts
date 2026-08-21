// Живой кадр КАНАЛА обязан уходить в пер-канальную воронку (channelFunnel):
// у канала свой плотный курсор channel_pts, по нему считается разрыв и идёт
// догон через /difference. Общая пер-юзерная воронка про channel_pts не знает
// вовсе — кадр, попавший туда, курсор канала не двигает.
//
// Развилка в workerCore читала пир из ВЕРХНЕГО уровня кадра (`d.peer_id`
// числом). После порта сообщения адрес пира переехал ВНУТРЬ конструктора
// (`d.message.peer_id` — объединение Peer), и у кадра с сообщением верхнего
// ключа не стало вовсе: условие перестало выполняться молча, посты канала
// поехали мимо своей воронки. Кадры МЕТАДАННЫХ канала (chat_update,
// boost_update) сообщения не несут и ключ пира держат наверху числом — они
// работали и продолжают.
//
// Приём — тот же, что в workerCore.pendingFrames.test.ts: частичный vi.mock,
// чтобы перехватить onFrame и позвать его напрямую, плюс перехват самой
// воронки.
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

const applyLive = vi.fn()
vi.mock('./realtime/channelFunnel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/channelFunnel')>()
  return {
    ...actual,
    newChannelFunnel: (deps: Parameters<typeof actual.newChannelFunnel>[0]) => ({
      ...actual.newChannelFunnel(deps),
      applyLive,
    }),
  }
})

import { createWorkerCore } from './workerCore'
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

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
  applyLive.mockClear()
})

describe('createWorkerCore(): канальные кадры уходят в пер-канальную воронку', () => {
  // Тело — ровно то, что публикует сервер (см. дамп кадра в usecase/chat):
  // channel_pts наверху, адрес пира внутри конструктора сообщения.
  it('пост канала → channelFunnel.applyLive с пиром из message.peer_id', () => {
    boot()

    capturedConnDeps!.onFrame('new_message', {
      channel_pts: 7,
      message: {
        _: 'message',
        id: 1,
        date: 1787334148,
        message: 'привет',
        peer_id: { _: 'peerChannel', channel_id: 42 },
        from_id: { _: 'peerUser', user_id: 7 },
        pFlags: { post: true },
      },
    })

    expect(applyLive).toHaveBeenCalledTimes(1)
    // peerId канала — ОТРИЦАТЕЛЬНЫЙ (знаковый PeerId: чат < 0), как его считает
    // getPeerId по конструктору peerChannel.
    expect(applyLive.mock.calls[0][0]).toBe(-42)
    expect(applyLive.mock.calls[0][1]).toBe('new_message')
    expect(applyLive.mock.calls[0][2]).toBe(7)
  })

  // Кадр метаданных канала сообщения не несёт — ключ пира у него наверху и
  // числом. Эта ветка работала и обязана продолжать: пин ловит починку,
  // сделанную «в лоб» переносом чтения только внутрь сообщения.
  it('chat_update канала → applyLive с пиром верхнего уровня', () => {
    boot()

    capturedConnDeps!.onFrame('chat_update', { channel_pts: 3, peer_id: -42, chat: { _: 'channel', id: 42 } })

    expect(applyLive).toHaveBeenCalledTimes(1)
    expect(applyLive.mock.calls[0][0]).toBe(-42)
    expect(applyLive.mock.calls[0][2]).toBe(3)
  })

  // Обычное сообщение (не канал) в пер-канальную воронку попадать не должно:
  // у него нет channel_pts, а курсор у него общий пер-юзерный.
  it('сообщение личного чата мимо пер-канальной воронки', () => {
    boot()

    capturedConnDeps!.onFrame('new_message', {
      pts: 5,
      message: {
        _: 'message', id: 1, date: 1787334148, message: 'привет',
        peer_id: { _: 'peerUser', user_id: 9 }, from_id: { _: 'peerUser', user_id: 9 },
      },
    })

    expect(applyLive).not.toHaveBeenCalled()
  })
})
