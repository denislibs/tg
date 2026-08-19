// Предикаты разметки клавиатур: что рисуем под баблом и что — над композером.
//
// Обе функции — ветвление по конструктору `_`, и именно это здесь пинится:
// «клавиатуры нет» — отдельный конструктор `replyKeyboardHide`, а не пустой
// массив; инлайн-кнопки под баблом и клавиатура над строкой ввода — РАЗНЫЕ
// конструкторы, и один не должен подменять другой.
import { describe, expect, it } from 'vitest'

import { findReplyKeyboardRows, getInlineMarkupRows, type KeyboardButtonRow, type ReplyMarkup } from './replyMarkup'

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

describe('findReplyKeyboardRows', () => {
  it('берёт последнюю клавиатуру окна', () => {
    const older: ReplyMarkup = { _: 'replyKeyboardMarkup', rows: [row('старая')] }
    expect(findReplyKeyboardRows([{ replyMarkup: older }, {}, { replyMarkup: keyboard }])).toBe(keyboard.rows)
  })

  it('replyKeyboardHide снимает клавиатуру, а не оставляет прошлую', () => {
    // До перевода на TL «скрыть» выражалось пустым массивом `keyboard: []`,
    // который бэкенд из JSON выкидывал (omitempty) — скан не находил ничего и
    // возвращался к прошлой клавиатуре, то есть /hide не работал вовсе.
    expect(findReplyKeyboardRows([{ replyMarkup: keyboard }, { replyMarkup: hide }])).toBeNull()
  })

  it('replyKeyboardForceReply — не клавиатура над композером', () => {
    expect(findReplyKeyboardRows([{ replyMarkup: keyboard }, { replyMarkup: { _: 'replyKeyboardForceReply' } }])).toBeNull()
  })

  it('replyInlineMarkup пропускается — прошлая клавиатура остаётся (tweb mergeReplyKeyboard)', () => {
    expect(findReplyKeyboardRows([{ replyMarkup: keyboard }, { replyMarkup: inline }, {}])).toBe(keyboard.rows)
  })

  it('клавиатура без рядов не показывается', () => {
    expect(findReplyKeyboardRows([{ replyMarkup: { _: 'replyKeyboardMarkup', rows: [] } }])).toBeNull()
  })

  it('разметки в окне нет — клавиатуры нет', () => {
    expect(findReplyKeyboardRows([{}, {}])).toBeNull()
  })
})
