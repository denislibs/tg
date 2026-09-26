/**
 * Врезка «Энергосбережения» (план 2D, задача 11): строка `LiteMode.Title` в
 * «Общих» открывает Solid-вкладку `AppPowerSavingTab` через хост слайдера (как
 * tweb `generalSettings.tsx:89` — `tab.slider.createTab(AppPowerSavingTab)`), а
 * справа — живой статус режима по `liteMode.all` (tweb `:37-38`), а не
 * захардкоженное «Выключено». Хост — граница (слайдер вкладок), он застаблен.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import lang from '@/lang'
import { DEFAULTS, useSettingsStore } from '@/settings'
import { AppPowerSavingTab } from '../solidJsTabs/tabs'
import GeneralSettings from './GeneralSettings'

const openTab = vi.hoisted(() => vi.fn(async() => undefined))
vi.mock('../sidebarLeft/settingsSliderHost', () => ({
  getSettingsSliderHost: () => ({ openTab }),
}))

afterEach(() => {
  cleanup()
  openTab.mockClear()
  useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode } })
})

const liteModeRow = () => [...document.querySelectorAll<HTMLElement>('.row')]
  .find((row) => row.textContent?.includes(lang['LiteMode.Title']))!

describe('«Общие» → «Энергосбережение»', () => {
  it('строка открывает вкладку AppPowerSavingTab через хост слайдера', () => {
    render(<GeneralSettings onBack={() => {}} />)
    fireEvent.click(liteModeRow())
    expect(openTab).toHaveBeenCalledWith(AppPowerSavingTab)
  })

  it('справа — статус режима: Disabled / Enabled по liteMode.all', () => {
    const { unmount } = render(<GeneralSettings onBack={() => {}} />)
    expect(liteModeRow().textContent).toContain(lang['Checkbox.Disabled'])
    unmount()

    useSettingsStore.getState().update({ liteMode: { ...DEFAULTS.liteMode, all: true } })
    render(<GeneralSettings onBack={() => {}} />)
    expect(liteModeRow().textContent).toContain(lang['Checkbox.Enabled'])
  })
})
