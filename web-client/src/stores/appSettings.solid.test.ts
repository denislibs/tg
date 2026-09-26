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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createEffect, createRoot } from 'solid-js'
import { DEFAULTS, useSettingsStore } from '@/settings'
import copy from '@helpers/object/copy'
import deepEqual from '@helpers/object/deepEqual'
import { appSettings, setAppSettings, SETTINGS_INIT, useAppSettings } from './appSettings.solid'

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
    // @ts-expect-error — пути нет и внутри поддерева
    expect(() => setAppSettings('autoDownloadNew', 'photo_size_max', 1)).toThrow(/photo_size_max/)
  })
})

describe('useAppSettings — формы записи «Данных и памяти» (задача 7 плана 2D)', () => {
  afterEach(() => {
    useSettingsStore.getState().update({
      autoDownloadEnabled: DEFAULTS.autoDownloadEnabled,
      autoDownloadPhoto: { ...DEFAULTS.autoDownloadPhoto },
      autoDownloadVideo: { ...DEFAULTS.autoDownloadVideo },
      autoDownloadFile: { ...DEFAULTS.autoDownloadFile },
      autoDownloadFileSizeMax: DEFAULTS.autoDownloadFileSizeMax,
    })
  })

  it('путь внутрь значения-объекта: autoDownload.photo.groups меняет одно поле, остальное не трогает', async() => {
    const before = useSettingsStore.getState().autoDownloadPhoto

    await setAppSettings('autoDownload', 'photo', 'groups', false)

    const after = useSettingsStore.getState().autoDownloadPhoto
    expect(after).toEqual({ ...before, groups: false })
    expect(after).not.toBe(before)
    expect(appSettings.autoDownload.photo.groups).toBe(false)
  })

  it('autoDownloadNew.pFlags.disabled — обратный смысл autoDownloadEnabled в обе стороны', async() => {
    expect(appSettings.autoDownloadNew.pFlags.disabled).toBeUndefined()

    await setAppSettings('autoDownloadNew', 'pFlags', 'disabled', true)
    expect(useSettingsStore.getState().autoDownloadEnabled).toBe(false)
    expect(appSettings.autoDownloadNew.pFlags.disabled).toBe(true)

    await setAppSettings('autoDownloadNew', 'pFlags', 'disabled', undefined)
    expect(useSettingsStore.getState().autoDownloadEnabled).toBe(true)
  })

  it('запись поддерева — одним update, как setStore(путь, объект) у tweb', async() => {
    useSettingsStore.getState().update({
      autoDownloadEnabled: false,
      autoDownloadPhoto: { contacts: false, private: false, groups: false, channels: false },
      autoDownloadFileSizeMax: 1024,
    })
    const spy = vi.spyOn(useSettingsStore.getState(), 'update')

    await setAppSettings('autoDownload', copy(SETTINGS_INIT.autoDownload))
    await setAppSettings('autoDownloadNew', copy(SETTINGS_INIT.autoDownloadNew))

    expect(spy).toHaveBeenCalledTimes(2)
    const state = useSettingsStore.getState()
    expect(state.autoDownloadPhoto).toEqual(DEFAULTS.autoDownloadPhoto)
    expect(state.autoDownloadPhoto).not.toBe(DEFAULTS.autoDownloadPhoto)
    expect(state.autoDownloadEnabled).toBe(true)
    expect(state.autoDownloadFileSizeMax).toBe(DEFAULTS.autoDownloadFileSizeMax)
    spy.mockRestore()
  })

  it('поддерево сливается по ключам объекта: поле, которого в объекте нет, не трогается', async() => {
    useSettingsStore.getState().update({ autoDownloadVideo: { contacts: false, private: false, groups: false, channels: false } })
    const video = useSettingsStore.getState().autoDownloadVideo

    await setAppSettings('autoDownload', { photo: { contacts: false, private: true, groups: true, channels: true } })

    expect(useSettingsStore.getState().autoDownloadPhoto.contacts).toBe(false)
    expect(useSettingsStore.getState().autoDownloadVideo).toBe(video)
    expect(useSettingsStore.getState().autoDownloadFile).toEqual(DEFAULTS.autoDownloadFile)
  })

  it('SETTINGS_INIT — дефолты в форме tweb; deepEqual с текущими — признак «ничего не меняли»', async() => {
    expect(SETTINGS_INIT.autoDownloadNew.file_size_max).toBe(DEFAULTS.autoDownloadFileSizeMax)
    expect(deepEqual(appSettings.autoDownload, SETTINGS_INIT.autoDownload)).toBe(true)
    expect(deepEqual(appSettings.autoDownloadNew, SETTINGS_INIT.autoDownloadNew)).toBe(true)

    await setAppSettings('autoDownloadNew', 'pFlags', 'disabled', true)
    expect(deepEqual(appSettings.autoDownloadNew, SETTINGS_INIT.autoDownloadNew)).toBe(false)
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
