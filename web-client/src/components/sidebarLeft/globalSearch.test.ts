// Пины владельца глобального поиска — порт tweb `initSearch`
// (`sidebarLeft/index.ts:1084-1554`), задача 12 плана
// `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`.
//
// Владелец гоняется на ФЕЙКОВЫХ узлах без React — каркас левой колонки
// оригинала (`index.html:91-102`): `.item-main > .sidebar-content.transition.zoom-fade
// > #chatlist-container + #search-container`, поле поиска и стрелка «назад».
// Поле — ванильная копия контракта tweb `InputSearch` (события `input`/Enter/
// крестик), как его увидит владелец и после шва задачи 13.
//
// Пины — на результат: узлы в `#search-container`, классы перехода на узлах,
// чип в поле, контекст поиска класса, запросы, дошедшие до фейкового бэкенда.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Единственная подмена — счётчик вокруг настоящего `createRoot` (приём
// `appSearchSuper.dom.test.ts`): утилизацию Solid-корней групп в DOM не видно,
// а она и есть расхождение 3 в шапке владельца.
const solidRoots = vi.hoisted(() => ({ opened: 0, disposed: 0 }))
vi.mock('solid-js', async(importOriginal) => {
  const actual = await importOriginal<typeof import('solid-js')>()
  return {
    ...actual,
    createRoot: <T>(fn: (dispose: () => void) => T, detachedOwner?: never) =>
      actual.createRoot((dispose) => {
        ++solidRoots.opened
        return fn(() => {
          ++solidRoots.disposed
          dispose()
        })
      }, detachedOwner),
  }
})

import GlobalSearch, { type GlobalSearchInputSearch, type GlobalSearchManagers } from '@components/sidebarLeft/globalSearch'
import type { ScrollableBase } from '@components/scrollable'
import type { DialogListElement } from '@lib/appDialogsManager'
import { resetSharedMediaHistories } from '@components/sharedMediaHistories'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { getOutputPeer } from '@core/peers/peerId'
import type { SearchHistoryOptions } from '@core/managers/messagesManager'
import type { ContactsFound } from '@core/managers/channelsManager'
import type { Dialog } from '@core/models'
import appNavigationController from '@core/navigation/appNavigationController'
import appImManager from '@lib/appImManager'
import { CLICK_EVENT_NAME, simulateClickEvent } from '@helpers/dom/clickEvent'
import { fillTipDates, type DateData } from '@helpers/date'
import rootScope from '@lib/rootScope'
import { useAppStateStore } from '@stores/appState'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'

const ME: PeerId = 1
const ALICE: PeerId = 7
const BOB: PeerId = 8
const NEWS: PeerId = -50

/** Контракт tweb `InputSearch` (`inputSearch.ts`) в объёме владельца, без debounce. */
class FakeInputSearch implements GlobalSearchInputSearch {
  public container = document.createElement('div')
  public input = document.createElement('input')
  public clearBtn = document.createElement('button')
  public onChange?: (value: string) => void
  public onClear?: () => void
  public onEnter?: (value: string) => void

  constructor() {
    this.container.classList.add('input-search')
    this.input.classList.add('input-search-input')
    this.container.append(this.input, this.clearBtn)
    // `onInput` (:200-220) — без debounce
    this.input.addEventListener('input', () => this.onChange?.(this.value))
    // `onKeyDown` (:238-243)
    this.input.addEventListener('keydown', (e) => {
      if(e.key !== 'Enter' || !this.onEnter || !this.value) return
      this.onEnter(this.value)
    })
    // `onClearClick` (:245-250)
    this.clearBtn.addEventListener('click', () => {
      this.value = ''
      this.onChange?.('')
      this.onClear?.()
    })
  }

  get value() {
    return this.input.value
  }

  set value(value: string) {
    this.input.value = value
  }

  type(value: string) {
    this.value = value
    this.input.dispatchEvent(new Event('input'))
  }
}

type Backend = {
  contacts?: PeerId[]
  dialogs?: PeerId[]
  myResults?: PeerId[]
}

function fakeBackend(backend: Backend = {}) {
  const calls = {
    history: [] as SearchHistoryOptions[],
    contacts: [] as [query?: string, includeSaved?: boolean, sortBy?: string, limit?: number][],
    search: [] as string[],
    dialogs: [] as { query?: string, limit?: number }[],
    pushRecent: [] as PeerId[],
    clearRecent: 0,
  }
  const managers = {
    messages: {
      searchHistory: async(ctx: SearchHistoryOptions) => {
        calls.history.push(ctx)
        return { messages: [], count: 0 }
      },
      searchCounters: async() => { throw new Error('hideEmptyTabs: false — счётчики не спрашиваются') },
    },
    peers: { fillMirror: async() => {} },
    presence: { get: async() => [] },
    contacts: {
      getContactsPeerIds: async(query?: string, includeSaved?: boolean, sortBy?: string, limit?: number) => {
        calls.contacts.push([query, includeSaved, sortBy, limit])
        return query ? backend.contacts ?? [] : []
      },
      pushRecentSearch: async(peerId: PeerId) => {
        calls.pushRecent.push(peerId)
      },
      clearRecentSearch: async() => {
        ++calls.clearRecent
        useAppStateStore.setState({ recentSearch: [] })
      },
    },
    channels: {
      search: async(q: string): Promise<ContactsFound> => {
        calls.search.push(q)
        return { _: 'contacts.found', my_results: (backend.myResults ?? []).map(getOutputPeer), results: [], chats: [], users: [] }
      },
    },
    dialogs: {
      getDialogs: async(options: { query?: string, limit?: number }) => {
        calls.dialogs.push(options)
        const peerIds = options.query ? backend.dialogs ?? [] : []
        return { dialogs: peerIds.map((peerId) => ({ peerId }) as Dialog), count: peerIds.length, isEnd: true }
      },
    },
  } as unknown as GlobalSearchManagers
  return { managers, calls }
}

/** Каркас оригинала: `index.html:91-102`. */
function build(backend: Backend = {}) {
  const itemMain = document.createElement('div')
  itemMain.classList.add('item-main')
  const inputSearch = new FakeInputSearch()
  const backBtn = document.createElement('button')
  const sidebarContent = document.createElement('div')
  sidebarContent.classList.add('sidebar-content', 'transition', 'zoom-fade')
  const chatlistContainer = document.createElement('div')
  chatlistContainer.id = 'chatlist-container'
  chatlistContainer.classList.add('transition-item')
  const searchContainer = document.createElement('div')
  searchContainer.id = 'search-container'
  searchContainer.classList.add('transition-item', 'sidebar-search')
  // `#new-menu` — последний ребёнок `.sidebar-content` (`construct`, :210-211)
  const newBtnMenu = document.createElement('div')
  newBtnMenu.id = 'new-menu'
  sidebarContent.append(chatlistContainer, searchContainer, newBtnMenu)
  itemMain.append(backBtn, inputSearch.container, sidebarContent)
  document.body.append(itemMain)

  const { managers, calls } = fakeBackend(backend)
  const searchActive: boolean[] = []
  const openedUrls: string[] = []
  const owner = new GlobalSearch({
    searchContainer,
    inputSearch,
    backBtn,
    managers,
    onSearchActive: (active) => searchActive.push(active),
    newBtnMenu,
    openUrl: (url) => openedUrls.push(url),
  })
  owners.push(owner)
  return { owner, inputSearch, backBtn, itemMain, sidebarContent, chatlistContainer, searchContainer, newBtnMenu, calls, searchActive, openedUrls }
}

/** запросы helper'а чипов — без лимита, в отличие от `loadChats` класса (`appSearchSuper.ts:1720`, `:1752`) */
const helperQueries = (calls: ReturnType<typeof fakeBackend>['calls']) => ({
  dialogs: calls.dialogs.filter((o) => o.limit === undefined).map((o) => o.query),
  contacts: calls.contacts.filter(([, , , limit]) => limit === undefined).map(([q, includeSaved]) => [q, includeSaved]),
})

const last = <T>(list: T[]) => list[list.length - 1]

const settle = async() => {
  for(let i = 0; i < 8; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const focus = (inputSearch: FakeInputSearch) => inputSearch.input.dispatchEvent(new FocusEvent('focus'))
/** конец CSS-анимации `zoom-fade` на узле (`transition.ts`, ветка `animationend`) */
const animationEnd = (el: HTMLElement) => el.dispatchEvent(new Event('animationend', { bubbles: true }))
const classes = (el: Element) => [...el.classList].sort()
const helper = (searchContainer: HTMLElement) => searchContainer.querySelector<HTMLElement>('.search-helper')!
const nav = (searchContainer: HTMLElement) => searchContainer.querySelector<HTMLElement>('nav.search-super-tabs')!
const chips = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(':scope > .selector-user')]
const group = (searchContainer: HTMLElement, className: string) => searchContainer.querySelector<HTMLElement>('.search-group.' + className)!
const groupRows = (el: HTMLElement) => [...el.querySelectorAll<DialogListElement>('.search-group-content a')]
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const mousedown = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

const owners: GlobalSearch[] = []
let prevMyId: PeerId

beforeEach(() => {
  resetSharedMediaHistories()
  resetPeerMirror()
  prevMyId = rootScope.myId
  rootScope.myId = ME
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
    { _: 'user', id: ALICE, first_name: 'Алиса', username: 'alice', pFlags: {} },
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} },
    { _: 'channel', id: 50, title: 'Новости', username: 'news', participants_count: 1200, pFlags: { broadcast: true } },
  ] as never }])
  useAppStateStore.setState({ recentSearch: [] })
  useChatsStore.setState({ dialogs: [] })
  // клик по строке выдачи открывает чат (`appDialogsManager.setListClickListener`), а стек
  // чатов `appImManager` в этом файле не поднят — его открытие здесь предмет не проверки
  vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
})

afterEach(() => {
  owners.splice(0).forEach((owner) => owner.destroy())
  rootScope.myId = prevMyId
  useAppStateStore.setState({ recentSearch: [] })
  useChatsStore.setState({ dialogs: [] })
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: false } })
  document.body.replaceChildren()
})

describe('жизненный цикл: создание по фокусу, снос по окончании обратного перехода (:1084-1502)', () => {
  it('до фокуса выдачи нет; фокус строит скроллер, класс и пять групп', async() => {
    const { inputSearch, searchContainer, chatlistContainer } = build()
    expect(searchContainer.childElementCount).toBe(0)
    // `transition(0)` (:1449) ставится только с первой инициализацией
    expect(chatlistContainer.classList.contains('active')).toBe(false)

    focus(inputSearch)
    await settle()

    const scrollable = searchContainer.querySelector(':scope > .scrollable')!
    expect(scrollable).not.toBeNull()
    expect(scrollable.querySelector(':scope > .search-super')).not.toBeNull()
    // пять групп оригинала (:1095-1103) лежат во вкладке `chats`
    const groups = [...searchContainer.querySelectorAll('.search-group')].map((el) => [...el.classList].filter((c) => c.startsWith('search-group-')).sort().join(' '))
    expect(groups).toEqual([
      'search-group-contacts',
      // у «Global search» тип тоже `contacts` (:1097)
      'search-group-contacts',
      'search-group-messages',
      'search-group-contacts search-group-people search-group-with-scroll',
      'search-group-contacts search-group-recent',
    ])
    // ряд вкладок — 7 из 9 оригинала (`apps`/`posts` — задачи 16-17)
    expect([...nav(searchContainer).querySelectorAll('.menu-horizontal-div-item')].map((el) => el.textContent)).toEqual(
      ['Chats', 'Channels', 'Media', 'Links', 'Files', 'Music', 'Voice'],
    )
  })

  it('transition(1): active+to у выдачи, active+from у чатлиста, animating у контейнера, is-search-active у .item-main', () => {
    const { inputSearch, searchContainer, chatlistContainer, sidebarContent, itemMain, searchActive } = build()
    focus(inputSearch)

    expect(classes(searchContainer)).toEqual(['active', 'sidebar-search', 'to', 'transition-item'])
    expect(classes(chatlistContainer)).toEqual(['active', 'from', 'transition-item'])
    expect(sidebarContent.classList.contains('animating')).toBe(true)
    expect(sidebarContent.classList.contains('backwards')).toBe(false)
    expect(itemMain.classList.contains('is-search-active')).toBe(true)
    expect(searchActive).toEqual([true])
    expect(sidebarContent.dataset.animation).toBe('zoom-fade')
  })

  it('«назад»: backwards; по окончании перехода #search-container пуст, поле очищено, повторный фокус строит всё заново', async() => {
    const { owner, inputSearch, backBtn, searchContainer, chatlistContainer, sidebarContent, itemMain, searchActive, calls } = build()
    focus(inputSearch)
    animationEnd(searchContainer)
    await settle()
    const firstSuper = searchContainer.querySelector('.search-super')
    inputSearch.value = 'abc'

    simulateClickEvent(backBtn)
    expect(sidebarContent.classList.contains('animating')).toBe(true)
    expect(sidebarContent.classList.contains('backwards')).toBe(true)
    expect(classes(chatlistContainer)).toEqual(['active', 'to', 'transition-item'])
    expect(classes(searchContainer)).toEqual(['active', 'from', 'sidebar-search', 'transition-item'])
    expect(itemMain.classList.contains('is-search-active')).toBe(false)
    expect(searchActive).toEqual([true, false])
    // пока переход идёт, выдача на месте — узел уходит с анимацией
    expect(searchContainer.childElementCount).toBe(1)

    animationEnd(chatlistContainer)
    // `cleanup()` (:1401-1423)
    expect(searchContainer.childElementCount).toBe(0)
    expect(owner.searchSuper).toBeUndefined()
    expect(inputSearch.value).toBe('')
    expect(inputSearch.onChange).toBeUndefined()
    expect(inputSearch.onClear).toBeUndefined()
    expect(inputSearch.onEnter).toBeUndefined()
    expect(sidebarContent.classList.contains('animating')).toBe(false)

    const historyBefore = calls.history.length
    focus(inputSearch)
    await settle()
    const secondSuper = searchContainer.querySelector('.search-super')
    expect(secondSuper).not.toBeNull()
    expect(secondSuper).not.toBe(firstSuper)
    expect(searchActive).toEqual([true, false, true])
    // новый инстанс снова загрузил первую вкладку
    expect(owner.searchSuper).toBeDefined()
    expect(calls.history.length).toBeGreaterThanOrEqual(historyBefore)
  })

  it('после закрытия утилизированы все Solid-корни сеанса: пять групп, ChatTypeMenu, строки (расхождение 3)', async() => {
    useAppStateStore.setState({ recentSearch: ['' + BOB] })
    const { inputSearch, backBtn, chatlistContainer } = build()
    solidRoots.opened = solidRoots.disposed = 0
    focus(inputSearch)
    await settle()
    // пять групп + корни класса и его строк — открыто больше пяти
    expect(solidRoots.opened).toBeGreaterThan(5)

    simulateClickEvent(backBtn)
    animationEnd(chatlistContainer)
    await settle()
    expect(solidRoots.disposed).toBe(solidRoots.opened)
  })

  it('класс сеанса собран внутри корня сеанса: предупреждения Solid о вычислениях без владельца нет (расхождение 11)', async() => {
    const warn = vi.spyOn(console, 'warn')
    try {
      const { inputSearch, backBtn, chatlistContainer } = build()
      focus(inputSearch)
      await settle()
      simulateClickEvent(backBtn)
      animationEnd(chatlistContainer)
      await settle()
      const leaks = warn.mock.calls.filter(([msg]) => String(msg).includes('computations created outside a `createRoot` or `render`'))
      expect(leaks, '`Tabs.MenuGradient` конструктора `AppSearchSuper` без владельца').toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('скроллер, созданный владельцем, снят: его подписка на окно отписана (расхождение 3)', async() => {
    // С tweb ffd925068 скроллер не вешает свой `resize` на окно: все живые
    // экземпляры лежат в ОДНОМ слабом реестре (`scrollable.ts`), выставленном
    // в `MOUNT_CLASS_TO` (у нас это `window`), а `destroy()` снимает запись.
    const registry = () => (window as unknown as { listeningScrollables: Set<WeakRef<ScrollableBase>> }).listeningScrollables
    const { inputSearch, backBtn, searchContainer, chatlistContainer } = build()
    focus(inputSearch)
    await settle()
    // `new Scrollable(searchContainer)` (:1089) записывается в реестр
    const mine = [...registry()].map((ref) => ref.deref()).filter((s) => s?.el === searchContainer)
    expect(mine).toHaveLength(1)

    simulateClickEvent(backBtn)
    animationEnd(chatlistContainer)
    expect([...registry()].some((ref) => ref.deref() === mine[0])).toBe(false)
  })

  it('#new-menu: is-hidden с фокуса; снимается через 150 мс после ухода выдачи, не раньше (:1550-1558, :1571)', async() => {
    const { inputSearch, backBtn, searchContainer, chatlistContainer, newBtnMenu } = build()
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(false)

    focus(inputSearch)
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(true)
    animationEnd(searchContainer)
    await settle()

    simulateClickEvent(backBtn)
    // переход назад ещё идёт — кнопка спрятана
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(true)
    animationEnd(chatlistContainer)
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(false)
  })

  it('#new-menu: destroy() снимает таймер возврата (расхождение 8)', async() => {
    const { owner, inputSearch, backBtn, searchContainer, chatlistContainer, newBtnMenu } = build()
    focus(inputSearch)
    animationEnd(searchContainer)
    await settle()
    simulateClickEvent(backBtn)
    animationEnd(chatlistContainer)

    owner.destroy()
    await new Promise((resolve) => setTimeout(resolve, 180))
    expect(newBtnMenu.classList.contains('is-hidden')).toBe(true)
  })

  it('без анимаций уборка — сразу на «назад»', async() => {
    useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
    const { inputSearch, backBtn, searchContainer, chatlistContainer } = build()
    focus(inputSearch)
    await settle()
    expect(classes(searchContainer)).toEqual(['active', 'sidebar-search', 'transition-item'])

    simulateClickEvent(backBtn)
    expect(searchContainer.childElementCount).toBe(0)
    expect(classes(chatlistContainer)).toEqual(['active', 'transition-item'])
  })

  it('destroy() снимает всё: выдачи нет, фокус больше ничего не создаёт, запись навигации снята', async() => {
    const { owner, inputSearch, searchContainer } = build()
    focus(inputSearch)
    await settle()
    expect(appNavigationController.findItemByType('global-search')).toBeDefined()

    owner.destroy()
    expect(searchContainer.childElementCount).toBe(0)
    expect(appNavigationController.findItemByType('global-search')).toBeUndefined()

    focus(inputSearch)
    window.dispatchEvent(new Event('tg-focus-search'))
    await settle()
    expect(searchContainer.childElementCount).toBe(0)
  })

  it('пустой ввод в сеть не ходит: ни выдачи сообщений, ни контактов, ни диалогов', async() => {
    const { inputSearch, calls } = build()
    focus(inputSearch)
    await settle()
    inputSearch.type('abc')
    inputSearch.type('')
    await settle()
    // сеть ушла только за «abc»; пустое значение — ни одного запроса
    for(const list of [calls.history.map((c) => c.query), calls.search, calls.contacts.map(([q]) => q), calls.dialogs.map((o) => o.query)]) {
      expect(list.every((q) => q === 'abc')).toBe(true)
    }
    calls.history.length = calls.search.length = calls.contacts.length = calls.dialogs.length = 0
    inputSearch.type('')
    await settle()

    expect(calls.history).toEqual([])
    expect(calls.search).toEqual([])
    expect(calls.contacts).toEqual([])
    expect(calls.dialogs).toEqual([])
  })
})

describe('чипы пира и даты (:1200-1303, :1349-1381)', () => {
  it('«today»: чип даты в helper вместо ряда вкладок; клик — чип в поле, is-picked, --paddingLeft, minDate/maxDate в контексте и в запросе', async() => {
    const { owner, inputSearch, searchContainer, calls } = build()
    focus(inputSearch)
    await settle()

    inputSearch.type('today')
    await settle()

    const helperEl = helper(searchContainer)
    expect(helperEl.parentElement).toBe(nav(searchContainer).parentElement)
    expect(helperEl.classList.contains('hide')).toBe(false)
    expect(nav(searchContainer).classList.contains('hide')).toBe(true)
    // `fillTipDates` (:1351-1359): ключ `date_<min>_<max>`, границы — сегодняшние сутки
    const dates: DateData[] = []
    fillTipDates('today', dates)
    const chip = chips(helperEl).find((el) => el.dataset.key!.startsWith('date_'))!
    expect(chip).toBeDefined()
    expect(chip.querySelector('.selector-user-title')?.textContent).toBe(dates[0].title)
    const [, minDate, maxDate] = chip.dataset.key!.split('_').map(Number)
    expect(Math.abs(minDate - dates[0].minDate)).toBeLessThan(1000)
    expect(Math.abs(maxDate - dates[0].maxDate)).toBeLessThan(1000)
    const today = { minDate, maxDate }
    expect(chip.classList.contains('selector-user-primary')).toBe(true)

    calls.history.length = 0
    click(chip)
    await settle()

    expect(chip.parentElement).toBe(inputSearch.container)
    expect(chip.classList.contains('selector-user-primary')).toBe(false)
    expect(inputSearch.container.classList.contains('is-picked')).toBe(true)
    expect(inputSearch.container.classList.contains('is-picked-twice')).toBe(false)
    expect(chip.classList.contains('is-first')).toBe(true)
    expect(inputSearch.input.style.getPropertyValue('--paddingLeft')).not.toBe('')
    expect(inputSearch.value).toBe('')
    // ряд вкладок вернулся, helper пуст и скрыт
    expect(nav(searchContainer).classList.contains('hide')).toBe(false)
    expect(helperEl.classList.contains('hide')).toBe(true)
    expect(owner.searchSuper!.searchContext).toMatchObject({ peerId: 0, folderId: 0, query: '', minDate: today.minDate, maxDate: today.maxDate })
    // запрос по дате ушёл и без текста (`appSearchSuper.ts:2474`)
    expect(last(calls.history)).toMatchObject({ minDate: today.minDate, maxDate: today.maxDate })
    // `ChatTypeMenu` прячется при чипах (`pause(0)`, :1214)
    const chatTypeMenu = searchContainer.querySelector('chat-type-menu') as HTMLElement & { props: { hidden?: boolean } }
    expect(chatTypeMenu.props.hidden).toBe(true)
  })

  it('чип пира ставит peerId (folderId снят); второй чип — is-picked-twice, is-first/is-last; повторный клик снимает; onClear снимает все', async() => {
    const { owner, inputSearch, searchContainer, calls } = build({ contacts: [ALICE] })
    focus(inputSearch)
    await settle()

    inputSearch.type('Алиса')
    await settle()
    // helper спрашивает диалоги и книгу БЕЗ лимита (:1363-1365) — лимит у запросов класса
    expect(helperQueries(calls)).toEqual({ dialogs: ['Алиса'], contacts: [['Алиса', true]] })
    const peerChip = chips(helper(searchContainer)).find((el) => el.dataset.key === '' + ALICE)!
    expect(peerChip).toBeDefined()
    click(peerChip)
    await settle()

    expect(owner.searchSuper!.searchContext.peerId).toBe(ALICE)
    expect(owner.searchSuper!.searchContext.folderId).toBeUndefined()
    // с выбранным пиром чипы пиров больше не предлагаются (:1361)
    inputSearch.type('today')
    await settle()
    expect(helperQueries(calls).dialogs).toEqual(['Алиса'])
    const dateChip = chips(helper(searchContainer))[0]
    expect(dateChip.dataset.key!.startsWith('date_')).toBe(true)
    click(dateChip)
    await settle()

    expect(chips(inputSearch.container)).toEqual([peerChip, dateChip])
    expect(inputSearch.container.classList.contains('is-picked-twice')).toBe(true)
    expect(peerChip.classList.contains('is-first')).toBe(true)
    expect(dateChip.classList.contains('is-last')).toBe(true)
    expect(last(calls.history)).toMatchObject({ peerId: ALICE })

    // повторный клик по чипу — снять (:1244-1246, :1268-1284)
    click(peerChip)
    await settle()
    expect(chips(inputSearch.container)).toEqual([dateChip])
    expect(inputSearch.container.classList.contains('is-picked-twice')).toBe(false)
    expect(dateChip.classList.contains('is-first')).toBe(true)
    expect(owner.searchSuper!.searchContext).toMatchObject({ peerId: 0, folderId: 0 })

    // крестик поля — снять все (:1286-1293)
    click(inputSearch.clearBtn)
    await settle()
    expect(chips(inputSearch.container)).toEqual([])
    expect(inputSearch.container.classList.contains('is-picked')).toBe(false)
    expect(inputSearch.input.style.getPropertyValue('--paddingLeft')).toBe('')
    expect(owner.searchSuper!.searchContext).toMatchObject({ peerId: 0, minDate: 0, maxDate: 0 })
    const chatTypeMenu = searchContainer.querySelector('chat-type-menu') as HTMLElement & { props: { hidden?: boolean } }
    expect(chatTypeMenu.props.hidden).toBe(false)
  })

  it('крестик поля снимает ОБА чипа (расхождение 5: обход копии массива)', async() => {
    const { owner, inputSearch, searchContainer } = build()
    owner.initSearch().openWithPeerId(ALICE)
    await settle()
    inputSearch.type('today')
    await settle()
    click(chips(helper(searchContainer))[0])
    await settle()
    expect(chips(inputSearch.container)).toHaveLength(2)

    click(inputSearch.clearBtn)
    await settle()
    expect(chips(inputSearch.container)).toEqual([])
    expect(owner.searchSuper!.searchContext).toMatchObject({ peerId: 0, folderId: 0, minDate: 0, maxDate: 0 })
  })

  it('openWithPeerId: поиск открыт сразу с чипом пира в поле (:1530-1549)', async() => {
    const { owner, inputSearch, searchContainer } = build()
    owner.initSearch().openWithPeerId(ALICE)
    await settle()

    expect(searchContainer.querySelector('.search-super')).not.toBeNull()
    expect(chips(inputSearch.container).map((el) => el.dataset.key)).toEqual(['' + ALICE])
    expect(inputSearch.container.classList.contains('is-picked')).toBe(true)
    expect(owner.searchSuper!.searchContext.peerId).toBe(ALICE)
  })

  it('cleanup снимает чипы и классы поля', async() => {
    const { inputSearch, backBtn, chatlistContainer } = build()
    const owner = owners[0]
    owner.initSearch().openWithPeerId(ALICE)
    await settle()

    simulateClickEvent(backBtn)
    animationEnd(chatlistContainer)
    expect(chips(inputSearch.container)).toEqual([])
    expect(inputSearch.container.classList.contains('is-picked')).toBe(false)
    expect(inputSearch.input.style.getPropertyValue('--paddingLeft')).toBe('')
  })
})

describe('недавние (:1383-1396, :1504-1519)', () => {
  it('mousedown по строке группы Chats пишет пира в recent и закрывает поиск', async() => {
    const { inputSearch, searchContainer, calls, searchActive } = build({ contacts: [ALICE] })
    focus(inputSearch)
    await settle()
    inputSearch.type('Алиса')
    await settle()

    const [row] = groupRows(group(searchContainer, 'search-group-contacts'))
    expect(+row.dataset.peerId!).toBe(ALICE)
    mousedown(row)

    expect(calls.pushRecent).toEqual([ALICE])
    // `onFound: close` (:1096)
    expect(last(searchActive)).toBe(false)
  })

  it('строка группы Recent в recent не пишется', async() => {
    useAppStateStore.setState({ recentSearch: ['' + BOB] })
    const { inputSearch, searchContainer, calls } = build()
    focus(inputSearch)
    await settle()

    const [row] = groupRows(group(searchContainer, 'search-group-recent'))
    expect(+row.dataset.peerId!).toBe(BOB)
    mousedown(row)
    expect(calls.pushRecent).toEqual([])
  })

  it('«clear» → подтверждение → clearRecentSearch → группа очищена; отмена ничего не трогает', async() => {
    useAppStateStore.setState({ recentSearch: ['' + BOB, '' + ALICE] })
    const { inputSearch, searchContainer, calls } = build()
    focus(inputSearch)
    await settle()

    const recent = group(searchContainer, 'search-group-recent')
    expect(recent.classList.contains('hide')).toBe(false)
    // правый слот заголовка — `ClearRecentSearch` (:1515)
    const trigger = [...recent.querySelectorAll<HTMLElement>('span.cursor-pointer')].find((el) => el.textContent === 'clear')!
    expect(trigger).toBeDefined()

    // отмена
    trigger.click()
    let popup = document.querySelector<HTMLElement>('.popup-confirmation')!
    expect(popup.querySelector('.popup-description')?.textContent).toBe('Are you sure you want to clear your search history?')
    const cancel = [...popup.querySelectorAll<HTMLElement>('.popup-button')].find((el) => !el.classList.contains('danger'))!
    cancel.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()
    expect(calls.clearRecent).toBe(0)
    expect(groupRows(recent)).toHaveLength(2)

    // подтверждение
    trigger.click()
    popup = last([...document.querySelectorAll<HTMLElement>('.popup-confirmation')])!
    popup.querySelector<HTMLElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await settle()
    expect(calls.clearRecent).toBe(1)
    expect(recent.classList.contains('hide')).toBe(true)
    expect(groupRows(recent)).toHaveLength(0)
  })
})

describe('навигация: Escape, Enter, Ctrl+F (:1312-1321, :1458-1467, index.ts:451-454)', () => {
  it('открытие кладёт запись global-search; Escape закрывает поиск', async() => {
    const { inputSearch, sidebarContent, searchActive } = build()
    focus(inputSearch)
    await settle()
    expect(appNavigationController.findItemByType('global-search')).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(appNavigationController.findItemByType('global-search')).toBeUndefined()
    expect(searchActive).toEqual([true, false])
    expect(sidebarContent.classList.contains('backwards')).toBe(true)
  })

  it('Enter со ссылкой: поле очищено, поиск закрыт, openUrl позван; Enter с текстом — ничего', async() => {
    const { inputSearch, searchActive, openedUrls } = build()
    focus(inputSearch)
    await settle()

    inputSearch.type('привет')
    inputSearch.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(openedUrls).toEqual([])
    expect(searchActive).toEqual([true])
    expect(inputSearch.value).toBe('привет')

    inputSearch.type('t.me/durov')
    inputSearch.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(openedUrls).toEqual(['t.me/durov'])
    expect(inputSearch.value).toBe('')
    expect(searchActive).toEqual([true, false])
  })

  it('Ctrl+F (tg-focus-search) открывает поиск и фокусирует поле; под попапом — нет', async() => {
    const { inputSearch, searchContainer, searchActive } = build()
    const popupItem = appNavigationController.pushItem({ type: 'popup', onPop: () => {} })
    window.dispatchEvent(new Event('tg-focus-search'))
    expect(searchContainer.childElementCount).toBe(0)
    appNavigationController.removeItem(popupItem)

    window.dispatchEvent(new Event('tg-focus-search'))
    await settle()
    expect(searchContainer.querySelector('.search-super')).not.toBeNull()
    expect(document.activeElement).toBe(inputSearch.input)
    expect(searchActive[0]).toBe(true)
  })
})

describe('вкладка «Каналы» видна, только если среди диалогов есть канал (:1556-1581)', () => {
  const channelsTab = (searchContainer: HTMLElement) =>
    [...nav(searchContainer).querySelectorAll<HTMLElement>('.menu-horizontal-div-item')].find((el) => el.textContent === 'Channels')!

  it('без каналов — hide; канал появился в зеркале диалогов — видна', async() => {
    useChatsStore.setState({ dialogs: [{ peerId: ALICE } as Dialog] })
    const { inputSearch, searchContainer } = build()
    focus(inputSearch)
    await settle()
    expect(channelsTab(searchContainer).classList.contains('hide')).toBe(true)

    useChatsStore.setState({ dialogs: [{ peerId: ALICE } as Dialog, { peerId: NEWS } as Dialog] })
    await settle()
    expect(channelsTab(searchContainer).classList.contains('hide')).toBe(false)
  })
})
