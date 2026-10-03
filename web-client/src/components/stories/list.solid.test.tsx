/** @jsxImportSource solid-js */
// Ряд историий (порт tweb `stories/list.tsx`): сворачивание жестом над списком —
// классы и переменные tweb (`--stories-scrolled`, `translateY` контейнера,
// `disable-hover`), клик по свёрнутому ряду разворачивает, по развёрнутому —
// открывает вьювер на пире элемента; свои истории — первыми.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { StoryGroup } from '@core/managers/storiesManager'
import type { StoryItem } from '@core/stories/story'

const createStoriesViewer = vi.fn((_props: { peerId: PeerId, onExit?: () => void }) => () => {})
vi.mock('@components/stories/viewer', () => ({ createStoriesViewer }))
vi.mock('@/client/bootstrap', () => ({
  getProxiedManagers: () => ({ peers: { fillMirror: async () => {} } }),
}))
// happy-dom не даёт 2D-контекста — кольцо рисуется пустышкой
vi.mock('@helpers/canvas/dashedCircle', () => ({
  default: class {
    canvas = document.createElement('canvas')
    context = { createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D
    dpr = 1
    prepare() {}
    render() {}
  },
}))

const { default: StoriesList } = await import('./list.solid')
const { useStoriesStore } = await import('@stores/storiesStore')
const { default: rootScope } = await import('@lib/rootScope')
const { useSettingsStore } = await import('@/settings')

const ME = 7
const story = (id: number, date = 1787334148 + id): StoryItem =>
  ({ _: 'storyItem', id, date, expire_date: date + 86400, media: { _: 'messageMediaPhoto', photo: { _: 'photo', id, sizes: [] } } })
const group = (id: number, maxReadId: number, stories: StoryItem[]): StoryGroup =>
  ({ author: { _: 'user', id, first_name: 'U' + id }, stories, maxReadId })

let dispose: (() => void) | undefined
let root: HTMLElement

function mount() {
  // `.item-main > .sidebar-header > .input-search > input` + `#chatlist-container` (tweb index.html:91-107)
  const el = (tag: string, cls: string, ...children: HTMLElement[]) => {
    const node = document.createElement(tag)
    if(cls) node.className = cls
    node.append(...children)
    return node
  }
  const chatlist = el('div', '', el('div', 'connection-status-bottom', el('div', 'scroller')))
  chatlist.id = 'chatlist-container'
  root = el('div', '', el('div', 'item-main',
    el('div', 'sidebar-header', el('div', 'input-search', el('input', ''))),
    el('div', 'sidebar-content', chatlist),
  ))
  document.body.append(root)
  // happy-dom не раскладывает: прямоугольники колонки 360px вокруг поля поиска
  const rect = (left: number, right: number) => () => ({ left, right, width: right - left, top: 0, bottom: 40, height: 40, x: left, y: 0 }) as DOMRect
  root.querySelector<HTMLElement>('input')!.getBoundingClientRect = rect(60, 300)
  root.querySelector<HTMLElement>('.input-search')!.getBoundingClientRect = rect(50, 310)
  root.querySelector<HTMLElement>('.sidebar-header')!.getBoundingClientRect = rect(0, 360)
  const host = document.createElement('div')
  host.classList.add('stories-list')
  root.querySelector('.sidebar-header')!.after(host)
  const setScrolledOn = root.querySelector<HTMLElement>('#chatlist-container')!
  const listenWheelOn = root.querySelector<HTMLElement>('.connection-status-bottom')!
  const scrollable = root.querySelector<HTMLElement>('.scroller')!
  const onExpand = vi.fn()
  dispose = render(() => StoriesList({
    foldInto: root.querySelector('input')!,
    setScrolledOn,
    getScrollable: () => scrollable,
    listenWheelOn,
    offsetX: -1,
    onExpand,
  }), host)
  const wheel = (deltaY: number) => listenWheelOn.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }))
  const container = () => host.firstElementChild as HTMLElement
  const items = () => Array.from(host.querySelectorAll<HTMLElement>('[role="button"]'))
  return { setScrolledOn, scrollable, wheel, container, items, onExpand }
}

beforeEach(() => {
  vi.useFakeTimers()
  rootScope.myId = ME
  // без анимаций: `useCollapsable` не ждёт transitionend, которого в happy-dom нет
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  useStoriesStore.setState({ groups: [], loaded: false })
  useStoriesStore.getState().setGroups([
    group(2, 0, [story(1)]), // чужие, непрочитаны
    group(ME, 5, [story(5)]), // свои, прочитаны
    group(3, 0, [story(2)]),
  ])
  createStoriesViewer.mockClear()
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  root.remove()
  vi.useRealTimers()
})

describe('StoriesList — сворачивание при скролле списка', () => {
  it('стартует свёрнутым; колесо вверх у края разворачивает, прокрученный список сворачивает', () => {
    const { setScrolledOn, scrollable, wheel, container } = mount()
    // свёрнут: контейнер уехал на -69px, список поджат к шапке (92px)
    expect(container().style.transform).toBe('translateY(-69px)')
    expect(setScrolledOn.style.getPropertyValue('--stories-scrolled')).toBe('92px')
    expect(container().classList.contains('disable-hover')).toBe(true)

    wheel(-50)
    expect(container().style.transform).toBe('translateY(0px)')
    expect(setScrolledOn.style.getPropertyValue('--stories-scrolled')).toBe('0px')
    expect(container().classList.contains('disable-hover')).toBe(false)

    vi.advanceTimersByTime(1000)
    scrollable.scrollTop = 40
    wheel(50)
    expect(container().style.transform).toBe('translateY(-69px)')
    expect(setScrolledOn.style.getPropertyValue('--stories-scrolled')).toBe('92px')
  })
})

describe('StoriesList — клик', () => {
  it('по свёрнутому ряду разворачивает его (onExpand), вьювер не открывается', () => {
    const { items, container, onExpand } = mount()
    items()[0].click()
    expect(createStoriesViewer).not.toHaveBeenCalled()
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(container().style.transform).toBe('translateY(0px)')
  })

  it('по развёрнутому — открывает вьювер с пиром элемента; выход снимает его', () => {
    const { items, wheel } = mount()
    wheel(-50)
    const bob = items().find((el) => el.querySelector('.avatar')?.getAttribute('data-peer-id') === '3')!
    bob.click()
    expect(createStoriesViewer).toHaveBeenCalledTimes(1)
    expect(createStoriesViewer.mock.calls[0][0].peerId).toBe(3)

    createStoriesViewer.mock.calls[0][0].onExit!()
    items()[0].click()
    expect(createStoriesViewer).toHaveBeenCalledTimes(2)
    expect(createStoriesViewer.mock.calls[1][0].peerId).toBe(ME)
  })
})

describe('StoriesList — порядок', () => {
  it('свои истории первыми (даже прочитанные), затем непрочитанные по свежести', () => {
    const { items } = mount()
    const order = items().map((el) => el.querySelector('.avatar')!.getAttribute('data-peer-id'))
    expect(order).toEqual([String(ME), '3', '2'])
    expect(items()[0].textContent).toContain('My Story')
  })

  it('пока ряд развёрнут, сортировка заморожена; свёрнутый ряд пересортирует', () => {
    const { items, wheel, scrollable } = mount()
    wheel(-50)
    // прочитали «3» — под заморозкой он остаётся на месте
    useStoriesStore.getState().markRead(3, 2)
    const ids = () => items().map((el) => el.querySelector('.avatar')!.getAttribute('data-peer-id'))
    expect(ids()).toEqual([String(ME), '3', '2'])

    vi.advanceTimersByTime(1000)
    scrollable.scrollTop = 40
    wheel(50)
    expect(useStoriesStore.getState().groups.map((g) => g.author.id)).toEqual([ME, 2, 3])
  })
})
