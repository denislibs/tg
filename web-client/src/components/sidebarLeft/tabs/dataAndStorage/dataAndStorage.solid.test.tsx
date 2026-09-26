/** @jsxImportSource solid-js */
/**
 * Вкладка «Данные и память» (`dataAndStorage/index.solid.tsx` +
 * `storageQuota.solid.tsx`, порт tweb `sidebarLeft/tabs/dataAndStorage/*`,
 * 812502980) — задача 7 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppDataAndStorageTab` из `solidJsTabs/tabs.ts`,
 * открытая через хост (`settingsSliderHost.ts`) тем же путём, что строка корня
 * настроек. Стабы — только границы: попап подтверждения (`confirmationPopup`,
 * свой DOM-слой со своими тестами), корзина CacheStorage (`core/mediaCache`:
 * подсчёт и очистка — happy-dom её не знает), геометрия.
 *
 * Предмет — расхождения прежнего React-экрана с tweb, видимые в DOM, и момент
 * записи:
 *  • первая строка — ТУМБЛЕР, Photos/Videos/Files — `Row disabled` с подписью;
 *  • сброс — `Button` с иконкой, выключенный на дефолтах, через подтверждение;
 *  • подписи секций — вне карточки;
 *  • квота: «Clear» в `row-right`, 4 строки с `Row.Icon`, 2 × ползунка;
 *  • срок и предел кэша пишутся на `destroy` вкладки, а не на каждом шаге ползунка.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { DEFAULTS, load, useSettingsStore } from '@/settings'
import { AppDataAndStorageTab } from '@components/solidJsTabs/tabs'
import { getIconContent } from '@components/icon'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import { createSettingsSliderHost, type SettingsSliderHost } from '../../settingsSliderHost'

const confirmationPopup = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@components/popups/popupPeer', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmationPopup,
}))

const cache = vi.hoisted(() => ({
  collectCachedFilesSizes: vi.fn(),
  clearCachedFiles: vi.fn(async() => {}),
}))
vi.mock('@core/mediaCache', async(importOriginal) => ({
  ...(await importOriginal<object>()),
  collectCachedFilesSizes: cache.collectCachedFilesSizes,
  clearCachedFiles: cache.clearCachedFiles,
}))

const MB = 1024 * 1024
const SIZES = { total: 130.8 * MB, images: 40.3 * MB, videos: 73.1 * MB, stickers: 17.3 * MB, other: 117.4 * 1024 }
const ZERO = { total: 0, images: 0, videos: 0, stickers: 0, other: 0 }

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost
let uninstallLabelActivation: () => void

const resetSettings = () => useSettingsStore.getState().update({
  autoDownloadEnabled: DEFAULTS.autoDownloadEnabled,
  autoDownloadPhoto: { ...DEFAULTS.autoDownloadPhoto },
  autoDownloadVideo: { ...DEFAULTS.autoDownloadVideo },
  autoDownloadFile: { ...DEFAULTS.autoDownloadFile },
  autoDownloadFileSizeMax: DEFAULTS.autoDownloadFileSizeMax,
  cacheTTL: DEFAULTS.cacheTTL,
  cacheSize: DEFAULTS.cacheSize,
})

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  resetSettings()
  cache.collectCachedFilesSizes.mockReset().mockResolvedValue(SIZES)
  cache.clearCachedFiles.mockClear()
  confirmationPopup.mockReset().mockResolvedValue(undefined)

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
  resetSettings()
})

const open = () => host.openTab(AppDataAndStorageTab)

function section(tab: SliderSuperTab, name: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.sidebar-left-section-container')]
    .find((c) => c.querySelector('.sidebar-left-section-name')?.textContent === name)
  if(!el) throw new Error('no section ' + name)
  return el as HTMLElement
}

function row(tab: SliderSuperTab, title: string) {
  const el = [...tab.scrollable.container.querySelectorAll('.row')]
    .find((r) => r.querySelector('.row-title')?.textContent === title)
  if(!el) throw new Error('no row ' + title)
  return el as HTMLElement
}

const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const titleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-title')!
const subtitleOf = (el: HTMLElement) => el.querySelector<HTMLElement>('.row-subtitle')!.textContent
const resetButton = (tab: SliderSuperTab) =>
  section(tab, lang.AutomaticMediaDownload).querySelector<HTMLButtonElement>('.sidebar-left-section-content > button')!

describe('«Данные и память» — автозагрузка медиа', () => {
  it('первая строка — тумблер (row-checkbox-field-toggle), а не квадратный чекбокс', async() => {
    const tab = await open()
    const first = section(tab, lang.AutomaticMediaDownload).querySelector<HTMLElement>('.row')!

    expect(titleOf(first).textContent).toBe(lang.AutoDownloadMedia)
    expect(first.querySelector('.row-checkbox-field-toggle')).not.toBeNull()
    expect(first.querySelector('.checkbox-field-toggle')).not.toBeNull()
    expect(input(first).checked).toBe(true)
  })

  it('Photos/Videos/Files — строки с подписью, ключи tweb; Files — с пределом размера', async() => {
    const tab = await open()
    const rows = [...section(tab, lang.AutomaticMediaDownload).querySelectorAll<HTMLElement>('.row')].slice(1)

    expect(rows.map((r) => titleOf(r).textContent)).toEqual([lang.AutoDownloadPhotos, lang.AutoDownloadVideos, lang.AutoDownloadFiles])
    expect(subtitleOf(rows[0])).toBe(lang.AutoDownloadOnAllChats)
    expect(subtitleOf(rows[1])).toBe(lang.AutoDownloadOnAllChats)
    expect(subtitleOf(rows[2])).toBe(lang.AutoDownloadUpToOnAllChats.replace('%1$s', '3.0 MB'))
  })

  it('подпись перечисляет включённые типы чатов ключами AutoDownload*, «Off» — когда пусто', async() => {
    useSettingsStore.getState().update({
      autoDownloadPhoto: { contacts: true, private: false, groups: true, channels: false },
      autoDownloadVideo: { contacts: false, private: false, groups: false, channels: false },
    })
    const tab = await open()

    expect(subtitleOf(row(tab, lang.AutoDownloadPhotos))).toBe(
      lang.AutoDownloadOnFor.replace('%1$s', lang.AutoDownloadContacts + lang['AutoDownloadSettings.LastDelimeter'] + lang.AutoDownloadGroups),
    )
    expect(subtitleOf(row(tab, lang.AutoDownloadVideos))).toBe(lang.AutoDownloadOff)
  })

  it('тумблер выключен — строки типов is-disabled и не открывают вкладку; запись — autoDownloadEnabled', async() => {
    const tab = await open()
    titleOf(section(tab, lang.AutomaticMediaDownload).querySelector<HTMLElement>('.row')!).click()

    expect(useSettingsStore.getState().autoDownloadEnabled).toBe(false)
    const photos = row(tab, lang.AutoDownloadPhotos)
    expect(photos.classList.contains('is-disabled')).toBe(true)

    photos.click()
    await pause(50)
    expect(document.querySelectorAll('.sidebar-header__title')).toHaveLength(1)
  })

  it('клик по «Photos» открывает вкладку автозагрузки фото (слайдер, не React-саб)', async() => {
    const tab = await open()
    row(tab, lang.AutoDownloadPhotos).click()

    await vi.waitFor(() => {
      const titles = [...document.querySelectorAll('.sidebar-header__title')].map((t) => t.textContent)
      expect(titles).toEqual([lang.DataSettings, lang.AutoDownloadPhotos])
    })
  })

  it('сброс — Button btn-primary primary btn-transparent с иконкой delete, выключен на дефолтах', async() => {
    const tab = await open()
    const button = resetButton(tab)

    expect(button.matches('.btn-primary.primary.btn-transparent')).toBe(true)
    expect(button.querySelector('.tgico.button-icon')).not.toBeNull()
    expect(button.querySelector('.i18n')!.textContent).toBe(lang.ResetAutomaticMediaDownload)
    expect(button.disabled).toBe(true)
  })

  it('сброс спрашивает подтверждение и возвращает дефолты автозагрузки', async() => {
    useSettingsStore.getState().update({
      autoDownloadEnabled: false,
      autoDownloadFile: { contacts: false, private: true, groups: true, channels: true },
      autoDownloadFileSizeMax: 10 * MB,
    })
    const tab = await open()
    const button = resetButton(tab)
    expect(button.disabled).toBe(false)

    button.click()
    await vi.waitFor(() => expect(useSettingsStore.getState().autoDownloadEnabled).toBe(true))

    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'ResetAutomaticMediaDownloadAlertTitle',
      descriptionLangKey: 'ResetAutomaticMediaDownloadAlert',
    }))
    expect(useSettingsStore.getState().autoDownloadFile).toEqual(DEFAULTS.autoDownloadFile)
    expect(useSettingsStore.getState().autoDownloadFileSizeMax).toBe(DEFAULTS.autoDownloadFileSizeMax)
    expect(button.disabled).toBe(true)
  })

  it('отмена подтверждения — настройки не тронуты', async() => {
    confirmationPopup.mockRejectedValue(undefined)
    useSettingsStore.getState().update({ autoDownloadEnabled: false })
    const tab = await open()

    resetButton(tab).click()
    await pause(0)

    expect(useSettingsStore.getState().autoDownloadEnabled).toBe(false)
  })

  it('подпись AutoDownloadAudioInfo — под карточкой, ребёнок -container', async() => {
    const tab = await open()
    const media = section(tab, lang.AutomaticMediaDownload)
    const caption = media.querySelector<HTMLElement>('.sidebar-left-section-caption')!

    expect(caption.textContent).toBe(lang.AutoDownloadAudioInfo)
    expect(caption.parentElement).toBe(media)
  })
})

describe('«Данные и память» — квота хранилища', () => {
  it('разметка tweb: Clear в row-right, 4 строки с Row.Icon, 2 ползунка, Clear All — кнопка', async() => {
    const tab = await open()
    const quota = section(tab, lang['StorageQuota.Title'])
    const content = quota.querySelector<HTMLElement>('.sidebar-left-section-content')!
    const rows = [...content.querySelectorAll<HTMLElement>(':scope > .row')]

    expect(rows.map((r) => titleOf(r).textContent)).toEqual([
      lang['StorageQuota.CachedFiles'],
      lang['StorageQuota.Images'],
      lang['StorageQuota.VideoFiles'],
      lang['StorageQuota.StickersEmoji'],
      lang['StorageQuota.Other'],
    ])
    // «Cached video stream chunks» (tweb :374-382) — О-6: корзин потоковых чанков нет
    expect(content.textContent).not.toContain('stream')

    const clear = rows[0].querySelector<HTMLButtonElement>('.row-right > div > button.primary.btn')!
    expect(clear.textContent).toBe(lang['StorageQuota.Clear'])

    expect(rows.slice(1).map((r) => r.querySelector('.row-icon .tgico.row-icon-icon')!.textContent)).toEqual(
      (['photo_filled', 'play_filled', 'sticker_filled', 'limit_file_filled'] as const).map(getIconContent),
    )
    expect(rows.slice(1).every((r) => r.querySelector('.row-icon.row-icon-colored'))).toBe(true)

    const names = [...content.querySelectorAll('.range-setting-selector-name')].map((n) => n.textContent)
    expect(names).toEqual([lang['StorageQuota.ClearCacheOlderThan'], lang['StorageQuota.CacheSizeLimit']])

    const clearAll = content.querySelector<HTMLButtonElement>(':scope > button.btn-primary.primary.btn-transparent')!
    expect(clearAll.querySelector('.i18n')!.textContent).toBe(lang['StorageQuota.ClearAll'])
    expect(clearAll.querySelector('.tgico.button-icon')).not.toBeNull()

    const caption = quota.querySelector<HTMLElement>('.sidebar-left-section-caption')!
    expect(caption.parentElement).toBe(quota)
    expect(caption.textContent).toBe(lang['StorageQuota.Caption'])
  })

  it('размеры: Loading до подсчёта, затем байты с одним знаком по категориям', async() => {
    let resolve!: (value: typeof SIZES) => void
    cache.collectCachedFilesSizes.mockReturnValue(new Promise((r) => { resolve = r }))
    const tab = await open()

    expect(subtitleOf(row(tab, lang['StorageQuota.CachedFiles']))).toBe(lang.Loading)

    resolve(SIZES)
    await vi.waitFor(() => expect(subtitleOf(row(tab, lang['StorageQuota.CachedFiles']))).toBe('130.8 MB'))
    expect(subtitleOf(row(tab, lang['StorageQuota.Images']))).toBe('40.3 MB')
    expect(subtitleOf(row(tab, lang['StorageQuota.VideoFiles']))).toBe('73.1 MB')
    expect(subtitleOf(row(tab, lang['StorageQuota.StickersEmoji']))).toBe('17.3 MB')
    expect(subtitleOf(row(tab, lang['StorageQuota.Other']))).toBe('117.4 KB')
  })

  it('подсчёт упал — StorageQuota.FailedToCalculate', async() => {
    cache.collectCachedFilesSizes.mockRejectedValue(new Error('quota'))
    const tab = await open()

    await vi.waitFor(() => expect(subtitleOf(row(tab, lang['StorageQuota.CachedFiles']))).toBe(lang['StorageQuota.FailedToCalculate']))
  })

  it('Clear: подтверждение с размером → корзина очищена → пересчёт', async() => {
    const tab = await open()
    await vi.waitFor(() => expect(subtitleOf(row(tab, lang['StorageQuota.CachedFiles']))).toBe('130.8 MB'))
    cache.collectCachedFilesSizes.mockResolvedValue(ZERO)

    row(tab, lang['StorageQuota.CachedFiles']).querySelector<HTMLButtonElement>('.row-right button')!.click()

    await vi.waitFor(() => expect(cache.clearCachedFiles).toHaveBeenCalledTimes(1))
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'StorageQuota.ClearCachedFiles',
      descriptionLangKey: 'StorageQuota.ClearConfirmation',
      descriptionLangArgs: ['130.8 MB'],
    }))
    await vi.waitFor(() => expect(subtitleOf(row(tab, lang['StorageQuota.Images']))).toBe('0 B'))
  })

  it('Clear отменили — корзина цела', async() => {
    confirmationPopup.mockRejectedValue(undefined)
    const tab = await open()

    row(tab, lang['StorageQuota.CachedFiles']).querySelector<HTMLButtonElement>('.row-right button')!.click()
    await pause(0)

    expect(cache.clearCachedFiles).not.toHaveBeenCalled()
  })

  it('Clear All — своё подтверждение и та же очистка', async() => {
    const tab = await open()
    section(tab, lang['StorageQuota.Title']).querySelector<HTMLButtonElement>('.sidebar-left-section-content > button')!.click()

    await vi.waitFor(() => expect(cache.clearCachedFiles).toHaveBeenCalledTimes(1))
    expect(confirmationPopup).toHaveBeenCalledWith(expect.objectContaining({
      titleLangKey: 'StorageQuota.ClearAll',
      descriptionLangKey: 'StorageQuota.ClearAllConfirmation',
    }))
  })

  it('ползунки — подписи значений tweb (неделя, Авто) по текущим cacheTTL/cacheSize', async() => {
    const tab = await open()
    const values = [...section(tab, lang['StorageQuota.Title']).querySelectorAll('.range-setting-selector-value')]
      .map((v) => v.textContent)
    expect(values).toEqual(['1 week', lang['StorageQuota.CacheSizeLimitAuto']])
  })

  it('срок кэша пишется на destroy вкладки, а не на шаге ползунка; ровно одна запись', async() => {
    const tab = await open()
    const seek = section(tab, lang['StorageQuota.Title']).querySelector<HTMLInputElement>('input[type="range"]')!
    // vitest отдаёт тот же шпион, что и в прошлом тесте, вместе с его вызовами
    const spy = vi.spyOn(useSettingsStore.getState(), 'update').mockClear()

    seek.value = '0'
    seek.dispatchEvent(new Event('input', { bubbles: true }))
    expect(useSettingsStore.getState().cacheTTL).toBe(DEFAULTS.cacheTTL)
    expect(section(tab, lang['StorageQuota.Title']).querySelector('.range-setting-selector-value')!.textContent).toBe('1 day')

    tab.close()
    await pause(400)

    expect(useSettingsStore.getState().cacheTTL).toBe(86400)
    expect(spy.mock.calls.filter(([patch]) => 'cacheTTL' in patch)).toHaveLength(1)
    expect(spy.mock.calls.some(([patch]) => 'cacheSize' in patch)).toBe(false)
  })

  it('срок «1 месяц» прежнего экрана (30 дней) — вкладка показывает «1 month», закрытие его не трогает', async() => {
    // холодный старт с тем, что сохранил React-экран: его месяц — 30 дней
    localStorage.setItem('tg-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('tg-settings') ?? '{}'), cacheTTL: 30 * 86400 }))
    useSettingsStore.setState(load())
    const tab = await open()
    const spy = vi.spyOn(useSettingsStore.getState(), 'update').mockClear()

    expect(section(tab, lang['StorageQuota.Title']).querySelector('.range-setting-selector-value')!.textContent).toBe('1 month')

    tab.close()
    await pause(400)

    expect(spy.mock.calls.some(([patch]) => 'cacheTTL' in patch)).toBe(false)
    expect(useSettingsStore.getState().cacheTTL).toBe(31 * 86400)
  })

  it('ползунки не трогали — на destroy ни одной записи', async() => {
    const tab = await open()
    // vitest отдаёт тот же шпион, что и в прошлом тесте, вместе с его вызовами
    const spy = vi.spyOn(useSettingsStore.getState(), 'update').mockClear()

    tab.close()
    await pause(400)

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('«Данные и память» — каркас', () => {
  it('шапка — DataSettings', async() => {
    const tab = await open()
    expect(tab.container.querySelector('.sidebar-header__title')!.textContent).toBe(lang.DataSettings)
  })

  it('после закрытия Solid-остров снят (DoD 5)', async() => {
    const tab = await open()
    expect(document.querySelectorAll('.sidebar-left-section-container').length).toBeGreaterThan(0)

    tab.close()
    await pause(400)

    expect(document.querySelectorAll('.sidebar-left-section-container')).toHaveLength(0)
    expect(tab.container.isConnected).toBe(false)
  })
})
