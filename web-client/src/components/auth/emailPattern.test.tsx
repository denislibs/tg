// Блеф-спойлер маски почты — порт tweb `emailSetup.tsx:wrapEmailPattern` +
// ветка `messageEntitySpoiler` с `noTextFormat` из `wrapRichText`.
//
// Пиним РАЗМЕТКУ ОРИГИНАЛА (`span.bluff-spoiler > span.bluff-spoiler-letter`),
// подмену символов брайлем и то, что буквы строятся УЗЛАМИ: в tweb они идут
// через `createElementFromMarkup`, т.е. innerHTML, а правило безопасности
// репозитория это запрещает — узлы должны быть теми же, парсинга разметки быть
// не должно.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Подключение к симуляции — не предмет этого теста (и воркера в happy-dom нет).
const spies = vi.hoisted(() => ({ attachBluffTextSpoilerTarget: vi.fn() }))
vi.mock('@components/dotRenderer', () => ({ default: spies }))

const { default: EmailPattern, wrapEmailPattern } = await import('./emailPattern')

const PATTERN = 'd****@e******.com'

const wrapToElement = (pattern: string) => {
  const host = document.createElement('div')
  const wrapped = wrapEmailPattern(pattern)
  host.append(wrapped)
  return host
}

describe('wrapEmailPattern', () => {
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

    // видимая часть адреса цела, длина всей строки не изменилась
    expect(host.textContent).toHaveLength(PATTERN.length)
    expect(host.textContent!.startsWith('d')).toBe(true)
    expect(host.textContent!.endsWith('.com')).toBe(true)
  })

  it('символы под маской ПОДМЕНЕНЫ — звёздочек в разметке не остаётся', () => {
    const host = wrapToElement(PATTERN)

    const letters = [...host.querySelectorAll('.bluff-spoiler-letter')]
    expect(letters).toHaveLength(10)
    for (const letter of letters) {
      expect(letter.textContent).toHaveLength(1)
      expect(letter.textContent).not.toBe('*')
      // буква — ОДИН текстовый узел; разметка не парсилась
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

describe('<EmailPattern>', () => {
  it('вносит готовые узлы в <b> карточки восстановления', () => {
    const { container } = render(<EmailPattern pattern={PATTERN} />)

    const bold = container.querySelector('b')
    expect(bold).not.toBeNull()
    expect(bold!.querySelectorAll('.bluff-spoiler')).toHaveLength(2)
    expect(bold!.querySelectorAll('.bluff-spoiler-letter')).toHaveLength(10)
    expect(bold!.textContent).toHaveLength(PATTERN.length)
  })

  it('строка без маски рендерится текстом', () => {
    const { container } = render(<EmailPattern pattern="user@example.com" />)

    expect(container.querySelector('.bluff-spoiler')).toBeNull()
    expect(container.textContent).toBe('user@example.com')
  })
})
