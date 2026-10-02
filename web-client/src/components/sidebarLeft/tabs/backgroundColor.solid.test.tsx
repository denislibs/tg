/** @jsxImportSource solid-js */
/**
 * Вкладка «Цвет» (`backgroundColor.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/backgroundColor.tsx`, 812502980) — задача 12 плана волны 2D.
 *
 * Вкладка настоящая (`AppBackgroundColorTab`), открыта через хост. Предмет:
 *  • разметка — `ColorPicker` в секции, 12 образцов сеткой отдельным блоком;
 *  • клик по образцу пишет сплошной цвет в настройки и снимает своё фото;
 *  • открытие НЕ перезаписывает обои, если они не цвет (порядок назначения
 *    `onChange` относительно `setColor`, `:122-138`); у цветных — отмечает образец.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore } from '@/settings'
import { AppBackgroundColorTab } from '@components/solidJsTabs/tabs'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: InstalledSidebarLeft

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 380, height: 198, right: 380, bottom: 198, x: 0, y: 0,
  } as DOMRect)
  useSettingsStore.getState().update({ wallpaper: { kind: 'default' }, customWallpaperMediaId: undefined })

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft({} as Managers, columnEl)
})

afterEach(async() => {
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = async() => {
  const tab = await host.openTab(AppBackgroundColorTab)
  await pause(20) // setTimeout(0) оригинала (:122) + троттлинг применения
  return tab
}

const swatches = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.search-super-content-media-grid .grid-item')]
const hexInput = (tab: SliderSuperTab) =>
  tab.scrollable.container.querySelector<HTMLInputElement>('.color-picker-inputs .input-field input')!

describe('вкладка «Цвет»', () => {
  it('шапка SetColor, классы контейнера, ColorPicker в секции и 12 образцов сеткой вне её', async() => {
    const tab = await open()
    expect(tab.title.textContent).toBe(lang.SetColor)
    expect(tab.container.classList.contains('background-container')).toBe(true)
    expect(tab.container.classList.contains('background-color-container')).toBe(true)
    expect(tab.scrollable.container.querySelector('.sidebar-left-section-content > .color-picker')).not.toBeNull()

    const items = swatches(tab)
    expect(items).toHaveLength(12)
    expect(items[0].className).toBe('grid-item background-item')
    expect(items[0].dataset.color).toBe('#e6ebee')
    expect(items[2].dataset.color).toBe('#008dd0')
    expect(items[0].querySelector<HTMLElement>('.grid-item-media')!.style.backgroundColor).not.toBe('')
    expect(items[0].closest('.sidebar-left-section-container')).toBeNull()
  })

  it('открытие при обоях-не-цвете ничего не пишет; HEX — запасной #cccccc', async() => {
    const writes: unknown[] = []
    const unsubscribe = useSettingsStore.subscribe((s, prev) => {
      if(s.wallpaper !== prev.wallpaper) writes.push(s.wallpaper)
    })
    const tab = await open()
    unsubscribe()

    expect(writes).toEqual([])
    expect(hexInput(tab).value).toBe('#cccccc')
  })

  it('клик по образцу — сплошной цвет в настройках, своё фото снято, образец активен', async() => {
    useSettingsStore.getState().update({ customWallpaperMediaId: 5 })
    const tab = await open()
    swatches(tab)[2].click()
    await pause(40)

    const s = useSettingsStore.getState()
    expect(s.wallpaper).toEqual({ kind: 'color', color: '#008dd0' })
    expect(s.customWallpaperMediaId).toBeUndefined()
    expect(swatches(tab)[2].classList.contains('active')).toBe(true)
    expect(swatches(tab)[2].classList.contains('is-corner-tr')).toBe(true)
    expect(hexInput(tab).value).toBe('#008dd0')
  })

  it('открытие при цветных обоях — HEX этого цвета, образец отмечен', async() => {
    useSettingsStore.getState().update({ wallpaper: { kind: 'color', color: '#c4e1a6' } })
    const tab = await open()

    expect(hexInput(tab).value).toBe('#c4e1a6')
    const active = swatches(tab).filter((el) => el.classList.contains('active'))
    expect(active.map((el) => el.dataset.color)).toEqual(['#c4e1a6'])
  })
})
