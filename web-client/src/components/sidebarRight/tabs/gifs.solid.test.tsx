/** @jsxImportSource solid-js */
/**
 * Тесты вкладки «Поиск GIF» (`gifs.solid.tsx`, порт tweb
 * `sidebarRight/tabs/gifs.tsx`, 812502980) вместе с её кладкой
 * (`components/gifsMasonry.ts`, порт tweb `gifsMasonry.ts`).
 *
 * Вкладка гоняется НАСТОЯЩАЯ — `AppGifsTab` из `solidJsTabs/tabs.ts` в
 * настоящей правой колонке (`AppSidebarRight`, `test/sidebarRight.ts`).
 * Стабы — только границы: поиск GIF (воркер, прокси Tenor), `IntersectionObserver`
 * (в happy-dom его нет — колбэк дёргается руками) и инстанс чата (мост
 * `appImManager.chat`, ВРЕМЕННО до К-3).
 *
 * Предмет проверок:
 *  • разметка — живой DOM tweb (дампы 19-emoticons-04/05): `#search-gifs-container`,
 *    поле поиска вместо заголовка, `div.gifs-masonry` с ячейками `div.gif.grid-item`;
 *  • тренды на открытии, догрузка по скроллу вниз, `loadedAll`, новый запрос
 *    сбрасывает выдачу, возврат к трендам снова их рисует;
 *  • видео ячейки — только пока она видима, ушедшая из вида ячейка его гасит;
 *  • клик — отправка элемента в композер чата, на мобильном колонка закрывается;
 *  • раскрытие колонки до первого запроса; Esc закрывает вкладку, корень снят.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type SliderSuperTab from '@components/sliderTab'
import { AppGifsTab } from '@components/solidJsTabs/tabs'
import { NAVIGATION_TRANSITION_TIME } from '@components/transition'
import type { GifItem } from '@core/gifs'
import type { GifPage, TenorGif } from '@core/managers/stickersManager'
import appNavigationController from '@core/navigation/appNavigationController'
import mediaSizes from '@helpers/mediaSizes'
import { installSidebarRight } from '@/test/sidebarRight'
import appImManager from '@lib/appImManager'

// открытый чат вкладки — `appImManager.chat`: геттер синглтона подменяется на тест
let openChat: unknown
const setChat = (chat: unknown) => { openChat = chat }
beforeEach(() => {
  vi.spyOn(appImManager, 'chat', 'get').mockImplementation(() => openChat as typeof appImManager.chat)
})

type Entry = { target: Element, isIntersecting: boolean }
class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = []
  observed = new Set<Element>()
  constructor(public cb: (entries: Entry[]) => void) {
    IntersectionObserverStub.instances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

/** Срабатывание настоящего наблюдателя: ячейка вошла во вьюпорт / ушла из него. */
function intersect(target: Element, isIntersecting: boolean) {
  for(const observer of IntersectionObserverStub.instances) {
    if(observer.observed.has(target)) observer.cb([{ target, isIntersecting }])
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Выезд правой колонки (`selectProfileTab`: 200 + 100 на десктопе) + запас. */
const REVEAL = 350
/** Переход вкладки (250) + её разрушение (250 + 30) + запас. */
const settle = () => pause(NAVIGATION_TRANSITION_TIME * 2 + 100)

const gif = (id: string, width = 320, height = 240): TenorGif => ({
  id,
  mp4Url: `https://cdn.test/${id}.mp4`,
  gifUrl: `https://cdn.test/${id}.gif`,
  previewUrl: `https://cdn.test/${id}.jpg`,
  width,
  height,
})
const page = (ids: string[], next = ''): GifPage => ({ gifs: ids.map((id) => gif(id)), next })

let column: ReturnType<typeof installSidebarRight>
let searchGifs: ReturnType<typeof vi.fn>

beforeEach(() => {
  IntersectionObserverStub.instances = []
  searchGifs = vi.fn(async(q: string, pos = '') => {
    if(q === '') return pos ? page(['t3']) : page(['t1', 't2'], 'p2')
    return page([q + '1'])
  })
  column = installSidebarRight({ stickers: { searchGifs } } as unknown as Managers)
})

afterEach(async() => {
  column.dispose()
  await settle()
  appNavigationController.spliceItems(0, Infinity)
  setChat(undefined)
  mediaSizes.isMobile = false
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

/** Открытие — как tweb `emoticonsDropdown/index.ts:306-308`. */
async function open() {
  const tab = column.sidebar.createTab(AppGifsTab)
  await tab.open()
  // Первый запрос — после выезда колонки (`toggleSidebar(true)` ждёт переход).
  await pause(REVEAL)
  return tab
}

const cells = (tab: SliderSuperTab) => [...tab.scrollable.container.querySelectorAll<HTMLElement>('.gifs-masonry > .gif')]
const ids = (tab: SliderSuperTab) => cells(tab).map((el) => el.dataset.docId)

function typeQuery(tab: SliderSuperTab, value: string) {
  const input = tab.container.querySelector<HTMLInputElement>('.input-search-input')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('вкладка «Поиск GIF» — разметка tweb', () => {
  it('#search-gifs-container, поле поиска вместо заголовка, в скроллере — div.gifs-masonry', async() => {
    const tab = await open()

    expect(tab.container.id).toBe('search-gifs-container')
    const header = tab.container.querySelector('.sidebar-header')!
    expect([...header.children].map((el) => el.className)).toEqual([
      expect.stringContaining('sidebar-close-button'),
      'input-search',
    ])
    expect(header.querySelector('.input-search-placeholder')!.textContent).toBe('Search GIFs')
    expect(tab.scrollable.container.firstElementChild!.className).toBe('gifs-masonry')
  })

  it('ячейка: div.gif.grid-item.media-gif-wrapper.media-container[data-doc-id] с размерами результата', async() => {
    const tab = await open()

    const [first] = cells(tab)
    expect([...first.classList]).toEqual(['gif', 'grid-item', 'media-gif-wrapper', 'media-container'])
    expect(first.dataset.docId).toBe('t-t1')
    expect(first.style.width).toBe('320px')
    expect(first.style.height).toBe('240px')
  })
})

describe('вкладка «Поиск GIF» — выдача', () => {
  it('на открытии — тренды одним запросом', async() => {
    const tab = await open()
    expect(searchGifs).toHaveBeenCalledTimes(1)
    expect(searchGifs).toHaveBeenCalledWith('', '')
    expect(ids(tab)).toEqual(['t-t1', 't-t2'])
  })

  it('скролл вниз — следующая страница по курсору ДОПИСЫВАЕТСЯ; пустая страница — больше не просим', async() => {
    const tab = await open()

    tab.scrollable.onScrolledBottom!()
    await pause(0)
    expect(searchGifs).toHaveBeenLastCalledWith('', 'p2')
    expect(ids(tab)).toEqual(['t-t1', 't-t2', 't-t3'])

    searchGifs.mockResolvedValueOnce(page([]))
    tab.scrollable.onScrolledBottom!()
    await pause(0)
    tab.scrollable.onScrolledBottom!()
    await pause(0)
    // loadedAll: после пустой страницы запросов нет
    expect(searchGifs).toHaveBeenCalledTimes(3)
  })

  it('новый запрос сбрасывает выдачу и курсор; возврат к пустому запросу снова рисует тренды', async() => {
    const tab = await open()

    typeQuery(tab, 'cat')
    await pause(350)
    expect(searchGifs).toHaveBeenLastCalledWith('cat', '')
    expect(ids(tab)).toEqual(['t-cat1'])

    typeQuery(tab, '')
    await pause(350)
    expect(searchGifs).toHaveBeenLastCalledWith('', '')
    expect(ids(tab)).toEqual(['t-t1', 't-t2'])
  })
})

describe('кладка — видео только у видимой ячейки', () => {
  it('ячейка во вьюпорте получает video.media-video, ушедшая — гасит его и возвращает превью', async() => {
    const tab = await open()
    const [cell] = cells(tab)
    expect(cell.querySelector('video')).toBeNull()

    intersect(cell, true)
    // happy-dom шлёт `canplay` сам, как только у видео появился `src`: первый
    // кадр «готов» сразу, и видео встаёт в ячейку (tweb `video.ts:645-661`).
    await pause(0)
    const video = cell.querySelector('video')!
    expect(video).not.toBeNull()
    expect(video.src).toBe('https://cdn.test/t1.mp4')
    expect(video.classList.contains('media-video')).toBe(true)
    expect(video.muted && video.loop && video.autoplay).toBe(true)

    intersect(cell, false)
    await pause(50)
    expect(cell.querySelector('video')).toBeNull()
  })
})

describe('вкладка «Поиск GIF» — клик', () => {
  it('отправка самим элементом в композер чата; на десктопе колонка остаётся', async() => {
    const onCloseBtnClick = vi.spyOn(column.sidebar, 'onCloseBtnClick')
    const sendMessageWithDocument = vi.fn(async() => true)
    setChat({ peerId: 5, input: { sendMessageWithDocument } })
    const tab = await open()

    const [, second] = cells(tab)
    second.click()
    await pause(0)

    expect(sendMessageWithDocument).toHaveBeenCalledTimes(1)
    const [[arg]] = sendMessageWithDocument.mock.calls as unknown as Array<[{ document: GifItem, target: HTMLElement }]>
    expect(arg.document).toMatchObject({ key: 't-t2', mp4Url: 'https://cdn.test/t2.mp4' })
    expect(arg.target).toBe(second)
    expect(onCloseBtnClick).not.toHaveBeenCalled()
  })

  it('на мобильном после отправки колонка закрывается', async() => {
    mediaSizes.isMobile = true
    const onCloseBtnClick = vi.spyOn(column.sidebar, 'onCloseBtnClick')
    setChat({ peerId: 5, input: { sendMessageWithDocument: async() => true } })
    const tab = await open()

    cells(tab)[0].click()
    await pause(0)
    expect(onCloseBtnClick).toHaveBeenCalledTimes(1)
  })
})

describe('вкладка «Поиск GIF» — колонка и закрытие', () => {
  it('сначала раскрыть колонку, первый запрос — после', async() => {
    let reveal!: () => void
    const toggleSidebar = vi.spyOn(column.sidebar, 'toggleSidebar').mockImplementation(() => new Promise<void>((resolve) => { reveal = resolve }))

    await open()
    expect(toggleSidebar).toHaveBeenCalledWith(true)
    expect(searchGifs).not.toHaveBeenCalled()

    reveal()
    await pause(0)
    expect(searchGifs).toHaveBeenCalledTimes(1)
  })

  it('Esc закрывает вкладку через контроллер навигации; после перехода узла нет, Solid-корень снят', async() => {
    const tab = await open()
    const masonry = tab.scrollable.container.querySelector('.gifs-masonry')!
    const input = tab.container.querySelector<HTMLInputElement>('.input-search-input')!

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    // Снята ровно вкладка поиска: под ней — профиль, колонка открыта (tweb).
    expect(column.column.querySelector('#search-gifs-container')).toBeNull()
    expect(column.sidebar.getHistory()).toEqual([column.sidebar.sharedMediaTab])
    // onCleanup Solid-корня: кладка вычищена, поле поиска снято (`inputSearch.remove()`
    // отцепляет слушатели — ввод в мёртвое поле в сеть не уходит).
    expect(masonry.children).toHaveLength(0)
    const calls = searchGifs.mock.calls.length
    input.value = 'late'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await pause(350)
    expect(searchGifs).toHaveBeenCalledTimes(calls)
  })
})
