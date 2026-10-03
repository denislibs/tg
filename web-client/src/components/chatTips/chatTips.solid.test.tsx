/** @jsxImportSource solid-js */
// Карточки пустой колонки — порт tweb `components/chatTips/*` (Б-13 волны 7).
//
// Предмет — правила, которые решают, ЧТО видно:
//  • колода (`index.solid.tsx`): узкий макет её не рисует вовсе; открытый чат её прячет, не
//    снимая; шаг циклический и пишется в настройку; свёртка кнопкой в углу; колода
//    раскрывается, когда показанная карточка готова;
//  • карточка «Чаты» (`chatsCard.solid.tsx`): фильтр показывается, только если за ним кто-то
//    есть, выбранный опустевший уступает первому живому, сетка — из ключа State под фильтром
//    («недавно закрытые» — `recentlyClosedChats`).
// Границы — дублёры: синглтоны колонок, плитка пира (её предмет — строка диалога), менеджеры.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { DEFAULTS, useSettingsStore } from '@/settings'
import { setAppStateSilent } from '@stores/appState'
import pause from '@helpers/schedulers/pause'
import styles from './chatTips.module.scss'

const sizes = vi.hoisted(() => ({ isLessThanFloatingLeftSidebar: false }))
vi.mock('@helpers/mediaSizes', () => ({ useMediaSizes: () => sizes }))

/** `appImManager` в объёме, который читает колода: пир верхнего чата и `peer_changed`. */
type FakeImManager = {
  chat: { peerId: number },
  dispatchEvent: (name: 'peer_changed', chat: { peerId: number }) => void
}
vi.mock('@lib/appImManager', async() => {
  const { default: EventListenerBase } = await import('@helpers/eventListenerBase')
  const im = Object.assign(new EventListenerBase(), { chat: { peerId: 0 } })
  return { default: im }
})

const sidebarLeft = vi.hoisted(() => ({
  getTab: vi.fn(),
  closeTabsUntilTab: vi.fn(),
  createTab: vi.fn(() => ({ open: vi.fn() })),
  closeAllTabsNaturally: vi.fn(async() => true),
  initSearch: vi.fn(() => ({ open: vi.fn() })),
}))
vi.mock('@components/sidebarLeft', () => ({ default: sidebarLeft }))
vi.mock('@components/solidJsTabs/tabs', () => ({ AppGeneralSettingsTab: class {}, AppStickersTab: class {} }))
vi.mock('@components/sidebarLeft/settingsPopups', () => ({ showStickersPopup: vi.fn() }))
vi.mock('@lib/appDialogsManager', () => ({ default: { setListClickListener: vi.fn() } }))
vi.mock('@components/topPeersList', () => ({
  renderTopPeerItem: ({ peerId, container }: { peerId: number, container: HTMLElement }) => {
    const tile = document.createElement('a')
    tile.dataset.peerId = '' + peerId
    container.append(tile)
  },
}))
vi.mock('@/client/bootstrap', () => ({
  getProxiedManagers: () => ({ stickers: { featuredSets: async() => ({ sets: [], covers: new Map() }) } }),
}))

const { renderChatTips } = await import('./index.solid')
const { default: ChatsTipCard } = await import('./chatsCard.solid')
const appImManager = (await import('@lib/appImManager')).default as unknown as FakeImManager

let dispose: (() => void) | undefined

beforeEach(() => {
  sizes.isLessThanFloatingLeftSidebar = false
  appImManager.chat.peerId = 0
  useSettingsStore.getState().update({ chatTips: { ...DEFAULTS.chatTips } })
  setAppStateSilent({ recentSearch: [], recentlyClosedChats: [] })
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
})

describe('колода (`renderChatTips`, tweb index.tsx)', () => {
  function mountDeck() {
    const column = document.createElement('div')
    const anchor = document.createElement('div')
    column.append(anchor)
    document.body.append(column)
    renderChatTips(anchor)
    const mount = column.querySelector<HTMLElement>('.chat-tips-mount')!
    dispose = () => (mount as HTMLElement & { disposeChatTips?: () => void }).disposeChatTips?.()
    return { column, mount }
  }

  const slots = (mount: HTMLElement) => Array.from(mount.querySelectorAll<HTMLElement>(`.${styles.slot}`))
  const activeSlot = (mount: HTMLElement) => slots(mount).findIndex((slot) => slot.classList.contains(styles.slotActive))
  const toggle = () => document.body.querySelector<HTMLElement>(`.${styles.toggleButton}`)
  const navButtons = (mount: HTMLElement) => Array.from(mount.querySelectorAll<HTMLElement>(`.${styles.navButton}`))

  it('монтируется сразу после якоря; повторный вызов заменяет прежнюю колоду, а не копит', () => {
    const { column } = mountDeck()
    expect(column.children[1].classList.contains('chat-tips-mount')).toBe(true)

    renderChatTips(column.firstElementChild as HTMLElement)
    expect(column.querySelectorAll('.chat-tips-mount')).toHaveLength(1)
    dispose = () => (column.querySelector('.chat-tips-mount') as HTMLElement & { disposeChatTips?: () => void }).disposeChatTips?.()
  })

  it('узкий макет (список чатов — выдвижной) колоду не рисует вовсе', () => {
    sizes.isLessThanFloatingLeftSidebar = true
    const { mount } = mountDeck()
    expect(mount.childElementCount).toBe(0)
    expect(toggle()).toBeNull()
  })

  it('три карточки по порядку macOS, показана сохранённая; колода раскрыта, когда показанная готова', async() => {
    useSettingsStore.getState().update({ chatTips: { index: 2, hidden: false } })
    const { mount } = mountDeck()
    await pause(0)

    expect(slots(mount)).toHaveLength(3)
    expect(activeSlot(mount)).toBe(2)
    expect(slots(mount)[2].inert).toBe(false)
    expect(slots(mount)[0].inert).toBe(true)
    expect(mount.querySelector(`.${styles.carousel}`)!.classList.contains(styles.carouselHidden)).toBe(false)
  })

  it('шаг циклический в обе стороны и пишется в `settings.chatTips.index`', async() => {
    const { mount } = mountDeck()
    const [prev, next] = navButtons(mount)

    prev.click()
    expect(useSettingsStore.getState().chatTips.index).toBe(2)
    expect(activeSlot(mount)).toBe(2)

    next.click()
    next.click()
    expect(useSettingsStore.getState().chatTips.index).toBe(1)
    expect(activeSlot(mount)).toBe(1)
  })

  it('кнопка в углу сворачивает колоду до пилюли «выберите чат» и разворачивает обратно', async() => {
    const { mount } = mountDeck()
    await pause(0)
    const carousel = mount.querySelector(`.${styles.carousel}`)!
    const pill = mount.querySelector(`.${styles.selectChat}`)!

    toggle()!.click()
    expect(useSettingsStore.getState().chatTips.hidden).toBe(true)
    expect(carousel.classList.contains(styles.carouselHidden)).toBe(true)
    expect(pill.classList.contains(styles.selectChatShown)).toBe(true)

    toggle()!.click()
    expect(useSettingsStore.getState().chatTips.hidden).toBe(false)
    expect(carousel.classList.contains(styles.carouselHidden)).toBe(false)
  })

  it('открытый чат прячет колоду, не снимая её; закрытый — возвращает', () => {
    const { mount } = mountDeck()
    const host = mount.querySelector<HTMLElement>(`.${styles.host}`)!
    const firstSlot = slots(mount)[0]

    appImManager.dispatchEvent('peer_changed', { peerId: 5 })
    expect(host.classList.contains(styles.hostHidden)).toBe(true)
    expect(toggle()).toBeNull()
    expect(slots(mount)[0]).toBe(firstSlot)

    appImManager.dispatchEvent('peer_changed', { peerId: 0 })
    expect(host.classList.contains(styles.hostHidden)).toBe(false)
    expect(toggle()).not.toBeNull()
  })
})

describe('карточка «Чаты» (tweb chatsCard.tsx)', () => {
  function mountCard() {
    const host = document.createElement('div')
    document.body.append(host)
    dispose = render(() => <ChatsTipCard />, host)
    return host
  }

  const filterButtons = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>(`.${styles.button}`))
  /** подпись кнопки — без глифа иконки */
  const labels = (host: HTMLElement) => filterButtons(host).map((b) => b.querySelector(`.${styles.buttonText}`)!.textContent)
  const tiles = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>(`.${styles.peers} [data-peer-id]`))
    .map((tile) => +tile.dataset.peerId!)

  it('пусто в обоих списках — ни одного фильтра, вместо сетки «Nothing here yet.»', () => {
    const host = mountCard()
    expect(filterButtons(host)).toHaveLength(0)
    expect(host.querySelector(`.${styles.peers}`)).toBeNull()
    expect(host.querySelector(`.${styles.empty}`)!.textContent).toBe('Nothing here yet.')
  })

  it('только «недавно закрытые» — один фильтр «Closed», он выбран, сетка из `recentlyClosedChats`', () => {
    setAppStateSilent({ recentlyClosedChats: ['7', '-8'] })
    const host = mountCard()

    expect(labels(host)).toEqual(['Closed'])
    expect(filterButtons(host)[0].getAttribute('aria-pressed')).toBe('true')
    expect(tiles(host)).toEqual([7, -8])
  })

  it('оба списка — «Searched» и «Closed»; переключение меняет сетку, не больше 8 плиток', () => {
    setAppStateSilent({
      recentSearch: ['1', '2'],
      recentlyClosedChats: ['11', '12', '13', '14', '15', '16', '17', '18', '19'],
    })
    const host = mountCard()
    const [, closed] = filterButtons(host)

    expect(labels(host)).toEqual(['Searched', 'Closed'])
    expect(tiles(host)).toEqual([1, 2])

    closed.click()
    expect(closed.getAttribute('aria-pressed')).toBe('true')
    expect(tiles(host)).toEqual([11, 12, 13, 14, 15, 16, 17, 18])
  })

  it('новый закрытый чат доезжает в сетку зеркалом State; опустевший выбранный фильтр уступает живому', () => {
    setAppStateSilent({ recentSearch: ['1'], recentlyClosedChats: ['11'] })
    const host = mountCard()
    filterButtons(host)[1].click()
    expect(tiles(host)).toEqual([11])

    setAppStateSilent({ recentlyClosedChats: ['12', '11'] })
    expect(tiles(host)).toEqual([12, 11])

    setAppStateSilent({ recentlyClosedChats: [] })
    expect(labels(host)).toEqual(['Searched'])
    expect(tiles(host)).toEqual([1])
  })

  it('ссылка подписи открывает глобальный поиск поверх закрытых вкладок', async() => {
    const host = mountCard()
    host.querySelector<HTMLAnchorElement>(`.${styles.description} a`)!.click()
    await pause(0)
    expect(sidebarLeft.closeAllTabsNaturally).toHaveBeenCalled()
    expect(sidebarLeft.initSearch).toHaveBeenCalled()
  })
})
