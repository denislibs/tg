// Офлайн-ветка getHistory и поле `out` (порт tweb pFlags.out).
//
// Бэкенд флага не отдаёт — его выводит владелец, поэтому значение ПРИВЯЗАНО К
// СЕССИИ, а офлайн-стор её переживает: `onLoggingOut` в воркере IndexedDB не
// чистит (это делает вкладка — useAuthGate → persist.clearAll(), и только в
// ветке migrateTo === null), а вход другого пользователя на вкладке, которая
// была на экране входа, идёт вообще без reload. Поэтому читатель диска обязан
// ПЕРЕСЧИТЫВАТЬ `out`, а не доверять сохранённому: иначе после смены аккаунта
// офлайн-история прошлого пользователя рисуется его глазами (чужие сообщения
// справа, с галочками).
//
// Отдельный файл от messagesManager.test.ts: `fake-indexeddb/auto` — глобальный
// побочный эффект на весь модуль, а тем тестам реальная IDB не нужна (приём из
// peersManager.persist.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import { newMessagesManager } from './messagesManager'
import { saveMessages } from '../store/persist'
import type { Message } from '../models'
import type { RestClient } from '../net/restClient'

/** Сети нет: fetch реджектится обычной ошибкой (не HttpError) — ровно тот
 *  случай, в котором getHistory уходит в офлайн-фолбэк. */
const offlineRest = { async get<R>(): Promise<R> { throw new TypeError('Failed to fetch') } } as unknown as RestClient

const stored = (over: Partial<Message> & { id: number; seq: number }): Message => ({
  chatId: 1, senderId: 2, type: 'text', text: 'm', replyToId: null, mediaId: null,
  createdAt: '2026-06-24T10:00:00Z', threadRootId: null, ...over,
})

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('getHistory (офлайн): `out` пересчитывается, а не читается с диска', () => {
  it('протухшее out=false на МОЁМ сообщении чинится при чтении', async () => {
    // На диске лежит снимок прошлой сессии: тогда автором был не я.
    await saveMessages(1, [stored({ id: 1, seq: 1, senderId: 7, out: false })])

    const mgr = newMessagesManager({ rest: offlineRest, getMeId: () => 7 })
    const r = await mgr.getHistory({ chatId: 1 })

    expect(r.cached).toBe(true)
    expect(r.messages[0].out).toBe(true)
  })

  it('протухшее out=true на ЧУЖОМ сообщении тоже чинится (смена аккаунта)', async () => {
    await saveMessages(1, [stored({ id: 1, seq: 1, senderId: 2, out: true })])

    const mgr = newMessagesManager({ rest: offlineRest, getMeId: () => 7 })
    const r = await mgr.getHistory({ chatId: 1 })

    expect(r.messages[0].out).toBe(false)
  })

  it('send-as с диска остаётся входящим (правило то же, что у сетевой границы)', async () => {
    await saveMessages(1, [stored({ id: 1, seq: 1, senderId: 7, sendAs: { chatId: 9, title: 'Канал' }, out: true })])

    const mgr = newMessagesManager({ rest: offlineRest, getMeId: () => 7 })
    const r = await mgr.getHistory({ chatId: 1 })

    expect(r.messages[0].out).toBe(false)
  })
})
