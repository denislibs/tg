// src/components/Sidebar.globalSearch.test.tsx
// ШОВ задачи 13 плана `docs/superpowers/plans/2026-09-07-solid-wave-3-global-search.md`:
// владелец глобального поиска (`components/sidebarLeft/globalSearch.ts`, порт
// tweb `initSearch`) встроен в ЖИВУЮ колонку через `core/hooks/useGlobalSearch.ts`.
// Здесь то, что видно только из колонки целиком:
// (1) `#search-container` постоянный и пустой, детей строит и сносит владелец;
// (2) классы перехода `zoom-fade` в обе стороны ставит владелец, и ре-рендер
//     колонки их не стирает (React пишет `className` целиком);
// (3) бургер — отражение владельца (`onSearchActive`), стрелка «назад» —
//     стабильный узел владельца, закрытие идёт только через него;
// (4) поле — объект tweb: `value = ''` владельца не возвращается ре-рендером,
//     `onChange` с debounce 300 мс;
// (5) Ctrl+F (`tg-focus-search`) и Escape — через владельца;
// (6) размонтирование колонки не оставляет ни узлов, ни подписок.
//
// Пины — на результат: узлы в DOM, классы на узлах, запросы до фейкового бэкенда.
import { type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import type { SearchHistoryOptions } from '../core/managers/messagesManager'
import { makeDialog } from '../core/dialogs/testDialog'
import { FakeResizeObserver } from '../lib/appDialogsManager.testkit'
import appNavigationController from '../core/navigation/appNavigationController'

vi.mock('./StoriesRow', () => ({ default: () => null }))
vi.mock('./LottieSticker', () => ({ default: () => null }))
// Утка пустой выдачи (`EmptySearchPlaceholder`) — lottie в воркере, которого в
// happy-dom нет; к шву не относится (пины заглушки — `emptySearchPlaceholder.solid.test.tsx`).
vi.mock('@lib/lottie/lottieLoader', () => ({ default: { loadAnimationAsAsset: () => new Promise(() => {}) } }))

const FOLDER = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: true, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

// Слой менеджеров — рекурсивный Proxy (приём `Sidebar.chatlist.test.tsx`);
// настоящий ответ — там, где его читают колонка, класс и владелец поиска.
function fakeManagers() {
  const history: SearchHistoryOptions[] = []
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return async () => ({ dialogs: [], count: 3, isEnd: true })
        if (ns === 'messages' && method === 'searchHistory') {
          return async (ctx: SearchHistoryOptions) => {
            history.push(ctx)
            return { messages: [], count: 0 }
          }
        }
        if (ns === 'contacts' && method === 'getContactsPeerIds') return async () => []
        if (ns === 'channels' && method === 'search') return async () => ({ _: 'contacts.found', my_results: [], results: [], chats: [], users: [] })
        if (ns === 'presence' && method === 'get') return async () => []
        return async () => undefined
      },
    }),
  }) as unknown as Managers
  return { managers, history }
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const searchContainer = () => $('#search-container')
const chatlistContainer = () => $('#chatlist-container')
const sidebarContent = () => $('.sidebar-content')
const itemMain = () => $('.item-main')
const input = () => $<HTMLInputElement>('.input-search-input')
const backBtn = () => $('.sidebar-back-button')
const classes = (el: Element) => [...el.classList].sort()

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/**
 * Конец CSS-анимаций `zoom-fade` (`transition.ts`, ветка `animationend`):
 * анимируются оба узла, `animationend` приходит каждому — по уходящему
 * слайдер снимает с него `active from`, по приходящему зовёт `onTransitionEnd`
 * (на закрытии — `cleanup()` владельца).
 */
async function finishTransition() {
  await act(async () => {
    for (const el of [chatlistContainer(), searchContainer()].filter((node) => node.classList.contains('from') || node.classList.contains('to'))) {
      el.dispatchEvent(new Event('animationend', { bubbles: true }))
    }
  })
}

async function focusSearch() {
  await act(async () => { input().dispatchEvent(new FocusEvent('focus')) })
  await settle()
}

async function clickBack() {
  await act(async () => { backBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

async function type(value: string) {
  await act(async () => {
    input().value = value
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Ре-рендер колонки, не связанный с поиском: замок в шапке по настройке код-пароля. */
async function rerenderColumn() {
  await act(async () => { useSettingsStore.setState({ passcodeEnabled: !useSettingsStore.getState().passcodeEnabled }) })
}

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: [1, 2, 3].map((peerId, i) => ({ dialog: makeDialog({ peerId }), index: 3 - i })),
  }])
  useChatsStore.setState({ loaded: true })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [FOLDER], recentSearch: [] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })
  useSettingsStore.setState({ tabsInSidebar: false, passcodeEnabled: false })
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  cleanup()
  appNavigationController.removeByType('global-search')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}) {
  const { managers, history } = fakeManagers()
  const view = render(
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} {...props} />
    </ManagersProvider>,
  )
  await settle()
  return { ...view, history }
}

describe('Sidebar — узлом #search-container владеет владелец поиска', () => {
  it('узел в DOM до фокуса и пуст; фокус — дети владельца (.search-super класса); закрытие — снова пуст, узел тот же', async () => {
    await renderSidebar()
    const node = searchContainer()
    // Мутация: вернуть условный рендер `{searching && <div id="search-container">}` —
    // до фокуса узла нет.
    expect(node).not.toBeNull()
    expect(node.childElementCount).toBe(0)

    await focusSearch()
    expect(searchContainer()).toBe(node)
    // Выдачу рисует класс `AppSearchSuper`, а не React-вкладки.
    expect(node.querySelector(':scope > .scrollable > .search-super')).not.toBeNull()
    expect(node.querySelectorAll('.search-super-tabs .menu-horizontal-div-item')).toHaveLength(7)

    await clickBack()
    await finishTransition()
    // DoD 5: владелец снял всё, что создал; узел — React, он на месте.
    expect(searchContainer()).toBe(node)
    expect(node.childElementCount).toBe(0)
  })
})

describe('Sidebar — переход zoom-fade в обе стороны ведёт владелец', () => {
  it('открытие: active+to у выдачи, active+from у чатлиста, animating у .sidebar-content; ре-рендер колонки их не стирает', async () => {
    await renderSidebar()
    await focusSearch()
    await rerenderColumn()

    expect(classes(searchContainer())).toEqual(['active', 'sidebar-search', 'to', 'transition-item'])
    // Мутация: вернуть `classList.toggle('active', !searching)` на чатлисте из
    // эффекта колонки — у уходящего узла пропадёт `active`, и
    // `_transition.scss:12` спрячет его до начала анимации.
    expect(chatlistContainer().classList.contains('active')).toBe(true)
    expect(chatlistContainer().classList.contains('from')).toBe(true)
    // `has-filters` владельца папок тоже переживает ре-рендер.
    expect(chatlistContainer().classList.contains('has-filters')).toBe(true)
    expect(sidebarContent().classList.contains('animating')).toBe(true)
    expect(sidebarContent().classList.contains('backwards')).toBe(false)
    // `is-search-active` — класс владельца (`onTransitionStart`, :1431).
    expect(itemMain().classList.contains('is-search-active')).toBe(true)

    await finishTransition()
    expect(chatlistContainer().classList.contains('active')).toBe(false)
    expect(sidebarContent().classList.contains('animating')).toBe(false)
  })

  it('закрытие: animating+backwards, чатлист приходит, классы сняты по animationend', async () => {
    await renderSidebar()
    await focusSearch()
    await finishTransition()

    await clickBack()
    await rerenderColumn()
    expect(sidebarContent().classList.contains('animating')).toBe(true)
    expect(sidebarContent().classList.contains('backwards')).toBe(true)
    expect(classes(chatlistContainer()).filter((c) => !c.startsWith('_'))).toEqual(['active', 'has-filters', 'to', 'transition-item'])
    expect(classes(searchContainer())).toEqual(['active', 'from', 'sidebar-search', 'transition-item'])
    expect(itemMain().classList.contains('is-search-active')).toBe(false)

    await finishTransition()
    expect(searchContainer().childElementCount).toBe(0)
    expect(sidebarContent().classList.contains('animating')).toBe(false)
    expect(sidebarContent().classList.contains('backwards')).toBe(false)
    // `cleanup()` снимает слушатель перехода вместе с `searchListenerSetter`
    // (:1418), поэтому `active from` с уходящей выдачи снимает страховочный
    // таймер слайдера (`transitionTime + 100`, `transition.ts`) — как у tweb.
    await settle(300)
    expect(classes(searchContainer())).toEqual(['sidebar-search', 'transition-item'])
    expect(classes(chatlistContainer()).filter((c) => !c.startsWith('_'))).toEqual(['active', 'has-filters', 'transition-item'])
  })
})

describe('Sidebar — бургер и стрелка «назад»', () => {
  it('state-back — от владельца: появляется на открытии, снимается на «назад»', async () => {
    await renderSidebar()
    const icon = $('.animated-menu-icon')
    expect(icon.classList.contains('state-back')).toBe(false)

    await focusSearch()
    expect(icon.classList.contains('state-back')).toBe(true)
    expect(backBtn().classList.contains('is-visible')).toBe(true)

    await clickBack()
    // Мутация: снять `onSearchActive` из шва — стрелка останется стрелкой.
    expect(icon.classList.contains('state-back')).toBe(false)
  })

  it('«назад» закрывает через владельца: запись навигации снята, переход backwards сыгран', async () => {
    await renderSidebar()
    await focusSearch()
    expect(appNavigationController.findItemByType('global-search')).toBeDefined()

    await clickBack()
    // Мутация: не отдать владельцу узел стрелки (`backBtnRef` у
    // `SidebarMenuButton`) — клик не дойдёт до владельца.
    expect(appNavigationController.findItemByType('global-search')).toBeUndefined()
    expect(sidebarContent().classList.contains('backwards')).toBe(true)
  })

  it('колонка папок показана: бургер в DOM и скрыт, стрелка — тот же узел; поиск открывается и закрывается', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    const main = document.createElement('div')
    main.id = 'main-columns'
    document.body.append(main)
    try {
      await renderSidebar()
      const burger = $('.left-sidebar-burger')
      const node = backBtn()
      // Мутация: вернуть условный рендер бургера `(!foldersSidebarShown || searching) &&` —
      // узла нет, владелец получил бы `null` вместо стрелки.
      expect(node).not.toBeNull()
      expect(burger.classList.contains('hide')).toBe(true)

      await focusSearch()
      expect(burger.classList.contains('hide')).toBe(false)
      expect(backBtn()).toBe(node)

      await clickBack()
      expect(sidebarContent().classList.contains('backwards')).toBe(true)
      await finishTransition()
      expect(searchContainer().childElementCount).toBe(0)
      expect(burger.classList.contains('hide')).toBe(true)
    } finally {
      main.remove()
    }
  })
})

describe('Sidebar — поиск и переключение папок', () => {
  it('клик по папке в вертикальной колонке при открытом поиске: поиск закрыт через владельца, папка выбрана', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    const main = document.createElement('div')
    main.id = 'main-columns'
    document.body.append(main)
    try {
      await renderSidebar()
      await focusSearch()
      await finishTransition()

      const item = document.querySelector<HTMLElement>(`#folders-sidebar .folders-sidebar__folder-item[data-filter-id="${FOLDER.id}"]`)!
      await act(async () => { fireEvent.click(item) })
      await settle()

      // `closeEverythingInsideNaturally` владельца папок (tweb `:505-516`) →
      // `closeSearch()` колонки → стрелка «назад» владельца поиска.
      // Мутация: снять `searchOwnerRef.current?.closeSearch()` из
      // `closeEverythingInside` — поиск останется открытым.
      expect(appNavigationController.findItemByType('global-search')).toBeUndefined()
      expect(sidebarContent().classList.contains('backwards')).toBe(true)
      await finishTransition()
      expect(searchContainer().childElementCount).toBe(0)
      expect(useFoldersStore.getState().selectedId).toBe(FOLDER.id)
    } finally {
      main.remove()
    }
  })
})

describe('Sidebar — поле поиска объектом tweb', () => {
  it('ввод уходит классу через 300 мс (debounce tweb inputSearch.ts:77), не раньше', async () => {
    const { history } = await renderSidebar()
    await focusSearch()
    const queried = () => history.filter((ctx) => ctx.query === 'durov').length

    await type('durov')
    await settle(150)
    // Мутация: звать `onChange` из `onInput` без таймера — запрос уже ушёл.
    expect(queried()).toBe(0)

    await settle(250)
    expect(queried()).toBeGreaterThan(0)
  })

  it('закрытие чистит поле (`cleanup`, :1407) — ре-рендер колонки значение не возвращает', async () => {
    await renderSidebar()
    await focusSearch()
    await type('durov')
    await settle(350)

    await clickBack()
    await finishTransition()
    await rerenderColumn()

    // Мутация: вернуть контролируемое поле `value={query}` — ре-рендер вернёт 'durov'.
    expect(input().value).toBe('')
    expect(input().classList.contains('is-empty')).toBe(true)
  })

  it('deep-open с префиллом: поиск открыт владельцем, значение в поле и в запросе класса', async () => {
    const { history } = await renderSidebar({ initialQuery: 'durov' })
    await settle()

    expect(searchContainer().classList.contains('active')).toBe(true)
    expect(input().value).toBe('durov')
    expect(history.some((ctx) => ctx.query === 'durov')).toBe(true)
    // стартовый показ «Всех чатов» владельцем папок поиск не закрыл
    expect(appNavigationController.findItemByType('global-search')).toBeDefined()
  })
})

describe('Sidebar — входы Ctrl+F и Escape', () => {
  it('tg-focus-search (Ctrl+F) открывает поиск владельцем и фокусирует поле', async () => {
    await renderSidebar()
    await act(async () => { window.dispatchEvent(new Event('tg-focus-search')) })
    await settle()

    expect(searchContainer().querySelector('.search-super')).not.toBeNull()
    expect(searchContainer().classList.contains('active')).toBe(true)
    expect(document.activeElement).toBe(input())
    expect($('.animated-menu-icon').classList.contains('state-back')).toBe(true)
  })

  it('Escape — запись навигации `global-search` закрывает поиск через владельца', async () => {
    await renderSidebar()
    await focusSearch()

    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })

    expect(appNavigationController.findItemByType('global-search')).toBeUndefined()
    expect(sidebarContent().classList.contains('backwards')).toBe(true)
    expect($('.animated-menu-icon').classList.contains('state-back')).toBe(false)
  })
})

describe('Sidebar — размонтирование колонки с открытым поиском', () => {
  it('ни узлов класса, ни записи навигации, ни подписки на Ctrl+F; консоль пуста', async () => {
    const error = vi.spyOn(console, 'error')
    const { unmount } = await renderSidebar()
    await focusSearch()
    expect(document.querySelector('.search-super')).not.toBeNull()

    unmount()

    expect(document.querySelector('.search-super')).toBeNull()
    expect(document.querySelector('.search-group')).toBeNull()
    // Мутация: не гасить владельца в teardown острова — запись навигации и
    // подписка окна переживут колонку.
    expect(appNavigationController.findItemByType('global-search')).toBeUndefined()
    await act(async () => { window.dispatchEvent(new Event('tg-focus-search')) })
    expect(document.querySelector('.search-super')).toBeNull()
    expect(error).not.toHaveBeenCalled()
  })
})
