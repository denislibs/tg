/** @jsxImportSource solid-js */
/**
 * Вкладка «Энергосбережение» (`powerSaving.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/powerSaving.tsx` + `components/checkboxFields.tsx`,
 * 812502980) — задача 11 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppPowerSavingTab` из `solidJsTabs/tabs.ts`,
 * открытая через хост (`settingsSliderHost.ts`) тем же путём, что строка
 * «Общих». Стабы — только границы: тост и геометрия (happy-dom её не считает).
 *
 * Предмет — видимое в DOM и записанное в стор:
 *  • две секции в `<form>`: мастер `all` с подписью `LiteMode.Info` ВНЕ карточки,
 *    дерево ключей tweb `:28-37` — в порядке оригинала, лишних наших ключей нет;
 *  • смысл тумблеров: мастер = «энергосбережение включено» (`liteMode.all`),
 *    остальные — «анимация включена» (`!liteMode[key]`);
 *  • группа — строка-аккордеон со счётчиком `N/M`, вложенные — чекбоксы;
 *    щелчок по заголовку раскрывает, по тумблеру — переключает всех вложенных;
 *  • при `all` строки `is-disabled`, поля `is-fake-disabled`, счётчики 0/M,
 *    щелчок по секции — тост `LiteMode.DisableAlert`;
 *  • сохранение на `change` формы — в zustand через мост `useAppSettings`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore, DEFAULTS } from '@/settings'
import { AppPowerSavingTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'
// щелчок по заголовку группы раскрывает её (`cancelEvent`), а не переключает —
// «не переключилось» мерится по спецификации, а не по happy-dom
import { installSpecLabelActivation } from '@/test/specLabelActivation'

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  toastNew,
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost
let uninstallLabelActivation: () => void

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode } })

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
  toastNew.mockClear()
  useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode } })
})

const open = () => host.openTab(AppPowerSavingTab)
const liteMode = () => useSettingsStore.getState().liteMode

const sections = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]

/** Строка по английскому тексту заголовка (без счётчика группы). */
function row(tab: SliderSuperTab, key: keyof typeof lang) {
  const el = [...tab.scrollable.container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.row-title')?.firstChild?.textContent === lang[key])
  if(!el) throw new Error('no row ' + key)
  return el
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const titleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title')!
const counterOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.accordion-counter')!

describe('вкладка «Энергосбережение» — разметка', () => {
  it('шапка LiteMode.Title, контейнер вкладки power-saving-container', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang['LiteMode.Title'])
    expect(tab.container.classList.contains('power-saving-container')).toBe(true)
  })

  it('две секции внутри form; мастер — тумблер, подпись LiteMode.Info под карточкой', async() => {
    const tab = await open()
    const [info, list] = sections(tab)

    expect(sections(tab)).toHaveLength(2)
    expect(info.parentElement!.tagName).toBe('FORM')
    expect(list.parentElement).toBe(info.parentElement)

    const rows = [...info.querySelectorAll<HTMLElement>('.row')]
    expect(rows.map((r) => titleOf(r).textContent)).toEqual([lang['LiteMode.EnableText']])
    expect(rows[0].querySelector('.row-checkbox-field-toggle')).not.toBeNull()

    const caption = info.querySelector<HTMLElement>('.sidebar-left-section-caption')!
    expect(caption.textContent).toBe(lang['LiteMode.Info'])
    expect(caption.parentElement).toBe(info)
    expect(list.querySelector('.sidebar-left-section-caption')).toBeNull()
  })

  it('дерево ключей tweb :28-37 — порядок и вложенность; эмодзи-группы нет', async() => {
    const tab = await open()
    const content = sections(tab)[1].querySelector<HTMLElement>('.sidebar-left-section-content')!
    const shape = [...content.children].map((el) => el.classList.contains('accordion') ?
      [...el.querySelectorAll('.row-title')].map((t) => t.textContent) :
      el.querySelector('.row-title')!.firstChild!.textContent)

    expect(shape).toEqual([
      lang['LiteMode.Key.video.Title'],
      lang['LiteMode.Key.gif.Title'],
      lang['LiteMode.Key.stickers.Title'],
      [lang['LiteMode.Key.stickers_panel.Title'], lang['LiteMode.Key.stickers_chat.Title'], lang['LiteMode.Key.emoji_appear.Title']],
      lang['LiteMode.Key.effects.Title'],
      [lang['LiteMode.Key.effects_reactions.Title'], lang['LiteMode.Key.effects_premiumstickers.Title'], lang['LiteMode.Key.effects_emoji.Title']],
      lang['LiteMode.Key.chat.Title'],
      [lang['LiteMode.Key.chat_background.Title'], lang['LiteMode.Key.chat_spoilers.Title']],
      lang['LiteMode.Key.animations.Title'],
      lang['LiteMode.Key.blur.Title'],
    ])
  })

  it('группа — строка-аккордеон: with-delimiter, счётчик 3/3, стрелка; вложенные — чекбоксы в свёрнутом inert-блоке', async() => {
    const tab = await open()
    const group = row(tab, 'LiteMode.Key.stickers.Title')

    expect(group.classList.contains('accordion-row')).toBe(true)
    expect(group.classList.contains('accordion-toggler')).toBe(true)
    expect(group.querySelector('.row-title-row.with-delimiter')).not.toBeNull()
    expect(counterOf(group).textContent).toBe('3/3')
    expect(group.querySelector('.accordion-icon.tgico')).not.toBeNull()
    expect(input(group).disabled).toBe(true)
    expect(input(group).checked).toBe(true)

    const accordion = group.nextElementSibling as HTMLElement
    expect(accordion.classList.contains('accordion')).toBe(true)
    expect(accordion.hasAttribute('inert')).toBe(true)
    const nested = [...accordion.querySelectorAll<HTMLElement>('.row')]
    expect(nested).toHaveLength(3)
    for(const r of nested) {
      expect(r.querySelector('.row-checkbox-field')).not.toBeNull()
      expect(r.querySelector('.row-checkbox-field-toggle')).toBeNull()
    }

    // строки без группы — не аккордеон-тогглеры
    expect(row(tab, 'LiteMode.Key.gif.Title').classList.contains('accordion-toggler')).toBe(false)
    expect(row(tab, 'LiteMode.Key.gif.Title').classList.contains('accordion-row')).toBe(true)
  })
})

describe('вкладка «Энергосбережение» — смысл тумблеров', () => {
  it('выключенная анимация (liteMode.gif = true) — тумблер снят; мастер отражает liteMode.all как есть', async() => {
    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, gif: true } })
    const tab = await open()

    expect(input(row(tab, 'LiteMode.Key.gif.Title')).checked).toBe(false)
    expect(input(row(tab, 'LiteMode.Key.video.Title')).checked).toBe(true)
    expect(input(row(tab, 'LiteMode.EnableText')).checked).toBe(false)
  })

  it('частично выключенная группа: счётчик 2/3, групповой тумблер снят', async() => {
    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, effects_emoji: true } })
    const tab = await open()
    const group = row(tab, 'LiteMode.Key.effects.Title')

    expect(counterOf(group).textContent).toBe('2/3')
    expect(input(group).checked).toBe(false)
  })

  it('щелчок по тумблеру пишет инвертированное значение в zustand', async() => {
    const tab = await open()
    titleOf(row(tab, 'LiteMode.Key.gif.Title')).click()

    expect(input(row(tab, 'LiteMode.Key.gif.Title')).checked).toBe(false)
    expect(liteMode().gif).toBe(true)
    expect(liteMode().video).toBe(false)
  })

  it('запись сохраняет ключи, которых нет на экране (эмодзи-группа)', async() => {
    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, emoji_panel: true } })
    const tab = await open()
    titleOf(row(tab, 'LiteMode.Key.video.Title')).click()

    expect(liteMode().video).toBe(true)
    expect(liteMode().emoji_panel).toBe(true)
  })
})

describe('вкладка «Энергосбережение» — группы', () => {
  it('щелчок по заголовку группы раскрывает аккордеон и ничего не пишет', async() => {
    const tab = await open()
    const group = row(tab, 'LiteMode.Key.stickers.Title')
    const spy = vi.spyOn(useSettingsStore.getState(), 'update')

    titleOf(group).click()

    const accordion = group.nextElementSibling as HTMLElement
    expect(accordion.classList.contains('is-expanded')).toBe(true)
    expect(accordion.hasAttribute('inert')).toBe(false)
    expect(group.classList.contains('accordion-toggler-expanded')).toBe(true)
    expect(input(group).checked).toBe(true)
    expect(spy).not.toHaveBeenCalled()

    titleOf(group).click()
    expect(accordion.classList.contains('is-expanded')).toBe(false)
    expect(accordion.hasAttribute('inert')).toBe(true)
  })

  it('щелчок по заголовку группы погашен (cancelEvent): строка-label не активирует поле', async() => {
    const tab = await open()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })

    titleOf(row(tab, 'LiteMode.Key.effects.Title')).dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
  })

  it('щелчок по тумблеру группы переключает всех вложенных: 0/3 и запись в стор', async() => {
    const tab = await open()
    const group = row(tab, 'LiteMode.Key.stickers.Title')

    group.querySelector<HTMLElement>('.checkbox-toggle')!.click()

    expect(counterOf(group).textContent).toBe('0/3')
    expect(input(group).checked).toBe(false)
    expect((group.nextElementSibling as HTMLElement).classList.contains('is-expanded')).toBe(false)
    expect(liteMode()).toMatchObject({ stickers: true, stickers_panel: true, stickers_chat: true, emoji_appear: true })
  })

  it('вложенный чекбокс: счётчик 2/3, групповой снят, в сторе ключ и группа', async() => {
    const tab = await open()
    const group = row(tab, 'LiteMode.Key.chat.Title')
    titleOf(group).click()

    titleOf(row(tab, 'LiteMode.Key.chat_spoilers.Title')).click()

    expect(counterOf(group).textContent).toBe('1/2')
    expect(input(group).checked).toBe(false)
    expect(liteMode()).toMatchObject({ chat: true, chat_spoilers: true, chat_background: false })
  })
})

describe('вкладка «Энергосбережение» — режим all', () => {
  it('включили мастер: строки is-disabled, поля is-fake-disabled, счётчики 0/M; запись через 200 мс', async() => {
    const tab = await open()
    titleOf(row(tab, 'LiteMode.EnableText')).click()

    const list = sections(tab)[1]
    const rows = [...list.querySelectorAll<HTMLElement>('.row')]
    expect(rows).toHaveLength(15)
    for(const r of rows) {
      expect(r.classList.contains('is-disabled')).toBe(true)
      expect(input(r).classList.contains('is-fake-disabled')).toBe(true)
    }
    expect(counterOf(row(tab, 'LiteMode.Key.stickers.Title')).textContent).toBe('0/3')
    expect(counterOf(row(tab, 'LiteMode.Key.chat.Title')).textContent).toBe('0/2')
    expect(row(tab, 'LiteMode.EnableText').classList.contains('is-disabled')).toBe(false)
    expect(liteMode().all).toBe(false)

    await pause(250)
    expect(liteMode().all).toBe(true)
    // значения по ключам не тронуты — выключенный режим вернёт их как были
    expect(liteMode().gif).toBe(false)
  })

  it('открыли при all = true — строки уже выключены; щелчок по секции — тост LiteMode.DisableAlert', async() => {
    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, all: true } })
    const tab = await open()
    const list = sections(tab)[1]

    expect(input(row(tab, 'LiteMode.EnableText')).checked).toBe(true)
    expect(row(tab, 'LiteMode.Key.gif.Title').classList.contains('is-disabled')).toBe(true)

    list.querySelector<HTMLElement>('.sidebar-left-section-content')!.click()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'LiteMode.DisableAlert' })
  })

  it('выключили мастер — строки ожили, счётчики вернулись, запись сразу', async() => {
    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, all: true } })
    const tab = await open()
    titleOf(row(tab, 'LiteMode.EnableText')).click()

    expect(liteMode().all).toBe(false)
    expect(row(tab, 'LiteMode.Key.gif.Title').classList.contains('is-disabled')).toBe(false)
    expect(input(row(tab, 'LiteMode.Key.gif.Title')).classList.contains('is-fake-disabled')).toBe(false)
    expect(counterOf(row(tab, 'LiteMode.Key.stickers.Title')).textContent).toBe('3/3')

    sections(tab)[1].querySelector<HTMLElement>('.sidebar-left-section-content')!.click()
    expect(toastNew).not.toHaveBeenCalled()
  })
})

describe('вкладка «Энергосбережение» — каркас', () => {
  it('после закрытия Solid-остров снят: секций в DOM нет (DoD 5)', async() => {
    const tab = await open()
    expect(document.querySelectorAll('.sidebar-left-section-container').length).toBe(2)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
