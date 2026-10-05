// Обработчики кнопок клавиатуры бота (`wrappers/keyboardButton.ts`, порт tweb
// `getKeyboardButtonHandler`): ветвление по конструктору кнопки нашей модели —
// ссылка становится `<a>` со свойствами безопасной ссылки, callback зовёт бота и
// показывает ответ тостом или попапом, веб-апп открывает модалку, простая кнопка
// под баблом ничего не шлёт. Узлы строит инлайн-раскладка
// (`createInlineReplyMarkup`) — та же, что у бабла.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@components/toast', () => ({ toast: vi.fn() }))
vi.mock('@components/popups/popupPeer', () => ({ confirmationPopup: vi.fn(() => Promise.resolve()) }))
vi.mock('@core/webapp', () => ({ openWebApp: vi.fn() }))

import { getMiddleware } from '@helpers/middleware'
import type { MyMessage } from '@core/models'
import type { KeyboardButton } from '@core/markup/replyMarkup'
import { toast } from '@components/toast'
import { confirmationPopup } from '@components/popups/popupPeer'
import { openWebApp } from '@core/webapp'
import { createInlineReplyMarkup } from '@components/chat/bubbleParts/replyMarkupLayout.solid'

const PEER = 2
const BOT = 100

function setup(buttons: KeyboardButton[], answer = { text: '', alert: false }) {
  const managers = {
    bots: { callback: vi.fn(async() => answer) },
    messages: { sendText: vi.fn(async() => ({ ok: true })) },
  }
  const chat = { peerId: PEER, managers, appImManager: { openUrl: vi.fn() } }
  const message = { _: 'message', id: 7, pFlags: {}, peerId: PEER, fromId: BOT, message: '' } as unknown as MyMessage
  const helper = getMiddleware()
  const container = createInlineReplyMarkup({
    rows: [{ _: 'keyboardButtonRow', buttons }],
    chat: chat as never,
    message,
    middleware: helper.get(),
  })
  document.body.append(container)
  const els = Array.from(container.querySelectorAll<HTMLElement>('.reply-markup-button'))
  return { managers, chat, container, els, helper }
}

describe('wrapKeyboardButton', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => document.body.replaceChildren())

  it('раскладка: .reply-markup → .reply-markup-row → кнопки с углами последнего ряда', () => {
    const { container, els } = setup([
      { _: 'keyboardButtonCallback', text: 'A', data: 'YQ==' },
      { _: 'keyboardButtonCallback', text: 'B', data: 'Yg==' },
    ])
    expect(container.classList.contains('reply-markup')).toBe(true)
    expect(container.querySelectorAll('.reply-markup-row')).toHaveLength(1)
    expect(els.map((el) => el.querySelector('.reply-markup-button-text')!.textContent)).toEqual(['A', 'B'])
    expect(els[0].classList.contains('is-first')).toBe(true)
    expect(els[1].classList.contains('is-last')).toBe(true)
  })

  it('ссылка — <a> с адресом и иконкой arrow_next', () => {
    const { els } = setup([{ _: 'keyboardButtonUrl', text: 'Сайт', url: 'https://example.com/' }])
    const [a] = els
    expect(a.tagName).toBe('A')
    expect(a.classList.contains('is-link')).toBe(true)
    expect(a.getAttribute('href')).toBe('https://example.com/')
    expect(a.querySelector('.reply-markup-button-icon')).not.toBeNull()
  })

  it('callback: бот из сообщения, данные кнопки, номер сообщения; ответ — тостом', async() => {
    const { els, managers } = setup([{ _: 'keyboardButtonCallback', text: 'Жми', data: 'Y2I=' }], { text: 'Готово', alert: false })
    els[0].click()
    expect(managers.bots.callback).toHaveBeenCalledWith(BOT, PEER, 'Y2I=', 7)
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect((vi.mocked(toast).mock.calls[0][0] as DocumentFragment).textContent).toBe('Готово')
    expect(confirmationPopup).not.toHaveBeenCalled()
  })

  it('callback с alert — попапом с кнопкой OK', async() => {
    const { els } = setup([{ _: 'keyboardButtonCallback', text: 'Жми', data: 'Y2I=' }], { text: 'Внимание', alert: true })
    els[0].click()
    await vi.waitFor(() => expect(confirmationPopup).toHaveBeenCalledTimes(1))
    const options = vi.mocked(confirmationPopup).mock.calls[0][0]
    expect((options.description as DocumentFragment).textContent).toBe('Внимание')
    expect(options.button).toEqual({ langKey: 'OK', isCancel: true })
    expect(toast).not.toHaveBeenCalled()
  })

  it('callback с пустым ответом — ни тоста, ни попапа', async() => {
    const { els, managers } = setup([{ _: 'keyboardButtonCallback', text: 'Жми', data: 'Y2I=' }])
    els[0].click()
    await vi.waitFor(() => expect(managers.bots.callback).toHaveBeenCalled())
    await Promise.resolve()
    expect(toast).not.toHaveBeenCalled()
    expect(confirmationPopup).not.toHaveBeenCalled()
  })

  it('веб-апп открывает модалку по адресу кнопки от имени бота', () => {
    const { els } = setup([{ _: 'keyboardButtonWebView', text: 'Открыть', url: 'https://app.example/' }])
    expect(els[0].classList.contains('is-web-view')).toBe(true)
    els[0].click()
    expect(openWebApp).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://app.example/', botId: BOT }))
  })

  it('простая кнопка под баблом ничего не шлёт (tweb default: только без сообщения)', () => {
    const { els, managers } = setup([{ _: 'keyboardButton', text: 'Привет' }])
    els[0].click()
    expect(managers.messages.sendText).not.toHaveBeenCalled()
  })
})
