/** @jsxImportSource solid-js */
// Пины `emailPattern.solid.tsx` — блеф-спойлер маски почты, порт tweb
// `emailSetup.tsx:wrapEmailPattern` + ветка `messageEntitySpoiler` с
// `noTextFormat` из `wrapRichText`. Перенесены СМЫСЛОМ из `emailPattern.
// test.tsx` (React-версия) — та же разметка, та же подмена символов, тот же
// запрет на innerHTML; только `<EmailPattern>` смонтирован через Solid
// `render`, а не `@testing-library/react`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'

const spies = vi.hoisted(() => ({ attachBluffTextSpoilerTarget: vi.fn() }))
vi.mock('@components/dotRenderer', () => ({ default: spies }))

const { default: EmailPattern, wrapEmailPattern } = await import('./emailPattern.solid')

const PATTERN = 'd****@e******.com'

const wrapToElement = (pattern: string) => {
  const host = document.createElement('div')
  const wrapped = wrapEmailPattern(pattern)
  host.append(wrapped)
  return host
}

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('wrapEmailPattern (Solid)', () => {
  it('строку без звёздочек отдаёт как есть', () => {
    expect(wrapEmailPattern('user@example.com')).toBe('user@example.com')
    expect(wrapEmailPattern('has space ***')).toBe('has space ***')
  })

  it('каждый ПРОГОН звёздочек становится span.bluff-spoiler с буквами-узлами', () => {
    const host = wrapToElement(PATTERN)

    const spoilers = host.querySelectorAll('.bluff-spoiler')
    expect(spoilers).toHaveLength(2)
    expect(spoilers[0].querySelectorAll('.bluff-spoiler-letter')).toHaveLength(4)
    expect(spoilers[1].querySelectorAll('.bluff-spoiler-letter')).toHaveLength(6)

    expect(host.textContent).toHaveLength(PATTERN.length)
    expect(host.textContent!.startsWith('d')).toBe(true)
    expect(host.textContent!.endsWith('.com')).toBe(true)
  })

  it('символы под маской ПОДМЕНЕНЫ — звёздочек в разметке не остаётся, буквы это текстовые узлы', () => {
    const host = wrapToElement(PATTERN)

    const letters = [...host.querySelectorAll('.bluff-spoiler-letter')]
    expect(letters).toHaveLength(10)
    for (const letter of letters) {
      expect(letter.textContent).toHaveLength(1)
      expect(letter.textContent).not.toBe('*')
      expect(letter.childNodes).toHaveLength(1)
      expect(letter.firstChild!.nodeType).toBe(Node.TEXT_NODE)
      expect(letter.children).toHaveLength(0)
    }
  })

  it('подключает обёртку к симуляции частиц', () => {
    spies.attachBluffTextSpoilerTarget.mockClear()

    const host = wrapToElement(PATTERN)

    const spoilers = [...host.querySelectorAll('.bluff-spoiler')]
    expect(spies.attachBluffTextSpoilerTarget).toHaveBeenCalledTimes(2)
    for (const spoiler of spoilers) {
      expect(spies.attachBluffTextSpoilerTarget).toHaveBeenCalledWith(spoiler)
    }
  })
})

describe('<EmailPattern> (Solid)', () => {
  it('вносит готовые узлы в <b> карточки восстановления', () => {
    const host = document.createElement('div')
    dispose = render(() => <EmailPattern pattern={PATTERN} />, host)

    const bold = host.querySelector('b')
    expect(bold).not.toBeNull()
    expect(bold!.querySelectorAll('.bluff-spoiler')).toHaveLength(2)
    expect(bold!.querySelectorAll('.bluff-spoiler-letter')).toHaveLength(10)
    expect(bold!.textContent).toHaveLength(PATTERN.length)
  })

  it('строка без маски рендерится текстом', () => {
    const host = document.createElement('div')
    dispose = render(() => <EmailPattern pattern="user@example.com" />, host)

    expect(host.querySelector('.bluff-spoiler')).toBeNull()
    expect(host.textContent).toBe('user@example.com')
  })
})
