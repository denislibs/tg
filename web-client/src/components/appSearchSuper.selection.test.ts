// Пины задачи 14 shared media — выделение элементов (`SearchSelection`, порт
// tweb `chat/selection.ts:662-839`) и контекстное меню элемента
// (`SearchContextMenu`, порт `appSearchSuper.ts:182-386`) по tweb 812502980.
//
// Предмет проверок — DOM: меню `.search-contextmenu` и видимые в нём пункты,
// плашка `.search-super-selection-container` на месте ряда вкладок, классы
// `is-selecting`/`is-selected`, чекбоксы плиток; действия наружу — то, ЧТО
// получил хост (пересылка/удаление/переход/скачивание). Класс, меню, выделение,
// `ButtonMenu` и `contextMenuController` — настоящие; замоканы только границы:
// выдача URL медиа воркером (`startClient`), буфер обмена браузера, `fetch`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))
vi.mock('../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

vi.mock('@helpers/blur', () => ({
  default: vi.fn(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    return { canvas, promise: Promise.resolve() }
  }),
}))

class IntersectionObserverStub {
  constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

import Scrollable from '@components/scrollable'
import AppSearchSuper, { type AppSearchSuperOptions, type SearchSuperManagers, type SearchSuperMediaTab } from '@components/appSearchSuper'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import { getWireFilter } from '@core/messages/inputMessagesFilter'
import { deleteDeletedMessages, getHistoryStorage, resetSharedMediaHistories } from '@components/sharedMediaHistories'
import * as viewer from '@components/mediaViewer/openMediaViewer'
import contextMenuController from '@helpers/contextMenuController'
import { hideToast } from '@components/toast'
import { makeMessage } from '@core/messages/testMessage'
import { saveDocument, saveMessageMedia, THUMB_TYPE_FULL, type MessageMedia } from '@core/media/messageMedia'
import type { MyMessage } from '@core/models'
import type { LangPackKey } from '@lib/langPack'

const PEER: PeerId = 1

const photoMedia = (id: number): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 1600, h: 900, size: 200_000 }] },
})

const videoMedia = (id: number): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document',
    id,
    mime_type: 'video/mp4',
    size: 3_000_000,
    attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 1280, h: 720 }],
  }),
})

const photo = (id: number): MyMessage => makeMessage({ id, peerId: PEER, fromId: PEER, media: saveMessageMedia(photoMedia(id)) })
const video = (id: number): MyMessage => makeMessage({ id, peerId: PEER, fromId: PEER, media: saveMessageMedia(videoMedia(id)) })

function fakeBackend(all: MyMessage[]) {
  return {
    messages: {
      searchHistory: async({ inputFilter, offsetId = 0, limit = 30 }: SearchHistoryOptions) => {
        const src = getWireFilter(inputFilter._) === 'media' ? all : []
        const from = offsetId ? src.filter((m) => m.id < offsetId) : src
        return { messages: from.slice(0, limit), count: src.length }
      },
      searchCounters: async(_peerId: number, filters: string[]) => filters.map((filter) => ({ filter, count: all.length })),
    },
  } as unknown as SearchSuperManagers
}

const mediaTabs = (): SearchSuperMediaTab[] => [
  { type: 'media', inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2' as LangPackKey },
  { type: 'files', inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2' as LangPackKey },
]

function hostActions() {
  return {
    setInnerPeer: vi.fn<NonNullable<AppSearchSuperOptions['setInnerPeer']>>(),
    showForwardPopup: vi.fn<NonNullable<AppSearchSuperOptions['showForwardPopup']>>(),
    showDeleteMessagesPopup: vi.fn<NonNullable<AppSearchSuperOptions['showDeleteMessagesPopup']>>(),
    downloadToDisc: vi.fn<NonNullable<AppSearchSuperOptions['downloadToDisc']>>(),
  }
}

const built: AppSearchSuper[] = []

async function build(all: MyMessage[], options: Partial<AppSearchSuperOptions> = {}) {
  const scrollableEl = document.createElement('div')
  document.body.append(scrollableEl)
  const scrollable = new Scrollable(scrollableEl)
  const host = document.createElement('div')
  host.className = 'profile-content'
  scrollable.container.append(host)

  const actions = hostActions()
  const searchSuper = new AppSearchSuper({
    mediaTabs: mediaTabs(),
    scrollable,
    managers: fakeBackend(all),
    ...actions,
    ...options,
  })
  host.append(searchSuper.container)
  built.push(searchSuper)
  searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })
  await searchSuper.load(true)
  await settle()
  return { searchSuper, actions }
}

async function settle() {
  for (let i = 0; i < 6; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const tiles = (searchSuper: AppSearchSuper) =>
  Array.from(searchSuper.container.querySelectorAll<HTMLElement>('.search-super-content-media-grid .search-super-item'))

function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

const menu = () => document.querySelector<HTMLElement>('.search-contextmenu')

/** Видимые пункты меню — скрытые `verify()` несут `hide` (tweb :240-251). */
function visibleItems(): HTMLElement[] {
  return Array.from(menu()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
    .filter((item) => !item.classList.contains('hide'))
}

const itemText = (item: Element) => item.querySelector('.btn-menu-item-text')?.textContent ?? ''
const visibleTexts = () => visibleItems().map(itemText)
const menuItem = (text: string) => visibleItems().find((item) => itemText(item) === text)!

async function openMenuOn(tile: HTMLElement) {
  // открытое меню повторный вызов не пересобирает (tweb :223-225) — как и
  // клик мимо меню, закрываем его прежде
  contextMenuController.close()
  rightClick(tile)
  await settle()
}

class ClipboardItemMock {
  public static supports = vi.fn(() => true)
  constructor(public items: Record<string, Blob | Promise<Blob>>) {}
}

let write: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetSharedMediaHistories()
  vi.restoreAllMocks()
  downloadMediaURL.mockResolvedValue('blob:full')
  vi.stubGlobal('devicePixelRatio', 1)
  write = vi.fn((items: ClipboardItemMock[]) => items[0].items['image/png'])
  Object.defineProperty(window, 'ClipboardItem', { configurable: true, value: ClipboardItemMock })
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { write } })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    blob: () => Promise.resolve(new Blob(['png'], { type: 'image/png' })),
  })))
})

afterEach(() => {
  contextMenuController.close()
  // выделение держит запись навигации (`multiselect-…`) — снимаем с классом
  built.splice(0).forEach((searchSuper) => searchSuper.destroy())
  // тост «скопировано» держит оверлей, который съедает следующий клик
  hideToast()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('SearchContextMenu: меню элемента (tweb appSearchSuper.ts:182-386, 812502980)', () => {
  it('правый клик по фото: меню в body с пунктами оригинала в его порядке, у плитки menu-open', async() => {
    const { searchSuper } = await build([photo(2), photo(1)])
    const [tile] = tiles(searchSuper)

    await openMenuOn(tile)

    const element = menu()!
    expect(element.parentElement).toBe(document.body)
    expect(element.classList.contains('btn-menu')).toBe(true)
    expect(element.classList.contains('contextmenu')).toBe(true)
    expect(element.classList.contains('active')).toBe(true)
    expect(tile.classList.contains('menu-open')).toBe(true)
    expect(visibleTexts()).toEqual(['Forward', 'Copy Media', 'Download', 'Show in chat', 'Select', 'Delete'])
  })

  it('«Копировать медиа» не появляется у видео', async() => {
    const { searchSuper } = await build([video(2), photo(1)])

    await openMenuOn(tiles(searchSuper)[0])

    expect(visibleTexts()).toContain('Download')
    expect(visibleTexts()).not.toContain('Copy Media')
  })

  it('правый клик мимо элемента меню не открывает', async() => {
    const { searchSuper } = await build([photo(1)])

    await openMenuOn(searchSuper.nav)

    expect(menu()?.classList.contains('active') ?? false).toBe(false)
  })

  it('пункты зовут хоста: переслать, скачать, перейти к сообщению, удалить', async() => {
    const { searchSuper, actions } = await build([photo(2), photo(1)])
    const [tile] = tiles(searchSuper)

    await openMenuOn(tile)
    click(menuItem('Forward'))
    expect(actions.showForwardPopup).toHaveBeenCalledWith({ [PEER]: [2] })

    await openMenuOn(tile)
    click(menuItem('Download'))
    expect(actions.downloadToDisc.mock.calls[0][0].id).toBe(2)

    await openMenuOn(tile)
    click(menuItem('Show in chat'))
    expect(actions.setInnerPeer).toHaveBeenCalledWith({ peerId: PEER, lastMsgId: 2, threadId: undefined })

    await openMenuOn(tile)
    click(menuItem('Delete'))
    expect(actions.showDeleteMessagesPopup).toHaveBeenCalledWith(PEER, [2])
  })

  it('«Копировать медиа»: запись в буфер, прелоадер в пункте, по итогу меню закрыто', async() => {
    const { searchSuper } = await build([photo(2)])

    await openMenuOn(tiles(searchSuper)[0])
    const item = menuItem('Copy Media')
    click(item)

    expect(write).toHaveBeenCalledOnce()
    expect(item.classList.contains('is-loading')).toBe(true)
    expect(menu()!.classList.contains('active')).toBe(true)

    await settle()
    expect(downloadMediaURL).toHaveBeenCalledWith(2, { thumb: false })
    expect(item.classList.contains('is-loading')).toBe(false)
    expect(menu()!.classList.contains('active')).toBe(false)
  })

  it('в режиме выделения остаются только пункты withSelection (tweb :243-247)', async() => {
    const { searchSuper } = await build([photo(2), photo(1)])
    const [first, second] = tiles(searchSuper)

    await openMenuOn(first)
    click(menuItem('Select'))

    await openMenuOn(first)
    expect(visibleTexts()).toEqual(['Forward selected', 'Download selected', 'Show in chat', 'Clear selection', 'Delete selected'])

    await openMenuOn(second)
    expect(visibleTexts()).toEqual(['Forward selected', 'Download selected', 'Show in chat', 'Select', 'Delete selected'])
  })

  it('destroy() убирает меню из документа', async() => {
    const { searchSuper } = await build([photo(1)])
    await openMenuOn(tiles(searchSuper)[0])
    expect(menu()).not.toBeNull()

    contextMenuController.close()
    searchSuper.destroy()

    expect(menu()).toBeNull()
  })
})

describe('SearchSelection: выделение элементов (tweb chat/selection.ts:662-839, 812502980)', () => {
  async function selectFirstByMenu(searchSuper: AppSearchSuper) {
    await openMenuOn(tiles(searchSuper)[0])
    click(menuItem('Select'))
    await settle()
  }

  it('выбор двух элементов: is-selecting на ряде и контейнере, плашка на месте ряда вкладок, счётчик 2', async() => {
    const opened = vi.spyOn(viewer, 'openMediaViewer').mockImplementation(() => undefined)
    const { searchSuper } = await build([photo(3), photo(2), photo(1)])
    const [first, second] = tiles(searchSuper)

    await selectFirstByMenu(searchSuper)
    // клик по плитке в режиме выделения выбирает её, а не открывает вьювер (tweb :767-772)
    click(second)
    await settle()

    expect(searchSuper.navScrollableContainer.classList.contains('is-selecting')).toBe(true)
    expect(searchSuper.container.classList.contains('is-selecting')).toBe(true)
    const plate = searchSuper.navScrollableContainer.querySelector<HTMLElement>(':scope > .search-super-selection-container')!
    expect(plate).not.toBeNull()
    expect(plate.querySelector('.search-super-selection-count')!.textContent).toBe('2 messages')
    // «перейти» — только для одного выбранного (tweb :734)
    expect(plate.querySelector('.search-super-selection-goto')!.classList.contains('hide')).toBe(true)

    expect(first.classList.contains('is-selected')).toBe(true)
    expect(second.classList.contains('is-selected')).toBe(true)
    expect(opened).not.toHaveBeenCalled()
    // чекбокс досыпан всем элементам вкладок (tweb :702-714)
    for (const tile of tiles(searchSuper)) {
      expect(tile.querySelector(':scope > label.checkbox-field input')).not.toBeNull()
    }
  })

  it('протяжка в режиме выделения берёт диапазон внутри вкладки', async() => {
    const { searchSuper } = await build([photo(4), photo(3), photo(2), photo(1)])
    const items = tiles(searchSuper)
    items.forEach((tile, i) => {
      tile.getBoundingClientRect = () => ({
        top: 0, left: i * 100, bottom: 100, right: i * 100 + 100,
        width: 100, height: 100, x: i * 100, y: 0, toJSON: () => ({}),
      })
    })

    await selectFirstByMenu(searchSuper) // выбран 4

    items[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    items[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    items[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    // браузер завершает протяжку кликом — его гасят (tweb selection.ts:312-320),
    // иначе он же переключил бы плитку обратно
    click(items[3])
    await settle()

    expect(searchSuper.selection!.getSelectedMids()).toEqual([1, 2, 3, 4])
  })

  it('кнопки плашки: пересылка и удаление уходят хосту и по подтверждению снимают выделение', async() => {
    const { searchSuper, actions } = await build([photo(2), photo(1)])
    await selectFirstByMenu(searchSuper)
    click(tiles(searchSuper)[1])
    await settle()

    const plate = searchSuper.navScrollableContainer.querySelector<HTMLElement>('.search-super-selection-container')!
    click(plate.querySelector('.search-super-selection-forward')!)
    expect(actions.showForwardPopup).toHaveBeenCalledTimes(1)
    const [fwd, onSelect] = actions.showForwardPopup.mock.calls[0]
    expect(fwd).toEqual({ [PEER]: [1, 2] })

    click(plate.querySelector('.search-super-selection-delete')!)
    const [peerId, mids, onConfirm] = actions.showDeleteMessagesPopup.mock.calls[0]
    expect([peerId, mids]).toEqual([PEER, [1, 2]])

    onConfirm!()
    expect(searchSuper.selection!.isSelecting).toBe(false)
    expect(onSelect).toBeTypeOf('function')
  })

  it('отмена крестиком убирает режим, плашку и чекбоксы', async() => {
    const { searchSuper } = await build([photo(2), photo(1)])
    await selectFirstByMenu(searchSuper)

    const plate = searchSuper.navScrollableContainer.querySelector<HTMLElement>('.search-super-selection-container')!
    click(plate.querySelector('.search-super-selection-cancel')!)
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(searchSuper.selection!.isSelecting).toBe(false)
    expect(searchSuper.navScrollableContainer.querySelector('.search-super-selection-container')).toBeNull()
    expect(searchSuper.navScrollableContainer.classList.contains('is-selecting')).toBe(false)
    expect(tiles(searchSuper).some((tile) => tile.querySelector('label.checkbox-field'))).toBe(false)
  })

  it('удалённое сообщение снимается с выделения вместе с узлом (tweb sharedMedia.tsx:325-327)', async() => {
    const { searchSuper } = await build([photo(2), photo(1)])
    await selectFirstByMenu(searchSuper) // выбран 2
    click(tiles(searchSuper)[1]) // и 1
    await settle()

    deleteDeletedMessages(searchSuper, PEER, [2])

    expect(searchSuper.selection!.getSelectedMids()).toEqual([1])
  })

  it('смена пира (setQuery → cleanup) снимает выделение (tweb :3121-3123)', async() => {
    const { searchSuper } = await build([photo(1)])
    await selectFirstByMenu(searchSuper)
    expect(searchSuper.selection!.isSelecting).toBe(true)

    searchSuper.setQuery({ peerId: PEER, historyStorage: getHistoryStorage(PEER) })

    expect(searchSuper.selection!.isSelecting).toBe(false)
    expect(searchSuper.selection!.length()).toBe(0)
  })
})
