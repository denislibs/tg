// ── ПИН tweb e96e06c37 (S9): средний клик по замаскированной ссылке спрашивает ──
//
// Замаскированная ссылка (текст ≠ адрес) обязана спросить «Открыть ссылку?»
// прежде, чем открыть настоящий хост. У tweb вопрос висит на inline-`onclick`,
// а средняя кнопка до него не доходит — e96e06c37 добавил делегированный
// `auxclick`. У нас inline-обработчиков нет, и до этого порта не спрашивала
// даже основная кнопка: делегат ленты (`chat/bubbles.ts::onContainerClick`)
// звал `navigation.openInternalLink`, которого хост не передаёт, и клик уходил
// браузеру. Проверяются обе кнопки — на настоящем `wrapRichText`.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import wrapRichText from './wrapRichText'
import { listenForMaskedAnchorClicks } from './maskedAnchor'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'

beforeAll(() => {
  listenForMaskedAnchorClicks()
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** Сообщение «жми сюда» со ссылкой на https://evil.example/ — как его рисует лента. */
function mountMasked(): HTMLAnchorElement {
  const text = 'жми сюда'
  const fragment = wrapRichText(text, {
    entities: [{ _: 'messageEntityTextUrl', offset: 0, length: text.length, url: 'https://evil.example/' }],
  })
  const message = document.createElement('div')
  message.className = 'message'
  message.append(fragment)
  document.body.append(message)
  const anchor = message.querySelector('a')!
  expect(anchor.getAttribute('data-anchor-action')).toBe('showMaskedAlert')
  return anchor
}

function mountPlain(): HTMLAnchorElement {
  const text = 'https://example.com/'
  const fragment = wrapRichText(text, {
    entities: [{ _: 'messageEntityUrl', offset: 0, length: text.length }],
  })
  document.body.append(fragment)
  return document.querySelector('a')!
}

const popup = () => document.querySelector<HTMLElement>('.popup-masked-url')

function press(anchor: HTMLElement, type: 'auxclick' | 'click', button: number) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  anchor.dispatchEvent(e)
  return e
}

describe('замаскированная ссылка спрашивает перед открытием (tweb e96e06c37)', () => {
  it('средняя кнопка: вместо новой вкладки — попап с НАСТОЯЩИМ адресом', () => {
    const anchor = mountMasked()
    const e = press(anchor, 'auxclick', 1)

    expect(e.defaultPrevented).toBe(true)
    expect(popup()).not.toBeNull()
    expect(popup()!.querySelector('.popup-title')?.textContent).toBe('Open Link')
    expect(popup()!.querySelector('.popup-description')?.textContent).toBe('Do you want to open https://evil.example/?')
  })

  it('основная кнопка — тот же вопрос (наша замена inline-onclick)', () => {
    const anchor = mountMasked()
    const e = press(anchor, 'click', 0)

    expect(e.defaultPrevented).toBe(true)
    expect(popup()).not.toBeNull()
  })

  it('«Открыть» кликает клон с настоящим адресом, и клон второй раз не спрашивает', () => {
    const anchor = mountMasked()
    press(anchor, 'auxclick', 1)

    const clone = popup()!.querySelector<HTMLAnchorElement>('.popup-description a')!
    expect(clone.href).toBe('https://evil.example/')
    expect(clone.target).toBe('_blank')
    expect(clone.hasAttribute('data-anchor-action')).toBe(false)

    const clicked = vi.spyOn(clone, 'click').mockImplementation(() => {})
    const open = Array.from(popup()!.querySelectorAll<HTMLElement>('.popup-button')).find((b) => b.textContent === 'Open')!
    open.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('правая кнопка и уже отменённый клик — не наши', () => {
    const anchor = mountMasked()
    expect(press(anchor, 'auxclick', 2).defaultPrevented).toBe(false)

    anchor.addEventListener('auxclick', (e) => e.preventDefault(), { once: true })
    press(anchor, 'auxclick', 1)
    expect(popup()).toBeNull()
  })

  it('обычная ссылка (текст = адрес) открывается без вопроса', () => {
    const anchor = mountPlain()
    expect(press(anchor, 'auxclick', 1).defaultPrevented).toBe(false)
    expect(press(anchor, 'click', 0).defaultPrevented).toBe(false)
    expect(popup()).toBeNull()
  })
})
