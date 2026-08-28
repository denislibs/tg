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
//
// СЕТЬ. Кадр с `pts`, не ушедший в пер-канальную воронку, попадает в
// пер-юзерную, а та при негидрированном курсоре сразу просит догон
// (globalFunnel.ts: `if (!isCursorReady()) { catchUp() }`) → GET /sync. Это
// единственная сеть, до которой доходит файл, и промис догона прод-код пускает
// через `void sync.catchUp()` (workerCore.ts) — то есть незастабленный fetch
// тест не ронял, а давал два Unhandled Rejection на прогон (ECONNREFUSED
// localhost:3000), а такой отказ vitest приписывает случайному файлу и
// предупреждает про ложноположительные прогоны.
//
// Стаб — тот же приём, что у соседей (workerCore.dialogFrames.test.ts,
// workerCore.meHydration.test.ts): белый список URL, всё прочее — громкий
// throw, чтобы новая сеть не пряталась за заглушкой. /sync отвечает ПУСТОЙ
// страницей журнала: догон завершается штатно и ничего не применяет — предмет
// файла (развилка воронок) от этого не зависит.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** URL'ы догона курсора, до которых дошёл этот прогон: поход в /sync —
 *  наблюдаемый след пер-юзерной воронки, им кейсы «мимо канальной воронки» и
 *  доказывают, что кадр ушёл в СОСЕДНЮЮ воронку, а не потерялся молча. */
const syncCalls: string[] = []

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  syncCalls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/sync?')) {
      syncCalls.push(u)
      // Пустая страница журнала: `slice: false` завершает цикл догона первым же
      // ответом, применять нечего.
      return new Response(JSON.stringify({
        new_messages: [], other_updates: [], state: { pts: 0, date: 0 }, slice: false,
      }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
  capturedConnDeps = null
  applyLive.mockClear()
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): канальные кадры уходят в пер-канальную воронку', () => {
  // Тело — ровно то, что публикует сервер: КОНСТРУКТОР
  // updateNewChannelMessage, курсор внутри него параметром `pts`, адрес пира
  // внутри конструктора сообщения. Именно дискриминатор и отвечает «курсор
  // канальный»: своего имени у канального курсора в схеме нет.
  it('пост канала → channelFunnel.applyLive с пиром из message.peer_id', () => {
    boot()

    capturedConnDeps!.onFrame('new_message', {
      _: 'updateNewChannelMessage',
      pts: 7,
      pts_count: 1,
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
    // Ключом маршрутизации едет КОНСТРУКТОР, а не тип конверта.
    expect(applyLive.mock.calls[0][1]).toBe('updateNewChannelMessage')
    expect(applyLive.mock.calls[0][2]).toBe(7)
  })

  // Кадр метаданных канала сообщения не несёт — пир у него СВОЙ параметр
  // конструктора (`peer`), а курсор пер-канальный, и говорит об этом сам
  // конструктор: updateChannelFullSnapshot. Прежде на его месте ехал
  // updateChatFullSnapshot (тот же, что у группы) плюс ключ `channel_pts` —
  // второе имя курсора, по которому клиент и решал вид кадра.
  it('снимок карточки канала → applyLive с пиром из параметра peer', () => {
    boot()

    capturedConnDeps!.onFrame('chat_update', {
      _: 'updateChannelFullSnapshot',
      peer: { _: 'peerChannel', channel_id: 42 },
      chat_full: { _: 'messages.chatFull' },
      pts: 3,
      pts_count: 1,
    })

    expect(applyLive).toHaveBeenCalledTimes(1)
    expect(applyLive.mock.calls[0][0]).toBe(-42)
    expect(applyLive.mock.calls[0][1]).toBe('updateChannelFullSnapshot')
    expect(applyLive.mock.calls[0][2]).toBe(3)
  })

  // Тот же снимок, но ГРУППЫ, — другой конструктор и другой курсор: в
  // пер-канальную воронку он попадать не должен. Это вторая половина пары:
  // одним конструктором на оба журнала различить их было нечем.
  it('снимок карточки ГРУППЫ мимо пер-канальной воронки', async () => {
    boot()

    capturedConnDeps!.onFrame('chat_update', {
      _: 'updateChatFullSnapshot',
      peer: { _: 'peerChannel', channel_id: 42 },
      chat_full: { _: 'messages.chatFull' },
      pts: 3,
      pts_count: 1,
    })

    expect(applyLive).not.toHaveBeenCalled()
    // …и не «нигде»: курсор пер-юзерной воронки не гидрирован, поэтому она на
    // этом кадре просит догон. Без этой половины кейс был бы зелёным и от кадра,
    // потерянного вовсе.
    await vi.waitFor(() => expect(syncCalls).toHaveLength(1))
  })

  // Обычное сообщение (не канал) в пер-канальную воронку попадать не должно —
  // и это САМЫЙ хрупкий случай новой развилки: `pts` теперь есть у обоих
  // кадров, и различает их только дискриминатор. Прочитай развилка курсор без
  // оглядки на него — каждое личное сообщение поехало бы в чужую воронку.
  it('сообщение личного чата мимо пер-канальной воронки', async () => {
    boot()

    capturedConnDeps!.onFrame('new_message', {
      _: 'updateNewMessage',
      pts: 5,
      pts_count: 1,
      message: {
        _: 'message', id: 1, date: 1787334148, message: 'привет',
        peer_id: { _: 'peerUser', user_id: 9 }, from_id: { _: 'peerUser', user_id: 9 },
      },
    })

    expect(applyLive).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(syncCalls).toHaveLength(1))
  })
})
