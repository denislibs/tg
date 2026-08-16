import { describe, it, expect } from 'vitest'
import { messageToConvMsg } from './messageToConvMsg'
import type { Message } from './models'

const base: Message = {
  id: 1, chatId: 1, seq: 1, senderId: 2, type: 'text', text: 'hi',
  replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z', threadRootId: null,
}

// `out` больше НЕ выводится здесь: это поле самого сообщения (Message.out, порт
// tweb pFlags.out), которое ставит владелец в воркере (core/models.ts::deriveOut,
// зовётся на границе маппинга messagesManager/pending). Витрина его читает —
// поэтому в стендах ниже исходящее сообщение задаётся полем `out: true`, а не
// совпадением senderId с meId. Сам предикат пинится в core/models.test.ts.
describe('messageToConvMsg', () => {
  it('берёт out из поля сообщения, а не из сравнения senderId с meId', () => {
    // senderId === meId, но владелец флага не поставил (сообщение пришло с
    // границы, которая его не выводит) — витрина СВОЕГО вывода не имеет.
    expect(messageToConvMsg({ ...base, senderId: 7 }, 7).out).toBe(false)
    // И наоборот: флаг владельца сильнее любого совпадения id.
    expect(messageToConvMsg({ ...base, senderId: 2, out: true }, 7).out).toBe(true)
  })

  it('marks messages from me as out with sent status', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, out: true }, 7)
    expect(c.out).toBe(true)
    expect(c.status).toBe('sent')
    expect(c.text).toBe('hi')
  })

  it('formats time as local HH:MM, not the raw ISO string', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.time).toMatch(/^\d{2}:\d{2}$/)
    expect(c.time).not.toBe(base.createdAt)
  })

  it('marks messages from others as incoming with no status', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('marks an outgoing message as read once the peer has read up to its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5, out: true }, 7, { readUpToSeq: 5 })
    expect(c.status).toBe('read')
  })

  it('marks an outgoing message as read when readUpToSeq is past its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5, out: true }, 7, { readUpToSeq: 9 })
    expect(c.status).toBe('read')
  })

  it('keeps an outgoing message as sent when readUpToSeq is below its seq', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5, out: true }, 7, { readUpToSeq: 4 })
    expect(c.status).toBe('sent')
  })

  it('keeps an outgoing message as sent when readUpToSeq is not provided', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, seq: 5, out: true }, 7)
    expect(c.status).toBe('sent')
  })

  it('never sets read status on incoming messages regardless of readUpToSeq', () => {
    const c = messageToConvMsg({ ...base, seq: 5 }, 7, { readUpToSeq: 9 })
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('always produces a text-type ConvMsg for now', () => {
    expect(messageToConvMsg(base, 7).type).toBe('text')
  })

  it('carries mediaId when the message has media', () => {
    const c = messageToConvMsg({ ...base, mediaId: 42, text: '' }, 7)
    expect(c.mediaId).toBe(42)
  })

  it('keeps mediaId on a service message (edit_photo → round thumbnail)', () => {
    const c = messageToConvMsg(
      { ...base, type: 'service', text: '{"action":"edit_photo","actor":"Алиса"}', mediaId: 55 },
      7,
    )
    expect(c.type).toBe('service')
    expect(c.mediaId).toBe(55)
    expect(c.text).toBe('Алиса обновил(а) фото группы')
  })

  it('sets sender from opts.senderName on incoming messages', () => {
    const c = messageToConvMsg(base, 7, { senderName: 'Bob' })
    expect(c.out).toBe(false)
    expect(c.sender).toBe('Bob')
  })

  it('never sets sender on outgoing messages even with senderName', () => {
    const c = messageToConvMsg({ ...base, senderId: 7, out: true }, 7, { senderName: 'Bob' })
    expect(c.out).toBe(true)
    expect(c.sender).toBeUndefined()
  })

  // Кросс-чат ответ (tweb ReplyToAnotherChat): превью строится из готового снимка,
  // а не из replyTo (оригинала нет в текущем сторе). seq не задаётся → не кликабельно.
  it('builds the reply preview from the cross-chat snapshot', () => {
    const c = messageToConvMsg(
      { ...base, replyToPeerId: 99, replySnapshotName: 'Алиса', replySnapshotText: 'Фотография' },
      7,
    )
    expect(c.replyToPeerId).toBe(99)
    expect(c.reply?.name).toBe('Алиса')
    expect(c.reply?.text).toBe('Фотография')
    expect(c.reply?.seq).toBeUndefined()
  })

  it('prefers the cross-chat snapshot over an in-chat replyTo', () => {
    const c = messageToConvMsg(
      {
        ...base,
        replyToPeerId: 99, replySnapshotName: 'Боб', replySnapshotText: 'привет из другого чата',
        replyTo: { msgId: 5, seq: 5, senderId: 3, text: 'local', type: 'text' },
      },
      7,
    )
    expect(c.reply?.name).toBe('Боб')
    expect(c.reply?.text).toBe('привет из другого чата')
  })

  it('keeps the normal in-chat reply preview when there is no cross-chat peer', () => {
    const c = messageToConvMsg(
      { ...base, replyTo: { msgId: 5, seq: 5, senderId: 3, text: 'local', type: 'text' } },
      7,
      { replyToName: 'Кэрол' },
    )
    expect(c.replyToPeerId).toBeUndefined()
    expect(c.reply?.name).toBe('Кэрол')
    expect(c.reply?.text).toBe('local')
    expect(c.reply?.seq).toBe(5)
  })
})

describe('messageToConvMsg — actions', () => {
  it('flags edited when editedAt is set', () => {
    const c = messageToConvMsg({ ...base, editedAt: '2026-06-24T11:00:00Z' }, 7)
    expect(c.edited).toBe(true)
  })

  it('flags deleted', () => {
    const c = messageToConvMsg({ ...base, deleted: true }, 7)
    expect(c.deleted).toBe(true)
  })

  it('maps forward attribution with the resolved name', () => {
    const c = messageToConvMsg({ ...base, fwdFromUserId: 42 }, 7, { forwardFromName: 'Игорь' })
    expect(c.forwardFrom).toEqual({ name: 'Игорь' })
  })

  it('no forwardFrom when not forwarded', () => {
    expect(messageToConvMsg(base, 7).forwardFrom).toBeUndefined()
  })
})
