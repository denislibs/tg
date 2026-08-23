// src/core/managers/messagesManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import { mapMyMessage, type MessageReal, type MyMessage, type RawMessage, type RawMessageReal } from '../models'
import type { NewMessageEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt, DeleteMessageEvt } from '../realtime/events'
import { RT } from '../realtime/events'
import type { MessageOp } from '../realtime/messageOps'
import { generateMessageId } from '../history/messageId'
import { makeRawMessage } from '../messages/testMessage'
import { getDocumentFromMessage, getMediaFromMessage, pollOptionKey, type MessageMedia, type MessageMediaPoll, type MessageMediaToDo } from '../media/messageMedia'

/** Номер в КЛИЕНТСКОМ пространстве. Чисел стало ОДНО (решение Р1): у сообщения
 *  больше нет пары «адрес + порядок», а на проводе номера СЕРВЕРНЫЕ — граница
 *  между пространствами и есть то, что здесь проверяется чаще всего. */
const cid = generateMessageId

const real = (m: MyMessage | undefined): MessageReal | undefined =>
  m?._ === 'message' ? m : undefined

function rawPage(ids: number[]): { messages: RawMessage[]; count: number } {
  // backend returns newest-first (DESC) for offset_id=0 / older pages
  const messages = ids.map((id) => makeRawMessage({
    id, peerId: 1, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z',
  }) as RawMessage)
  return { messages, count: messages.length }
}

function countingRest(pages: Record<string, { messages: RawMessage[]; count: number }>) {
  let calls = 0
  const rest = {
    get: async (_path: string, q?: Record<string, string | number>) => {
      calls++
      const key = `${q?.offset_id ?? 0}:${q?.add_offset ?? 0}:${q?.limit ?? 0}`
      return pages[key] ?? { messages: [], count: 0 }
    },
    post: async () => ({}),
  } as unknown as RestClient
  return { rest, calls: () => calls }
}

describe('MessagesManager.getHistory', () => {
  it('fetches the newest window and returns ascending messages', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    // Номера на выходе КЛИЕНТСКИЕ: страница пришла с сервера, границу маппинга
    // она уже прошла.
    expect(r.messages.map((m) => m.id)).toEqual([cid(3), cid(4), cid(5)]) // ascending for UI
    expect(r.count).toBe(3)
  })

  it('serves the second identical request from cache (no extra REST call)', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(1)
  })

  it('reports reachedTop when an older page is short', async () => {
    const { rest } = countingRest({
      '0:0:40': rawPage([5, 4, 3, 2, 1]),
      '1:1:40': rawPage([1]), // older inclusive of 1 → just [1] (< limit)
    })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const older = await mgr.getHistory({ peerId: 1, offsetId: cid(1), addOffset: 1, limit: 40 })
    expect(older.reachedTop).toBe(true)
  })

  // Regression: re-opening a chat (cached newest page of exactly `limit`) must
  // NOT report reachedTop — the real top isn't reached, so scroll-up paging
  // stays enabled. (Previously `fulfilled` conflated page-satisfied with top.)
  it('does not report reachedTop on re-open when only the newest page is cached', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const first = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(first.reachedTop).toBe(false)
    // simulate re-open: identical initial request, now served from cache
    const reopen = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 3 })
    expect(reopen.reachedBottom).toBe(true)
    expect(reopen.reachedTop).toBe(false)
  })
})

describe('MessagesManager.sendMessage', () => {
  it('POSTs and returns the created message, caching it', async () => {
    const created = makeRawMessage({ id: 6, peerId: 1, fromId: 1, text: 'hey', createdAt: '2026-06-24T11:00:00Z' })
    const rest = { post: async () => created, get: async () => ({ messages: [], count: 0 }) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const m = await mgr.sendMessage({ peerId: 1, text: 'hey', clientMsgId: 'c1' })
    expect(m.id).toBe(cid(6))
    expect(real(m)?.message).toBe('hey')
  })

  it('forwards reply_to_peer_id for a cross-chat reply', async () => {
    let body: Record<string, unknown> = {}
    const created = makeRawMessage({ id: 6, peerId: 1, fromId: 1, text: 'hey', createdAt: '2026-06-24T11:00:00Z', replyToMsgId: 5 })
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return created } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.sendMessage({ peerId: 1, text: 'hey', clientMsgId: 'c1', replyToId: cid(5), replyToPeerId: 99 })
    // В теле запроса номер СЕРВЕРНЫЙ: всё, что уходит на сервер, проходит через
    // `getServerMessageId` — иначе бэкенд получил бы клиентское число и ответил
    // бы 404 (громко, а не молчаливой подменой).
    expect(body.reply_to_id).toBe(5)
    expect(body.reply_to_peer_id).toBe(99)
  })
})

describe('MessagesManager scheduled', () => {
  // Отдельной формы «запланированного» на проводе больше НЕТ: это обычное
  // сообщение (`message`) с нашим параметром `send_at` — отложенность выражена
  // полем, а не вторым конструктором и вторым маппером к нему.
  const rawScheduled = (over: Record<string, unknown> = {}) => ({
    ...makeRawMessage({ id: 1, peerId: 1, fromId: 1, text: 'later', createdAt: '2026-07-19T10:00:00Z' }),
    send_at: 1_784_937_600, ...over,
  })

  it('sends when_online=true and maps the whenOnline flag', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled({ when_online: true }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 0, whenOnline: true })
    expect(body.when_online).toBe(true)
    expect(real(s)?.when_online).toBe(true)
  })

  it('defaults when_online to false for a dated schedule', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled() } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 1_800_000_000 })
    expect(body.when_online).toBe(false)
    // В ОТВЕТЕ ключа нет вовсе — «выключено» у флага это его отсутствие, а не
    // `false` (то же правило, что у всех pFlags схемы).
    expect(real(s)?.when_online).toBeUndefined()
  })

  it('editScheduled PATCHes the new send_at and returns the updated record', async () => {
    let path = ''
    let body: Record<string, unknown> = {}
    const rest = { patch: async (p: string, b: Record<string, unknown>) => { path = p; body = b; return rawScheduled({ send_at: 1_800_000_500 }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    // Адрес строки — СЕРВЕРНЫЙ номер: клиентское пространство общее (границу
    // разбора проходит всё), значит и обратно приводится тем же способом.
    const s = await mgr.editScheduled(1, cid(7), 1_800_000_500)
    expect(path).toBe('/chats/1/scheduled/7')
    expect(body.send_at).toBe(1_800_000_500)
    expect(real(s)?.send_at).toBe(1_800_000_500)
  })
})

/** Кадр `new_message` несёт сообщение ЦЕЛИКОМ под ключом `message` — форма
 *  `updateNewMessage` (решение Р5). Второй проводной формы сообщения (плоские
 *  `msg_id`/`seq`/`sender_id`/`text` прямо в кадре) и второго маппера к ней
 *  больше нет, поэтому и фикстура кадра строится той же фабрикой, что страница
 *  истории. */
const liveEvt = (m: RawMessageReal, over: Partial<NewMessageEvt> = {}): NewMessageEvt =>
  ({ _: 'updateNewMessage', message: m as RawMessage, ...over })

describe('MessagesManager.cacheLive', () => {
  // Ссылка на кросс-чат ответ должна пережить кэш — иначе при переоткрытии чата
  // из кэша плашка ответа теряет чат оригинала. Снимка `{name, text}` рядом
  // больше нет: едет `reply_to.reply_from`/`reply_media`, а превью строит тот,
  // кто рисует.
  it('preserves the cross-chat reply reference in the cache entry', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive(liveEvt({
      ...makeRawMessage({ id: 4, peerId: 1, fromId: 1, text: 'ответ', createdAt: '2026-06-24T10:00:00Z' }),
      reply_to: {
        _: 'messageReplyHeader',
        reply_to_msg_id: 999,
        reply_to_peer_id: { _: 'peerChannel', channel_id: 77 },
        reply_from: { _: 'messageFwdHeader', from_name: 'Алиса', date: 0 },
      },
    }))
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === cid(4))
    expect(live).toBeTruthy()
    expect(live?.reply_to?.reply_to_peer_id).toEqual({ _: 'peerChannel', channel_id: 77 })
    expect(live?.reply_to?.reply_from?.from_name).toBe('Алиса')
    // Номер оригинала тоже переведён в клиентское пространство — иначе плашка
    // не нашла бы его в окне.
    expect(live?.reply_to?.reply_to_msg_id).toBe(cid(999))
  })

  // Эхо своей отправки узнаётся по `random_id` — КОНСТРУКТОРНОМУ параметру
  // схемы, а не по нашему `client_msg_id` рядом с ним. По нему же сливается
  // временный бабл (messageOps.insert), поэтому потеря поля в кэше означала бы
  // «отправляется…» рядом с уже отправленным после переоткрытия чата.
  it('preserves random_id of a live message for cache reopen', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive(liveEvt(makeRawMessage({
      id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z', randomId: 'c-live-1',
    })))
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === cid(4))
    expect(live).toBeTruthy()
    expect(live?.random_id).toBe('c-live-1')
  })

  // Task 3 (Stage 1B.2): cacheLive должен возвращать MessageOp[] — операции для
  // проектора на главном потоке. Обычное сообщение → одна операция insert с
  // ключом основного окна (тот же формат, что hkey/winKey — просто String(peerId)).
  it('returns one insert op keyed to the main window for an ordinary message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 4, peerId: 1, fromId: 1, text: 'hi', createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({ op: 'insert', key: '1', msg: expect.objectContaining({ id: cid(4) }) })
  })

  // Тред-сообщение при обоих загруженных срезах (основное окно чата + окно
  // треда) → ДВЕ операции, по одной на каждое затронутое окно (порт applyIncoming,
  // который пишет в оба ключа при threadRootId).
  it('returns two insert ops (main + thread window) when both slices are loaded', async () => {
    // thread window — свой ключ истории (thread_root=100), тоже полная «нижняя»
    // страница (offsetId=0 → всегда держит низ).
    const threadPage = { messages: [makeRawMessage({ id: 2, peerId: 1, fromId: 1, text: 'root reply', threadRootId: 100, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage], count: 1 }
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        if (q?.thread_root === 100) return threadPage
        return rawPage([3, 2, 1])
      },
      post: async () => ({}),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    // Корень треда живёт ВНУТРИ ссылки на ответ (`reply_to.reply_to_top_id`) —
    // отдельного `thread_root_id` рядом с сообщением больше нет.
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 5, peerId: 1, fromId: 1, text: 'thread hi', threadRootId: 100, createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of ops) {
      expect(op.op).toBe('insert')
      if (op.op === 'insert') expect(op.msg.id).toBe(cid(5))
    }
  })

  // КРИТИЧНО: окно, не державшее низ истории (сохранена только «средняя»/старая
  // страница, offsetId!==0 без short-page), должно дать НОЛЬ операций — та же
  // семантика, что и сам гейт вставки в SSOT (messagesManager.ts:~500-501). Иначе
  // главный поток вставит туда, где воркер не вставлял, и представления разъедутся.
  it('produces no op for a window that did not hold the bottom of history', async () => {
    const { rest } = countingRest({ '10:1:3': rawPage([9, 8, 7]) }) // paging older, full (non-short) page
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 2, offsetId: cid(10), addOffset: 1, limit: 3 })
    const ops = mgr.cacheLive(liveEvt(makeRawMessage({
      id: 99, peerId: 2, fromId: 1, text: 'x', createdAt: '2026-06-24T10:00:00Z',
    })))
    expect(ops).toEqual([])
  })
})

// Пин на СПОСОБ: `cacheLive` не имеет своего маппера. Раньше их было два —
// `fromNewMessageEvt` для живого кадра и `mapMessage` для страницы истории, —
// и они молча расходились полями (кадр нёс сообщение плоско, страница —
// объектом). Теперь проводная форма ОДНА (`updateNewMessage`: сообщение целиком
// под ключом `message`), поэтому маппер тоже один, и расхождение невозможно
// by construction. Тест краснеет, если в `cacheLive` снова заведут параллельный
// литерал сборки сообщения.
describe('MessagesManager.cacheLive — сообщение собирает ТОТ ЖЕ маппер, что и страница истории', () => {
  const ME = 9
  // Кадр с максимумом полей конструктора `message`, какие несёт живое сообщение.
  const fullMessage: RawMessageReal = {
    ...makeRawMessage({
      id: 42, peerId: 3, fromId: ME, text: 'caption', createdAt: '2026-08-10T13:00:00Z',
      entities: [{ _: 'messageEntityBold', offset: 0, length: 3 }],
      threadRootId: 100, replyToMsgId: 41, groupedId: 7007, randomId: 'c-parity-1',
      mediaUnread: true, out: true,
      media: {
        _: 'messageMediaPhoto',
        photo: {
          _: 'photo', id: 555,
          sizes: [
            { _: 'photoStrippedSize', type: 'i', bytes: 'abc' },
            { _: 'photoSize', type: 'y', w: 320, h: 240, size: 1024 },
            { _: 'photoSize', type: 'w', w: 640, h: 480, size: 2048 },
          ],
        },
      },
    }),
    fwd_from: { _: 'messageFwdHeader', from_id: { _: 'peerUser', user_id: 11 }, date: 1754733600, channel_post: 13 },
    reply_markup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Click', data: 'Y2I=' }] }] },
    effect_name: 'confetti',
    secretMedia: { mediaId: 1, keyB64: 'k', ivB64: 'i', name: 'photo.jpg', mime: 'image/jpeg', size: 2048, mediaType: 'photo' },
  } as RawMessageReal

  it('cacheLive(evt).msg равен mapMyMessage(evt.message) без исключений', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: 3, offsetId: 0, addOffset: 0, limit: 40 }) // держит низ — гейт вставки открыт
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const main = ops.find((o) => o.key === '3')
    expect(main?.op).toBe('insert')
    expect(main && main.op === 'insert' ? main.msg : null).toEqual(mapMyMessage(fullMessage, ME))
  })

  it('тред-ключ той же операции тоже несёт полный (не урезанный) msg', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: 3, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 3, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const thread = ops.find((o) => o.key === `3:${cid(100)}`)
    expect(thread?.op).toBe('insert')
    expect(thread && thread.op === 'insert' ? thread.msg : null).toEqual(mapMyMessage(fullMessage, ME))
  })

  // `pFlags.out` производит СЕРВЕР (решение Р7 отменено): владелец его больше не
  // выводит и не имеет права переспорить. Прежний describe про `send_as` здесь
  // УДАЛЁН вместе с предметом — параметра `send_as` на проводе не существует, а
  // правило «сообщение от лица канала рисуется входящим» выражено через `from_id`
  // (ссылку на ЧАТ, а не на человека) и пинится там, где ему место, —
  // `core/models.test.ts` (предикат) и `core/messageToConvMsg.test.ts` (сторона
  // бабла). Здесь остаётся ровно то, за что отвечает менеджер: флаг доезжает как есть.
  it('pFlags.out кадра доезжает до операции неизменным', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: 3, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive(liveEvt(fullMessage))
    const main = ops.find((o) => o.key === '3')
    expect(main && main.op === 'insert' ? main.msg.pFlags.out : null).toBe(true)
  })
})

// Баг (см. BRIEF.md): cacheEdit патчил только text/entities/editedAt и молча
// игнорировал reply_markup из кадра edit_message, хотя витрина применяет его
// (storeProjection.ts: RT.editMessage → applyEdit(..., e.reply_markup ?? null)).
// Значит живая правка клавиатуры бота выглядела правильно (витрина её ловила
// из сырого кадра мимо SSOT), а SSOT воркера оставался со старой клавиатурой —
// расхождение всплывало только при переоткрытии чата/второй вкладке, поднимающей
// окно из кэша воркера. Правило то же, что у витрины: поле есть → положить
// значение кадра, поля нет → клавиатура снята (бэк шлёт reply_markup абсолютным
// значением, backend/internal/usecase/chat/frame.go:243).
describe('MessagesManager.cacheEdit — reply_markup', () => {
  function pageWithMarkup(): { messages: RawMessage[]; count: number } {
    const messages = [3, 2, 1].map((id) => ({
      ...makeRawMessage({ id, peerId: 1, fromId: 1, text: `m${id}`, createdAt: '2026-06-24T10:00:00Z' }),
      ...(id === 2 ? { reply_markup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] } } : {}),
    }) as RawMessage)
    return { messages, count: messages.length }
  }

  it('maps reply_markup into the SSOT when the edit carries a new keyboard', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(before.messages.find((m) => m.id === cid(2)))?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] })
    // Кадр несёт сообщение ЦЕЛИКОМ — той же формы, что приходит историей.
    mgr.cacheEdit({
      _: 'updateEditMessage',
      message: makeRawMessage({
        id: 2, peerId: 1, fromId: 1, text: 'edited', editDate: 1_786_536_000,
        replyMarkup: { _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'New', data: 'bmV3' }] }] },
      }),
    })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const edited = real(r.messages.find((m) => m.id === cid(2)))
    expect(edited?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'New', data: 'bmV3' }] }] })
  })

  it('clears replyMarkup in the SSOT when the edit carries no reply_markup (removed)', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(before.messages.find((m) => m.id === cid(2)))?.reply_markup).toEqual({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Old', data: 'b2xk' }] }] })
    mgr.cacheEdit({
      _: 'updateEditMessage',
      message: makeRawMessage({ id: 2, peerId: 1, fromId: 1, text: 'edited', editDate: 1_786_536_000 }),
    })
    const r = await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(real(r.messages.find((m) => m.id === cid(2)))?.reply_markup).toBeUndefined()
  })
})

// Stage 1B.3 (Task 3): простые правки сообщения (без обогащений витрины, см.
// docs/research/2026-08-10-message-enrichments.md) переведены на операции — по
// одной 'patch'/'remove' на каждое окно, где сообщение видно. rawPage([id...])
// заводит id===seq, поэтому msg_id ниже совпадает с seq тестовых фикстур.
// edit_message/geo_live_update намеренно НЕ переведены (см. комментарии у
// messages.cacheEdit/cacheGeoLive) — тестов на op-перевод для них здесь нет.

// Тред-фикстура (порт паттерна из describe('MessagesManager.cacheLive') выше):
// сообщение id=2/seq=2 видно и в основном окне чата (rawPage[3,2,1]), и в окне
// треда (thread_root=100) — оба среза ссылаются на ОДНУ запись SSOT (карта по
// чату, не по окну), поэтому это годный фикстур для проверки многооконности.
function restWithThreadOverlap(): RestClient {
  const threadPage = {
    messages: [makeRawMessage({
      id: 2, peerId: 1, fromId: 1, text: 'root reply', threadRootId: 100,
      createdAt: '2026-06-24T10:00:00Z',
    }) as RawMessage],
    count: 1,
  }
  return {
    get: async (_path: string, q?: Record<string, string | number>) => {
      if (q?.thread_root === 100) return threadPage
      return rawPage([3, 2, 1])
    },
    post: async () => ({}),
  } as unknown as RestClient
}

/** Карточка ссылки в форме кадра: конструктор, а не плоский снимок. */
function webPageMedia(title: string): MessageMedia {
  return {
    _: 'messageMediaWebPage',
    webpage: { _: 'webPage', url: 'https://x/', display_url: 'x', title },
  }
}

describe('MessagesManager.cacheWebPage', () => {
  it('returns a patch op carrying the mapped web page for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр несёт КОНСТРУКТОР — тот же, что и в самом сообщении, с обычной
    // лестницей ступеней у картинки. Плоской формы (`site_name`/`photo_w`/
    // `photo_blur` россыпью) на проводе нет, поэтому и переводить нечего.
    const media: MessageMedia = {
      _: 'messageMediaWebPage',
      webpage: {
        _: 'webPage', url: 'https://x/', display_url: 'x',
        site_name: 'X', title: 'Title', has_iv: true,
        photo: {
          _: 'photo', id: 7,
          sizes: [
            { _: 'photoStrippedSize', type: 'i', bytes: 'Ymx1cg==' },
            { _: 'photoSize', type: 'y', w: 1280, h: 640, size: 0 },
            { _: 'photoSize', type: 'w', w: 2000, h: 1000, size: 0 },
          ],
        },
      },
    }
    const evt: WebPageUpdateEvt = { _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2, media }
    const ops = mgr.cacheWebPage(evt)
    // Номер в кадре СЕРВЕРНЫЙ, в операции — уже клиентский: иначе патч не нашёл
    // бы сообщение в окне. Вложение доезжает как есть.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheWebPage({ _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 999, media: webPageMedia('Title') })
    expect(ops).toEqual([])
  })

  // Многооконность: воркерный patchMsg мутирует ОДНУ копию в SSOT (единая Map на
  // чат) и останавливается на первом совпадении — но сторный patchChat проходит по
  // ВСЕМ окнам чата. Без явного перечисления окон операция дошла бы только до
  // одного, и окно треда осталось бы со старыми данными.
  it('returns one patch op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const evt: WebPageUpdateEvt = { _: 'updateMessageWebPage', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2, media: webPageMedia('Title') }
    const ops = mgr.cacheWebPage(evt)
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of ops) {
      expect(op.op).toBe('patch')
      if (op.op === 'patch') {
        expect(op.fields.media?._).toBe('messageMediaWebPage')
        expect(op.fields.media?._ === 'messageMediaWebPage' && op.fields.media.webpage.title).toBe('Title')
      }
    }
  })
})

describe('MessagesManager.cacheFactCheck', () => {
  it('returns a patch op carrying the mapped fact-check for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // `factCheck` — КОНСТРУКТОР схемы, приезжающий целиком (текст внутри —
    // `textWithEntities`), поэтому маппера у него нет и быть не должно.
    const evt: FactCheckUpdateEvt = {
      _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      factcheck: { _: 'factCheck', country: 'RU', text: { _: 'textWithEntities', text: 'проверено', entities: [] } },
    }
    const ops = mgr.cacheFactCheck(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: evt.factcheck } }])
  })

  // «Сняли» — ОТСУТСТВИЕ параметра в кадре (а не null под тем же ключом);
  // fields.factcheck при этом обязан быть undefined, как и у остальных cacheX.
  it('returns fields.factcheck: undefined when the fact-check is removed', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2 })
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { factcheck: undefined } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ _: 'updateMessageFactCheck', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 999 })
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cacheMediaRead', () => {
  function voicePage(unread: boolean) {
    return {
      messages: [makeRawMessage({
        id: 7, peerId: 1, fromId: 1, text: '', createdAt: '2026-06-24T10:00:00Z',
        mediaUnread: unread,
        media: {
          _: 'messageMediaDocument',
          document: {
            _: 'document', id: 5, mime_type: 'audio/ogg', size: 10,
            attributes: [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 3 }],
          },
        },
      }) as RawMessage],
      count: 1,
    }
  }

  it('returns a patch op clearing mediaUnread for an unread voice message', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(true) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt: MediaReadEvt = { _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [7] }
    const ops = mgr.cacheMediaRead(evt)
    // «Прочитано» — ОТСУТСТВИЕ флага схемы, а не `false`: пустой `pFlags`
    // и есть снятая точка.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(7), fields: { pFlags: {} } }])
  })

  // Гейт паритетен воркерному patchMsg: уже прочитанное сообщение не патчится в
  // SSOT — значит и операция на него порождаться не должна (иначе повторный/
  // задвоенный кадр слал бы избыточный, хоть и no-op на сторной стороне, патч).
  it('produces no op when the message is already read (idempotent replay)', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(false) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [7] })
    expect(ops).toEqual([])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ _: 'updateReadPeerMessagesContents', peer: { _: 'peerUser', user_id: 1 }, messages: [999] })
    expect(ops).toEqual([])
  })
})

const lockedPaid: MessageMedia = {
  _: 'messageMediaPaidMedia',
  stars_amount: 10,
  extended_media: [{ _: 'messageExtendedMediaPreview', w: 640, h: 480 }],
}

describe('MessagesManager.cachePaidUnlock', () => {
  it('returns a patch op carrying the media fields + paidMedia (not a whole-message replace)', async () => {
    // Сообщение в SSOT — ЗАБЛОКИРОВАННОЕ платное: цену кадр не везёт (она
    // свойство самого вложения), поэтому обёртку берём у сообщения.
    const { rest } = countingRest({ '0:0:40': mediaPage(2, lockedPaid) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр разблокировки несёт ВЛОЖЕНИЕ целиком: у заблокированного сервер
    // отдавал псевдо-фото из одной stripped-ступени (LockedPlaceholder), здесь
    // приезжает настоящая лестница.
    const media: MessageMedia = {
      _: 'messageMediaPhoto',
      photo: {
        _: 'photo',
        id: 55,
        sizes: [
          { _: 'photoStrippedSize', type: 'i', bytes: 'abc' },
          { _: 'photoSize', type: 'w', w: 640, h: 480, size: 2048 },
        ],
      },
    }
    // Оплачено — позиция вектора становится `messageExtendedMedia` с настоящим
    // вложением внутри; цена (`stars_amount`) при этом на месте, она свойство
    // самого платного вложения.
    const unlocked: MessageMedia = {
      _: 'messageMediaPaidMedia',
      stars_amount: 10,
      extended_media: [{ _: 'messageExtendedMedia', media }],
    }
    // Кадр несёт РОВНО предмет — вектор позиций; цена берётся у сообщения,
    // потому что она свойство самого платного вложения, а не приписка кадра.
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      extended_media: unlocked.extended_media,
    })
    // Плоского `media_id` рядом нет — адрес файла живёт ВНУТРИ вложения.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media: unlocked } }])
    expect(getMediaFromMessage({ media: ops[0].op === 'patch' ? ops[0].fields.media : undefined })!.id).toBe(55)
  })

  // Бэк вычищает у заблокированного медиа ВСЮ мету контента (stripLockedMedia
  // оставляет только псевдо-фото из stripped-ступени) и возвращает её кадром
  // разблокировки. Патч обязан нести вложение целиком и УЖЕ нормализованным
  // (`saveMessageMedia`), иначе у оплаченного документа нет выведенного типа:
  // оплаченное аудио остаётся без подписи, а оплаченная гифка рисуется
  // видео-баблом до перезагрузки истории.
  it('переносит вложение целиком, с выведенным типом документа', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(2, lockedPaid) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser' as const, user_id: 1 }, msg_id: 2,
      extended_media: [{
        _: 'messageExtendedMedia',
        media: {
          _: 'messageMediaDocument',
          document: {
            _: 'document', id: 55, mime_type: 'video/mp4', size: 10,
            attributes: [
              { _: 'documentAttributeVideo', duration: 3, w: 320, h: 240 },
              { _: 'documentAttributeAnimated' },
              { _: 'documentAttributeFilename', file_name: 'g.mp4' },
            ],
          },
        },
      }],
    })
    const patch = ops[0]
    const fields = patch?.op === 'patch' ? patch.fields : null
    // Нормализация обязана зайти ВНУТРЬ обёртки платного медиа — иначе у
    // оплаченного документа нет выведенного типа.
    const doc = getDocumentFromMessage({ media: fields?.media })
    expect(doc?.type).toBe('gif') // выведен из documentAttributeAnimated
    expect(doc?.file_name).toBe('g.mp4')
    expect(doc?.duration).toBe(3)
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({
      _: 'updateMessageExtendedMedia', peer: { _: 'peerUser', user_id: 1 }, msg_id: 999,
      extended_media: [{ _: 'messageExtendedMedia', media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } } }],
    })
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cacheDelete', () => {
  it('returns a remove op for the window holding the deleted message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt: DeleteMessageEvt = { _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2] }
    const ops = mgr.cacheDelete(evt)
    expect(ops).toEqual([{ op: 'remove', key: '1', msgId: cid(2) }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [999] })
    expect(ops).toEqual([])
  })

  // Многооконность для remove: ключи окон обязаны вычисляться ДО evictMsg — после
  // удаления seq уже выкинут из всех срезов, и второй проход не нашёл бы ни
  // основное окно, ни окно треда (регресс, который эта проверка ловит).
  it('returns one remove op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })
    const ops = mgr.cacheDelete({ _: 'updateDeletePeerMessages', peer: { _: 'peerUser', user_id: 1 }, messages: [2] })
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: cid(2) })
  })
})

// Регрессия (финальное ревью feat/remaining-ops, Regression 2): deleteMessage
// (RPC-путь удаления из меню сообщения) после REST зовёт evictMsg НАПРЯМУЮ, минуя
// cacheDelete — окна опустошаются в SSOT, но операции remove не рассылаются.
// [RT.deleteMessage] убран из реестра APPLY проектора (storeProjection.ts) —
// окно теперь правит ТОЛЬКО applyOps(RT.messageOp), поэтому другие вкладки того
// же пользователя не удаляют сообщение из открытых окон, пока не перезагрузятся.
// Вкладка-инициатор чинит своё окно сама (useMessageActions → applyDelete) — эти
// тесты бьют именно по RPC-пути, который должен разослать ops остальным вкладкам.
describe('MessagesManager.deleteMessage (RPC path)', () => {
  it('broadcasts one remove op per window where the message was visible, computed BEFORE eviction', async () => {
    const overlap = restWithThreadOverlap() as unknown as { get: RestClient['get']; post: RestClient['post'] }
    const rest = { ...overlap, del: async () => ({ ok: true }) } as unknown as RestClient
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40, threadRoot: cid(100) })

    await mgr.deleteMessage(1, cid(2), false)

    expect(broadcast).toHaveBeenCalledTimes(1)
    const [event, payload] = broadcast.mock.calls[0] as [string, { ops: MessageOp[] }]
    expect(event).toBe(RT.messageOp)
    expect(payload.ops).toHaveLength(2)
    expect(payload.ops.map((o) => o.key).sort()).toEqual(['1', `1:${cid(100)}`])
    for (const op of payload.ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: cid(2) })
  })

  it('does not broadcast when the message is absent from every window', async () => {
    const { rest: base } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const rest = { ...(base as unknown as { get: RestClient['get']; post: RestClient['post'] }), del: async () => ({ ok: true }) } as unknown as RestClient
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })

    await mgr.deleteMessage(1, cid(999), false)

    expect(broadcast).not.toHaveBeenCalled()
  })
})

// Task 4 (Stage 1B.3): опросы / чек-листы / розыгрыши. Все три едут ТЕМ ЖЕ
// конструктором, что и внутри сообщения, под ключом `media`, и сообщение
// находят не по номеру (его в кадре нет), а по идентификатору ВНУТРИ вложения.
//
// cachePoll обновляет SSOT воркера целиком — это его офлайн-кэш; операция же
// несёт агрегат КАК ПРИШЁЛ, без `pFlags.chosen`, потому что общий кадр его и не
// содержит (сервер собирает итоги для «зрителя 0»). Сохранение выбора ОКНА
// проверяет messageOps.test.ts (applyOp).
const pollMedia = (over?: { id?: number; voters?: number[]; chosen?: number; totalVoters?: number }): MessageMediaPoll => ({
  _: 'messageMediaPoll',
  poll: {
    _: 'poll',
    id: over?.id ?? 5,
    question: { _: 'textWithEntities', text: 'q', entities: [] },
    answers: [0, 1].map((i) => ({
      _: 'pollAnswer' as const,
      text: { _: 'textWithEntities' as const, text: i ? 'b' : 'a', entities: [] },
      option: pollOptionKey(i),
    })),
  },
  results: {
    _: 'pollResults',
    total_voters: over?.totalVoters ?? 1,
    results: [0, 1].map((i) => ({
      _: 'pollAnswerVoters' as const,
      option: pollOptionKey(i),
      voters: (over?.voters ?? [1, 0])[i],
      ...(over?.chosen === i ? { pFlags: { chosen: true as const } } : {}),
    })),
  },
})

function mediaPage(msgId: number, media: MessageMedia) {
  return {
    messages: [{
      ...makeRawMessage({ id: msgId, peerId: 1, fromId: 1, text: '', createdAt: '2026-06-24T10:00:00Z' }),
      media,
    } as RawMessage],
    count: 1,
  }
}

describe('MessagesManager.cachePoll', () => {
  it('операция несёт вложение КАК ПРИШЛО — без chosen из SSOT', async () => {
    // SSOT уже держит МОЙ выбор (вариант 0) — live-кадр его не несёт.
    const { rest } = countingRest({ '0:0:40': mediaPage(2, pollMedia({ chosen: 0 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Кадр несёт опрос и итоги ОТДЕЛЬНЫМИ параметрами: вложение собирается
    // обратно на границе разбора, окно хранит его вложением сообщения.
    const media = pollMedia({ voters: [1, 1], totalVoters: 2 })
    const ops = mgr.cachePoll({
      _: 'updateMessagePoll', peer: { _: 'peerUser', user_id: 1 },
      poll_id: media.poll.id, poll: media.poll, results: media.results,
    })
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(2), fields: { media } }])
    const patched = ops[0].op === 'patch' ? ops[0].fields.media : undefined
    expect(patched?._ === 'messageMediaPoll' && patched.results.results?.some((r) => r.pFlags?.chosen)).toBe(false)
  })

  it('produces no op when no message in the SSOT carries this poll id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(2, pollMedia({ id: 5 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePoll({ _: 'updateMessagePoll' as const, peer: { _: 'peerUser' as const, user_id: 1 }, poll_id: (pollMedia({ id: 999 })).poll.id, poll: (pollMedia({ id: 999 })).poll, results: (pollMedia({ id: 999 })).results })
    expect(ops).toEqual([])
  })
})

const todoMedia = (over?: { id?: number; marked?: boolean }): MessageMediaToDo => ({
  _: 'messageMediaToDo',
  todo: {
    _: 'todoList',
    id: over?.id ?? 8,
    pFlags: { others_can_complete: true },
    title: { _: 'textWithEntities', text: 't', entities: [] },
    list: [{ _: 'todoItem', id: 1, title: { _: 'textWithEntities', text: 'i1', entities: [] } }],
  },
  ...(over?.marked
    ? { completions: [{ _: 'todoCompletion' as const, id: 1, completed_by: { _: 'peerUser' as const, user_id: 1 }, date: 7 }] }
    : {}),
})

describe('MessagesManager.cacheChecklist', () => {
  it('returns a patch op carrying the media (no local field — full replace is correct here)', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(3, todoMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const evt = { _: 'updateMessageToDo' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia({ marked: true }) }
    const ops = mgr.cacheChecklist(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(3), fields: { media: evt.media } }])
  })

  it('produces no op when no message in the SSOT carries this checklist id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(3, todoMedia({ id: 8 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheChecklist({ _: 'updateMessageToDo' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia({ id: 999 }) })
    expect(ops).toEqual([])
  })
})

const giveawayMedia = (over?: { id?: number; participants?: number }): MessageMedia => ({
  _: 'messageMediaGiveaway',
  id: over?.id ?? 9,
  pFlags: { winners_are_visible: true },
  channels: [1],
  quantity: 1,
  months: 3,
  until_date: 0,
})

/** Состоявшийся розыгрыш — ДРУГОЙ конструктор того же вложения. */
const giveawayResultsMedia = (id = 9): MessageMedia => ({
  _: 'messageMediaGiveawayResults',
  id,
  channel_id: 1,
  launch_msg_id: 4,
  winners_count: 1,
  unclaimed_count: 0,
  winners: [77],
  months: 3,
  until_date: 0,
})

describe('MessagesManager.cacheGiveaway', () => {
  it('находит сообщение по id ВНУТРИ вложения и заменяет вложение целиком', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    // Розыгрыш состоялся — приезжает ДРУГОЙ конструктор с тем же id.
    const evt = { _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: giveawayResultsMedia() }
    const ops = mgr.cacheGiveaway(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: cid(4), fields: { media: evt.media } }])
    // Номер сообщения-запуска — такой же адрес, как `message.id`, и на границе
    // кадра он переводится тем же приведением, что и на границе разбора
    // сообщения. Иначе «перейти к сообщению-запуску» промахнулось бы: кадр
    // несёт СЕРВЕРНОЕ число, а окно живёт в клиентском пространстве.
    const patched = ops[0].op === 'patch' ? ops[0].fields.media : undefined
    expect(patched?._ === 'messageMediaGiveawayResults' && patched.launch_msg_id).toBe(cid(4))
  })

  it('produces no op when no message in the SSOT carries this giveaway id', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia({ id: 9 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheGiveaway({ _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: giveawayMedia({ id: 999 }) })
    expect(ops).toEqual([])
  })

  it('вложение не розыгрыш — операции нет вовсе', async () => {
    const { rest } = countingRest({ '0:0:40': mediaPage(4, giveawayMedia()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(mgr.cacheGiveaway({ _: 'updateMessageGiveaway' as const, peer: { _: 'peerUser' as const, user_id: 1 }, media: todoMedia() })).toEqual([])
  })
})

// ── Что владелец делает НА ГРАНИЦЕ МАППИНГА ────────────────────────────────
// Раньше здесь выводился `out`: бэкенд флага не отдавал, и владелец вычислял
// его сам на каждой границе. Теперь `pFlags.out` производит СЕРВЕР (решение Р7
// отменено), выводить нечего — вопрос «моё ли это» ушёл с клиента целиком.
//
// Но граница маппинга работой не осталась: сервер производит только НАСТОЯЩИЕ
// конструкторы служебного действия, а до синтетических («Вы присоединились»
// против «X присоединился») их уточняет клиент — `refineMessageAction`, порт
// appMessagesManager.ts:5215-5238. Для этого нужен `me`, и нужен ВЕЗДЕ, где
// сообщение уходит наружу: ставить уточнение в `put()` недостаточно — `put`
// единственный вход в SSOT, но мимо него отдают `getAround`, офлайн-ветка
// `getHistory` и вся поисковая группа (они в SSOT вообще не пишут).
describe('MessagesManager: служебное действие уточняет владелец на границе маппинга', () => {
  const ME = 7
  // Страница из двух пилюль: «сам себя добавил» ЗРИТЕЛЬ и «сам себя добавил»
  // кто-то другой. Обе приезжают одним и тем же серверным конструктором —
  // различает их только уточнение.
  const pillsPage = (): { messages: RawMessage[]; count: number } => ({
    messages: [
      makeRawMessage({ id: 2, peerId: -1, fromId: 2, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage,
      makeRawMessage({ id: 1, peerId: -1, fromId: ME, createdAt: '2026-06-24T10:00:00Z' }) as RawMessage,
    ].map((m, i) => ({
      ...m, _: 'messageService',
      action: { _: 'messageActionChatAddUser', users: [i === 0 ? 2 : ME] },
    }) as unknown as RawMessage),
    count: 2,
  })

  const actionsOf = (list: MyMessage[]) =>
    list.map((m) => (m._ === 'messageService' ? m.action._ : m._))

  it('страница истории: своё вступление → JoinedYou, чужое → Joined', async () => {
    const { rest } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })

  it('повторная выдача из кэша (без сети) несёт то же уточнение', async () => {
    const { rest, calls } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    const cached = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })
    expect(cached.cached).toBe(true)
    expect(calls()).toBe(1)
    expect(actionsOf(cached.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })

  it('getAround (jump-to-message) идёт мимо put — и всё равно уточняет', async () => {
    const rest = {
      get: async () => ({ messages: pillsPage().messages, reached_top: true, reached_bottom: true }),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.getAround(-1, cid(2), 40)
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoined', 'messageActionChatJoinedYou'])
  })

  it('поиск по чату (в SSOT не пишет вовсе) — тоже уточняет', async () => {
    const rest = { get: async () => pillsPage() } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => ME })
    const r = await mgr.searchMessages(-1, 'м')
    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoined', 'messageActionChatJoinedYou'])
  })

  // Гонка личности. `me` появляется у воркера асинхронно; страница, обслуженная
  // раньше, уехала бы вкладке с ЧУЖОЙ формулировкой пилюли — молчаливая
  // регрессия. Гейт meReady (workerCore: гидрация `me` с диска / первый setMe)
  // обязан удержать маппинг. Мутация «убрать await whenMeReady()» красит именно
  // этот тест: сеть отвечает микротаском, а личность приезжает макротаском,
  // поэтому без гейта маппинг гарантированно застаёт meId === null.
  it('ранняя страница истории ЖДЁТ готовности `me`', async () => {
    let meId: number | null = null
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const { rest } = countingRest({ '0:0:40': pillsPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => meId, meReady: () => ready })

    setTimeout(() => { meId = ME; release() }, 0)
    const r = await mgr.getHistory({ peerId: -1, offsetId: 0, addOffset: 0, limit: 40 })

    expect(actionsOf(r.messages)).toEqual(['messageActionChatJoinedYou', 'messageActionChatJoined'])
  })
})

// Вид ЧАТА (вещательный канал) владельцу временного бабла приносит workerCore
// (`isBroadcastChat`, порт `appPeersManager.isBroadcast` в роли `generateFlags`,
// tweb appMessagesManager.ts:3128-3130). Здесь пинится ПЕРЕДАЧА признака сквозь
// менеджер: сама механика флага — в `messages/pending.test.ts`, соединение
// стрелки с кэшем карточек — в `workerCore.pendingPost.test.ts`. Без передачи
// бабл поста стоял бы СПРАВА до ответа сервера и прыгал влево на эхе
// (`isOurMessage`, tweb chat.ts:1379 — `&& !message.pFlags.post`).
describe('MessagesManager: вид чата доходит до временного бабла', () => {
  const pendingOp = async (isBroadcastChat: (peerId: number) => boolean) => {
    const { rest } = countingRest({ '0:0:40': rawPage([]) })
    const ops: MessageOp[] = []
    const mgr = newMessagesManager({
      rest,
      isBroadcastChat,
      broadcast: (_e, p) => { ops.push(...(p as { ops: MessageOp[] }).ops) },
    })
    // Бабл вставляется только в окно, доведённое до НИЗА истории.
    await mgr.getHistory({ peerId: 1, offsetId: 0, addOffset: 0, limit: 40 })
    mgr.beforeMessageSending({ peer_id: 1, client_msg_id: 'c-1', sender_id: 42, text: 'пост', type: 'text' })
    return ops.find((o) => o.op === 'insert') as { msg: MessageReal } | undefined
  }

  it('вещательный канал → у бабла pFlags.post', async () => {
    expect((await pendingOp(() => true))!.msg.pFlags).toEqual({ out: true, post: true })
  })

  it('обычный чат → флага нет', async () => {
    expect((await pendingOp(() => false))!.msg.pFlags).toEqual({ out: true })
  })
})
