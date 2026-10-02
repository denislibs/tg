/** @jsxImportSource solid-js */
/**
 * Вкладки автозагрузки (`autoDownload/{photo,video,file}.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/autoDownload/*`, 812502980) — задача 7 плана волны 2D.
 *
 * Вкладки настоящие (`AppAutoDownload*Tab` из `solidJsTabs/tabs.ts`), открыты
 * через хост; «Данные и память» → «Photos» — тем же путём, что у пользователя.
 * Предмет — прежний React-саб рисовал квадратные чекбоксы и ключи
 * `Contacts`/`ChatList.Filter.Channels`; у tweb — тумблеры и `Autodownload*`,
 * запись — лист `autoDownload.<тип>.<пир>` на переключении, предел файла — с
 * дебаунсом 200 мс.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { DEFAULTS, useSettingsStore } from '@/settings'
import { AppAutoDownloadFileTab, AppAutoDownloadPhotoTab, AppAutoDownloadVideoTab, AppDataAndStorageTab } from '@components/solidJsTabs/tabs'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import { installSidebarLeft, type InstalledSidebarLeft } from '@/test/sidebarLeft'

vi.mock('@core/mediaCache', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  collectCachedFilesSizes: vi.fn(async() => ({ total: 0, images: 0, videos: 0, stickers: 0, other: 0 })),
}))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: InstalledSidebarLeft
let uninstallLabelActivation: () => void

const resetSettings = () => useSettingsStore.getState().update({
  autoDownloadEnabled: DEFAULTS.autoDownloadEnabled,
  autoDownloadPhoto: { ...DEFAULTS.autoDownloadPhoto },
  autoDownloadVideo: { ...DEFAULTS.autoDownloadVideo },
  autoDownloadFile: { ...DEFAULTS.autoDownloadFile },
  autoDownloadFileSizeMax: DEFAULTS.autoDownloadFileSizeMax,
})

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  resetSettings()

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = installSidebarLeft({} as Managers, columnEl)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  vi.restoreAllMocks()
  resetSettings()
})

function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el as HTMLElement
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const titleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title')!

const PEER_TITLES = [lang.AutodownloadContacts, lang.AutodownloadPrivateChats, lang.AutodownloadGroupChats, lang.AutodownloadChannels]

describe('автозагрузка — фото и видео', () => {
  it('фото: шапка AutoDownloadPhotos, секция AutoDownloadPhotosTitle, четыре ТУМБЛЕРА ключами tweb', async() => {
    useSettingsStore.getState().update({ autoDownloadPhoto: { contacts: true, private: false, groups: true, channels: false } })
    const tab = await host.openTab(AppAutoDownloadPhotoTab)

    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.AutoDownloadPhotos)
    const sections = tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')
    expect(sections).toHaveLength(1)
    expect(sections[0].querySelector('.sidebar-left-section-name')!.textContent).toBe(lang.AutoDownloadPhotosTitle)

    const rows = [...sections[0].querySelectorAll<HTMLElement>('.row')]
    expect(rows.map((r) => titleOf(r).textContent)).toEqual(PEER_TITLES)
    expect(rows.every((r) => r.querySelector('.checkbox-field-toggle.row-checkbox-field-toggle'))).toBe(true)
    expect(rows.map((r) => input(r).checked)).toEqual([true, false, true, false])
  })

  it('клик по строке «Group Chats» — ровно одна запись, меняет только своё поле', async() => {
    const tab = await host.openTab(AppAutoDownloadPhotoTab)
    // vitest отдаёт тот же шпион, что и в прошлом тесте, вместе с его вызовами
    const spy = vi.spyOn(useSettingsStore.getState(), 'update').mockClear()

    titleOf(row(tab, lang.AutodownloadGroupChats)).click()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().autoDownloadPhoto).toEqual({ contacts: true, private: true, groups: false, channels: true })
    expect(input(row(tab, lang.AutodownloadGroupChats)).checked).toBe(false)
  })

  it('видео пишет autoDownloadVideo, фото не трогает', async() => {
    const tab = await host.openTab(AppAutoDownloadVideoTab)
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.AutoDownloadVideos)

    input(row(tab, lang.AutodownloadChannels)).click()

    expect(useSettingsStore.getState().autoDownloadVideo.channels).toBe(false)
    expect(useSettingsStore.getState().autoDownloadPhoto).toEqual(DEFAULTS.autoDownloadPhoto)
  })

  it('переключение доезжает до подписи строки «Photos» во вкладке-родителе', async() => {
    const parent = await host.openTab(AppDataAndStorageTab)
    row(parent, lang.AutoDownloadPhotos).click()
    await vi.waitFor(() => expect(document.querySelectorAll('.sidebar-header__title')).toHaveLength(2))
    const photoTab = document.querySelectorAll<HTMLElement>('.sidebar-slider-item')
    const content = photoTab[photoTab.length - 1]
    await vi.waitFor(() => expect(content.querySelectorAll('.row')).toHaveLength(4))

    const channels = [...content.querySelectorAll<HTMLElement>('.row')].find((r) => titleOf(r).textContent === lang.AutodownloadChannels)!
    titleOf(channels).click()

    const subtitle = row(parent, lang.AutoDownloadPhotos).querySelector('.row-subtitle')!.textContent
    expect(subtitle).toBe(lang.AutoDownloadOnFor.replace('%1$s', [
      lang.AutoDownloadContacts, lang['AutoDownloadSettings.Delimeter'],
      lang.AutoDownloadPm, lang['AutoDownloadSettings.LastDelimeter'],
      lang.AutoDownloadGroups,
    ].join('')))
  })

  it('после закрытия секция снята (узел вкладки и корень Solid) — DoD 5', async() => {
    const tab = await host.openTab(AppAutoDownloadPhotoTab)
    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(1)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})

describe('автозагрузка — файлы', () => {
  it('ползунок размера — в той же секции после тумблеров: имя, «up to 3.0 MB»', async() => {
    const tab = await host.openTab(AppAutoDownloadFileTab)
    const content = tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section-content')!
    const children = [...content.children]
    const selector = content.querySelector<HTMLElement>(':scope > .range-setting-selector')!

    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.AutoDownloadFiles)
    expect(content.querySelector('.sidebar-left-section-name')!.textContent).toBe(lang.AutoDownloadFilesTitle)
    expect(children[children.length - 1]).toBe(selector)
    expect(selector.querySelector('.range-setting-selector-name')!.textContent).toBe(lang.AutoDownloadMaxFileSize)
    expect(selector.querySelector('.range-setting-selector-value')!.textContent).toBe(lang.AutodownloadSizeLimitUpTo.replace('%1$s', '3.0 MB'))
  })

  it('скраб: подпись сразу, запись предела — одна, после дебаунса 200 мс', async() => {
    const tab = await host.openTab(AppAutoDownloadFileTab)
    const selector = tab.scrollable.container.querySelector<HTMLElement>('.range-setting-selector')!
    const seek = selector.querySelector<HTMLInputElement>('input[type="range"]')!
    const spy = vi.spyOn(useSettingsStore.getState(), 'update').mockClear()

    for(const value of ['0.5', '0.9', '1']) {
      seek.value = value
      seek.dispatchEvent(new Event('input', { bubbles: true }))
    }

    expect(selector.querySelector('.range-setting-selector-value')!.textContent).toBe(lang.AutodownloadSizeLimitUpTo.replace('%1$s', '20.0 MB'))
    expect(spy).not.toHaveBeenCalled()

    await pause(250)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(useSettingsStore.getState().autoDownloadFileSizeMax).toBe(20 * 1024 * 1024)
  })
})
