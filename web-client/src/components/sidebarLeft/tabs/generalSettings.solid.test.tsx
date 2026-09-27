/** @jsxImportSource solid-js */
/**
 * Вкладка «Общие» (`generalSettings.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/generalSettings.tsx`, 812502980) — задача 13 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppGeneralSettingsTab` из `solidJsTabs/tabs.ts`,
 * открытая через хост (`settingsSliderHost.ts`) тем же путём, что строка корня
 * настроек. Стабы — только границы: геометрия (happy-dom её не считает) и холсты
 * фона вкладки «Обои» (в happy-dom нет 2D-контекста).
 *
 * Предмет — видимое в DOM и записанное в настройки:
 *  • три секции в порядке оригинала — `Settings`, `ColorTheme`,
 *    `General.TimeFormat`; `DistanceUnitsTitle` нет (у tweb
 *    `IS_GEOLOCATION_SUPPORTED` — всегда `false`);
 *  • ползунок размера текста 12–20 с шагом 1 пишет `textSize`;
 *  • строки «Обои» и «Энергосбережение» открывают свои вкладки; статус справа
 *    у второй — живой по `liteMode.all`, без переоткрытия;
 *  • пять радио темы в порядке и с ключами tweb пишут `themeChoice`;
 *  • два радио формата времени с живым временем в подписи пишут `timeFormat`;
 *  • закрытие вкладки снимает Solid-остров и минутный таймер.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore, DEFAULTS } from '@/settings'
import { getIconContent } from '@components/icon'
import { AppGeneralSettingsTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'
import { installSpecLabelActivation } from '@/test/specLabelActivation'

// Вкладка «Обои», которую открывает строка: плитки рисуют холсты, а в happy-dom
// нет 2D-контекста (как в `background.solid.test.tsx`).
vi.mock('@core/chat/gradientRenderer', () => ({
  default: class {
    static createCanvas() { return document.createElement('canvas') }
    static create() { return { gradientRenderer: {}, canvas: document.createElement('canvas') } }
    init() {}
  },
}))
vi.mock('@core/chat/patternRenderer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  renderPattern: () => {},
}))

// Минутный таймер подписей формата времени — настоящий, но его отмена видна
// тесту: «остров снят» включает и таймер (tweb `onCleanup(cancel)`, `:325`).
const cancelMinute = vi.hoisted(() => vi.fn())
vi.mock('@helpers/eachMinute', async(importOriginal) => {
  const real = (await importOriginal<typeof import('@helpers/eachMinute')>()).default
  return {
    default: (callback: () => unknown, runFirst?: boolean) => {
      const cancel = real(callback, runFirst)
      return () => {
        cancelMinute()
        cancel()
      }
    },
  }
})

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost
let uninstallLabelActivation: () => void

const resetSettings = () => useSettingsStore.getState().update({
  textSize: DEFAULTS.textSize,
  themeChoice: DEFAULTS.themeChoice,
  timeFormat: DEFAULTS.timeFormat,
  liteMode: { ...DEFAULTS.liteMode },
})

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  resetSettings()

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, {} as Managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
  cancelMinute.mockClear()
  resetSettings()
})

const open = () => host.openTab(AppGeneralSettingsTab)
const settings = () => useSettingsStore.getState()

const sections = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]

const sectionName = (section: HTMLElement) =>
  section.querySelector('.sidebar-left-section-name')?.textContent

const content = (section: HTMLElement) =>
  section.querySelector<HTMLElement>('.sidebar-left-section-content')!

/** Строка по английскому тексту заголовка (без правой части). */
function row(tab: SliderSuperTab, text: string) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.firstChild?.textContent === text)
  if(!el) throw new Error('no row ' + text)
  return el
}

const radio = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="radio"]')!
const titleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title')!.firstChild!.textContent
const tabTitles = () => [...document.querySelectorAll('.sidebar-header__title')].map((el) => el.textContent)

describe('вкладка «Общие» — разметка', () => {
  it('шапка Telegram.GeneralSettingsViewController', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent)
      .toBe(lang['Telegram.GeneralSettingsViewController'])
  })

  it('три секции в порядке оригинала; секции единиц расстояния нет', async() => {
    const tab = await open()
    expect(sections(tab).map(sectionName)).toEqual([
      lang.Settings,
      lang.ColorTheme,
      lang['General.TimeFormat'],
    ])
  })
})

describe('секция Settings', () => {
  it('первым — ползунок размера текста 12–20, шаг 1, значение справа — число', async() => {
    useSettingsStore.getState().update({ textSize: 17 })
    const tab = await open()
    const first = content(sections(tab)[0]).children
    // имя секции, затем ползунок
    expect(first[1].classList.contains('range-setting-selector')).toBe(true)

    const selector = first[1] as HTMLElement
    expect(selector.querySelector('.range-setting-selector-name')!.textContent).toBe(lang.TextSize)
    expect(selector.querySelector('.range-setting-selector-value')!.textContent).toBe('17')

    const seek = selector.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([seek.min, seek.max, seek.step]).toEqual(['12', '20', '1'])
  })

  it('ползунок пишет textSize и обновляет число', async() => {
    const tab = await open()
    const selector = content(sections(tab)[0]).querySelector<HTMLElement>('.range-setting-selector')!
    const seek = selector.querySelector<HTMLInputElement>('input[type="range"]')!
    seek.value = '19'
    seek.dispatchEvent(new Event('input', { bubbles: true }))

    expect(settings().textSize).toBe(19)
    expect(selector.querySelector('.range-setting-selector-value')!.textContent).toBe('19')
  })

  it('после ползунка — ровно две строки: «Обои» и «Энергосбережение» с иконками tweb', async() => {
    const tab = await open()
    const rows = [...content(sections(tab)[0]).querySelectorAll<HTMLElement>('.row')]
    expect(rows.map(titleOf)).toEqual([lang.ChatBackground, lang['LiteMode.EnableText']])
    expect(rows.map((r) => r.querySelector('.row-icon')!.textContent)).toEqual([
      getIconContent('appearance_filled'),
      getIconContent('sputnik_filled'),
    ])
    expect(rows.every((r) => r.classList.contains('row-clickable'))).toBe(true)
  })

  it('«Энергосбережение»: справа вторичный статус, живой по liteMode.all', async() => {
    const tab = await open()
    const right = () => row(tab, lang['LiteMode.EnableText'])
      .querySelector<HTMLElement>('.row-title-right')!
    expect(right().classList.contains('row-title-right-secondary')).toBe(true)
    expect(right().textContent).toBe(lang['Checkbox.Disabled'])

    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, all: true } })
    expect(right().textContent).toBe(lang['Checkbox.Enabled'])
  })

  it('«Обои» открывает вкладку ChatBackground', async() => {
    const tab = await open()
    row(tab, lang.ChatBackground).click()
    await pause(100)
    expect(tabTitles()).toContain(lang.ChatBackground)
  })

  it('«Энергосбережение» открывает вкладку LiteMode.Title', async() => {
    const tab = await open()
    row(tab, lang['LiteMode.EnableText']).click()
    await pause(100)
    expect(tabTitles()).toContain(lang['LiteMode.Title'])
  })
})

describe('секция ColorTheme', () => {
  const THEMES = ['ThemeDay', 'ThemeNight', 'ThemeLight', 'ThemeTinted', 'AutoNightSystemDefault'] as const

  it('пять радио в form, в порядке и с ключами tweb', async() => {
    const tab = await open()
    const form = content(sections(tab)[1]).querySelector('form')!
    const rows = [...form.querySelectorAll<HTMLElement>('.row')]
    expect(rows.map(titleOf)).toEqual(THEMES.map((key) => lang[key]))
    expect(rows.map((r) => radio(r).value)).toEqual(['day', 'night', 'light', 'tinted', 'system'])
    expect(rows.every((r) => r.querySelector('.row-radio-field') !== null)).toBe(true)
  })

  it('отмечено выбранное themeChoice', async() => {
    useSettingsStore.getState().update({ themeChoice: 'tinted' })
    const tab = await open()
    const checked = [...content(sections(tab)[1]).querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .filter((input) => input.checked).map((input) => input.value)
    expect(checked).toEqual(['tinted'])
  })

  it('щелчок по строке пишет themeChoice и переносит отметку', async() => {
    const tab = await open()
    row(tab, lang.ThemeNight).querySelector<HTMLElement>('.row-title')!.click()
    expect(settings().themeChoice).toBe('night')
    expect(radio(row(tab, lang.ThemeNight)).checked).toBe(true)
    expect(radio(row(tab, lang.AutoNightSystemDefault)).checked).toBe(false)
  })
})

describe('секция General.TimeFormat', () => {
  it('два радио в form: подписи — текущее время в h12/h23, отмечен timeFormat', async() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 27, 22, 16, 5))
    const tab = await open()
    const rows = [...content(sections(tab)[2]).querySelectorAll<HTMLElement>('form > .row')]

    expect(rows.map(titleOf)).toEqual([lang['General.TimeFormat.h12'], lang['General.TimeFormat.h23']])
    expect(rows.map((r) => r.querySelector('.row-subtitle')!.textContent)).toEqual(['10:16 PM', '22:16'])
    expect(rows.map((r) => radio(r).checked)).toEqual([false, true])
  })

  it('щелчок по «12-hour» пишет timeFormat 12h', async() => {
    const tab = await open()
    row(tab, lang['General.TimeFormat.h12']).querySelector<HTMLElement>('.row-title')!.click()
    expect(settings().timeFormat).toBe('12h')
    expect(radio(row(tab, lang['General.TimeFormat.h12'])).checked).toBe(true)
  })
})

describe('жизненный цикл', () => {
  it('закрытие снимает Solid-остров и минутный таймер подписей', async() => {
    const tab = await open()
    expect(cancelMinute).not.toHaveBeenCalled()
    tab.close()
    await pause(400)

    expect(document.querySelector('.range-setting-selector')).toBeNull()
    expect(document.querySelector('input[name="time-format"]')).toBeNull()
    expect(cancelMinute).toHaveBeenCalledTimes(1)
  })
})
