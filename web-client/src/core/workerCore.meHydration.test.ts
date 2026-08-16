// Гонка личности на холодном старте (поле `Message.out`, порт tweb pFlags.out).
//
// Бэкенд `out` не отдаёт — воркер выводит его сам, сравнивая `senderId` с id
// текущего пользователя. А `me` у воркера появлялся ТОЛЬКО с ответом `/me`
// (`workerCore.ts` импортировал `saveMe`, но не `loadMe`), значит страница
// истории, обслуженная раньше этого ответа, уехала бы вкладке с out=false у
// ВСЕХ сообщений: свои сообщения слева, без галочек, до перезагрузки чата.
// Молчаливая регрессия — ни один тест её бы не заметил.
//
// Закрыто ДВУМЯ строками, и обе пинит этот файл (каждая по отдельности красит
// оба кейса ниже):
//   1. `start()` гидрирует `me` с диска — симметрично write-through `saveMe` в
//      `setMe`, и строго ПОСЛЕ `persistScope` (тот стирает данные прошлого
//      аккаунта, чтение до него отдало бы чужой профиль);
//   2. `messages` получает гейт `meReady: () => meReady`, и сетевые границы
//      маппинга ждут его перед выводом `out`.
//
// Прогон настоящий: createWorkerCore() + core.start(), тот же messagesManager и
// тот же persist, что в проде. fake-indexeddb — ПЕРВОЙ строкой (newCursor()/
// newConnectionManager() читают IndexedDB прямо в конструкторе createWorkerCore,
// а RestClient гейтит запросы на tokens.ready()).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveMe } from './store/persist'
import type { User } from './managers/authManager'

const ME: User = {
  id: 7, phone: '+79990000007', username: 'me', firstName: 'Я', lastName: '',
  displayName: 'Я', bio: '', birthday: null, avatarUrl: '', avatarPreview: '',
  phoneVisibility: 'contacts', premium: false, emojiStatus: '',
}

// Страница истории: одно моё сообщение, одно чужое. `/me` в этом стенде НЕ
// отвечает вовсе (токена нет → authManager.fetchMe возвращает null, не ходя в
// сеть) — ровно тот случай, ради которого нужна гидрация с диска.
const historyPage = {
  messages: [
    { id: 2, chat_id: 1, seq: 2, sender_id: 7, type: 'text', text: 'моё', reply_to_id: null, media_id: null, created_at: '2026-08-16T10:00:00Z' },
    { id: 1, chat_id: 1, seq: 1, sender_id: 3, type: 'text', text: 'чужое', reply_to_id: null, media_id: null, created_at: '2026-08-16T10:00:00Z' },
  ],
  count: 2,
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/chats/1/history')) return new Response(JSON.stringify(historyPage), { status: 200 })
    throw new Error('unexpected fetch ' + u)
  }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): личность гидрируется с диска ДО обслуживания истории', () => {
  it('страница, запрошенная сразу после start(), знает, какие сообщения мои', async () => {
    await saveMe(ME) // прошлый запуск оставил профиль на диске (write-through setMe)

    const core = createWorkerCore()
    core.start()
    // Вкладка просит историю НЕ дожидаясь ничего — так и происходит на холодном
    // старте (boot вкладки шлёт RPC, как только поднялся порт).
    const r = await core.registry.messages.getHistory({ chatId: 1 })

    expect(r.messages.map((m) => [m.seq, m.out])).toEqual([[1, false], [2, true]])
  })

  it('пустой диск гейт не подвешивает: история приезжает (пусть и вся входящей)', async () => {
    // Диск чистим ЯВНО: `core/store/persist.ts` мемоизирует соединение в
    // модульном `dbPromise`, поэтому свежий IDBFactory из beforeEach его не
    // переоткрывает — профиль предыдущего кейса иначе доживает сюда.
    await saveMe(null)

    const core = createWorkerCore()
    core.start()

    // Ключевое здесь — что промис вообще резолвится: гейт снимается в любом
    // исходе гидрации, включая «на диске ничего нет». Подвисший навсегда гейт
    // заморозил бы ленту, что хуже неверного `out`.
    const r = await core.registry.messages.getHistory({ chatId: 1 })

    expect(r.messages.map((m) => m.out)).toEqual([false, false])
  })
})
