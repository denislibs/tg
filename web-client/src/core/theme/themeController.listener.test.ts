// @vitest-environment happy-dom
// Порт tweb `themeController.setThemeListener` (helpers/themeController.ts:271-292):
// тема применяется сразу и следует за системной (`prefers-color-scheme`), когда
// выбрано «как в системе». Нужен ДО экрана блокировки — под замком React (а с
// ним `useThemeToggle`) не монтируется, и без этого экран рисовался на голом
// белом фоне (баг со стенда). Отдельный файл: подписка ставится один раз на жизнь
// модуля, как у оригинала на жизнь страницы.
import { describe, expect, it, vi } from 'vitest'
import type { ThemeChoice } from '../../theme'

type Listener = (e: { matches: boolean }) => void
const listeners: Listener[] = []
let dark = false
window.matchMedia = vi.fn((query: string) => ({
  get matches() { return query.includes('dark') ? dark : false },
  media: query,
  addEventListener: (_: string, cb: Listener) => { listeners.push(cb) },
  removeEventListener: vi.fn(),
})) as unknown as typeof window.matchMedia

const { setThemeListener, getCurrentPreset } = await import('./themeController')

const flipSystem = (value: boolean) => {
  dark = value
  for (const cb of listeners) cb({ matches: value })
}

describe('setThemeListener', () => {
  it('применяет выбор сразу и следует за системой только при «как в системе»', () => {
    let choice: ThemeChoice = 'system'
    setThemeListener(() => choice)

    const html = document.documentElement
    expect(html.getAttribute('data-theme')).toBe('day')
    expect(document.getElementById('theme')?.textContent).toMatch(/--background-color:#/)

    flipSystem(true)
    expect(getCurrentPreset()).toBe('night')
    expect(html.classList.contains('night')).toBe(true)

    flipSystem(false)
    expect(getCurrentPreset()).toBe('day')
    expect(html.classList.contains('night')).toBe(false)

    // выбрана конкретная тема — системная ей не указ
    choice = 'night'
    flipSystem(true)
    flipSystem(false)
    expect(getCurrentPreset()).toBe('night')
  })

  it('повторный вызов не вешает вторую подписку', () => {
    const before = listeners.length
    setThemeListener(() => 'day')
    expect(listeners.length).toBe(before)
    expect(getCurrentPreset()).toBe('day')
  })
})
