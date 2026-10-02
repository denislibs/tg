/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Поиск стикеров» (`stickers.solid.tsx`, порт tweb
 * `sidebarRight/tabs/stickers.tsx`, 812502980).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppStickersTab` из `solidJsTabs/tabs.ts` в
 * настоящей правой колонке (`AppSidebarRight`, `test/sidebarRight.ts`), с
 * настоящим `appNavigationController`. Стабы — только границы: менеджер
 * стикеров (воркер), `wrapSticker` (загрузка файла и плеер — не предмет вкладки),
 * просмотрщик по зажатию (свой тест — `stickerViewer.test.ts`), React-попап
 * набора (ВРЕМЕННО до 2C-15) и инстанс чата (мост `appImManager`, ВРЕМЕННО до Э4-3).
 *
 * Предмет проверок:
 *  • разметка — живой DOM tweb (дамп 19-emoticons-06): `#stickers-container
 *    .chatlist-container`, поле поиска вместо заголовка, строки наборов;
 *  • тренды на открытии, поиск по вводу, снятие строк, которых нет в выдаче;
 *  • кнопка Add/Added: сеть — В МОМЕНТ КЛИКА, кнопка гаснет на время запроса;
 *  • клик по стикеру — отправка в чат, по строке — попап набора;
 *  • раскрытие колонки — только когда вкладка в правой колонке;
 *  • Esc закрывает вкладку через контроллер навигации, Solid-корень снят.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import SidebarSlider from '@components/slider'
import attachStickerViewerListeners from '@components/stickerViewer'
import type SliderSuperTab from '@components/sliderTab'
import { AppStickersTab } from '@components/solidJsTabs/tabs'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import wrapSticker from '@components/wrappers/sticker'
import type { Covers, Sticker, StickerSet } from '@core/managers/stickersManager'
import appNavigationController from '@core/navigation/appNavigationController'
import { makeSticker } from '@core/stickers/testSticker'
import rootScope from '@lib/rootScope'
import { installSidebarRight } from '@/test/sidebarRight'
import { appImManager } from './emoticonsSearchBridge'

vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))
vi.mock('@components/stickerViewer', () => ({ default: vi.fn() }))
const attachStickerViewerListenersMock = vi.mocked(attachStickerViewerListeners)
const wrapStickerMock = vi.mocked(wrapSticker)

const openStickerSetModal = vi.fn()
vi.mock('@components/stickers/StickerSetModal', () => ({ openStickerSetModal: (...args: unknown[]) => openStickerSetModal(...args) }))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Выезд правой колонки (`selectProfileTab`: 200 + 100 на десктопе) + запас. */
const REVEAL = 350
/** Переход вкладки (250) + её разрушение (250 + 30) + запас. */
const settle = () => pause(NAVIGATION_TRANSITION_TIME * 2 + 100)

const makeSet = (id: number, title: string, count: number, extra: Partial<StickerSet> = {}): StickerSet => ({
  _: 'stickerSet',
  id,
  title,
  short_name: 'set' + id,
  count,
  ...extra,
})

/** Выдача менеджера: наборы + первые документы каждого (covered sets). */
function covered(...rows: Array<[StickerSet, number]>): { sets: StickerSet[], covers: Covers } {
  const covers: Covers = new Map()
  for(const [set, docs] of rows) {
    covers.set(set.id, Array.from({ length: docs }, (_, i) => makeSticker({ id: set.id * 100 + i, setId: set.id })))
  }
  return { sets: rows.map(([set]) => set), covers }
}

const DUCK = makeSet(1, 'Duck', 40)
const UTYA = makeSet(2, 'Utya', 3, { installed_date: 1700000000 })

/** Разметка колонки tweb `index.html:110-112`: слайдер ищет в ней `.sidebar-slider`. */
function createSidebarEl() {
  const el = document.createElement('div')
  const sliderEl = document.createElement('div')
  sliderEl.classList.add('sidebar-content', 'sidebar-slider', 'tabs-container')
  el.append(sliderEl)
  document.body.append(el)
  return el
}
let column: ReturnType<typeof installSidebarRight>
let stickers: {
  featuredSets: ReturnType<typeof vi.fn>
  searchSets: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  uninstall: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  wrapStickerMock.mockReset()
  wrapStickerMock.mockImplementation((options) => ({
    render: Promise.resolve(document.createElement('img')),
    width: options.width,
    height: options.height,
    destroy: () => {},
  }))
  openStickerSetModal.mockReset()
  attachStickerViewerListenersMock.mockReset()

  stickers = {
    featuredSets: vi.fn(async() => covered([DUCK, 5], [UTYA, 3])),
    searchSets: vi.fn(async() => covered()),
    install: vi.fn(async() => {}),
    uninstall: vi.fn(async() => {}),
  }

  column = installSidebarRight({ stickers } as unknown as Managers)
})

afterEach(async() => {
  column.dispose()
  await settle()
  appNavigationController.spliceItems(0, Infinity)
  appImManager.chat = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/** Открытие — как tweb `emoticonsDropdown/index.ts:303-305`. */
async function open() {
  const tab = column.sidebar.createTab(AppStickersTab)
  await tab.open()
  // Тренды — после выезда колонки (`toggleSidebar(true)` ждёт переход, до 300 мс).
  await pause(REVEAL)
  return tab
}

const rows = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.sticker-set')]
const row = (tab: SliderSuperTab, title: string) => rows(tab).find((el) => el.dataset.title === title)!
const button = (tab: SliderSuperTab, title: string) => row(tab, title).querySelector<HTMLButtonElement>('.sticker-set-button')!

function typeQuery(tab: SliderSuperTab, value: string) {
  const input = tab.container.querySelector<HTMLInputElement>('.input-search-input')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('вкладка «Поиск стикеров» — разметка tweb', () => {
  it('#stickers-container.chatlist-container, поле поиска вместо заголовка, в скроллере — div.sticker-sets', async() => {
    const tab = await open()

    expect(tab.container.id).toBe('stickers-container')
    expect([...tab.container.classList]).toEqual(expect.arrayContaining(['tabs-tab', 'sidebar-slider-item', 'chatlist-container']))

    // tweb :160 — `tab.title.replaceWith(inputSearch.container)`
    const header = tab.container.querySelector('.sidebar-header')!
    expect([...header.children].map((el) => el.className)).toEqual([
      expect.stringContaining('sidebar-close-button'),
      'input-search',
    ])
    expect(header.querySelector('.sidebar-header__title')).toBeNull()
    expect(header.querySelector('.input-search-placeholder')!.textContent).toBe('Search Stickers')

    const scrollable = tab.scrollable.container
    expect(scrollable.firstElementChild!.className).toBe('sticker-sets')
  })

  it('строка набора: header > details(name[dir=auto], count) + button, ниже min(5, count) ячеек', async() => {
    const tab = await open()

    expect(rows(tab).map((el) => el.dataset.title)).toEqual(['Duck', 'Utya'])
    const duck = row(tab, 'Duck')
    expect(duck.dataset.stickerSet).toBe('1')
    expect([...duck.children].map((el) => el.className)).toEqual(['sticker-set-header', 'sticker-set-stickers'])

    const header = duck.querySelector('.sticker-set-header')!
    expect([...header.children].map((el) => el.className)).toEqual([
      'sticker-set-details',
      'btn-primary btn-color-primary sticker-set-button',
    ])
    const name = header.querySelector('.sticker-set-name')!
    expect(name.getAttribute('dir')).toBe('auto')
    expect(name.textContent).toBe('Duck')
    expect(header.querySelector('.sticker-set-count')!.textContent).toBe('40 stickers')

    expect(duck.querySelectorAll('.sticker-set-sticker')).toHaveLength(5)
    expect(row(tab, 'Utya').querySelectorAll('.sticker-set-sticker')).toHaveLength(3)
  })

  it('превью — wrapSticker 68×68 в группе STICKERS-SEARCH, play+loop, одна очередь на вкладку', async() => {
    await open()

    expect(wrapStickerMock).toHaveBeenCalledTimes(8)
    const calls = wrapStickerMock.mock.calls.map(([options]) => options)
    for(const options of calls) {
      expect(options).toMatchObject({ width: 68, height: 68, group: 'STICKERS-SEARCH', play: true, loop: true })
      expect(options.div.classList.contains('sticker-set-sticker')).toBe(true)
    }
    expect(new Set(calls.map((options) => options.lazyLoadQueue)).size).toBe(1)
    expect(calls[0].mediaId).toBe(100)
  })
})

describe('вкладка «Поиск стикеров» — предпросмотр по зажатию', () => {
  it('просмотрщик слушает кладку наборов со слушателями вкладки (tweb :166)', async() => {
    const tab = await open()
    expect(attachStickerViewerListenersMock).toHaveBeenCalledTimes(1)
    expect(attachStickerViewerListenersMock).toHaveBeenCalledWith({
      listenTo: tab.scrollable.container.querySelector('.sticker-sets'),
      listenerSetter: tab.listenerSetter,
    })
  })
})

describe('вкладка «Поиск стикеров» — выдача', () => {
  it('на открытии — тренды, один запрос', async() => {
    await open()
    expect(stickers.featuredSets).toHaveBeenCalledTimes(1)
    expect(stickers.searchSets).not.toHaveBeenCalled()
  })

  it('ввод — searchSets после дебаунса; строки не из выдачи и не подходящие под запрос снимаются', async() => {
    const tab = await open()
    stickers.searchSets.mockResolvedValue(covered([makeSet(3, 'Cats', 2), 2]))

    // Пауза между нажатиями короче дебаунса (300 мс): запрос один, на итог ввода.
    typeQuery(tab, 'ca')
    await pause(100)
    typeQuery(tab, 'cat')
    await pause(350)

    // tweb InputSearch: один вызов на паузу ввода, а не на каждое нажатие.
    expect(stickers.searchSets).toHaveBeenCalledTimes(1)
    expect(stickers.searchSets).toHaveBeenCalledWith('cat')
    expect(rows(tab).map((el) => el.dataset.title)).toEqual(['Cats'])
  })

  it('ответ на устаревший запрос не рисуется', async() => {
    const tab = await open()
    let release!: (value: ReturnType<typeof covered>) => void
    stickers.searchSets.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))

    typeQuery(tab, 'duck')
    await pause(350)
    typeQuery(tab, '')
    release(covered([makeSet(4, 'Duckling', 1), 1]))
    await pause(0)

    expect(rows(tab).map((el) => el.dataset.title)).not.toContain('Duckling')
  })

  it('снятая строка гасит свою зону: плееры её превью умирают вместе с ней', async() => {
    const tab = await open()
    const duckMiddleware = wrapStickerMock.mock.calls[0][0].middleware!
    expect(duckMiddleware()).toBe(true)

    stickers.searchSets.mockResolvedValue(covered())
    typeQuery(tab, 'zzz')
    await pause(350)

    expect(rows(tab)).toHaveLength(0)
    expect(duckMiddleware()).toBe(false)
  })
})

describe('вкладка «Поиск стикеров» — кнопка Add/Added', () => {
  it('не установлен — «Add»; установлен (installed_date) — «Added» + gray', async() => {
    const tab = await open()
    expect(button(tab, 'Duck').textContent).toBe('Add')
    expect(button(tab, 'Duck').classList.contains('gray')).toBe(false)
    expect(button(tab, 'Utya').textContent).toBe('Added')
    expect(button(tab, 'Utya').classList.contains('gray')).toBe(true)
  })

  it('сеть — в момент клика; на время запроса кнопка disabled; ответ — «Added» + gray, событие установки', async() => {
    const tab = await open()
    let release!: () => void
    stickers.install.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    const installed = vi.fn()
    rootScope.addEventListener('stickers_installed', installed)

    // До клика в сеть не ходим — ни установкой, ни снятием.
    expect(stickers.install).not.toHaveBeenCalled()
    expect(stickers.uninstall).not.toHaveBeenCalled()

    button(tab, 'Duck').click()

    expect(stickers.install).toHaveBeenCalledTimes(1)
    expect(stickers.install).toHaveBeenCalledWith(1)
    expect(button(tab, 'Duck').getAttribute('disabled')).toBe('true')

    release()
    await pause(0)

    expect(button(tab, 'Duck').hasAttribute('disabled')).toBe(false)
    expect(button(tab, 'Duck').textContent).toBe('Added')
    expect(button(tab, 'Duck').classList.contains('gray')).toBe(true)
    expect(installed).toHaveBeenCalledTimes(1)
    rootScope.removeEventListener('stickers_installed', installed)

    // Второй клик — снятие: состояние набора строки обновлено ответом.
    button(tab, 'Duck').click()
    expect(stickers.uninstall).toHaveBeenCalledWith(1)
    await pause(0)
    expect(button(tab, 'Duck').textContent).toBe('Add')
  })

  it('клик по кнопке попап набора не открывает', async() => {
    const tab = await open()
    button(tab, 'Duck').click()
    await pause(0)
    expect(openStickerSetModal).not.toHaveBeenCalled()
  })
})

describe('вкладка «Поиск стикеров» — клики', () => {
  it('стикер при открытом чате — отправка самим документом в композер чата', async() => {
    const sendMessageWithDocument = vi.fn(() => true)
    appImManager.chat = { peerId: 5, input: { sendMessageWithDocument } }
    const tab = await open()

    const cell = row(tab, 'Duck').querySelectorAll<HTMLElement>('.sticker-set-sticker')[1]
    // `data-doc-id` ставит `wrapSticker` (у нас — застабленный)
    cell.dataset.docId = '101'
    cell.click()
    await pause(0)

    expect(sendMessageWithDocument).toHaveBeenCalledTimes(1)
    const [[arg]] = sendMessageWithDocument.mock.calls as unknown as Array<[{ document: Sticker, target: HTMLElement }]>
    expect(arg.document.id).toBe(101)
    expect(arg.target).toBe(cell)
    expect(openStickerSetModal).not.toHaveBeenCalled()
  })

  it('стикер без чата проваливается в строку и открывает набор', async() => {
    const tab = await open()
    row(tab, 'Duck').querySelector<HTMLElement>('.sticker-set-sticker')!.click()
    await pause(0)
    expect(openStickerSetModal).toHaveBeenCalledWith({ id: 1 }, undefined)
  })

  it('клик по строке вне кнопки и превью — попап набора по его id', async() => {
    const tab = await open()
    row(tab, 'Utya').querySelector<HTMLElement>('.sticker-set-name')!.click()
    await pause(0)
    expect(openStickerSetModal).toHaveBeenCalledWith({ id: 2 }, undefined)
  })
})

describe('вкладка «Поиск стикеров» — колонка и закрытие', () => {
  it('в правой колонке — сначала раскрыть её, тренды — после', async() => {
    let reveal!: () => void
    const toggleSidebar = vi.spyOn(column.sidebar, 'toggleSidebar').mockImplementation(() => new Promise<void>((resolve) => { reveal = resolve }))

    await open()
    expect(toggleSidebar).toHaveBeenCalledWith(true)
    expect(stickers.featuredSets).not.toHaveBeenCalled()

    reveal()
    await pause(0)
    expect(stickers.featuredSets).toHaveBeenCalledTimes(1)
  })

  // tweb :211-217: из подсказки пустой колонки вкладка открывается в ЛЕВОМ
  // слайдере — там правую колонку раскрывать незачем.
  it('в другом слайдере правую колонку не раскрывает', async() => {
    const toggleSidebar = vi.spyOn(column.sidebar, 'toggleSidebar')
    const left = new SidebarSlider({
      sidebarEl: createSidebarEl(),
      navigationType: 'left',
      managers: { stickers } as unknown as Managers,
    })

    const tab = left.createTab(AppStickersTab)
    await tab.open()
    await pause(0)
    expect(toggleSidebar).not.toHaveBeenCalled()
    expect(stickers.featuredSets).toHaveBeenCalledTimes(1)
    left.destroy()
  })

  it('Esc закрывает вкладку через контроллер навигации; после перехода узла вкладки нет, Solid-корень снят', async() => {
    const tab = await open()
    const middleware = wrapStickerMock.mock.calls[0][0].middleware!
    const setsDiv = tab.scrollable.container.querySelector('.sticker-sets')!
    expect(column.column.contains(tab.container)).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    // Снята ровно вкладка поиска: под ней — профиль, колонка открыта (tweb).
    expect(column.column.querySelector('#stickers-container')).toBeNull()
    expect(column.sidebar.getHistory()).toEqual([column.sidebar.sharedMediaTab])
    // onCleanup Solid-корня: кладка наборов вычищена, зоны превью погашены.
    expect(setsDiv.children).toHaveLength(0)
    expect(middleware()).toBe(false)
  })
})
