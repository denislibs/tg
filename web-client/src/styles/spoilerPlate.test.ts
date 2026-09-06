// Серая плашка текстового спойлера снимается ТОЛЬКО стилем — и только при живом
// узле оверлея.
//
// Правило одно: `.spoilers-container:has(.message-spoiler-overlay) .spoiler
// {background-color: unset}` (tweb `src/scss/partials/_spoiler.scss`, наш порт —
// `styles/tweb/_spoiler.scss`). Пока лента узел не вешала, оно не срабатывало
// никогда, и спойлер в бабле был сплошной плашкой вместо частиц — тот самый
// дефект.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТИЛЕВОЙ ПИН. Пины разметки
// (`components/chat/bubbles.spoilerOverlay.test.ts`) сверяют НАЛИЧИЕ узла и
// остаются зелёными, если правило из партиала убрать или переименовать класс на
// одной из сторон: узел на месте, плашка вернулась. Поэтому здесь — НАСТОЯЩИЙ
// скомпилированный `styles/index.scss` поверх НАСТОЯЩЕЙ разметки
// (`wrapRichText` + `createMessageSpoilerOverlay`), тем же способом, что
// `styles/timePart.test.ts`.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import type { MessageEntity } from '@core/models'

const spies = vi.hoisted(() => ({
  attachTextSpoilerOverlay: vi.fn(() => ({
    animation: { paused: false },
    dpr: 1,
    overlay: { update: () => {}, unwrap: () => {}, wrap: () => {}, reset: () => {}, clear: () => {} },
  })),
  attachTextSpoilerTarget: vi.fn(),
  attachBluffTextSpoilerTarget: vi.fn(),
}))
vi.mock('@components/dotRenderer', () => ({ default: spies }))
vi.mock('@lib/spoiler/spoilerSupport', () => ({
  TEXT_SPOILER_WIDTH: 240,
  TEXT_SPOILER_HEIGHT: 120,
  spoilerSimDpr: () => 1,
  animationsEnabled: () => true,
  isWorkerSimSupported: () => true,
}))

const { createMessageSpoilerOverlay } = await import('@components/messages/messageSpoilerOverlay')
const { default: wrapRichText } = await import('@lib/richtext/wrapRichText')

const SPOILER: MessageEntity[] = [{ _: 'messageEntitySpoiler', offset: 0, length: 6 }]
/** токен темы (`styles/_tokens.scss`, дневная палитра) — им партиал заливает спойлер */
const PLATE = 'rgb(227, 229, 232)'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/** Тело сообщения со спойлером — как его собирает лента (`bubbles.ts:renderMessage`). */
function mountMessage() {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  document.documentElement.style.setProperty('--spoiler-background-color', PLATE)

  const messageElement = document.createElement('div')
  messageElement.className = 'message spoilers-container'
  messageElement.append(wrapRichText('secret rest', { entities: SPOILER }))
  document.body.append(messageElement)

  return { messageElement, spoiler: messageElement.querySelector('.spoiler') as HTMLElement }
}

describe('плашка текстового спойлера', () => {
  it('без оверлея спойлер закрыт СПЛОШНОЙ заливкой — режим деградации', () => {
    const { spoiler } = mountMessage()

    expect(getComputedStyle(spoiler).backgroundColor).toBe(PLATE)
  })

  it('оверлей частиц заливку снимает — иначе частиц под ней не видно', () => {
    const { messageElement, spoiler } = mountMessage()

    const overlay = createMessageSpoilerOverlay({ messageElement })!
    messageElement.append(overlay.element)

    expect(getComputedStyle(spoiler).backgroundColor).not.toBe(PLATE)
  })

  it('оверлей ушёл — заливка вернулась (правило держится ИМЕННО на узле)', () => {
    const { messageElement, spoiler } = mountMessage()

    const overlay = createMessageSpoilerOverlay({ messageElement })!
    messageElement.append(overlay.element)
    overlay.dispose()

    expect(getComputedStyle(spoiler).backgroundColor).toBe(PLATE)
  })
})
