// Предикаты разметки клавиатур: что рисуем под баблом и что — над композером.
//
// Обе функции — ветвление по конструктору `_`, и именно это здесь пинится:
// «клавиатуры нет» — отдельный конструктор `replyKeyboardHide`, а не пустой
// массив; инлайн-кнопки под баблом и клавиатура над строкой ввода — РАЗНЫЕ
// конструкторы, и один не должен подменять другой.
import { describe, expect, it } from 'vitest'

import {
  getHistoryReplyMarkup,
  getInlineMarkupRows,
  isForceReplyMarkup,
  type KeyboardButtonRow,
  type ReplyKeyboardMarkup,
  type ReplyMarkup,
} from './replyMarkup'
import type { MyMessage } from '../models'

const row = (...texts: string[]): KeyboardButtonRow => ({
  _: 'keyboardButtonRow',
  buttons: texts.map((text) => ({ _: 'keyboardButton', text })),
})

const inline: ReplyMarkup = {
  _: 'replyInlineMarkup',
  rows: [{ _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButtonCallback', text: 'Click', data: 'Y2I=' }] }],
}
const keyboard: ReplyMarkup = { _: 'replyKeyboardMarkup', pFlags: { resize: true }, rows: [row('A', 'B'), row('/hide')] }
const hide: ReplyMarkup = { _: 'replyKeyboardHide' }

describe('getInlineMarkupRows', () => {
  it('отдаёт ряды только у replyInlineMarkup', () => {
    expect(getInlineMarkupRows(inline)).toBe(inline.rows)
    expect(getInlineMarkupRows(keyboard)).toBeUndefined()
    expect(getInlineMarkupRows(hide)).toBeUndefined()
    expect(getInlineMarkupRows(undefined)).toBeUndefined()
  })

  it('разметка без кнопок клавиатуры не даёт (tweb: containerDiv.childElementCount)', () => {
    expect(getInlineMarkupRows({ _: 'replyInlineMarkup', rows: [] })).toBeUndefined()
    expect(getInlineMarkupRows({ _: 'replyInlineMarkup', rows: [{ _: 'keyboardButtonRow', buttons: [] }] })).toBeUndefined()
  })
})

const BOT = 100
const ME = 1
const notBot = () => false
const flags = (markup: ReplyMarkup | undefined) => (markup as ReplyKeyboardMarkup | undefined)?.pFlags

/** Сообщение окна: входящее от бота либо своё (`out`). */
function msg(id: number, o: { markup?: ReplyMarkup, out?: boolean, text?: string, replyTo?: number } = {}): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: o.out ? { out: true } : {},
    peer_id: { _: 'peerUser', user_id: BOT },
    peerId: BOT,
    fromId: o.out ? ME : BOT,
    date: id,
    message: o.text ?? '',
    reply_markup: o.markup,
    reply_to: o.replyTo ? { _: 'messageReplyHeader', reply_to_msg_id: o.replyTo } : undefined,
  } as MyMessage
}

function service(id: number, userId: number): MyMessage {
  return {
    _: 'messageService',
    id,
    pFlags: {},
    peer_id: { _: 'peerChat', chat_id: 5 },
    peerId: -5,
    fromId: ME,
    date: id,
    action: { _: 'messageActionChatDeleteUser', user_id: userId },
  } as MyMessage
}

describe('getHistoryReplyMarkup (порт mergeReplyKeyboard)', () => {
  it('берёт последнюю клавиатуру окна и метит её сообщением и ботом', () => {
    const older: ReplyMarkup = { _: 'replyKeyboardMarkup', rows: [row('старая')] }
    const r = getHistoryReplyMarkup([msg(1, { markup: older }), msg(2), msg(3, { markup: keyboard })], notBot) as ReplyKeyboardMarkup
    expect(r._).toBe('replyKeyboardMarkup')
    expect(r.rows).toBe((keyboard as ReplyKeyboardMarkup).rows)
    expect(r.mid).toBe(3)
    expect(r.fromId).toBe(BOT)
  })

  it('не пишет клиентские поля в разметку сообщения окна', () => {
    const own: ReplyMarkup = { _: 'replyKeyboardMarkup', rows: [row('A')] }
    getHistoryReplyMarkup([msg(1, { markup: own })], notBot)
    expect(own).toEqual({ _: 'replyKeyboardMarkup', rows: [row('A')] })
  })

  it('replyKeyboardHide снимает клавиатуру, а не оставляет прошлую', () => {
    const r = getHistoryReplyMarkup([msg(1, { markup: keyboard }), msg(2, { markup: hide })], notBot)
    expect(r).toEqual({ _: 'replyKeyboardHide', mid: 2 })
  })

  it('replyInlineMarkup пропускается — прошлая клавиатура остаётся', () => {
    const r = getHistoryReplyMarkup([msg(1, { markup: keyboard }), msg(2, { markup: inline }), msg(3)], notBot)
    expect((r as ReplyKeyboardMarkup).mid).toBe(1)
  })

  it('selective-разметка не трогает последнюю клавиатуру', () => {
    const selective: ReplyMarkup = { _: 'replyKeyboardMarkup', pFlags: { selective: true }, rows: [row('S')] }
    const r = getHistoryReplyMarkup([msg(1, { markup: keyboard }), msg(2, { markup: selective })], notBot)
    expect((r as ReplyKeyboardMarkup).mid).toBe(1)
  })

  it('одноразовую клавиатуру гасит следующее своё сообщение с текстом', () => {
    const once: ReplyMarkup = { _: 'replyKeyboardMarkup', pFlags: { single_use: true }, rows: [row('Да')] }
    const shown = getHistoryReplyMarkup([msg(1, { markup: once })], notBot)
    expect(flags(shown)).not.toHaveProperty('hidden')

    const spent = getHistoryReplyMarkup([msg(1, { markup: once }), msg(2, { out: true, text: 'Да' })], notBot)
    expect(flags(spent)).toMatchObject({ single_use: true, hidden: true })
  })

  it('одноразовая клавиатура старше своего последнего сообщения приходит уже скрытой', () => {
    const once: ReplyMarkup = { _: 'replyKeyboardMarkup', pFlags: { single_use: true }, rows: [row('Да')] }
    // своё сообщение 5 раньше в окне, разметка 3 доехала позже — порядок свёртки по окну
    const r = getHistoryReplyMarkup([msg(5, { out: true, text: 'x' }), msg(3, { markup: once })], notBot)
    expect(flags(r)).toMatchObject({ hidden: true })
  })

  it('обычная клавиатура своим сообщением не гасится', () => {
    const r = getHistoryReplyMarkup([msg(1, { markup: keyboard }), msg(2, { out: true, text: 'A' })], notBot)
    expect(flags(r)).not.toHaveProperty('hidden')
  })

  it('форс-ответ гасит ответ на него', () => {
    const force: ReplyMarkup = { _: 'replyKeyboardForceReply' }
    const r = getHistoryReplyMarkup([msg(1, { markup: force }), msg(2, { out: true, text: 'ok', replyTo: 1 })], notBot)
    expect(isForceReplyMarkup(r)).toBe(true)
    expect(flags(r)).toMatchObject({ hidden: true })
  })

  it('удаление бота из группы снимает его клавиатуру', () => {
    const r = getHistoryReplyMarkup([msg(1, { markup: keyboard }), service(2, BOT)], notBot)
    expect(r).toEqual({ _: 'replyKeyboardHide', mid: 2, pFlags: {} })
  })

  it('удаление бота без клавиатуры — по предикату isBot', () => {
    expect(getHistoryReplyMarkup([service(2, 7)], () => true)).toEqual({ _: 'replyKeyboardHide', mid: 2, pFlags: {} })
    expect(getHistoryReplyMarkup([service(2, 7)], notBot)).toBeUndefined()
  })

  it('разметки в окне нет — клавиатуры нет', () => {
    expect(getHistoryReplyMarkup([msg(1), msg(2)], notBot)).toBeUndefined()
  })
})
