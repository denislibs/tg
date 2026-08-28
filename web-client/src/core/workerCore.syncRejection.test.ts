// Задача #91. Упавший `GET /sync` не имеет права давать Unhandled Rejection.
//
// Пер-юзерный догон `sync.catchUp()` прод-код зовёт ДВАЖДЫ и оба раза
// fire-and-forget — вернувшийся промис никто не дожидается:
//
//   1. адаптер воронки `catchUp: () => { ... }` — воронка объявляет зависимость
//      как `() => void` (globalFunnel.ts), и на негидрированном курсоре зовёт её
//      на КАЖДОМ живом кадре с `pts` (`if (!isCursorReady()) { catchUp() }`);
//   2. ветка hello-кадра реконнекта, где серверный `pts` разошёлся с курсором.
//
// `syncEngine.catchUp()` отказ пробрасывает СОЗНАТЕЛЬНО (его наблюдает тот, кто
// дожидается, — пин `realtime/syncEngine.test.ts`), а `.finally` внутри него
// держит парность synchronizing/synchronized и сбрасывает `running` в любом
// исходе. То есть функционально упавший догон безвреден — цена ровно одна:
// необработанный отказ, который шумит в консоли боевой вкладки и МАСКИРУЕТ
// настоящие отказы (именно он и давал два Unhandled Rejection на прогон vitest,
// пока workerCore.channelFrames.test.ts не застабил там сеть — коммит 6f0da402).
//
// НАБЛЮДАЕМОСТЬ. Необработанный отказ — не исключение и не значение, поймать
// его `expect().rejects` нельзя: он проявляется только тем, что среда об этом
// СООБЩАЕТ. Поэтому кейсы слушают `process.on('unhandledRejection')` — под
// vitest промисы нативные, и node поднимает событие в конце того же оборота
// микрозадач. Слушатель добавляется рядом с чужими (vitest вешает свой) и
// снимается в afterEach, чтобы не течь на соседние файлы.
//
// Стаб сети — тот же приём, что у соседних workerCore.*.test.ts: белый список
// URL, всё непредусмотренное — громкий throw. Отличие в том, что `/sync` здесь
// не отвечает пустой страницей, а ОТКАЗЫВАЕТ: предмет файла — именно сбой сети.
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

// bind() без start(): `cursorReady` поднимает только start(), поэтому пер-юзерная
// воронка остаётся на негидрированном курсоре — та самая ветка, что просит догон.
function boot() {
  const core = createWorkerCore()
  const [epWorker] = pair()
  core.bind(epWorker)
  expect(capturedConnDeps).not.toBeNull()
}

/** Походы догона в сеть — наблюдаемый след того, что кейс ДОШЁЛ до отказа, а не
 *  промолчал по пути (без этой половины тест был бы зелёным и от кадра, который
 *  до /sync вовсе не добрался). */
const syncCalls: string[] = []
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

/** Отдать очередь: node поднимает 'unhandledRejection' после того, как оборот
 *  микрозадач исчерпан, — одного макротика достаточно, берём с запасом. */
async function settleRejections() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  syncCalls.length = 0
  unhandled.length = 0
  process.on('unhandledRejection', onUnhandled)
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/sync?')) {
      syncCalls.push(u)
      throw new TypeError('Failed to fetch')  // сеть моргнула — ровно боевой случай
    }
    throw new Error('unexpected fetch ' + u)
  }))
  capturedConnDeps = null
})

afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  vi.unstubAllGlobals()
})

describe('createWorkerCore(): упавший /sync не даёт Unhandled Rejection', () => {
  // Вызыватель №1: адаптер `catchUp` пер-юзерной воронки. Кадр личного чата с
  // `pts` на негидрированном курсоре — кратчайший путь до этой ветки (тот же,
  // которым в неё попадают кейсы workerCore.channelFrames.test.ts).
  it('догон, запрошенный воронкой на негидрированном курсоре', async () => {
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

    await vi.waitFor(() => expect(syncCalls).toHaveLength(1))
    await settleRejections()

    expect(unhandled).toEqual([])
  })

  // Вызыватель №2: hello-кадр реконнекта с расхождением pts. Курсор здесь
  // гидрируется штатно (пустой IDB → 0), серверный pts=5 с ним не совпал —
  // ветка просит догон, и он падает.
  it('догон, запрошенный hello-кадром реконнекта с расхождением pts', async () => {
    boot()

    capturedConnDeps!.onFrame('hello', { pts: 5, date: 1787334148 })

    await vi.waitFor(() => expect(syncCalls).toHaveLength(1))
    await settleRejections()

    expect(unhandled).toEqual([])
  })

  // Контроль самого инструмента: если бы слушатель не ловил необработанный
  // отказ вовсе, оба кейса выше были бы зелёными при ЛЮБОМ прод-коде. Здесь
  // отказ заведомо никем не обработан — слушатель обязан его увидеть.
  it('слушатель действительно видит необработанный отказ (контроль инструмента)', async () => {
    void Promise.reject(new Error('контрольный отказ'))

    await settleRejections()

    expect(unhandled).toHaveLength(1)
    expect((unhandled[0] as Error).message).toBe('контрольный отказ')
  })
})
