// src/core/managers/messagesManager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { newMessagesManager } from './messagesManager'
import type { RestClient } from '../net/restClient'
import { fromNewMessageEvt, mapFactCheck, mapWebPage, mapPoll, mapChecklist, mapGiveaway, type RawMessage, type RawPoll, type RawChecklist, type RawGiveaway } from '../models'
import type { NewMessageEvt, WebPageUpdateEvt, FactCheckUpdateEvt, MediaReadEvt, DeleteMessageEvt } from '../realtime/events'
import { RT } from '../realtime/events'
import type { MessageOp } from '../realtime/messageOps'
import { getDocumentFromMessage, type MessageMedia } from '../media/messageMedia'

function rawPage(seqs: number[]): { messages: RawMessage[]; count: number } {
  // backend returns newest-first (DESC) for offset_id=0 / older pages
  const messages = seqs.map((seq) => ({
    id: seq, chat_id: 1, seq, sender_id: 1, type: 'text', text: `m${seq}`,
    reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
  }))
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
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(r.messages.map((m) => m.seq)).toEqual([3, 4, 5]) // ascending for UI
    expect(r.count).toBe(3)
  })

  it('serves the second identical request from cache (no extra REST call)', async () => {
    const { rest, calls } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(calls()).toBe(1)
  })

  it('reports reachedTop when an older page is short', async () => {
    const { rest } = countingRest({
      '0:0:40': rawPage([5, 4, 3, 2, 1]),
      '1:1:40': rawPage([1]), // older inclusive of 1 → just [1] (< limit)
    })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const older = await mgr.getHistory({ chatId: 1, offsetSeq: 1, addOffset: 1, limit: 40 })
    expect(older.reachedTop).toBe(true)
  })

  // Regression: re-opening a chat (cached newest page of exactly `limit`) must
  // NOT report reachedTop — the real top isn't reached, so scroll-up paging
  // stays enabled. (Previously `fulfilled` conflated page-satisfied with top.)
  it('does not report reachedTop on re-open when only the newest page is cached', async () => {
    const { rest } = countingRest({ '0:0:3': rawPage([5, 4, 3]) })
    const mgr = newMessagesManager({ rest })
    const first = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(first.reachedTop).toBe(false)
    // simulate re-open: identical initial request, now served from cache
    const reopen = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 3 })
    expect(reopen.reachedBottom).toBe(true)
    expect(reopen.reachedTop).toBe(false)
  })
})

describe('MessagesManager.sendMessage', () => {
  it('POSTs and returns the created message, caching it', async () => {
    const created: RawMessage = {
      id: 10, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'hey',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T11:00:00Z',
    }
    const rest = { post: async () => created, get: async () => ({ messages: [], count: 0 }) } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const m = await mgr.sendMessage({ chatId: 1, text: 'hey', clientMsgId: 'c1' })
    expect(m.seq).toBe(6)
    expect(m.text).toBe('hey')
  })

  it('forwards reply_to_peer_id for a cross-chat reply', async () => {
    let body: Record<string, unknown> = {}
    const created: RawMessage = {
      id: 10, chat_id: 1, seq: 6, sender_id: 1, type: 'text', text: 'hey',
      reply_to_id: 5, media_id: null, created_at: '2026-06-24T11:00:00Z',
    }
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return created } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.sendMessage({ chatId: 1, text: 'hey', clientMsgId: 'c1', replyToId: 5, replyToPeerId: 99 })
    expect(body.reply_to_id).toBe(5)
    expect(body.reply_to_peer_id).toBe(99)
  })
})

describe('MessagesManager scheduled', () => {
  const rawScheduled = (over: Record<string, unknown> = {}) => ({
    id: 1, chat_id: 1, sender_id: 1, type: 'text', text: 'later',
    send_at: '2026-07-20T10:00:00Z', created_at: '2026-07-19T10:00:00Z', ...over,
  })

  it('sends when_online=true and maps the whenOnline flag', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled({ when_online: true }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 0, whenOnline: true })
    expect(body.when_online).toBe(true)
    expect(s.whenOnline).toBe(true)
  })

  it('defaults when_online to false for a dated schedule', async () => {
    let body: Record<string, unknown> = {}
    const rest = { post: async (_p: string, b: Record<string, unknown>) => { body = b; return rawScheduled() } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.scheduleMessage(1, { text: 'later', sendAt: 1_800_000_000 })
    expect(body.when_online).toBe(false)
    expect(s.whenOnline).toBe(false)
  })

  it('editScheduled PATCHes the new send_at and returns the updated record', async () => {
    let path = ''
    let body: Record<string, unknown> = {}
    const rest = { patch: async (p: string, b: Record<string, unknown>) => { path = p; body = b; return rawScheduled({ send_at: '2026-07-21T09:00:00Z' }) } } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    const s = await mgr.editScheduled(1, 7, 1_800_000_500)
    expect(path).toBe('/chats/1/scheduled/7')
    expect(body.send_at).toBe(1_800_000_500)
    expect(s.sendAt).toBe('2026-07-21T09:00:00Z')
  })
})

describe('MessagesManager.cacheLive', () => {
  // Регресс Bug 4: снимок кросс-чат-reply должен пережить кэш — иначе при
  // переоткрытии чата из кэша превью кросс-чат-ответа не рисуется.
  it('preserves cross-chat reply snapshot in the cache entry', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive({
      chat_id: 1, msg_id: 4, seq: 4, sender_id: 1, type: 'text', text: 'ответ',
      media_id: null, created_at: '2026-06-24T10:00:00Z',
      reply_to_id: 999, reply_to_peer_id: 77,
      reply_snapshot_name: 'Алиса', reply_snapshot_text: 'из другого чата',
    } as NewMessageEvt)
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === 4)
    expect(live).toBeTruthy()
    expect(live?.replyToPeerId).toBe(77)
    expect(live?.replySnapshotName).toBe('Алиса')
    expect(live?.replySnapshotText).toBe('из другого чата')
  })

  // Task 6: new_message несёт client_msg_id (эхо своей отправки), и на главном
  // потоке applyIncoming/reconcileAck матчат оптимистичный бабл именно по нему
  // (mapMessage → msg.clientId, см. models.ts:799). cacheLive собирал модель
  // без этого поля — переоткрытие чата из кэша воркера отдавало эхо-сообщение
  // БЕЗ clientId, и слияние с ещё не сверенным баблом (если ack/echo по сети
  // пока не пришли) не срабатывало бы.
  it('preserves client_msg_id (clientId) of a live message for cache reopen', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    mgr.cacheLive({
      chat_id: 1, msg_id: 4, seq: 4, sender_id: 1, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-06-24T10:00:00Z',
      client_msg_id: 'c-live-1',
    } as NewMessageEvt)
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const live = r.messages.find((m) => m.id === 4)
    expect(live).toBeTruthy()
    expect(live?.clientId).toBe('c-live-1')
  })

  // Task 3 (Stage 1B.2): cacheLive должен возвращать MessageOp[] — операции для
  // проектора на главном потоке. Обычное сообщение → одна операция insert с
  // ключом основного окна (тот же формат, что hkey/winKey — просто String(chatId)).
  it('returns one insert op keyed to the main window for an ordinary message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive({
      chat_id: 1, msg_id: 4, seq: 4, sender_id: 1, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-06-24T10:00:00Z',
    } as NewMessageEvt)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({ op: 'insert', key: '1', msg: expect.objectContaining({ id: 4, seq: 4 }) })
  })

  // Тред-сообщение при обоих загруженных срезах (основное окно чата + окно
  // треда) → ДВЕ операции, по одной на каждое затронутое окно (порт applyIncoming,
  // который пишет в оба ключа при threadRootId).
  it('returns two insert ops (main + thread window) when both slices are loaded', async () => {
    // thread window — свой ключ истории (thread_root=100), тоже полная «нижняя»
    // страница (offsetSeq=0 → всегда держит низ).
    const threadPage = { messages: [{ id: 2, chat_id: 1, seq: 2, sender_id: 1, type: 'text', text: 'root reply', thread_root_id: 100, reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z' } as RawMessage], count: 1 }
    const rest = {
      get: async (_path: string, q?: Record<string, string | number>) => {
        if (q?.thread_root === 100) return threadPage
        return rawPage([3, 2, 1])
      },
      post: async () => ({}),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40, threadRoot: 100 })
    const ops = mgr.cacheLive({
      chat_id: 1, msg_id: 5, seq: 5, sender_id: 1, type: 'text', text: 'thread hi',
      media_id: null, created_at: '2026-06-24T10:00:00Z', thread_root_id: 100,
    } as NewMessageEvt)
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', '1:100'])
    for (const op of ops) {
      expect(op.op).toBe('insert')
      if (op.op === 'insert') expect(op.msg.id).toBe(5)
    }
  })

  // КРИТИЧНО: окно, не державшее низ истории (сохранена только «средняя»/старая
  // страница, offsetSeq!==0 без short-page), должно дать НОЛЬ операций — та же
  // семантика, что и сам гейт вставки в SSOT (messagesManager.ts:~500-501). Иначе
  // главный поток вставит туда, где воркер не вставлял, и представления разъедутся.
  it('produces no op for a window that did not hold the bottom of history', async () => {
    const { rest } = countingRest({ '10:1:3': rawPage([9, 8, 7]) }) // paging older, full (non-short) page
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 2, offsetSeq: 10, addOffset: 1, limit: 3 })
    const ops = mgr.cacheLive({
      chat_id: 2, msg_id: 99, seq: 99, sender_id: 1, type: 'text', text: 'x',
      media_id: null, created_at: '2026-06-24T10:00:00Z',
    } as NewMessageEvt)
    expect(ops).toEqual([])
  })
})

// Fix (пост-ревью Task 4): пин паритета полей между cacheLive и fromNewMessageEvt
// (единый маппер live-кадра, models.ts). До фикса cacheLive держал СВОЙ, независимый
// mapMessage()-литерал — он молча отставал полями (fwd_from_*/gift/reply_markup/
// effect/media_title/media_performer/reply_to) от fromNewMessageEvt, которым
// раньше вставлял сообщение в окно applyIncoming на главном потоке. Пока applyIncoming
// был единственным писателем окна, расхождение было не видно — рендерился полный
// вариант из fromNewMessageEvt. После Task 4 (проектор переигрывает ОПЕРАЦИЮ, а
// cacheLive — единственный источник её msg) обеднённая модель стала бы молчаливой
// регрессией данных на самом горячем пути (только что пришедшее сообщение). Фикс —
// cacheLive теперь зовёт fromNewMessageEvt напрямую, поэтому расхождение полей
// невозможно by construction; этот тест — регрессионный пин на СПОСОБ (не завести
// параллельный литерал снова), красный на старой (докоммитной) реализации.
describe('MessagesManager.cacheLive — паритет полей с fromNewMessageEvt', () => {
  // Кадр с ВСЕМИ полями Message-модели, какие несёт NewMessageEvt (кроме тех, что
  // резолвит main-thread — replyTo, и не относящихся к модели Message — pts/unread/
  // sender_name/reply_quote_*, funnel/UI-only поля, не отображаемые в Message).
  const fullEvt: NewMessageEvt = {
    chat_id: 3, msg_id: 42, seq: 7, sender_id: 9, type: 'photo', text: 'caption',
    entities: [{ type: 'bold', offset: 0, length: 3 }],
    media_id: 555, created_at: '2026-08-10T13:00:00Z',
    thread_root_id: 100,
    reply_to_id: 41, reply_to_peer_id: 2, reply_snapshot_name: 'Алиса', reply_snapshot_text: 'оригинал',
    fwd_from_user_id: 11, fwd_from_chat_id: 12, fwd_from_msg_id: 13, fwd_date: '2026-08-09T10:00:00Z',
    media_unread: true, grouped_id: 'g-1',
    geo: { lat: 1.5, lng: 2.5, title: 'Point', address: 'Addr', live_period: 900 },
    contact: { user_id: 77, name: 'Bob', phone: '+1' },
    gift: { id: 1, gift: { id: 2, emoji: '🎁', title: 'Gift', price_stars: 100, convert_stars: 50, total: null, remains: null, sold_out: false }, from_id: 9, anonymous: false, hidden: false, converted: false, convert_stars: 50 },
    reply_markup: { inline: [[{ text: 'Click', callback: 'cb' }]] },
    media_w: 640, media_h: 480, media_mime: 'image/jpeg', media_blur: 'abc',
    media_has_thumb: true, media_duration: 12, media_size: 2048, media_name: 'photo.jpg',
    media_title: 'Track', media_performer: 'Artist', media_animated: true,
    secret_media: { mediaId: 1, keyB64: 'k', ivB64: 'i', name: 'photo.jpg', mime: 'image/jpeg', size: 2048, mediaType: 'photo' },
    effect: 'confetti',
    paid_media: { price: 10, locked: false },
    client_msg_id: 'c-parity-1',
  }

  it('cacheLive(fullEvt).msg равен fromNewMessageEvt(fullEvt) без исключений', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => fullEvt.sender_id })
    await mgr.getHistory({ chatId: 3, offsetSeq: 0, addOffset: 0, limit: 40 }) // держит низ — гейт вставки открыт
    const ops = mgr.cacheLive(fullEvt)
    const main = ops.find((o) => o.key === '3')
    expect(main?.op).toBe('insert')
    // Исключений нет: fromNewMessageEvt уже сама делает то, что раньше cacheLive
    // дублировал вручную (инжект secretMedia/secret, clientId) — единственный
    // источник вставки теперь один и тот же маппер, вызванный один раз.
    // Единственная НАДБАВКА поверх маппера — `out` (порт tweb pFlags.out): его
    // ставит граница маппинга владельца (withOut в messagesManager.ts), потому
    // что проводного поля у бэка нет. Здесь отправитель кадра — я, значит true.
    expect(main && main.op === 'insert' ? main.msg : null).toEqual({ ...fromNewMessageEvt(fullEvt), out: true })
  })

  it('тред-ключ той же операции тоже несёт полный (не урезанный) msg', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => fullEvt.sender_id })
    await mgr.getHistory({ chatId: 3, offsetSeq: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ chatId: 3, offsetSeq: 0, addOffset: 0, limit: 40, threadRoot: 100 })
    const ops = mgr.cacheLive(fullEvt)
    const thread = ops.find((o) => o.key === '3:100')
    expect(thread?.op).toBe('insert')
    expect(thread && thread.op === 'insert' ? thread.msg : null).toEqual({ ...fromNewMessageEvt(fullEvt), out: true })
  })
})

// Дефект (закрыт этой задачей): бэк кладёт send_as в кадр new_message
// (backend/internal/usecase/chat/frame.go: messageUpdatePayload), но проводной
// тип NewMessageEvt поля не объявлял, а fromNewMessageEvt его не переносила —
// у ЖИВОГО сообщения sendAs не появлялся до перезагрузки истории. Ломались две
// вещи сразу: правило `out` (порт tweb pFlags.out — send-as рисуется ВХОДЯЩИМ
// даже когда отправитель я) и имя автора бабла (канал/группа вместо участника).
// Проверяем весь путь целиком — кадр → cacheLive → операция окна, а не только
// маппер: паритетный пин выше сравнивает cacheLive с fromNewMessageEvt и на
// поле, отсутствующем в ОБОИХ, остаётся зелёным.
describe('MessagesManager.cacheLive — send_as живого кадра', () => {
  const sendAsEvt: NewMessageEvt = {
    chat_id: 3, msg_id: 43, seq: 8, sender_id: 9, type: 'text', text: 'пост от канала',
    media_id: null, created_at: '2026-08-10T13:05:00Z',
    send_as: { chat_id: 77, title: 'Мой канал', photo_id: 5 },
  }

  it('sendAs доезжает до вставляемого сообщения, и оно считается ВХОДЯЩИМ у автора', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    // getMeId — реальный отправитель кадра: без send-as это было бы исходящее.
    const mgr = newMessagesManager({ rest, getMeId: () => sendAsEvt.sender_id })
    await mgr.getHistory({ chatId: 3, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive(sendAsEvt)
    const main = ops.find((o) => o.key === '3')
    expect(main?.op).toBe('insert')
    const msg = main && main.op === 'insert' ? main.msg : null
    expect(msg?.sendAs).toEqual({ chatId: 77, title: 'Мой канал', photoId: 5 })
    expect(msg?.out).toBe(false)
  })

  it('тот же кадр без send_as — обычное исходящее', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([1]) })
    const mgr = newMessagesManager({ rest, getMeId: () => sendAsEvt.sender_id })
    await mgr.getHistory({ chatId: 3, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheLive({ ...sendAsEvt, send_as: undefined })
    const main = ops.find((o) => o.key === '3')
    const msg = main && main.op === 'insert' ? main.msg : null
    expect(msg?.sendAs).toBeUndefined()
    expect(msg?.out).toBe(true)
  })
})

// Баг (см. BRIEF.md): cacheEdit патчил только text/entities/editedAt и молча
// игнорировал reply_markup из кадра edit_message, хотя витрина применяет его
// (storeProjection.ts: RT.editMessage → applyEdit(..., e.reply_markup ? mapReplyMarkup(...) : null)).
// Значит живая правка клавиатуры бота выглядела правильно (витрина её ловила
// из сырого кадра мимо SSOT), а SSOT воркера оставался со старой клавиатурой —
// расхождение всплывало только при переоткрытии чата/второй вкладке, поднимающей
// окно из кэша воркера. Правило то же, что у витрины: поле есть → маппить
// mapReplyMarkup, поля нет → клавиатура снята (бэк шлёт reply_markup абсолютным
// значением, backend/internal/usecase/chat/frame.go:243).
describe('MessagesManager.cacheEdit — reply_markup', () => {
  function pageWithMarkup(): { messages: RawMessage[]; count: number } {
    const messages = [3, 2, 1].map((seq) => ({
      id: seq, chat_id: 1, seq, sender_id: 1, type: 'text', text: `m${seq}`,
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
      reply_markup: seq === 2 ? { inline: [[{ text: 'Old', callback: 'old' }]] } : undefined,
    }) as RawMessage)
    return { messages, count: messages.length }
  }

  it('maps reply_markup into the SSOT when the edit carries a new keyboard', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    expect(before.messages.find((m) => m.id === 2)?.replyMarkup).toEqual({ inline: [[{ text: 'Old', callback: 'old' }]] })
    mgr.cacheEdit({
      chat_id: 1, msg_id: 2, seq: 2, text: 'edited', edited_at: '2026-08-11T10:00:00Z',
      // one_time — поле, которого нет в фикстурах старой клавиатуры (только
      // inline). Без него toEqual не отличил бы смаппленный ReplyMarkup от
      // сырого RawMarkup: обе стороны несли бы один и тот же {inline}, а
      // отсутствующие oneTime/one_time читаются toEqual как равные undefined.
      reply_markup: { inline: [[{ text: 'New', callback: 'new' }]], one_time: true },
    })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const edited = r.messages.find((m) => m.id === 2)
    expect(edited?.replyMarkup).toEqual({ inline: [[{ text: 'New', callback: 'new' }]], oneTime: true })
  })

  it('clears replyMarkup in the SSOT when the edit carries no reply_markup (removed)', async () => {
    const { rest } = countingRest({ '0:0:40': pageWithMarkup() })
    const mgr = newMessagesManager({ rest })
    const before = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    expect(before.messages.find((m) => m.id === 2)?.replyMarkup).toEqual({ inline: [[{ text: 'Old', callback: 'old' }]] })
    mgr.cacheEdit({ chat_id: 1, msg_id: 2, seq: 2, text: 'edited', edited_at: '2026-08-11T10:00:00Z' })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const edited = r.messages.find((m) => m.id === 2)
    expect(edited?.replyMarkup).toBeUndefined()
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
    messages: [{
      id: 2, chat_id: 1, seq: 2, sender_id: 1, type: 'text', text: 'root reply',
      thread_root_id: 100, reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z',
    } as RawMessage],
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

describe('MessagesManager.cacheWebPage', () => {
  it('returns a patch op carrying the mapped web page for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt: WebPageUpdateEvt = { chat_id: 1, msg_id: 2, seq: 2, web_page: { url: 'https://x', site_name: 'X', title: 'Title' } }
    const ops = mgr.cacheWebPage(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 2, fields: { webPage: mapWebPage(evt.web_page) } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheWebPage({ chat_id: 1, msg_id: 999, seq: 999, web_page: { title: 'Title' } })
    expect(ops).toEqual([])
  })

  // Многооконность: воркерный patchMsg мутирует ОДНУ копию в SSOT (единая Map на
  // чат) и останавливается на первом совпадении — но сторный patchChat проходит по
  // ВСЕМ окнам чата. Без явного перечисления окон операция дошла бы только до
  // одного, и окно треда осталось бы со старыми данными.
  it('returns one patch op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40, threadRoot: 100 })
    const evt: WebPageUpdateEvt = { chat_id: 1, msg_id: 2, seq: 2, web_page: { title: 'Title' } }
    const ops = mgr.cacheWebPage(evt)
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', '1:100'])
    for (const op of ops) {
      expect(op.op).toBe('patch')
      if (op.op === 'patch') expect(op.fields).toEqual({ webPage: mapWebPage(evt.web_page) })
    }
  })
})

describe('MessagesManager.cacheFactCheck', () => {
  it('returns a patch op carrying the mapped fact-check for an existing message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt: FactCheckUpdateEvt = { chat_id: 1, msg_id: 2, seq: 2, factcheck: { text: 'проверено', country: 'RU' } }
    const ops = mgr.cacheFactCheck(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 2, fields: { factCheck: mapFactCheck(evt.factcheck!) } }])
  })

  // factcheck: null — проверка снята, fields.factCheck обязан быть undefined
  // (а не отсутствовать/null), как и cacheX/applyX в сторе (см. карту обогащений).
  it('returns fields.factCheck: undefined when the fact-check is removed', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ chat_id: 1, msg_id: 2, seq: 2, factcheck: null })
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 2, fields: { factCheck: undefined } }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheFactCheck({ chat_id: 1, msg_id: 999, seq: 999, factcheck: null })
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cacheMediaRead', () => {
  function voicePage(unread: boolean) {
    return {
      messages: [{
        id: 7, chat_id: 1, seq: 7, sender_id: 1, type: 'voice', text: '',
        reply_to_id: null, media_id: 5, created_at: '2026-06-24T10:00:00Z', media_unread: unread,
      } as RawMessage],
      count: 1,
    }
  }

  it('returns a patch op clearing mediaUnread for an unread voice message', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(true) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt: MediaReadEvt = { chat_id: 1, msg_id: 7 }
    const ops = mgr.cacheMediaRead(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 7, fields: { mediaUnread: false } }])
  })

  // Гейт паритетен воркерному patchMsg: уже прочитанное сообщение не патчится в
  // SSOT — значит и операция на него порождаться не должна (иначе повторный/
  // задвоенный кадр слал бы избыточный, хоть и no-op на сторной стороне, патч).
  it('produces no op when the message is already read (idempotent replay)', async () => {
    const { rest } = countingRest({ '0:0:40': voicePage(false) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ chat_id: 1, msg_id: 7 })
    expect(ops).toEqual([])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheMediaRead({ chat_id: 1, msg_id: 999 })
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cachePaidUnlock', () => {
  it('returns a patch op carrying the media fields + paidMedia (not a whole-message replace)', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
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
    const evt = {
      chat_id: 1, msg_id: 2, seq: 2, sender_id: 1, type: 'photo', text: '',
      media_id: 55, created_at: '2026-06-24T10:00:00Z', media,
      media_w: 640, media_h: 480, media_mime: 'image/jpeg', media_blur: 'abc',
      media_has_thumb: true, media_duration: undefined, media_size: 2048, media_name: 'p.jpg',
      paid_media: { price: 10, locked: false },
    } as unknown as NewMessageEvt
    const ops = mgr.cachePaidUnlock(evt)
    expect(ops).toEqual([{
      op: 'patch', key: '1', msgId: 2,
      fields: {
        mediaId: 55, media,
        mediaWidth: 640, mediaHeight: 480, mediaMime: 'image/jpeg', mediaBlur: 'abc',
        mediaHasThumb: true, mediaDuration: undefined, mediaSize: 2048, mediaName: 'p.jpg',
        mediaTitle: undefined, mediaPerformer: undefined, mediaAnimated: undefined,
        paidMedia: { price: 10, locked: false },
      },
    }])
  })

  // Бэк вычищает у заблокированного медиа ВСЮ мету контента (stripLockedMedia
  // оставляет только псевдо-фото из stripped-ступени) и возвращает её кадром
  // разблокировки. Патч обязан нести вложение целиком и УЖЕ нормализованным
  // (`saveMessageMedia`), иначе у оплаченного документа нет выведенного типа:
  // оплаченное аудио остаётся без подписи, а оплаченная гифка рисуется
  // видео-баблом до перезагрузки истории.
  it('переносит вложение целиком, с выведенным типом документа', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({
      chat_id: 1, msg_id: 2, seq: 2, sender_id: 1, type: 'video', text: '',
      media_id: 55, created_at: '2026-06-24T10:00:00Z',
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
      paid_media: { price: 10, locked: false },
    } as unknown as NewMessageEvt)
    const patch = ops[0]
    const fields = patch?.op === 'patch' ? patch.fields : null
    const doc = getDocumentFromMessage({ media: fields?.media })
    expect(doc?.type).toBe('gif') // выведен из documentAttributeAnimated
    expect(doc?.file_name).toBe('g.mp4')
    expect(doc?.duration).toBe(3)
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePaidUnlock({ chat_id: 1, msg_id: 999, seq: 999, sender_id: 1, type: 'photo', text: '', media_id: null, created_at: '2026-06-24T10:00:00Z' } as NewMessageEvt)
    expect(ops).toEqual([])
  })
})

describe('MessagesManager.cacheDelete', () => {
  it('returns a remove op for the window holding the deleted message', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt: DeleteMessageEvt = { chat_id: 1, msg_id: 2, seq: 2, for_me: false }
    const ops = mgr.cacheDelete(evt)
    expect(ops).toEqual([{ op: 'remove', key: '1', msgId: 2 }])
  })

  it('produces no op for a message absent from the SSOT', async () => {
    const { rest } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheDelete({ chat_id: 1, msg_id: 999, seq: 999, for_me: false })
    expect(ops).toEqual([])
  })

  // Многооконность для remove: ключи окон обязаны вычисляться ДО evictMsg — после
  // удаления seq уже выкинут из всех срезов, и второй проход не нашёл бы ни
  // основное окно, ни окно треда (регресс, который эта проверка ловит).
  it('returns one remove op per window when the message is visible in both the main and thread windows', async () => {
    const mgr = newMessagesManager({ rest: restWithThreadOverlap() })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40, threadRoot: 100 })
    const ops = mgr.cacheDelete({ chat_id: 1, msg_id: 2, seq: 2, for_me: false })
    expect(ops).toHaveLength(2)
    expect(ops.map((o) => o.key).sort()).toEqual(['1', '1:100'])
    for (const op of ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: 2 })
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
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40, threadRoot: 100 })

    await mgr.deleteMessage(1, 2, false)

    expect(broadcast).toHaveBeenCalledTimes(1)
    const [event, payload] = broadcast.mock.calls[0] as [string, { ops: MessageOp[] }]
    expect(event).toBe(RT.messageOp)
    expect(payload.ops).toHaveLength(2)
    expect(payload.ops.map((o) => o.key).sort()).toEqual(['1', '1:100'])
    for (const op of payload.ops) expect(op).toEqual({ op: 'remove', key: op.key, msgId: 2 })
  })

  it('does not broadcast when the message is absent from every window', async () => {
    const { rest: base } = countingRest({ '0:0:40': rawPage([3, 2, 1]) })
    const rest = { ...(base as unknown as { get: RestClient['get']; post: RestClient['post'] }), del: async () => ({ ok: true }) } as unknown as RestClient
    const broadcast = vi.fn()
    const mgr = newMessagesManager({ rest, broadcast })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })

    await mgr.deleteMessage(1, 999, false)

    expect(broadcast).not.toHaveBeenCalled()
  })
})

// Task 4 (Stage 1B.3): опросы / чек-листы / розыгрыши. cachePoll/cacheGiveaway
// продолжают мутировать SSOT воркера как раньше (сохраняя myVotes/participating/
// iWon из своей же копии — это отдельный, не связанный с операцией офлайн-кэш),
// но операция несёт ГОЛЫЙ агрегат mapX(evt.x) — БЕЗ этого локального поля.
// Слияние патча поверх окна (core/realtime/messageOps.ts) подставляет локальный
// выбор ИЗ ОКНА — эти тесты проверяют именно op.fields, а сохранение проверяет
// messageOps.test.ts (applyOp).
const rawPoll = (overrides?: Partial<RawPoll>): RawPoll => ({
  id: 5, question: 'q', options: ['a', 'b'], anonymous: false, multiple: false,
  quiz: false, closed: false, counts: [1, 0], total_voters: 1, my_votes: [],
  ...overrides,
})

function pollPage(msgId: number, poll: RawPoll) {
  return {
    messages: [{
      id: msgId, chat_id: 1, seq: msgId, sender_id: 1, type: 'poll', text: '',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z', poll,
    } as RawMessage],
    count: 1,
  }
}

describe('MessagesManager.cachePoll', () => {
  it('returns a patch op carrying the голый агрегат опроса (myVotes из события, не из SSOT)', async () => {
    // SSOT уже держит МОЙ выбор (voted вариант 0) — live-кадр его не несёт.
    const { rest } = countingRest({ '0:0:40': pollPage(2, rawPoll({ my_votes: [0] })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt = { chat_id: 1, poll: rawPoll({ counts: [1, 1], total_voters: 2, my_votes: [] }) }
    const ops = mgr.cachePoll(evt)
    // Операция несёт ровно mapPoll(evt.poll) — миллионном myVotes СВОЕГО события
    // (пустой, как обычно шлёт сервер в общем broadcast), а НЕ [0] из SSOT.
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 2, fields: { poll: mapPoll(evt.poll) } }])
    expect(ops[0].op === 'patch' && ops[0].fields.poll?.myVotes).toEqual([])
  })

  it('produces no op when no message in the SSOT carries this poll id', async () => {
    const { rest } = countingRest({ '0:0:40': pollPage(2, rawPoll({ id: 5 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cachePoll({ chat_id: 1, poll: rawPoll({ id: 999 }) })
    expect(ops).toEqual([])
  })
})

const rawChecklist = (overrides?: Partial<RawChecklist>): RawChecklist => ({
  id: 8, title: 't', items: [{ id: 1, text: 'i1', marked_by: [] }],
  others_can_add: false, others_can_mark: true,
  ...overrides,
})

function checklistPage(msgId: number, checklist: RawChecklist) {
  return {
    messages: [{
      id: msgId, chat_id: 1, seq: msgId, sender_id: 1, type: 'checklist', text: '',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z', checklist,
    } as RawMessage],
    count: 1,
  }
}

describe('MessagesManager.cacheChecklist', () => {
  it('returns a patch op carrying the mapped checklist (no local field — full replace is correct here)', async () => {
    const { rest } = countingRest({ '0:0:40': checklistPage(3, rawChecklist()) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt = { chat_id: 1, checklist: rawChecklist({ items: [{ id: 1, text: 'i1', marked_by: [1] }] }) }
    const ops = mgr.cacheChecklist(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 3, fields: { checklist: mapChecklist(evt.checklist) } }])
  })

  it('produces no op when no message in the SSOT carries this checklist id', async () => {
    const { rest } = countingRest({ '0:0:40': checklistPage(3, rawChecklist({ id: 8 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheChecklist({ chat_id: 1, checklist: rawChecklist({ id: 999 }) })
    expect(ops).toEqual([])
  })
})

const rawGiveaway = (overrides?: Partial<RawGiveaway>): RawGiveaway => ({
  id: 9, chat_id: 1, prize_kind: 'premium', months: 3, stars: 0, winners_count: 1,
  until_date: 0, status: 'active', participants: 4, participating: false, i_won: false,
  ...overrides,
})

function giveawayPage(msgId: number, giveaway: RawGiveaway) {
  return {
    messages: [{
      id: msgId, chat_id: 1, seq: msgId, sender_id: 1, type: 'giveaway', text: '',
      reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z', giveaway,
    } as RawMessage],
    count: 1,
  }
}

describe('MessagesManager.cacheGiveaway', () => {
  it('returns a patch op carrying the голый агрегат розыгрыша (participating/iWon из события, не из SSOT)', async () => {
    // SSOT уже держит МОЁ участие — live-кадр его не несёт (обычный broadcast без персонализации).
    const { rest } = countingRest({ '0:0:40': giveawayPage(4, rawGiveaway({ participating: true, i_won: false })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const evt = { chat_id: 1, giveaway: rawGiveaway({ participants: 5, participating: false, i_won: false }) }
    const ops = mgr.cacheGiveaway(evt)
    expect(ops).toEqual([{ op: 'patch', key: '1', msgId: 4, fields: { giveaway: mapGiveaway(evt.giveaway) } }])
    expect(ops[0].op === 'patch' && ops[0].fields.giveaway?.participating).toBe(false)
  })

  it('produces no op when no message in the SSOT carries this giveaway id', async () => {
    const { rest } = countingRest({ '0:0:40': giveawayPage(4, rawGiveaway({ id: 9 })) })
    const mgr = newMessagesManager({ rest })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const ops = mgr.cacheGiveaway({ chat_id: 1, giveaway: rawGiveaway({ id: 999 }) })
    expect(ops).toEqual([])
  })
})

// ── `out` на границе маппинга (порт tweb pFlags.out) ────────────────────────
// Бэкенд флага не отдаёт (ни REST-витрина messageJSON, ни WS-кадр
// messageUpdatePayload) — его выводит владелец, ЗДЕСЬ, на каждой границе, где
// сообщение уходит наружу. Ставить его в `put()` было бы недостаточно: `put` —
// единственный вход в SSOT, но мимо него сообщения отдают getAround, офлайн-ветка
// getHistory и вся поисковая группа методов (они в SSOT вообще не пишут).
describe('MessagesManager: `out` ставит владелец на границе маппинга', () => {
  const mixedPage = (): { messages: RawMessage[]; count: number } => ({
    messages: [
      { id: 2, chat_id: 1, seq: 2, sender_id: 7, type: 'text', text: 'моё', reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z' },
      { id: 1, chat_id: 1, seq: 1, sender_id: 2, type: 'text', text: 'чужое', reply_to_id: null, media_id: null, created_at: '2026-06-24T10:00:00Z' },
    ],
    count: 2,
  })

  it('страница истории: моё → out=true, чужое → out=false', async () => {
    const { rest } = countingRest({ '0:0:40': mixedPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => 7 })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    expect(r.messages.map((m) => [m.seq, m.out])).toEqual([[1, false], [2, true]])
  })

  it('send-as: пост от имени канала — входящий, хотя отправитель я', async () => {
    const page = mixedPage()
    page.messages[0].send_as = { chat_id: 9, title: 'Канал' }
    const { rest } = countingRest({ '0:0:40': page })
    const mgr = newMessagesManager({ rest, getMeId: () => 7 })
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    expect(r.messages.find((m) => m.seq === 2)?.out).toBe(false)
  })

  it('повторная выдача из кэша (без сети) несёт тот же out', async () => {
    const { rest, calls } = countingRest({ '0:0:40': mixedPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => 7 })
    await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    const cached = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })
    expect(cached.cached).toBe(true)
    expect(calls()).toBe(1)
    expect(cached.messages.map((m) => m.out)).toEqual([false, true])
  })

  it('getAround (jump-to-message) идёт мимо put — и всё равно несёт out', async () => {
    const rest = {
      get: async () => ({ messages: mixedPage().messages, reached_top: true, reached_bottom: true }),
    } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => 7 })
    const r = await mgr.getAround(1, 2, 40)
    expect(r.messages.map((m) => m.out)).toEqual([true, false])
  })

  it('поиск по чату (в SSOT не пишет вовсе) — тоже несёт out', async () => {
    const rest = { get: async () => mixedPage() } as unknown as RestClient
    const mgr = newMessagesManager({ rest, getMeId: () => 7 })
    const r = await mgr.searchMessages(1, 'м')
    expect(r.messages.map((m) => m.out)).toEqual([true, false])
  })

  // Гонка личности. `me` появляется у воркера асинхронно; страница истории,
  // обслуженная раньше, уехала бы вкладке с out=false у ВСЕХ сообщений —
  // молчаливая регрессия (все свои сообщения слева, без галочек). Гейт meReady
  // (workerCore: гидрация `me` с диска / первый setMe) обязан удержать маппинг.
  // Мутация «убрать await whenMeReady()» красит именно этот тест: сеть отвечает
  // микротаском, а личность приезжает макротаском, поэтому без гейта маппинг
  // гарантированно застаёт meId === null.
  it('ранняя страница истории ЖДЁТ готовности `me` (иначе всё стало бы входящим)', async () => {
    let meId: number | null = null
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    const { rest } = countingRest({ '0:0:40': mixedPage() })
    const mgr = newMessagesManager({ rest, getMeId: () => meId, meReady: () => ready })

    setTimeout(() => { meId = 7; release() }, 0)
    const r = await mgr.getHistory({ chatId: 1, offsetSeq: 0, addOffset: 0, limit: 40 })

    expect(r.messages.map((m) => m.out)).toEqual([false, true])
  })
})
