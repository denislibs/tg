// Гонка личности на холодном старте.
//
// ПРЕДМЕТ ГЕЙТА СМЕНИЛСЯ вместе с портом сообщения. Прежде он держал
// `Message.out`: бэкенд флага не отдавал, воркер выводил его сам сравнением
// автора с `me`, и страница, обслуженная раньше ответа `/me`, уезжала вкладке с
// out=false у ВСЕХ сообщений. Теперь `pFlags.out` производит СЕРВЕР (решение Р7
// отменено), и этой гонки нет.
//
// Но `me` воркеру по-прежнему нужен, и ровно на границе разбора: сервер
// производит только НАСТОЯЩИЕ конструкторы служебного действия, а клиент
// уточняет их до синтетических — «Вы присоединились» против «X присоединился»
// (`refineMessageAction`, порт appMessagesManager.ts:5215-5238). Обслуженная
// раньше гидрации страница отдала бы вкладке ЧУЖУЮ формулировку пилюли.
//
// Закрыто ДВУМЯ строками, и обе пинит этот файл (каждая по отдельности красит
// оба кейса ниже):
//   1. `start()` гидрирует `me` с диска — симметрично write-through `saveMe` в
//      `setMe`, и строго ПОСЛЕ `persistScope` (тот стирает данные прошлого
//      аккаунта, чтение до него отдало бы чужой профиль);
//   2. `messages` получает гейт `meReady: () => meReady`, и сетевые границы
//      маппинга ждут его перед уточнением действия.
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
import { makeRawServiceMessage } from './messages/testMessage'
import type { PeerProfile } from './managers/authManager'
import type { MyMessage } from './models'

const ME: PeerProfile = {
  user: { _: 'user', pFlags: { self: true }, id: 7, phone: '+79990000007', username: 'me', first_name: 'Я', photo: { _: 'userProfilePhotoEmpty' } },
  fullUser: { _: 'userFull', id: 7 },
  canMessage: true,
}

// Страница истории: пилюля «участник добавил сам себя». `/me` в этом стенде НЕ
// отвечает вовсе (токена нет → authManager.fetchMe возвращает null, не ходя в
// сеть) — ровно тот случай, ради которого нужна гидрация с диска.
const historyPage = {
  messages: [
    makeRawServiceMessage({ id: 1, peerId: 1, fromId: 7, action: { _: 'messageActionChatAddUser', users: [7] } }),
  ],
  count: 1,
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

const actionOf = (m: MyMessage) => (m._ === 'messageService' ? m.action._ : undefined)

describe('createWorkerCore(): личность гидрируется с диска ДО обслуживания истории', () => {
  it('страница, запрошенная сразу после start(), знает, что пилюля про ЗРИТЕЛЯ', async () => {
    await saveMe(ME) // прошлый запуск оставил профиль на диске (write-through setMe)

    const core = createWorkerCore()
    core.start()
    // Вкладка просит историю НЕ дожидаясь ничего — так и происходит на холодном
    // старте (boot вкладки шлёт RPC, как только поднялся порт).
    const r = await core.registry.messages.getHistory({ peerId: 1 })

    expect(r.messages.map(actionOf)).toEqual(['messageActionChatJoinedYou'])
  })

  it('пустой диск гейт не подвешивает: история приезжает (пусть и с формулировкой про другого)', async () => {
    // Диск чистим ЯВНО: `core/store/persist.ts` мемоизирует соединение в
    // модульном `dbPromise`, поэтому свежий IDBFactory из beforeEach его не
    // переоткрывает — профиль предыдущего кейса иначе доживает сюда.
    await saveMe(null)

    const core = createWorkerCore()
    core.start()

    // Ключевое здесь — что промис вообще резолвится: гейт снимается в любом
    // исходе гидрации, включая «на диске ничего нет». Подвисший навсегда гейт
    // заморозил бы ленту, что хуже неточной формулировки.
    const r = await core.registry.messages.getHistory({ peerId: 1 })

    expect(r.messages.map(actionOf)).toEqual(['messageActionChatJoined'])
  })
})
