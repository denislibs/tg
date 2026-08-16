// Спойлер прячет свой текст до клика.
//
// Смысл перенесён из `components/RichText.spoiler.test.tsx`: проверяем не разметку
// саму по себе, а НАБЛЮДАЕМОЕ свойство — под настоящими правилами
// `styles/tweb/_spoiler.scss` текст спойлера невидим, пока его не раскрыли.
// Разметка — 1:1 tweb `wrapRichText.ts:700-711`: `.spoiler > .spoiler-text`.
import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileString } from 'sass'
import type { MessageEntity } from '@core/models'
import { wrapMessageText } from './index'

const SPOILER: MessageEntity[] = [{ type: 'spoiler', offset: 0, length: 6 }]

beforeAll(() => {
  // тот самый эталонный партиал — тест падает, если разметка перестанет ему соответствовать
  const scss = readFileSync(resolve(__dirname, '../../styles/tweb/_spoiler.scss'), 'utf8')
  const style = document.createElement('style')
  style.textContent = compileString(scss).css
  document.head.append(style)
  // токен темы (styles/_tokens.scss, дневная палитра) — партиал заливает им спойлер
  document.documentElement.style.setProperty('--spoiler-background-color', 'rgb(227, 229, 232)')
})

/** Рендер внутри `.spoilers-container` — так спойлер живёт в бабле (tweb `.message`). */
function renderInContainer(text: string, entities: MessageEntity[]) {
  const container = document.createElement('div')
  container.className = 'message spoilers-container'
  document.body.append(container)
  container.append(wrapMessageText(text, entities))
  return container
}

describe('spoiler hides its text until revealed', () => {
  it('wraps the spoiler run in tweb markup (.spoiler > .spoiler-text)', () => {
    const container = renderInContainer('secret rest', SPOILER)

    const spoiler = container.querySelector('.spoiler')
    expect(spoiler).not.toBeNull()

    const spoilerText = spoiler!.querySelector('.spoiler-text')
    expect(spoilerText).not.toBeNull()
    expect(spoilerText!.textContent).toBe('secret')
    // остальной текст спойлером не накрыт
    expect(container.textContent).toBe('secret rest')
  })

  it('renders the spoiler text fully transparent (nothing readable without a click)', () => {
    const container = renderInContainer('secret', SPOILER)

    const spoilerText = container.querySelector('.spoiler-text') as HTMLElement
    expect(getComputedStyle(spoilerText).opacity).toBe('0')
  })

  it('paints the spoiler box over the text (opaque fill from the partial)', () => {
    const container = renderInContainer('secret', SPOILER)

    const spoiler = container.querySelector('.spoiler') as HTMLElement
    expect(getComputedStyle(spoiler).backgroundColor).toBe('rgb(227, 229, 232)')
  })

  it('reveals the text on click (is-spoiler-visible + forwards on the container)', () => {
    const container = renderInContainer('secret', SPOILER)

    const spoiler = container.querySelector('.spoiler') as HTMLElement
    spoiler.click()

    expect(container.classList.contains('is-spoiler-visible')).toBe(true)
    expect(container.classList.contains('forwards')).toBe(true)
    // тот же селектор из партиала, что прячет текст, теперь его показывает
    expect(getComputedStyle(container.querySelector('.spoiler-text') as HTMLElement).opacity).toBe('1')
  })

  it('keeps non-spoiler text untouched', () => {
    const container = renderInContainer('plain text', [])
    expect(container.querySelector('.spoiler')).toBeNull()
  })

  it('форматирование внутри спойлера остаётся вложенным в .spoiler-text', () => {
    const container = renderInContainer('secret rest', [
      { type: 'spoiler', offset: 0, length: 6 },
      { type: 'bold', offset: 0, length: 6 },
    ])

    expect(container.querySelectorAll('.spoiler').length).toBe(1)
    expect(container.querySelector('.spoiler-text')?.textContent).toBe('secret')
  })
})
