// Каталог операций над окном сообщений (Stage 1B.2, Task 2). applyOp — чистая
// функция над массивом Message: та же семантика дедупа/слияния, что и
// applyIncoming в messagesStore.ts (см. messagesStore.threadRouting.test.ts и
// messagesStore.tentativeSeq.test.ts на сторону стора), но без Zustand — чтобы
// проектор и будущий Solid-остров могли переиграть операцию без стора.
import { describe, expect, it } from 'vitest'
import { applyOp, type MessageOp } from './messageOps'
import type { Message } from '../models'

const CHAT = 30
const ME = 1
const OTHER = 2

function msg(seq: number, id: number, extra?: Partial<Message>): Message {
  return {
    id, chatId: CHAT, seq, senderId: ME, type: 'text', text: `m${seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-08-10T12:00:00Z', threadRootId: null,
    ...extra,
  }
}

// Неподтверждённый оптимистичный бабл: clientId есть И id < 0 (несущий инвариант
// 1B.1 — messagesStore.ts:62-64).
function optimisticBubble(seq: number, clientId: string): Message {
  return msg(seq, -1, { clientId, senderId: ME })
}

const KEY = String(CHAT)

describe('applyOp', () => {
  it('insert нового сообщения → добавлено, порядок по возрастанию seq', () => {
    const base = [msg(1, 101), msg(3, 103)]
    const op: MessageOp = { op: 'insert', key: KEY, msg: msg(2, 102) }
    const next = applyOp(base, op)
    expect(next.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(next.map((m) => m.id)).toEqual([101, 102, 103])
  })

  // Что ломается: если бы insert не матчил по clientId (а слепо добавлял бы
  // входящее рядом), в списке остались бы ДВА элемента — оптимистичный бабл и
  // серверное эхо — вместо слияния в один.
  it('insert сообщения, чей clientId совпал с неподтверждённым баблом → бабл заменён, один элемент, clientId сохранён', () => {
    const bubble = optimisticBubble(1, 'c1')
    const echo = msg(5, 900, { clientId: 'c1', senderId: ME })
    const next = applyOp([bubble], { op: 'insert', key: KEY, msg: echo })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(900)
    expect(next[0].seq).toBe(5)
    expect(next[0].clientId).toBe('c1')
  })

  // Что ломается: без проверки "id уже есть" повторное применение эха (ack
  // пришёл раньше, эхо — дубликат по id) добавило бы дубль-бабл на экран.
  it('insert сообщения, чей id уже есть (ack-then-echo) → дубля нет, список не изменился', () => {
    const base = [msg(5, 900, { clientId: 'c1' })]
    const echo = msg(5, 900, { clientId: 'c1' }) // то же серверное сообщение приходит повторно
    const next = applyOp(base, { op: 'insert', key: KEY, msg: echo })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(900)
  })

  // Инвариант, починенный в 1B.1: чужое входящее с тем же seq, что и
  // tentativeSeq бабла, но БЕЗ совпадения clientId — не вытесняет бабл.
  it('insert сообщения с тем же seq, что у бабла, но БЕЗ совпадения clientId → оба остаются', () => {
    const bubble = optimisticBubble(1, 'c-opt')
    const foreign = msg(1, 501, { senderId: OTHER })
    const next = applyOp([bubble], { op: 'insert', key: KEY, msg: foreign })
    expect(next).toHaveLength(2)
    expect(next.some((m) => m.clientId === 'c-opt')).toBe(true)
    expect(next.some((m) => m.id === 501)).toBe(true)
  })

  it('replace существующего → заменено, позиция по seq сохранена', () => {
    const base = [msg(1, 1, { text: 'a' }), msg(2, 2, { text: 'b' }), msg(3, 3, { text: 'c' })]
    const next = applyOp(base, { op: 'replace', key: KEY, msg: msg(2, 2, { text: 'edited' }) })
    expect(next.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(next[1].text).toBe('edited')
    expect(next[0].text).toBe('a')
    expect(next[2].text).toBe('c')
  })

  it('replace отсутствующего → список не изменился (no-op)', () => {
    const base = [msg(1, 1)]
    const next = applyOp(base, { op: 'replace', key: KEY, msg: msg(9, 999) })
    expect(next).toEqual(base)
    expect(next).toBe(base) // ссылка сохранена — no-op, не «пересборка с тем же содержимым»
  })

  it('remove существующего по msgId → удалено', () => {
    const base = [msg(1, 1), msg(2, 2), msg(3, 3)]
    const next = applyOp(base, { op: 'remove', key: KEY, msgId: 2 })
    expect(next.map((m) => m.id)).toEqual([1, 3])
  })

  // Важно для мемоизации: если бы remove на отсутствующем id всё равно строил
  // новый массив (например, через filter без предварительной проверки), любой
  // подписчик, мемоизированный по ссылке на msgs, перерисовался бы впустую.
  it('remove отсутствующего → no-op, та же ссылка на массив', () => {
    const base = [msg(1, 1)]
    const next = applyOp(base, { op: 'remove', key: KEY, msgId: 999 })
    expect(next).toBe(base)
  })
})
