/**
 * Побочки настройки «Энергосбережение» (план 2D, задача 11) — подписчик самой
 * настройки, а не обработчик строки вкладки: `client/liteModeSettings.ts`, порт
 * части tweb `appImManager.setSettings` (`appImManager.ts:2738-2757`), которую
 * оригинал зовёт на каждое `settings_updated`. Срабатывает, кто бы ни поменял
 * `liteMode`: вкладка, меню «Ещё», соседняя вкладка браузера.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS, useSettingsStore } from '@/settings'
import animationIntersector from '@components/animationIntersector'
import { watchLiteModeSettings } from './liteModeSettings'

let stop: () => void

const set = (patch: Partial<typeof DEFAULTS.liteMode>) =>
  useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, ...patch } })

beforeEach(() => {
  set({})
  document.body.className = 'animation-level-2'
  document.documentElement.className = ''
})

afterEach(() => {
  stop?.()
  set({})
  vi.restoreAllMocks()
})

describe('watchLiteModeSettings', () => {
  it('на заводе применяет текущее значение сразу', () => {
    set({ animations: true })
    stop = watchLiteModeSettings()
    expect(document.body.classList.contains('animation-level-0')).toBe(true)
    expect(document.body.classList.contains('animation-level-2')).toBe(false)
  })

  it('liteMode.animations гасит и возвращает классы уровня анимаций на body', () => {
    stop = watchLiteModeSettings()
    set({ animations: true })
    expect(document.body.classList.contains('animation-level-0')).toBe(true)
    set({})
    expect(document.body.classList.contains('animation-level-0')).toBe(false)
    expect(document.body.classList.contains('animation-level-2')).toBe(true)
  })

  it('all — тоже без анимаций (формула liteMode.isAvailable)', () => {
    stop = watchLiteModeSettings()
    set({ all: true })
    expect(document.body.classList.contains('animation-level-0')).toBe(true)
  })

  it('liteMode.blur ставит html.no-backdrop', () => {
    stop = watchLiteModeSettings()
    set({ blur: true })
    expect(document.documentElement.classList.contains('no-backdrop')).toBe(true)
    set({})
    expect(document.documentElement.classList.contains('no-backdrop')).toBe(false)
  })

  it('стикеры: автоплей по ключам stickers_chat/stickers_panel уходит в animationIntersector', () => {
    const setAutoplay = vi.spyOn(animationIntersector, 'setAutoplay')
    stop = watchLiteModeSettings()
    setAutoplay.mockClear()
    set({ stickers_chat: true })
    expect(setAutoplay).toHaveBeenCalledWith(false, 'stickers_chat')
    expect(setAutoplay).toHaveBeenCalledWith(true, 'stickers_panel')
  })

  it('смена чужого ключа настроек не трогает классы', () => {
    stop = watchLiteModeSettings()
    const toggle = vi.spyOn(document.body.classList, 'toggle')
    useSettingsStore.getState().update({ notifyVolume: 0.3 })
    expect(toggle).not.toHaveBeenCalled()
  })

  it('после отписки не реагирует', () => {
    stop = watchLiteModeSettings()
    stop()
    set({ animations: true })
    expect(document.body.classList.contains('animation-level-0')).toBe(false)
  })
})

// Проводка (web-client/CLAUDE.md, «Тесты»): подписку заводит `App.tsx` — рендер
// App в vitest невозможен (нужны менеджеры/воркер), поэтому скан исходника, как
// `App.authMount.test.ts`: вызов лежит в теле layout-эффекта и отдаёт ему отписку.
describe('проводка в App.tsx', () => {
  it('watchLiteModeSettings заводится в useLayoutEffect и снимается его уборкой', async() => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    expect(src).toMatch(/useLayoutEffect\(\s*\(\)\s*=>\s*(?:\{\s*return\s+)?watchLiteModeSettings\(\)/)
  })
})
