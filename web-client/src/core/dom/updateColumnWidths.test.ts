import { describe, it, expect, beforeEach } from 'vitest'
import updateColumnWidths, {
  DEFAULT_COLUMN_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  isUserCollapsedLeft,
  setOpenTabsLeftSidebar,
  setUserPreferredLeft,
  setUserPreferredRight,
} from './updateColumnWidths'

const read = (name: string) => document.documentElement.style.getPropertyValue(name)

function atWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  updateColumnWidths()
}

// Состояние DOM между тестами НЕ сбрасываем: модуль пишет переменную только
// когда значение изменилось (кэш `last`), а сбросить кэш извне нечем. Плюс
// модуль красит корень уже на импорте (ранняя простановка, tweb :390-394) —
// после `removeAttribute('style')` константы вроде --right-sidebar-fits не
// переписались бы никогда. Тесты идут по порядку и читают накопленное состояние.
describe('updateColumnWidths', () => {
  it('десктоп 1728 — значения совпадают с живым tweb', () => {
    atWidth(1728)
    expect(read('--default-column-width')).toBe('360px')
    expect(read('--left-column-width')).toBe('360px')
    expect(read('--right-column-width')).toBe('360px')
    expect(read('--middle-column-width')).toBe('1696px') // vw − 2×16
    expect(read('--chat-width')).toBe('696px') // кап CHAT_WIDTH_MAX
    expect(read('--folders-sidebar-offset')).toBe('0px')
    expect(read('--right-sidebar-fits')).toBe('1480px')
    expect(read('--page-chats-padding')).toBe('16px')
    expect(document.body.classList.contains('right-column-floats')).toBe(false)
  })

  it('узкий десктоп — правая колонка всплывает, чат сужается от левой колонки', () => {
    atWidth(1100)
    // 1100 < 0 + 360 + 360 + 696 + 64 → floats
    expect(document.body.classList.contains('right-column-floats')).toBe(true)
    // доступно справа от левой колонки: 1100 − 360 − 48 = 692 < 696
    expect(read('--chat-width')).toBe('692px')
  })

  it('handheld — колонки во весь экран, отступ страницы 0', () => {
    // сначала широкий: модуль пишет переменные только при изменении значения,
    // поэтому переключаем состояние явно (в приложении класс никто не снимает)
    atWidth(1728)
    atWidth(500)
    expect(read('--left-column-width')).toBe('500px')
    expect(read('--right-column-width')).toBe('500px')
    expect(read('--chat-width')).toBe('500px')
    expect(read('--page-chats-padding')).toBe('0px')
    expect(document.body.classList.contains('right-column-floats')).toBe(true)
  })

  it('плавающий левый сайдбар (601-925) — чат занимает всю среднюю колонку', () => {
    atWidth(800)
    expect(read('--left-column-width')).toBe(`${DEFAULT_COLUMN_WIDTH}px`)
    // middle = 800 − 32 = 768 → кап 696
    expect(read('--chat-width')).toBe('696px')
  })

  it('--page-chats-padding у #column-center — своя величина (16 десктоп)', () => {
    const center = document.createElement('div')
    center.id = 'column-center'
    document.body.append(center)
    try {
      atWidth(1728)
      expect(center.style.getPropertyValue('--page-chats-padding')).toBe('16px')
    } finally {
      center.remove()
    }
  })
})

// Пользовательская ширина колонок из ручки ресайза (tweb setUserPreferredLeft /
// setUserPreferredRight, updateColumnWidths.ts:156-176). Тесты идут последними:
// модуль держит предпочтения в своём состоянии, сбросить его нечем.
describe('updateColumnWidths — предпочтения ресайза', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1728, configurable: true })
    updateColumnWidths()
  })

  it('ширина зажимается в MIN/MAX', () => {
    setUserPreferredLeft(1000)
    expect(read('--left-column-width')).toBe(`${MAX_SIDEBAR_WIDTH}px`)
    setUserPreferredLeft(100)
    expect(read('--left-column-width')).toBe(`${MIN_SIDEBAR_WIDTH}px`)
    setUserPreferredRight(10_000)
    expect(read('--right-column-width')).toBe(`${MAX_SIDEBAR_WIDTH}px`)
  })

  it('0 = свёрнутая колонка: visual/layout уходят в 80', () => {
    setUserPreferredLeft(0)
    expect(isUserCollapsedLeft()).toBe(true)
    expect(read('--left-column-visual-width')).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`)
    expect(read('--left-column-width')).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`)
  })

  it('открытая вкладка всплывает свёрнутую колонку визуально, но не в потоке', () => {
    setUserPreferredLeft(0)
    setOpenTabsLeftSidebar(true)
    expect(read('--left-column-visual-width')).toBe(`${DEFAULT_COLUMN_WIDTH}px`)
    expect(read('--left-column-width')).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`)
    setOpenTabsLeftSidebar(false)
    expect(read('--left-column-visual-width')).toBe(`${SIDEBAR_COLLAPSED_WIDTH}px`)
  })

  it('в floating-диапазоне (601-925) свёрнутость игнорируется', () => {
    setUserPreferredLeft(0)
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
    updateColumnWidths()
    expect(read('--left-column-visual-width')).toBe(`${DEFAULT_COLUMN_WIDTH}px`)
  })
})
