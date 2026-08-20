import { describe, it, expect } from 'vitest'
import { applyPeerOps } from './peerCache'
import { getDocumentFromMessage, saveMessageMedia } from './media/messageMedia'
import { messageToConvMsg } from './messageToConvMsg'
import { makeMessage, makeServiceMessage } from './messages/testMessage'
import type { MessageReal } from './models'

applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 5, first_name: 'Алиса', pFlags: {} }] }])

const base: MessageReal = makeMessage({ id: 1, peerId: 1, fromId: 2, text: 'hi', date: 1_750_000_000 })
/** Исходящее: `pFlags.out` производит СЕРВЕР, витрина его только читает. */
const mine = (over: Partial<MessageReal> = {}): MessageReal =>
  ({ ...makeMessage({ id: 1, peerId: 1, fromId: 7, text: 'hi', date: 1_750_000_000, out: true }), ...over })

// `out` больше НЕ выводится витриной и НЕ выводится клиентом вовсе: это
// `pFlags.out` от сервера (решение Р7 отменено). Витрине остался другой вопрос —
// СТОРОНА бабла, и решает его `from_id`: сообщение от лица канала остаётся `out`
// у автора, но рисуется входящим. Сам предикат пинится в core/models.test.ts.
describe('messageToConvMsg', () => {
  it('берёт сторону бабла из pFlags.out и автора-человека', () => {
    // Автор совпал со зрителем, но флага нет — витрина СВОЕГО вывода не имеет.
    expect(messageToConvMsg(makeMessage({ id: 1, peerId: 1, fromId: 7 }), 7).out).toBe(false)
    // И наоборот: флаг сервера сильнее любого совпадения id.
    expect(messageToConvMsg(makeMessage({ id: 1, peerId: 1, fromId: 2, out: true }), 7).out).toBe(true)
  })

  it('сообщение от лица КАНАЛА рисуется входящим, хотя оно out', () => {
    expect(messageToConvMsg(makeMessage({ id: 1, peerId: -1, fromId: -9, out: true }), 7).out).toBe(false)
  })

  it('marks messages from me as out with sent status', () => {
    const c = messageToConvMsg(mine(), 7)
    expect(c.out).toBe(true)
    expect(c.status).toBe('sent')
    expect(c.text).toBe('hi')
  })

  // Вложение обязано доехать до витрины ЦЕЛИКОМ: бабл спрашивает у него всё —
  // и пики волны голосового (documentAttributeAudio.waveform), и тип документа.
  it('переносит вложение (с пиками волны голосового) в витрину', () => {
    const media = saveMessageMedia({
      _: 'messageMediaDocument',
      document: {
        _: 'document', id: 55, mime_type: 'audio/ogg', size: 100,
        attributes: [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7, waveform: 'HwAq/wc=' }],
      },
    })
    const voice = makeMessage({ id: 1, peerId: 1, fromId: 2, media })
    const conv = messageToConvMsg(voice, 7)
    expect(conv.media).toBe(media)
    expect(conv.type).toBe('voice')
    // Адрес файла спрашивают у ВЛОЖЕНИЯ — плоского `media_id` рядом больше нет.
    expect(conv.mediaId).toBe(55)
    expect(getDocumentFromMessage(conv)?.attributes).toContainEqual({
      _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 7, waveform: 'HwAq/wc=',
    })
    expect(messageToConvMsg({ ...voice, media: undefined }, 7).media).toBeUndefined()
  })

  it('formats time as local HH:MM, not the raw value', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.time).toMatch(/^\d{2}:\d{2}$/)
    expect(c.createdAt).toBe(new Date(base.date * 1000).toISOString())
  })

  it('marks messages from others as incoming with no status', () => {
    const c = messageToConvMsg(base, 7)
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('marks an outgoing message as read once the peer has read up to its id', () => {
    const c = messageToConvMsg(mine({ id: 5 }), 7, { readUpToId: 5 })
    expect(c.status).toBe('read')
  })

  it('marks an outgoing message as read when readUpToId is past its id', () => {
    const c = messageToConvMsg(mine({ id: 5 }), 7, { readUpToId: 9 })
    expect(c.status).toBe('read')
  })

  it('keeps an outgoing message as sent when readUpToId is below its id', () => {
    const c = messageToConvMsg(mine({ id: 5 }), 7, { readUpToId: 4 })
    expect(c.status).toBe('sent')
  })

  it('keeps an outgoing message as sent when readUpToId is not provided', () => {
    expect(messageToConvMsg(mine({ id: 5 }), 7).status).toBe('sent')
  })

  it('never sets read status on incoming messages regardless of readUpToId', () => {
    const c = messageToConvMsg(makeMessage({ id: 5, peerId: 1, fromId: 2 }), 7, { readUpToId: 9 })
    expect(c.out).toBe(false)
    expect(c.status).toBeUndefined()
  })

  it('текстовое сообщение без вложения — вид text', () => {
    expect(messageToConvMsg(base, 7).type).toBe('text')
  })

  it('пилюля смены фото несёт фото ВНУТРИ действия, а не media_id рядом', () => {
    const svc = makeServiceMessage({
      id: 2, peerId: -1, fromId: 5,
      action: { _: 'messageActionChatEditPhoto', photo: { _: 'photo', id: 55, sizes: [] } },
    })
    const c = messageToConvMsg(svc, 7)
    expect(c.type).toBe('service')
    // Имя берётся из зеркала карточек — в действии его нет (см. serviceMsg.ts).
    expect(c.text).toBe('Алиса обновил(а) фото группы')
  })

  it('sets sender from opts.senderName on incoming messages', () => {
    const c = messageToConvMsg(base, 7, { senderName: 'Bob' })
    expect(c.out).toBe(false)
    expect(c.sender).toBe('Bob')
  })

  it('never sets sender on outgoing messages even with senderName', () => {
    const c = messageToConvMsg(mine(), 7, { senderName: 'Bob' })
    expect(c.out).toBe(true)
    expect(c.sender).toBeUndefined()
  })

  // Кросс-чат ответ (tweb ReplyToAnotherChat): оригинал зрителю недоступен, и
  // его атрибуцию везёт СТРУКТУРА `reply_to.reply_from` (`messageFwdHeader`), а
  // не плоская пара `reply_snapshot_name`/`_text`.
  it('строит превью кросс-чат ответа из reply_from/reply_media', () => {
    const c = messageToConvMsg({
      ...base,
      reply_to: {
        _: 'messageReplyHeader',
        reply_to_msg_id: 5,
        reply_to_peer_id: { _: 'peerChannel', channel_id: 99 },
        reply_from: { _: 'messageFwdHeader', from_name: 'Алиса', date: 0 },
        reply_media: { _: 'messageMediaPhoto', photo: { _: 'photo', id: 1, sizes: [] } },
      },
    }, 7)
    expect(c.replyToPeerId).toBe(-99)
    expect(c.reply?.name).toBe('Алиса')
    expect(c.reply?.text).toBe('Фотография')
  })

  // Обычный ответ: на проводе едет ССЫЛКА, оригинал разрешает вызывающий из
  // своего окна — превью строит клиент, а не сервер.
  it('строит превью обычного ответа из РАЗРЕШЁННОГО вызывающим оригинала', () => {
    const original = makeMessage({ id: 5, peerId: 1, fromId: 3, text: 'local' })
    const c = messageToConvMsg(
      { ...base, reply_to: { _: 'messageReplyHeader', reply_to_msg_id: 5 } },
      7,
      { replyToName: 'Кэрол', replyToMessage: original },
    )
    expect(c.replyToPeerId).toBeUndefined()
    expect(c.reply?.name).toBe('Кэрол')
    expect(c.reply?.text).toBe('local')
    expect(c.reply?.seq).toBe(5)
  })

  it('цитата показывается вместо текста оригинала', () => {
    const original = makeMessage({ id: 5, peerId: 1, fromId: 3, text: 'длинный оригинал' })
    const c = messageToConvMsg(
      { ...base, reply_to: { _: 'messageReplyHeader', pFlags: { quote: true }, reply_to_msg_id: 5, quote_text: 'фрагмент' } },
      7,
      { replyToMessage: original },
    )
    expect(c.reply?.text).toBe('фрагмент')
    expect(c.reply?.quote).toBe(true)
  })
})

describe('messageToConvMsg — actions', () => {
  it('flags edited when edit_date is set', () => {
    expect(messageToConvMsg({ ...base, edit_date: 1_750_000_100 }, 7).edited).toBe(true)
  })

  it('maps forward attribution with the resolved name', () => {
    const c = messageToConvMsg(
      { ...base, fwd_from: { _: 'messageFwdHeader', from_id: { _: 'peerUser', user_id: 42 }, date: 0 } },
      7,
      { forwardFromName: 'Игорь' },
    )
    expect(c.forwardFrom).toEqual({ name: 'Игорь' })
  })

  it('no forwardFrom when not forwarded', () => {
    expect(messageToConvMsg(base, 7).forwardFrom).toBeUndefined()
  })

  // Лог звонка — служебное сообщение с `messageActionPhoneCall`; прежде это был
  // `type === 'call'` с JSON `{video, reason, duration}` внутри текста.
  it('лог звонка читается из действия, а не из JSON внутри текста', () => {
    const c = messageToConvMsg(makeServiceMessage({
      id: 3, peerId: 9, fromId: 9,
      action: { _: 'messageActionPhoneCall', pFlags: { video: true }, reason: { _: 'phoneCallDiscardReasonHangup' }, duration: 42 },
    }), 7)
    expect(c.type).toBe('call')
    expect(c.call).toEqual({ video: true, reason: 'ok', duration: 42 })
  })

  it('«отменён» от «состоялся» отличает НАЛИЧИЕ длительности', () => {
    const c = messageToConvMsg(makeServiceMessage({
      id: 3, peerId: 9, fromId: 9,
      action: { _: 'messageActionPhoneCall', reason: { _: 'phoneCallDiscardReasonHangup' } },
    }), 7)
    expect(c.call).toEqual({ video: false, reason: 'cancelled', duration: undefined })
  })
})
