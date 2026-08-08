import { describe, it, expect, beforeEach } from 'vitest'
import updateColumnWidths, { DEFAULT_COLUMN_WIDTH } from './updateColumnWidths'

const read = (name: string) => document.documentElement.style.getPropertyValue(name)

function atWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  // модуль кэширует последние значения — сбрасываем через два прогона подряд
  updateColumnWidths()
  updateColumnWidths()
}

describe('updateColumnWidths', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.className = ''
  })

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
