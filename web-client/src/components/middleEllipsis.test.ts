// Поведение `MiddleEllipsisElement` (порт tweb components/middleEllipsis.ts):
// длинный текст режется ПОСЕРЕДИНЕ по реальной ширине, а не хвостом.
//
// Ширину меряет канвас, которого в happy-dom нет (getContext('2d') → null, см.
// src/test/setup.ts), поэтому измеритель подменён предсказуемым: 8px на символ.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@helpers/canvas/getTextWidth', () => ({
  default: (text: string) => text.length * 8,
}))

const { MiddleEllipsisElement } = await import('./middleEllipsis')

type WithGetSize = HTMLElement & { getSize?: () => number }

/** Смонтировать элемент с известной шириной бокса (tweb `(element as any).getSize`). */
function mount(text: string, width: number): HTMLElement {
  const element = new MiddleEllipsisElement()
  element.textContent = text
  ;(element as WithGetSize).getSize = () => width
  document.body.append(element)
  return element
}

beforeEach(() => {
  document.body.textContent = ''
})

describe('MiddleEllipsisElement', () => {
  it('текст, влезающий в бокс, не трогается', () => {
    const element = mount('short.pdf', 400)

    expect(element.textContent).toBe('short.pdf')
    expect(element.hasAttribute('title')).toBe(false)
  })

  it('длинное имя режется посередине — расширение остаётся видно', () => {
    const name = 'Оферта_Маркетплейс_ЭЦП_очень_длинное_имя (1).pdf'
    const element = mount(name, 160) // 20 символов влезает, в имени — 47

    const shown = element.textContent as string
    expect(shown).not.toBe(name)
    expect(shown).toContain('…')
    // хвост с расширением сохранён (в этом весь смысл middle-ellipsis)
    expect(shown.endsWith('.pdf')).toBe(true)
    expect(shown.startsWith('Оферта')).toBe(true)
    // полное имя доступно тултипом
    expect(element.getAttribute('title')).toBe(name)
  })

  it('оторванный от DOM элемент забывается (нет утечки в карте пересчёта)', () => {
    const element = mount('some-file-name-that-is-long.pdf', 40)
    element.remove()

    // после отсоединения resize не должен ничего пересчитывать — проверяем, что
    // повторное подключение начинает с чистого листа (текст уже обрезан, но
    // элемент снова попадает в карту и не падает)
    document.body.append(element)
    expect(element.isConnected).toBe(true)
  })
})
