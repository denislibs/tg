// Клавиатура бота над композером (`chat/replyKeyboard.solid.tsx`, порт tweb
// `ReplyKeyboard`): доступность кнопки-тумблера по последней разметке окна
// (`checkAvailability`), живой пересчёт по зеркалу окна вместо события
// `history_reply_markup`, форс-ответ открывает плашку ответа один раз
// (`checkForceReply`), нажатие простой кнопки шлёт её текст и закрывает панель.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import { putMirrorPage, resetMessagesMirror, winKey } from '@core/history/messagesMirror'
import type { MyMessage } from '@core/models'
import type { ReplyMarkup } from '@core/markup/replyMarkup'
import ReplyKeyboard from './replyKeyboard.solid'
import { ChatType } from './chatType'

const PEER = 100
const ME = 1

function msg(id: number, o: { markup?: ReplyMarkup, out?: boolean, text?: string, replyTo?: number } = {}): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: o.out ? { out: true } : {},
    peer_id: { _: 'peerUser', user_id: PEER },
    peerId: PEER,
    fromId: o.out ? ME : PEER,
    date: id,
    message: o.text ?? '',
    reply_markup: o.markup,
    reply_to: o.replyTo ? { _: 'messageReplyHeader', reply_to_msg_id: o.replyTo } : undefined,
  } as MyMessage
}

const keyboard: ReplyMarkup = {
  _: 'replyKeyboardMarkup',
  rows: [
    { _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButton', text: 'Да' }, { _: 'keyboardButton', text: 'Нет' }] },
    { _: 'keyboardButtonRow', buttons: [{ _: 'keyboardButton', text: 'Позже' }] },
  ],
}

function setup(type = ChatType.Chat) {
  const managers = { messages: { sendText: vi.fn(async() => ({ ok: true })) } }
  const chat = { peerId: PEER, type, managers, appImManager: { openUrl: vi.fn() } }
  const chatInput = { chat, initMessageReply: vi.fn(async() => {}) }
  const btnHover = document.createElement('button')
  btnHover.classList.add('toggle-reply-markup', 'hide')
  const appendTo = document.createElement('div')
  document.body.append(appendTo, btnHover)
  const listenerSetter = new ListenerSetter()
  const helper = getMiddleware()
  const replyKeyboard = new ReplyKeyboard({
    listenerSetter,
    appendTo,
    btnHover,
    chatInput: chatInput as never,
    middleware: helper.get(),
  })
  return { replyKeyboard, btnHover, appendTo, chatInput, managers, helper, listenerSetter }
}

describe('ReplyKeyboard', () => {
  let cleanup: (() => void) | undefined

  beforeEach(() => {
    resetMessagesMirror()
  })

  afterEach(() => {
    cleanup?.()
    cleanup = undefined
    document.body.replaceChildren()
  })

  it('checkAvailability: кнопка видна, пока последняя разметка окна — клавиатура с рядами', () => {
    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    expect(t.btnHover.classList.contains('hide')).toBe(false)
  })

  it('checkAvailability: нет разметки или пустые ряды — кнопка скрыта', () => {
    putMirrorPage(winKey(PEER), [msg(1, { markup: { _: 'replyKeyboardMarkup', rows: [] } })])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.btnHover.classList.remove('hide')
    t.replyKeyboard.setPeer(PEER)
    expect(t.btnHover.classList.contains('hide')).toBe(true)
  })

  it('в разделе приветственных сообщений клавиатуры нет', () => {
    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    const t = setup(ChatType.Welcome)
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    expect(t.btnHover.classList.contains('hide')).toBe(true)
  })

  it('окно в зеркале сменилось — доступность пересчитывается (вместо history_reply_markup)', () => {
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    expect(t.btnHover.classList.contains('hide')).toBe(true)

    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    expect(t.btnHover.classList.contains('hide')).toBe(false)

    putMirrorPage(winKey(PEER), [msg(2, { markup: { _: 'replyKeyboardHide' } })])
    expect(t.btnHover.classList.contains('hide')).toBe(true)
  })

  it('после уничтожения зоны жизни зеркало клавиатуру не трогает', () => {
    const t = setup()
    t.replyKeyboard.setPeer(PEER)
    t.helper.destroy()
    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    expect(t.btnHover.classList.contains('hide')).toBe(true)
  })

  it('открытие рисует ряды; простая кнопка шлёт свой текст и закрывает панель', async() => {
    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)

    await t.replyKeyboard.toggle(true)
    const element = t.appendTo.querySelector<HTMLElement>('.reply-keyboard')!
    expect(element.classList.contains('active')).toBe(true)
    const rows = element.querySelectorAll('.reply-keyboard-row.reply-markup-row')
    expect(rows).toHaveLength(2)
    const buttons = element.querySelectorAll<HTMLElement>('.reply-keyboard-button.btn.reply-markup-button')
    expect(Array.from(buttons, (b) => b.textContent)).toEqual(['Да', 'Нет', 'Позже'])

    buttons[1].click()
    expect(t.managers.messages.sendText).toHaveBeenCalledWith(expect.objectContaining({ peerId: PEER, text: 'Нет' }))
    expect(element.classList.contains('active')).toBe(false)
  })

  it('checkForceReply: форс-ответ открывает плашку ответа один раз', async() => {
    putMirrorPage(winKey(PEER), [msg(5, { markup: { _: 'replyKeyboardForceReply' } })])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    expect(t.chatInput.initMessageReply).toHaveBeenCalledWith({ replyToMsgId: 5 })

    t.replyKeyboard.setPeer(PEER)
    t.replyKeyboard.checkForceReply()
    expect(t.chatInput.initMessageReply).toHaveBeenCalledTimes(1)
  })

  it('checkForceReply: ответ на форс-ответ его гасит', () => {
    putMirrorPage(winKey(PEER), [
      msg(6, { markup: { _: 'replyKeyboardForceReply' } }),
      msg(7, { out: true, text: 'ok', replyTo: 6 }),
    ])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    expect(t.chatInput.initMessageReply).not.toHaveBeenCalled()
  })

  it('эфемерный режим прячет кнопку', () => {
    putMirrorPage(winKey(PEER), [msg(1, { markup: keyboard })])
    const t = setup()
    cleanup = () => t.helper.destroy()
    t.replyKeyboard.setPeer(PEER)
    t.replyKeyboard.setEphemeralMode(true)
    expect(t.btnHover.classList.contains('hide')).toBe(true)
  })
})
