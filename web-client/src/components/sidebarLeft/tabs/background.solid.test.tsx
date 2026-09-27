/** @jsxImportSource solid-js */
/**
 * Вкладка «Обои» (`background.solid.tsx`, порт tweb `sidebarLeft/tabs/background.tsx`,
 * 812502980) — задача 12 плана волны 2D.
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppChatBackgroundTab` из `solidJsTabs/tabs.ts`,
 * открытая через хост (`settingsSliderHost.ts`) тем же путём, что строка «Общих».
 * Стабы — только границы: выбор файла (`requestFile`), воркер (`managers.media`),
 * 2D-контекст холстов фона (в happy-dom его нет — поддельный) и геометрия.
 *
 * Предмет — видимое в DOM и записанное в настройки:
 *  • три кнопки `btn-primary btn-transparent` и строка-тумблер размытия в одной
 *    секции, сетка `.search-super-content-media-grid` — отдельным блоком после неё;
 *  • тумблер размытия выключен (`disabled`) у обоев с узором, цвета и умолчания —
 *    включён только у своего фото (tweb `getBlurDisabled`, `:296-299`);
 *  • клик по плитке, «Сбросить», тумблер и загрузка пишут в zustand ровно то,
 *    что рисует фон чата; активная плитка — `.active` + угол сетки;
 *  • «Задать цвет» открывает вкладку «Цвет»; закрытие снимает Solid-остров.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import lang from '@/lang'
import { useSettingsStore, DEFAULTS } from '@/settings'
import { WALLPAPER_PRESETS } from '@/wallpapers'
import { getIconContent } from '@components/icon'
import { AppChatBackgroundTab } from '@components/solidJsTabs/tabs'
import { createSettingsSliderHost, type SettingsSliderHost } from '../settingsSliderHost'
import { installSpecLabelActivation } from '@/test/specLabelActivation'
import { installFakeCanvas } from '@/test/fakeCanvas'
import backgroundStyles from '@components/chat/bubbles/chatBackground.module.scss'

// Плитка — настоящий `<ChatBackground>`; холстам — поддельный 2D-контекст
// (в happy-dom его нет, `test/fakeCanvas.ts`).
let fakeCanvas: ReturnType<typeof installFakeCanvas>

const requestFile = vi.hoisted(() => vi.fn())
vi.mock('@helpers/files/requestFile', () => ({ default: requestFile }))

// Точка входа за URL медиа ходит к воркеру через `startClient()` — граница.
const ensureMediaUrl = vi.hoisted(() => vi.fn(async(id: number) => `blob:media-${id}`))
vi.mock('@core/media/ensureMediaUrl', () => ({ ensureMediaUrl }))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let host: SettingsSliderHost
let uninstallLabelActivation: () => void
let upload: ReturnType<typeof vi.fn>

beforeEach(() => {
  fakeCanvas = installFakeCanvas()
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  useSettingsStore.getState().update({
    wallpaper: { kind: 'default' },
    customWallpaperMediaId: undefined,
    customWallpaperBlur: false,
  })

  upload = vi.fn(async() => 77)
  const managers = { media: { upload, cancelUpload: vi.fn(async() => {}) } } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = createSettingsSliderHost(columnEl, managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await pause(400)
  document.body.replaceChildren()
  ensureMediaUrl.mockClear()
  vi.restoreAllMocks()
  fakeCanvas.restore()
  requestFile.mockReset()
})

const open = () => host.openTab(AppChatBackgroundTab)

const grid = (tab: SliderSuperTab) => tab.scrollable.container.querySelector<HTMLElement>('.search-super-content-media-grid')!
const tiles = (tab: SliderSuperTab) => [...grid(tab).querySelectorAll<HTMLElement>('.grid-item')]
const tile = (tab: SliderSuperTab, id: string) => grid(tab).querySelector<HTMLElement>(`.grid-item[data-id="${id}"]`)!
const blurRow = (tab: SliderSuperTab) => tab.scrollable.container.querySelector<HTMLElement>('.sidebar-left-section .row')!
const blurInput = (tab: SliderSuperTab) => blurRow(tab).querySelector<HTMLInputElement>('input[type="checkbox"]')!

describe('вкладка «Обои» — разметка', () => {
  it('шапка ChatBackground, контейнер вкладки с классами фона', async() => {
    const tab = await open()
    expect(tab.title.textContent).toBe(lang.ChatBackground)
    expect(tab.container.classList.contains('background-container')).toBe(true)
    expect(tab.container.classList.contains('background-image-container')).toBe(true)
  })

  it('секция: три кнопки (cameraadd/colorize/favourites) и строка-тумблер Blur; сетка — отдельно', async() => {
    const tab = await open()
    const content = tab.scrollable.container.querySelector('.sidebar-left-section-content')!
    const buttons = [...content.querySelectorAll(':scope > button')]

    expect(buttons.map((b) => b.className.split(' ').filter((c) => c.startsWith('btn')).join(' '))).toEqual([
      'btn-primary btn-transparent', 'btn-primary btn-transparent', 'btn-primary btn-transparent',
    ])
    expect(buttons.map((b) => b.querySelector('.i18n')!.textContent)).toEqual([
      lang['ChatBackground.UploadWallpaper'], lang.SetColor, lang['Appearance.Reset'],
    ])
    expect(buttons.map((b) => b.querySelector('.tgico.button-icon')!.textContent)).toEqual([
      getIconContent('cameraadd'), getIconContent('colorize'), getIconContent('favourites'),
    ])
    const row = content.querySelector(':scope > .row')!
    expect(row.querySelector('.row-title')!.textContent).toBe(lang['ChatBackground.Blur'])
    expect(row.querySelector('.row-checkbox-field-toggle')).not.toBeNull()

    // сетка — не в секции, а соседним блоком (tweb :606-610)
    expect(grid(tab).closest('.sidebar-left-section-container')).toBeNull()
    expect(grid(tab).parentElement!.tagName).toBe('DIV')
  })

  it('плитки пресетов: grid-item с ролью кнопки, скелет — градиент цветов 135deg', async() => {
    const tab = await open()
    expect(tiles(tab)).toHaveLength(WALLPAPER_PRESETS.length)
    const first = tiles(tab)[0]
    expect(first.className).toContain('background-item')
    expect(first.getAttribute('role')).toBe('button')
    expect(first.getAttribute('tabindex')).toBe('0')
    const media = first.querySelector<HTMLElement>('.background-item-media.grid-item-media')!
    expect(media.style.background).toContain('linear-gradient(135deg')
  })

  it('плитка — тот же `<ChatBackground>` в дневной отрисовке (tweb `:104-127`): градиент пресета и узор soft-light', async() => {
    const tab = await open()
    await pause(0)
    const media = tiles(tab)[1].querySelector<HTMLElement>('.background-item-media')!
    const layer = media.querySelector<HTMLElement>(`.${backgroundStyles.Layer}`)!
    expect(layer).not.toBeNull()
    const slot = layer.querySelector<HTMLElement>(`.${backgroundStyles.SlotActive}`)!
    expect(slot.classList.contains(backgroundStyles.IsPattern)).toBe(true)
    const [gradient, pattern] = [...slot.children] as HTMLCanvasElement[]
    expect(gradient.dataset.colors).toBe(WALLPAPER_PRESETS[1].colors.join(','))
    expect(pattern.classList.contains(backgroundStyles.Blend)).toBe(true)
    // не tinted-отрисовка (у tweb она включается только темой `tinted`)
    expect(slot.classList.contains(backgroundStyles.IsTinted)).toBe(false)
    expect(pattern.classList.contains(backgroundStyles.DarkPatternInvert)).toBe(false)
    // холст узора — под размер плитки 72×96, а не окна
    expect([pattern.width, pattern.height]).toEqual([72, 96])
  })
})

describe('вкладка «Обои» — размытие', () => {
  it('обои по умолчанию и пресет — тумблер disabled, строка is-disabled', async() => {
    const tab = await open()
    expect(blurInput(tab).disabled).toBe(true)
    expect(blurRow(tab).classList.contains('is-disabled')).toBe(true)

    useSettingsStore.getState().update({ wallpaper: { kind: 'preset', colors: [...WALLPAPER_PRESETS[1].colors] } })
    await pause(0)
    expect(blurInput(tab).disabled).toBe(true)
  })

  it('своё фото — тумблер включён, переключение пишет customWallpaperBlur ровно один раз', async() => {
    useSettingsStore.getState().update({ customWallpaperMediaId: 5, customWallpaperBlur: false })
    const tab = await open()
    expect(blurInput(tab).disabled).toBe(false)
    expect(blurRow(tab).classList.contains('is-disabled')).toBe(false)

    const writes: boolean[] = []
    const unsubscribe = useSettingsStore.subscribe((s, prev) => {
      if(s.customWallpaperBlur !== prev.customWallpaperBlur) writes.push(!!s.customWallpaperBlur)
    })
    blurRow(tab).querySelector<HTMLElement>('.row-title')!.click()
    await pause(0)
    unsubscribe()

    expect(writes).toEqual([true])
  })
})

describe('вкладка «Обои» — выбор и сброс', () => {
  it('клик по плитке пресета — пресет в настройках, своё фото снято, плитка активна с углом', async() => {
    useSettingsStore.getState().update({ customWallpaperMediaId: 5 })
    const tab = await open()
    const preset = WALLPAPER_PRESETS[4]
    tile(tab, preset.id).click()
    await pause(0)

    const s = useSettingsStore.getState()
    expect(s.wallpaper).toEqual({ kind: 'preset', colors: preset.colors })
    expect(s.customWallpaperMediaId).toBeUndefined()
    expect(grid(tab).querySelectorAll('.active')).toHaveLength(1)
    expect(tile(tab, preset.id).classList.contains('active')).toBe(true)
    // первой стоит плитка своего фото, пресет №4 — шестая плитка сетки в 3
    // колонки: край второго ряда из пяти — без угла
    expect(tiles(tab)[0].dataset.id).toBe('custom-5')
    expect(tile(tab, preset.id).className).not.toMatch(/is-corner/)

    // пресет №1 — третья плитка: правый верхний угол
    tile(tab, WALLPAPER_PRESETS[1].id).click()
    await pause(0)
    expect(tile(tab, WALLPAPER_PRESETS[1].id).classList.contains('is-corner-tr')).toBe(true)
    expect(tile(tab, preset.id).classList.contains('active')).toBe(false)
  })

  it('«Сбросить» возвращает обои по умолчанию и снимает своё фото и размытие', async() => {
    useSettingsStore.getState().update({ customWallpaperMediaId: 5, customWallpaperBlur: true })
    const tab = await open()
    const reset = [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.querySelector('.i18n')?.textContent === lang['Appearance.Reset'])!
    reset.click()
    await pause(0)

    const s = useSettingsStore.getState()
    expect(s.wallpaper).toEqual(DEFAULTS.wallpaper)
    expect(s.customWallpaperMediaId).toBeUndefined()
    expect(s.customWallpaperBlur).toBe(false)
    expect(blurInput(tab).disabled).toBe(true)
  })

  it('своё фото — плитка первой, активна, картинка из воркера', async() => {
    useSettingsStore.getState().update({ customWallpaperMediaId: 5 })
    const tab = await open()
    await pause(0)
    const first = tiles(tab)[0]
    expect(first.dataset.id).toBe('custom-5')
    expect(first.classList.contains('active')).toBe(true)
    // адрес — от медиа-конвейера (`ensureMediaUrl`); `ChatBackgroundStore` держит
    // его в памяти вкладки, поэтому повторный вызов может и не понадобиться
    await vi.waitFor(() => expect(first.querySelector('img')?.getAttribute('src')).toBe('blob:media-5'))
  })
})

describe('вкладка «Обои» — загрузка и переходы', () => {
  it('загрузка: плитка встаёт первой с прелоадером, по ответу — своё фото в настройках', async() => {
    requestFile.mockResolvedValue(new File(['x'], 'bg.jpg', { type: 'image/jpeg' }))
    const tab = await open()
    const uploadBtn = [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.querySelector('.i18n')?.textContent === lang['ChatBackground.UploadWallpaper'])!
    uploadBtn.click()
    await pause(0)

    expect(requestFile).toHaveBeenCalledWith('image/x-png,image/png,image/jpeg')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toMatchObject({ mime: 'image/jpeg', size: 1 })
    expect(upload.mock.calls[0][0].progressId).toEqual(expect.any(String))
    await pause(0)

    const s = useSettingsStore.getState()
    expect(s.customWallpaperMediaId).toBe(77)
    expect(s.customWallpaperBlur).toBe(false)
    const first = tiles(tab)[0]
    expect(first.dataset.id).toBe('custom-77')
    expect(first.classList.contains('active')).toBe(true)
  })

  it('«Задать цвет» открывает вкладку «Цвет»', async() => {
    const tab = await open()
    const setColor = [...tab.scrollable.container.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.querySelector('.i18n')?.textContent === lang.SetColor)!
    setColor.click()
    await pause(50)

    const titles = [...document.querySelectorAll('.sidebar-header__title')].map((el) => el.textContent)
    expect(titles).toContain(lang.SetColor)
  })

  it('закрытие вкладки снимает Solid-остров (узлов секции и сетки нет)', async() => {
    const tab = await open()
    tab.close()
    await pause(400)
    expect(document.querySelector('.search-super-content-media-grid')).toBeNull()
    expect(document.querySelector('.background-container .sidebar-left-section')).toBeNull()
  })
})
