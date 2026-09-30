/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Стикеры и эмодзи» (`stickersAndEmoji.solid.tsx`, порт tweb
 * `sidebarLeft/tabs/stickersAndEmoji.tsx`, 812502980), задача 15 плана 2D.
 *
 * Вкладка настоящая — `AppStickersAndEmojiTab` из `solidJsTabs/tabs.ts` на
 * колоночном слайдере. Стабы — только границы: менеджер стикеров (воркер,
 * `GET /sticker-sets`), `wrapSticker` (загрузка файла и плеер), попап набора
 * (мост `settingsPopups`, ВРЕМЕННО до 2C-15) и геометрия.
 *
 * Предмет проверок — результат в DOM и в настройках, а не «функцию позвали»:
 *  • три секции tweb по порядку, имена и подписи вне карточки; секций
 *    «Dynamic Pack Order» (О-43) и строки «Large Emoji» (О-45) нет;
 *  • первая секция: «Quick Reaction» (`row-with-padding`, превью
 *    `row-media-small`) открывает вкладку быстрой реакции ТЕМ ЖЕ слайдером;
 *    «Suggest Stickers» — контекст-меню из трёх пунктов, выбор пишет
 *    `stickersSuggest` и меняет правую подпись; «Loop» — тумблер `loopStickers`;
 *  • «Suggest Emoji» — тумблер `emojiSuggest`;
 *  • наборы — строки во ВТОРОМ контенте секции (не рядом с именем), в порядке
 *    ответа, без `row-sortable` (О-14), с обложкой 36×36 и открытием попапа;
 *  • `stickers_installed`/`stickers_deleted` дописывают/снимают строку;
 *  • открытие ждёт список наборов; после закрытия остров снят (DoD 5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Sticker, StickerSet } from '@core/managers/stickersManager'
import type SliderSuperTab from '@components/sliderTab'
import wrapSticker from '@components/wrappers/sticker'
import lang from '@/lang'
import { getIconContent } from '@components/icon'
import rootScope from '@lib/rootScope'
import { DEFAULTS, useSettingsStore } from '@/settings'
import { AppQuickReactionTab, AppStickersAndEmojiTab } from '@components/solidJsTabs/tabs'
import { mountTestColumnSlider, type TestColumnSlider } from '@/test/columnSlider'
import { installSpecLabelActivation } from '@/test/specLabelActivation'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
const wrapStickerMock = vi.mocked(wrapSticker)

const popups = vi.hoisted(() => ({ showStickersPopup: vi.fn() }))
vi.mock('@components/sidebarLeft/settingsPopups', () => popups)

const set = (id: number, title: string, count: number, thumb?: number): StickerSet => ({
  _: 'stickerSet', id, title, short_name: 'set' + id, count, thumb_document_id: thumb,
})

const SETS = [set(1, 'Hot Cherry', 34, 501), set(2, 'Duck', 52), set(3, 'Cats', 40, 503)]

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Переход (250) + разрушение вкладки (280) + запас. */
const settle = () => pause(400)

let host: TestColumnSlider
let uninstallLabelActivation: () => void
let mySets: ReturnType<typeof vi.fn<() => Promise<StickerSet[]>>>
let getStickerSet: ReturnType<typeof vi.fn>

beforeEach(() => {
  uninstallLabelActivation = installSpecLabelActivation()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect)
  popups.showStickersPopup.mockClear()
  wrapStickerMock.mockReset()
  wrapStickerMock.mockImplementation((options) => ({
    render: Promise.resolve(document.createElement('img')),
    width: options.width,
    height: options.height,
    destroy: () => {},
  }))
  useSettingsStore.getState().update({
    loopStickers: DEFAULTS.loopStickers,
    stickersSuggest: DEFAULTS.stickersSuggest,
    emojiSuggest: DEFAULTS.emojiSuggest,
  })

  mySets = vi.fn<() => Promise<StickerSet[]>>(async() => SETS)
  getStickerSet = vi.fn(async({ id }: { id: number }) => ({
    set: SETS.find((s) => s.id === id)!,
    stickers: [{ _: 'document', id: id * 100 + 1, w: 512, h: 512 } as unknown as Sticker],
  }))
  const managers = {
    stickers: { mySets, getStickerSet },
      } as unknown as Managers

  const columnEl = document.createElement('div')
  columnEl.id = 'column-left'
  document.body.append(columnEl)
  host = mountTestColumnSlider(columnEl, managers)
})

afterEach(async() => {
  uninstallLabelActivation()
  host.destroy()
  await settle()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const open = () => host.openTab(AppStickersAndEmojiTab)

const sections = (tab: SliderSuperTab) =>
  [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sidebar-left-section-container')]
const nameOf = (section: HTMLElement) =>
  section.querySelector('.sidebar-left-section-name')?.textContent ?? null
/** Подпись секции — ребёнок контейнера, вне карточки `.sidebar-left-section` (tweb `section.tsx:112`). */
const captionOf = (section: HTMLElement) =>
  section.querySelector(':scope > .sidebar-left-section-caption')?.textContent ?? null
const rowsOf = (section: HTMLElement) => [...section.querySelectorAll<HTMLElement>('.row')]
const titleOf = (row: HTMLElement) => row.querySelector('.row-title')!.textContent
const setRows = (tab: SliderSuperTab) => {
  const contents = sections(tab)[2].querySelectorAll<HTMLElement>('.sidebar-left-section > .sidebar-left-section-content')
  return [...contents[1].children] as HTMLElement[]
}
const stickersOn = () => useSettingsStore.getState()

describe('вкладка «Стикеры и эмодзи» — разметка tweb', () => {
  it('шапка StickersName, класс контейнера, три секции с именами и подписями вне карточки', async() => {
    const tab = await open()
    expect(tab.title.textContent).toBe(lang.StickersName)
    expect(tab.container.classList.contains('stickers-emoji-container')).toBe(true)

    const all = sections(tab)
    expect(all.map(nameOf)).toEqual([null, lang.Emoji, lang['Telegram.InstalledStickerPacksController']])
    expect(all.map(captionOf)).toEqual([lang.LoopAnimatedStickersInfo, null, lang.StickersBotInfo])
  })

  it('нет «Dynamic Pack Order» (О-43) и «Large Emoji» (О-45)', async() => {
    const tab = await open()
    const text = tab.scrollable.container.textContent!
    expect(text).not.toContain('Dynamic Pack Order')
    expect(text).not.toContain('Large Emoji')
    expect(rowsOf(sections(tab)[1]).map(titleOf)).toEqual([lang['GeneralSettings.EmojiPrediction']])
  })

  it('первая секция: Quick Reaction с превью, Suggest Stickers со вторичной подписью справа, Loop — тумблер', async() => {
    const tab = await open()
    const [quick, suggest, loop] = rowsOf(sections(tab)[0])

    expect(titleOf(quick)).toBe(lang.DoubleTapSetting)
    expect(quick.classList.contains('row-with-padding')).toBe(true)
    expect(quick.classList.contains('row-clickable')).toBe(true)
    expect(quick.querySelector(':scope > .row-media.row-media-small')).not.toBeNull()

    expect(suggest.querySelector('.row-icon')!.textContent).toBe(getIconContent('lamp_filled'))
    expect(suggest.querySelector('.row-title-right.row-title-right-secondary')!.textContent).toBe(lang.SuggestStickersAll)

    expect(loop.tagName).toBe('LABEL')
    expect(loop.querySelector('.row-icon')!.textContent).toBe(getIconContent('flip'))
    expect(loop.querySelector<HTMLInputElement>('.checkbox-field-toggle input')!.checked).toBe(true)
  })
})

describe('вкладка «Стикеры и эмодзи» — строки', () => {
  it('Quick Reaction открывает вкладку быстрой реакции тем же слайдером', async() => {
    const tab = await open()
    const opened = vi.fn(async() => {})
    const createTab = vi.spyOn(host.slider, 'createTab').mockReturnValue({ open: opened } as never)

    rowsOf(sections(tab)[0])[0].click()
    await pause(0)

    expect(createTab).toHaveBeenCalledTimes(1)
    expect(createTab.mock.calls[0][0]).toBe(AppQuickReactionTab)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('Suggest Stickers: меню из трёх пунктов tweb, выбор пишет настройку и меняет подпись', async() => {
    const tab = await open()
    const suggest = rowsOf(sections(tab)[0])[1]
    suggest.click()
    await vi.waitFor(() => expect(document.querySelector('.btn-menu')?.classList.contains('active')).toBe(true))

    const items = [...document.querySelectorAll<HTMLElement>('.btn-menu .btn-menu-item')]
    expect(items.map((i) => i.querySelector('.btn-menu-item-text')!.textContent))
      .toEqual([lang.SuggestStickersAll, lang.SuggestStickersInstalled, lang.SuggestStickersNone])
    expect(items.map((i) => i.querySelector('.tgico')!.textContent)).toEqual([getIconContent('stickers_face'), getIconContent('newprivate'), getIconContent('stop')])

    items[2].click()
    expect(stickersOn().stickersSuggest).toBe('none')
    await vi.waitFor(() =>
      expect(suggest.querySelector('.row-title-right-secondary')!.textContent).toBe(lang.SuggestStickersNone))
  })

  it('Loop и Suggest Emoji — тумблеры своих настроек, в обе стороны', async() => {
    const tab = await open()
    const loop = rowsOf(sections(tab)[0])[2]
    const emoji = rowsOf(sections(tab)[1])[0]

    loop.querySelector<HTMLElement>('.row-title')!.click()
    expect(stickersOn().loopStickers).toBe(false)
    emoji.querySelector<HTMLElement>('.row-title')!.click()
    expect(stickersOn().emojiSuggest).toBe(false)

    useSettingsStore.getState().update({ loopStickers: true, emojiSuggest: true })
    await Promise.resolve()
    expect(loop.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    expect(emoji.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
  })
})

describe('вкладка «Стикеры и эмодзи» — установленные наборы', () => {
  it('строки во втором контенте секции, в порядке ответа, без row-sortable (О-14)', async() => {
    const tab = await open()
    const rows = setRows(tab)
    expect(rows.map(titleOf)).toEqual(['Hot Cherry', 'Duck', 'Cats'])
    expect(rows.map((r) => r.dataset.id)).toEqual(['1', '2', '3'])
    expect(rows[0].querySelector('.row-subtitle')!.textContent).toBe('34 stickers')
    expect(rows.every((r) => r.classList.contains('row-with-padding') && !r.classList.contains('row-sortable'))).toBe(true)
    expect(tab.scrollable.container.querySelector('.row-sortable-icon')).toBeNull()
  })

  it('обложка 36×36: документ-обложка номером, без обложки — первый стикер набора', async() => {
    const tab = await open()
    await vi.waitFor(() => expect(wrapStickerMock).toHaveBeenCalledTimes(3))
    const byMedia = new Map(wrapStickerMock.mock.calls.map(([o]) => [o.mediaId, o]))
    expect([...byMedia.keys()].sort((a, b) => a - b)).toEqual([201, 501, 503])
    expect(getStickerSet).toHaveBeenCalledTimes(1)
    expect(getStickerSet).toHaveBeenCalledWith({ id: 2 })
    const first = byMedia.get(501)!
    expect([first.width, first.height, first.group]).toEqual([36, 36, 'GENERAL-SETTINGS'])
    expect(first.div.parentElement).toBe(setRows(tab)[0])
    expect(first.div.classList.contains('row-media')).toBe(true)
  })

  it('клик по набору открывает попап набора по его id', async() => {
    const tab = await open()
    setRows(tab)[1].click()
    expect(popups.showStickersPopup).toHaveBeenCalledWith({ id: 2 })
  })

  it('stickers_installed дописывает строку в начало (без дублей), stickers_deleted — снимает', async() => {
    const tab = await open()
    rootScope.dispatchEventSingle('stickers_installed', set(9, 'Fresh', 7, 909))
    rootScope.dispatchEventSingle('stickers_installed', SETS[0])
    expect(setRows(tab).map(titleOf)).toEqual(['Fresh', 'Hot Cherry', 'Duck', 'Cats'])

    rootScope.dispatchEventSingle('stickers_deleted', SETS[1])
    expect(setRows(tab).map(titleOf)).toEqual(['Fresh', 'Hot Cherry', 'Cats'])
  })
})

describe('вкладка «Стикеры и эмодзи» — жизненный цикл', () => {
  it('открытие ждёт список наборов', async() => {
    let resolve!: (sets: StickerSet[]) => void
    mySets.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    let opened = false
    const promise = open().then((tab) => { opened = true; return tab })
    await pause(50)
    expect(opened).toBe(false)
    resolve(SETS)
    const tab = await promise
    expect(setRows(tab)).toHaveLength(3)
  })

  it('закрытая вкладка снимает остров: узлов нет, события наборов больше не слушаются, миддлвари обложек мертвы', async() => {
    const tab = await open()
    await vi.waitFor(() => expect(wrapStickerMock).toHaveBeenCalledTimes(3))
    const middlewares = wrapStickerMock.mock.calls.map(([o]) => o.middleware!)
    const content = setRows(tab)[0].parentElement!
    expect(middlewares.every((m) => m())).toBe(true)

    tab.close()
    await settle()

    expect(tab.container.isConnected).toBe(false)
    expect(middlewares.every((m) => !m())).toBe(true)
    rootScope.dispatchEventSingle('stickers_installed', set(9, 'Fresh', 7, 909))
    expect(content.children).toHaveLength(3)
  })
})
