// Офлайн-ветка getHistory: сети нет — окно поднимается С ДИСКА.
//
// Прежде этот файл проверял ДРУГОЕ — что читатель диска ПЕРЕСЧИТЫВАЕТ `out`.
// Предмет исчез: `pFlags.out` производит сервер (решение Р7 отменено), выводить
// на клиенте нечего, и вместе с выводом ушёл гейт `me` из этой ветки. Осталось
// то, ради чего ветка вообще есть, и оно до сих пор не было запинено отдельно:
// сохранённая страница отдаётся как есть, помечается `cached`, и ею СИДЯТСЯ
// SSOT и срез — иначе следующий такой же запрос снова ушёл бы в упавшую сеть.
//
// Отдельный файл от messagesManager.test.ts: `fake-indexeddb/auto` — глобальный
// побочный эффект на весь модуль, а тем тестам реальная IDB не нужна (приём из
// peersManager.persist.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { newMessagesManager } from './messagesManager'
import { saveMessages } from '../store/persist'
import { makeMessage } from '../messages/testMessage'
import { generateMessageId } from '../history/messageId'
import type { MessageReal, MyMessage } from '../models'
import type { RestClient } from '../net/restClient'

/** Сети нет: fetch реджектится обычной ошибкой (не HttpError) — ровно тот
 *  случай, в котором getHistory уходит в офлайн-фолбэк. */
const offlineRest = () => {
  const get = vi.fn(async () => { throw new TypeError('Failed to fetch') })
  return { rest: { get } as unknown as RestClient, get }
}

/** Снимок на диске — номера в нём КЛИЕНТСКИЕ: границу разбора страница прошла
 *  ещё в ту сессию, когда её сохраняли. */
const stored = (id: number, over: Partial<MessageReal> = {}): MyMessage =>
  ({ ...makeMessage({ id: generateMessageId(id), peerId: 1, fromId: 2, text: `m${id}`, date: 1_750_000_000 }), ...over })

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('getHistory (офлайн): окно поднимается с диска', () => {
  it('падение сети отдаёт сохранённую страницу, помеченную cached', async () => {
    await saveMessages(1, [stored(1), stored(2)])
    const { rest } = offlineRest()

    const r = await newMessagesManager({ rest }).getHistory({ peerId: 1 })

    expect(r.cached).toBe(true)
    expect(r.messages.map((m) => m.id)).toEqual([generateMessageId(1), generateMessageId(2)])
    // Низ истории известен (последнее, что успели сохранить), верх — нет:
    // пагинация вверх остаётся включённой.
    expect(r.reachedBottom).toBe(true)
    expect(r.reachedTop).toBe(false)
  })

  // Что ломается: не сиди ветка SSOT и срез, каждое переоткрытие чата офлайн
  // снова било бы в упавшую сеть и ждало её таймаута — при том, что данные уже
  // в памяти.
  it('поднятое с диска садится в SSOT: второй такой же запрос в сеть не идёт', async () => {
    await saveMessages(1, [stored(1), stored(2)])
    const { rest, get } = offlineRest()
    const mgr = newMessagesManager({ rest })

    await mgr.getHistory({ peerId: 1 })
    const again = await mgr.getHistory({ peerId: 1 })

    expect(get).toHaveBeenCalledTimes(1)
    expect(again.cached).toBe(true)
    expect(again.messages.map((m) => m.id)).toEqual([generateMessageId(1), generateMessageId(2)])
  })

  // `pFlags.out` приезжает с СЕРВЕРА и хранится как есть: пересчитывать его при
  // чтении нечем (у поста от лица канала автором стоит сам канал). Названный
  // остаток — история прошлого аккаунта на диске; см. докблок ветки.
  it('сохранённый pFlags.out отдаётся как есть, без пересчёта', async () => {
    await saveMessages(1, [stored(1, { pFlags: { out: true } })])
    const { rest } = offlineRest()

    const r = await newMessagesManager({ rest, getMeId: () => 999 }).getHistory({ peerId: 1 })

    expect(r.messages[0].pFlags.out).toBe(true)
  })

  // Чат, которого на диске нет вовсе (`core/store/persist.ts` мемоизирует
  // соединение в модульном `dbPromise`, поэтому свежий IDBFactory из beforeEach
  // его не переоткрывает — берём заведомо чужой ключ, а не чистый диск).
  it('пустой диск фолбэком не считается — ошибка сети пробрасывается', async () => {
    const { rest } = offlineRest()
    await expect(newMessagesManager({ rest }).getHistory({ peerId: 4242 })).rejects.toThrow('Failed to fetch')
  })
})
