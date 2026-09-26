/**
 * Мост `useAppSettings()` (`stores/appSettings.solid.ts`, задача 4 плана 2D):
 * API tweb `stores/appSettings.ts` поверх нашего zustand `useSettingsStore` —
 * БЕЗ второй копии факта. Пины на результат:
 *  • запись пути tweb доезжает до zustand и до `localStorage` (там живёт факт);
 *  • запись из React (`update`) видна Solid-эффекту по пути tweb;
 *  • незаведённый путь — `throw`, а не молчаливый no-op;
 *  • скан: в мосту нет собственного хранилища (ни Solid-стора, ни сигнала,
 *    ни `localStorage`), и ключ `tg-settings` пишет только `settings.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createEffect, createRoot } from 'solid-js'
import { useSettingsStore } from '@/settings'
import { appSettings, setAppSettings, useAppSettings } from './appSettings.solid'

const SRC = join(__dirname, '..')
const initial = useSettingsStore.getState()

afterEach(() => {
  useSettingsStore.getState().update({
    notifyDesktop: initial.notifyDesktop,
    notifyPush: initial.notifyPush,
    notifySound: initial.notifySound,
    notifyVolume: initial.notifyVolume,
    sentMessageSound: initial.sentMessageSound,
  })
})

describe('useAppSettings — один источник правды (zustand)', () => {
  it('setAppSettings(notifications, desktop, false) пишет в zustand и в localStorage', async() => {
    useSettingsStore.getState().update({ notifyDesktop: true })

    await setAppSettings('notifications', 'desktop', false)

    expect(useSettingsStore.getState().notifyDesktop).toBe(false)
    expect(JSON.parse(localStorage.getItem('tg-settings')!).notifyDesktop).toBe(false)
  })

  it('update() из React виден Solid-эффекту по пути tweb', () => {
    const seen: number[] = []
    const dispose = createRoot((dispose) => {
      const [settings] = useAppSettings()
      createEffect(() => { seen.push(settings.notifications.volume) })
      return dispose
    })

    useSettingsStore.getState().update({ notifyVolume: 0.3 })
    dispose()

    expect(seen[seen.length - 1]).toBe(0.3)
    expect(appSettings.notifications.volume).toBe(0.3)
  })

  it('эффект по одному пути не перезапускается от смены чужого ключа', () => {
    let runs = 0
    const dispose = createRoot((dispose) => {
      createEffect(() => { void appSettings.notifications.sound; ++runs })
      return dispose
    })

    useSettingsStore.getState().update({ notifyVolume: 0.7 })
    dispose()

    expect(runs).toBe(1)
  })

  it('незаведённый путь — throw, а не молчаливый no-op', () => {
    // @ts-expect-error — пути нет в таблице соответствий
    expect(() => setAppSettings('notifications', 'novibrate', true)).toThrow(/novibrate/)
    // @ts-expect-error — поддерево, а не лист
    expect(() => setAppSettings('notifications', {})).toThrow(/notifications/)
  })
})

describe('нет второго стора настроек (скан исходников)', () => {
  function walk(dir: string, acc: string[] = []): string[] {
    for(const name of readdirSync(dir)) {
      const p = join(dir, name)
      if(statSync(p).isDirectory()) walk(p, acc)
      else if(/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
    }
    return acc
  }

  it('мост не заводит своего хранилища: ни createStore, ни createSignal, ни localStorage', () => {
    const src = readFileSync(join(__dirname, 'appSettings.solid.ts'), 'utf8')
      // комментарии объясняют, ЧЕГО здесь нет, — их не считаем
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/createStore|createSignal|createMutable|localStorage/)
    expect(src).toMatch(/subscribeExternal\(/)
  })

  it('ключ tg-settings (персист настроек) пишет только settings.tsx', () => {
    const writers = walk(SRC)
      .filter((file) => /['"]tg-settings['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1))
    expect(writers).toEqual(['settings.tsx'])
  })
})
