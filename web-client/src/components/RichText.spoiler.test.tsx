// Регресс на дефект «спойлер не скрывает текст».
//
// RichText рисовал спойлер классами CSS-модуля (`s.spoiler` / `s.spoilerHidden`),
// которых в `RichText.module.scss` не существовало: оба резолвились в `undefined`,
// класс не вешался и скрытый текст читался сразу. Проверяем не разметку саму по
// себе, а НАБЛЮДАЕМОЕ свойство: под настоящими правилами `styles/tweb/_spoiler.scss`
// текст спойлера невидим, пока его не раскрыли.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileString } from 'sass'
import { render } from '@testing-library/react'

// Проверяем НИЖНИЙ уровень деградации — чистый CSS без оверлея частиц. В tweb он
// включается ровно в одном браузере: `bubbles.ts:addMessageSpoilerOverlay` не
// вешает оверлей в Firefox. Его и изображаем — иначе в DOM появится
// `.message-spoiler-overlay`, а он по партиалу гасит CSS-заливку
// (`:has(.message-spoiler-overlay) .spoiler{background-color: unset}`).
vi.mock('@environment/userAgent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@environment/userAgent')>()),
  IS_FIREFOX: true,
}))

const { default: RichText } = await import('./RichText')
import type { MessageEntity } from '../core/models'

const SPOILER: MessageEntity[] = [{ _: 'messageEntitySpoiler', offset: 0, length: 6 }]

beforeAll(() => {
  // тот самый эталонный партиал — тест падает, если разметка перестанет ему соответствовать
  const scss = readFileSync(resolve(__dirname, '../styles/tweb/_spoiler.scss'), 'utf8')
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
  const result = render(<RichText text={text} entities={entities} linkColor="#39c" />, { container })
  return { container, result }
}

describe('spoiler hides its text until revealed', () => {
  it('wraps the spoiler run in tweb markup (.spoiler > .spoiler-text)', () => {
    const { container } = renderInContainer('secret rest', SPOILER)

    const spoiler = container.querySelector('.spoiler')
    expect(spoiler).not.toBeNull()

    const spoilerText = spoiler!.querySelector('.spoiler-text')
    expect(spoilerText).not.toBeNull()
    expect(spoilerText!.textContent).toBe('secret')
    // остальной текст спойлером не накрыт
    expect(container.textContent).toBe('secret rest')
  })

  it('renders the spoiler text fully transparent (nothing readable without a click)', () => {
    const { container } = renderInContainer('secret', SPOILER)

    const spoilerText = container.querySelector('.spoiler-text') as HTMLElement
    expect(getComputedStyle(spoilerText).opacity).toBe('0')
  })

  it('paints the spoiler box over the text (opaque fill from the partial)', () => {
    const { container } = renderInContainer('secret', SPOILER)

    const spoiler = container.querySelector('.spoiler') as HTMLElement
    expect(getComputedStyle(spoiler).backgroundColor).toBe('rgb(227, 229, 232)')
  })

  it('reveals the text on click (is-spoiler-visible + forwards on the container)', () => {
    const { container } = renderInContainer('secret', SPOILER)

    const spoiler = container.querySelector('.spoiler') as HTMLElement
    spoiler.click()

    expect(container.classList.contains('is-spoiler-visible')).toBe(true)
    expect(container.classList.contains('forwards')).toBe(true)
    // тот же селектор из партиала, что прячет текст, теперь его показывает
    expect(getComputedStyle(container.querySelector('.spoiler-text') as HTMLElement).opacity).toBe('1')
  })

  it('keeps non-spoiler text untouched', () => {
    const { container } = renderInContainer('plain text', [])
    expect(container.querySelector('.spoiler')).toBeNull()
    expect(container.querySelector('.message-spoiler-overlay')).toBeNull()
  })
})
