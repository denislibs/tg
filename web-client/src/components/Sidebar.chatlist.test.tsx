// src/components/Sidebar.chatlist.test.tsx
// ШОВ задачи 6 плана папок (`docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md`):
// TS-владелец контейнеров папок `lib/appDialogsManager.ts` встроен в ЖИВОЙ
// сайдбар. Здесь то, что видно только из колонки целиком:
// (1) узлами папок владеет владелец, React кладёт в них только свои `ul`
//     (порталом в `.chatlist-top`) и не держит своих контейнеров;
// (2) переключение папки = список с начала (памяти `scrollTop` у папок в tweb
//     НЕТ, поправка 1 плана), страница просится на каждый показ, сети нет;
// (3) первая страница — ровно одна (late binding хэндла списка);
// (4) следы владельца на узлах React (`has-filters`, `--chatlist-overlay-height`)
//     переживают ре-рендер колонки;
// (5) размонтирование колонки не оставляет узлов и не пишет ошибок.
//
// Отдельный файл (как `Sidebar.connectionStatus.test.tsx`) — тяжёлое дерево
// Sidebar тянется только сюда.
import { StrictMode, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { applyFolderUpdate, useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { useSettingsStore } from '../settings'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Managers } from '../client/bootstrap'
import type { Dialog } from '../core/models'
import { makeDialog } from '../core/dialogs/testDialog'
import { FakeResizeObserver } from '../lib/appDialogsManager.testkit'
import useFolders from '../stores/folders.solid'
import lottieLoader from '../lib/lottie/lottieLoader'

// Ряд историй — внешний потребитель скроллера АКТИВНОЙ папки (`getScrollable`,
// порт `useCollapsable.ts:124`): протоколируем его пропы, остальное — настоящее.
const { storiesProps } = vi.hoisted(() => ({ storiesProps: { current: undefined as undefined | Record<string, unknown> } }))
vi.mock('./StoriesRow', () => ({
  default: (props: Record<string, unknown>) => {
    storiesProps.current = props
    return null
  },
}))

// Анимация в шапке редактора папки (его открывает меню папки) тянет `.tgs`
// через `fetch`, а `fetch` здесь — шпион «сети нет»; к предмету не относится.
vi.mock('./LottieSticker', () => ({ default: () => null }))

const HOST_HEIGHT = 720
const DIALOGS = 500

/** Папка, под правило которой подходят все наши приватные диалоги (non-contacts). */
const FOLDER = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: true, groups: false, broadcasts: false,
  bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

// Весь слой менеджеров — рекурсивный Proxy (приём `Sidebar.connectionStatus.test.tsx`);
// настоящий ответ нужен двум методам: пуллу автомата соединения и странице диалогов.
function fakeManagers() {
  const getDialogs = vi.fn(async (_o: { filterId: number }) => ({ dialogs: [], count: DIALOGS, isEnd: true }))
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => {
        if (ns === 'realtime' && method === 'getStatus') return async () => ({ state: 'ready', retryAt: undefined, syncing: false })
        if (ns === 'dialogs' && method === 'getDialogs') return getDialogs
        // ссылки папки — их список читает вкладка редактора (задача 24 плана 2D)
        if (ns === 'folders' && method === 'listInvites') return async () => []
        return async () => undefined
      },
    }),
  }) as unknown as Managers
  return { managers, getDialogs }
}

const dialog = (peerId: PeerId): Dialog => makeDialog({ peerId })

const frames = () => [...document.querySelectorAll<HTMLElement>('#folders-container > .folders-scrollable')]
const frameOf = (id: number) => document.querySelector<HTMLElement>(`#folders-container > .folders-scrollable[data-filter-id="${id}"]`)!
const activeFrame = () => document.querySelector<HTMLElement>('#folders-container > .folders-scrollable.active')!
const listIn = (frame: HTMLElement) => frame.querySelector<HTMLElement>(':scope > .chatlist-top > ul.chatlist')!
const firstRowIn = (frame: HTMLElement) => listIn(frame).querySelector<HTMLElement>('a.chatlist-chat')
const chatlistContainer = () => document.getElementById('chatlist-container')!
/** Узел, на котором владелец держит --chatlist-overlay-height (tweb bottomPart). */
const overlayHost = () => document.querySelector<HTMLElement>('.connection-status-bottom')!
/** Запросы страниц конкретной папки (строка «Архив» гидрируется отдельно). */
const pagesOf = (getDialogs: ReturnType<typeof fakeManagers>['getDialogs'], id: number) =>
  getDialogs.mock.calls.filter(([o]) => o.filterId === id && !('limit' in o && (o as { limit?: number }).limit === 10)).length

/** Доводка: троттлинг измерения скролла (24 мс) + фолбэк-таймер слайда (200+100). */
async function settle(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/**
 * Настоящий конец CSS-перехода: `transitionend` приходит обоим кадрам
 * (`_slider.scss:214-216`) — по уходящему слайдер снимает с него `active from`,
 * по приходящему зовёт `onTransitionEnd` полосы (уборка неактивных списков).
 */
async function finishTransition() {
  await act(async () => {
    for (const el of frames().filter((f) => f.classList.contains('from') || f.classList.contains('to'))) {
      el.dispatchEvent(new Event('transitionend', { bubbles: true }))
    }
  })
}

let sizeStubbed = false
const fetchSpy = vi.fn()

beforeEach(() => {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: Array.from({ length: DIALOGS }, (_, i) => ({ dialog: dialog(i + 1), index: DIALOGS - i })),
  }])
  useChatsStore.setState({ loaded: true })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useAppStateStore.setState({ folders: [FOLDER] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })
  useSettingsStore.setState({ tabsInSidebar: false })
  storiesProps.current = undefined
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()

  if (!sizeStubbed) {
    sizeStubbed = true
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('folders-scrollable') ? HOST_HEIGHT : 0 },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) { return this.classList.contains('folders-scrollable') ? 360 : 0 },
    })
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}, { strict = false } = {}) {
  const { managers, getDialogs } = fakeManagers()
  const tree = (
    <ManagersProvider managers={managers}>
      <Sidebar onToggleMode={() => {}} {...props} />
    </ManagersProvider>
  )
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await settle(0)
  return { ...view, getDialogs }
}

/** Клик по вкладке ряда папок — Solid-узел владельца, слушатель — `horizontalMenu`. */
async function clickTab(title: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('#folders-tabs .menu-horizontal-div-item')]
    .find((el) => el.textContent?.includes(title))!
  await act(async () => { fireEvent.click(tab) })
  await settle(0)
}

async function scrollActiveTo(top: number) {
  const host = activeFrame()
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await settle(60)
}

describe('Sidebar — узлами папок владеет владелец', () => {
  it('ul.chatlist каждой папки лежит в .chatlist-top её .folders-scrollable; ряд и оверлей — у владельца', async () => {
    await renderSidebar()

    // Мутация: вернуть React-обёртку `#folders-container` в Sidebar — владелец
    // положит свой второй, и `#folders-container > .folders-scrollable` найдёт
    // не всё (или удвоится).
    expect(document.querySelectorAll('#folders-container')).toHaveLength(1)
    expect(frames().map((f) => f.dataset.filterId)).toEqual(['0', '7'])
    for (const frame of frames()) {
      const ul = listIn(frame)
      expect(ul.className).toBe('chatlist virtual-chatlist')
      // `.chatlist-bottom` ровно один — узел владельца; своего список не рисует.
      expect(frame.querySelectorAll('.chatlist-bottom')).toHaveLength(1)
    }
    // Ряд — Solid-узлы владельца прямо в оверлее (дамп `14-left-01-chatlist.json:46-48`).
    const overlay = overlayHost().querySelector(':scope > .chatlist-overlay')!
    expect(overlay.querySelector(':scope > .folders-tabs-scrollable #folders-tabs')).not.toBe(null)
    expect(overlay.querySelector(':scope > .folders-tabs-gradient-container')).not.toBe(null)
    expect(document.querySelectorAll('.chatlist-overlay')).toHaveLength(1)
  })

  it('первая папка просит страницу РОВНО один раз, вторая — только при первом показе', async () => {
    const { getDialogs } = await renderSidebar()

    // Мутация: вернуть `useEffect(() => requestItemForIdx(0))` в ChatListFolder —
    // у «Всех чатов» станет две страницы, у «Работы» — одна без показа.
    expect(pagesOf(getDialogs, ALL_FOLDER_ID)).toBe(1)
    expect(pagesOf(getDialogs, FOLDER.id)).toBe(0)

    await clickTab('Работа')
    expect(pagesOf(getDialogs, FOLDER.id)).toBe(1)
  })
})

describe('Sidebar — переключение папки: список с начала', () => {
  it('клик по «Работа»: активен её кадр, по концу перехода ul «Всех» пуст, у «Работы» первая строка #1, сети нет', async () => {
    const { getDialogs } = await renderSidebar()
    await scrollActiveTo(HOST_HEIGHT)
    const all = frameOf(ALL_FOLDER_ID)
    expect(firstRowIn(all)!.getAttribute('href')).toBe('#7')

    await clickTab('Работа')
    // Во время перехода в DOM оба кадра: уходящий `from`, приходящий `active to`.
    expect(all.classList.contains('from')).toBe(true)
    expect(frameOf(FOLDER.id).classList.contains('to')).toBe(true)
    expect(document.querySelector('#folders-container')!.classList.contains('animating')).toBe(true)
    await finishTransition()

    expect(activeFrame()).toBe(frameOf(FOLDER.id))
    expect(useFoldersStore.getState().selectedId).toBe(FOLDER.id)
    // Мутация: не чистить неактивные в `onTransitionEnd` владельца — ul «Всех»
    // останется со строками окна.
    expect(listIn(all).children).toHaveLength(0)
    expect(firstRowIn(frameOf(FOLDER.id))!.getAttribute('href')).toBe('#1')
    expect(frameOf(FOLDER.id).scrollTop).toBe(0)
    expect(pagesOf(getDialogs, FOLDER.id)).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('возврат на «Все чаты» — первая страница заново и строки с #1', async () => {
    const { getDialogs } = await renderSidebar()
    await scrollActiveTo(HOST_HEIGHT)
    const all = frameOf(ALL_FOLDER_ID)

    await clickTab('Работа')
    await finishTransition()
    // Браузер: у неактивного кадра `display: none` — позиция обнулена без `scroll`.
    all.scrollTop = 0

    await clickTab('All')
    await finishTransition()

    expect(activeFrame()).toBe(all)
    expect(pagesOf(getDialogs, ALL_FOLDER_ID)).toBe(2)
    expect(firstRowIn(all)!.getAttribute('href')).toBe('#1')
    expect(listIn(frameOf(FOLDER.id)).children).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('ряду историй отдаётся скроллер АКТИВНОЙ папки (xd владельца)', async () => {
    await renderSidebar()
    const getScrollable = storiesProps.current!.getScrollable as () => HTMLElement | null

    expect(getScrollable()).toBe(frameOf(ALL_FOLDER_ID))

    await clickTab('Работа')
    await finishTransition()

    expect(getScrollable()).toBe(frameOf(FOLDER.id))
  })

  // Писатель выбора один — владелец (`foldersStore.deselectIfRemoved` снят).
  it('удалили АКТИВНУЮ папку с другого устройства — её кадр снят, показаны «Все чаты»', async () => {
    await renderSidebar()
    await clickTab('Работа')
    await finishTransition()

    await act(async () => { applyFolderUpdate({ folder_id: FOLDER.id, deleted: true }) })
    await settle(0)

    expect(frames().map((f) => f.dataset.filterId)).toEqual(['0'])
    expect(activeFrame()).toBe(frameOf(ALL_FOLDER_ID))
    expect(useFoldersStore.getState().selectedId).toBe(ALL_FOLDER_ID)
  })

  it('клик по папке в вертикальной колонке идёт через тот же selectTab владельца', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    const main = document.createElement('div')
    main.id = 'main-columns'
    document.body.append(main)
    try {
      await renderSidebar()

      const item = [...document.querySelectorAll<HTMLElement>('#folders-sidebar *')]
        .find((el) => el.children.length === 0 && el.textContent === 'Работа')!
      await act(async () => { fireEvent.click(item) })
      await settle(0)
      await finishTransition()

      // Мутация: вернуть колонке `useFoldersStore.select` вместо `onClick()` —
      // выбор в сторе сменится, а активный кадр владельца останется «Всех».
      expect(activeFrame()).toBe(frameOf(FOLDER.id))
      expect(useFoldersStore.getState().selectedId).toBe(FOLDER.id)
    } finally {
      main.remove()
    }
  })
})

// Меню папки (задача 7 плана): одна фабрика `createFolderContextMenu` на оба
// ряда, `appSidebarLeft` колонки — один объект на обоих. Здесь — что колонка
// его ДАЛА обоим и что он открывает её экран (пункты и `verify` запинены в
// `helpers/dom/createFolderContextMenu.test.ts`).
describe('Sidebar — меню папки на обоих рядах', () => {
  // Заставка редактора: загрузку лотти (`fetch` ассета) тест не ведёт — отказ, и
  // вкладка ставит статичный кадр, как без WASM SIMD.
  beforeEach(() => {
    vi.spyOn(lottieLoader, 'loadAnimationFromURLManually').mockRejectedValue(new Error('NO_WASM'))
  })

  // Редактор — вкладка `AppEditFolderTab` поверх колонки (задача 24 плана 2D):
  // имя папки — в поле вкладки `.edit-folder-container`.
  const editorWith = (title: string) =>
    [...document.querySelectorAll<HTMLElement>('.edit-folder-container .input-field-input')].find((el) => el.textContent === title)

  async function editVia(target: HTMLElement) {
    await act(async () => {
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    await settle(0)
    const item = [...document.querySelectorAll<HTMLElement>('.btn-menu.contextmenu.active .btn-menu-item')]
      .find((el) => el.textContent?.includes('Edit folder'))!
    await act(async () => { item.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await settle(0)
  }

  it('горизонтальный ряд: «Edit folder» на вкладке «Работа» открывает её редактор', async () => {
    await renderSidebar()
    expect(editorWith('Работа')).toBeUndefined()

    const tab = [...document.querySelectorAll<HTMLElement>('#folders-tabs .menu-horizontal-div-item')]
      .find((el) => el.textContent?.includes('Работа'))!
    await editVia(tab)

    await vi.waitFor(() => expect(editorWith('Работа')).toBeDefined(), { timeout: 5000 })
  })

  it('редактор — вкладка поверх списка: колонка has-open-tabs, «назад» возвращает к чатам', async () => {
    await renderSidebar()
    const column = document.getElementById('column-left')!
    const tab = [...document.querySelectorAll<HTMLElement>('#folders-tabs .menu-horizontal-div-item')]
      .find((el) => el.textContent?.includes('Работа'))!
    await editVia(tab)
    await vi.waitFor(() => expect(editorWith('Работа')).toBeDefined(), { timeout: 5000 })
    expect(column.classList.contains('has-open-tabs')).toBe(true)

    const editor = document.querySelector<HTMLElement>('.edit-folder-container')!
    await act(async () => { editor.querySelector<HTMLElement>('.sidebar-close-button')!.click() })
    await act(async () => { await settle(400) })

    expect(document.querySelector('.edit-folder-container')).toBeNull()
    expect(column.classList.contains('has-open-tabs')).toBe(false)
  })

  it('вертикальная колонка: «Edit folder» на строке «Работа» открывает её редактор', async () => {
    useSettingsStore.setState({ tabsInSidebar: true })
    const main = document.createElement('div')
    main.id = 'main-columns'
    document.body.append(main)
    try {
      await renderSidebar()
      await editVia(document.querySelector<HTMLElement>(`#folders-sidebar .folders-sidebar__folder-item[data-filter-id="${FOLDER.id}"]`)!)

      await vi.waitFor(() => expect(editorWith('Работа')).toBeDefined(), { timeout: 5000 })
    } finally {
      main.remove()
    }
  })
})

describe('Sidebar — следы владельца на узлах React', () => {
  it('has-filters на #chatlist-container переживает ре-рендер колонки (поиск открыли и закрыли)', async () => {
    await renderSidebar()
    expect(chatlistContainer().classList.contains('has-filters')).toBe(true)
    expect(chatlistContainer().classList.contains('active')).toBe(true)

    await act(async () => { fireEvent.focus(screen.getByRole('textbox')) })
    // Поиск открыт: переход владельца поиска увёл чатлист в `from` (классы
    // перехода и их пины — `Sidebar.globalSearch.test.tsx`), `has-filters` на месте.
    expect(chatlistContainer().classList.contains('from')).toBe(true)
    expect(chatlistContainer().classList.contains('has-filters')).toBe(true)

    await act(async () => { fireEvent.click(document.querySelector('.sidebar-back-button')!) })
    expect(chatlistContainer().classList.contains('active')).toBe(true)
    // Мутация: вернуть `active` в `className` React — первый же ре-рендер с
    // новым `className` сотрёт `has-filters`, поставленный владельцем.
    expect(chatlistContainer().classList.contains('has-filters')).toBe(true)
  })

  it('--chatlist-overlay-height ставит владелец на .connection-status-bottom, ре-рендер его не стирает', async () => {
    await renderSidebar()
    const observer = FakeResizeObserver.instances.find((o) => o.observed[0]?.classList.contains('chatlist-overlay'))!
    act(() => observer.fire(104))
    expect(overlayHost().style.getPropertyValue('--chatlist-overlay-height')).toBe('104px')

    await act(async () => { fireEvent.focus(screen.getByRole('textbox')) })

    // Мутация: вернуть `style={overlayHeightVar}` на хост — React перепишет
    // переменную своим значением (0px) на первом же ре-рендере.
    expect(overlayHost().style.getPropertyValue('--chatlist-overlay-height')).toBe('104px')
    for (const frame of frames()) expect(overlayHost().contains(frame)).toBe(true)
  })

  it('deep-open с префиллом поиска: стартовый показ «Всех чатов» поиск не закрывает', async () => {
    await renderSidebar({ initialQuery: 'durov' })

    // Поиск открыт владельцем поиска и не закрыт первым `onClick(0, false)`
    // владельца папок: выдача — приходящий узел перехода, стрелки «назад» не
    // нажимали (обратного перехода нет).
    expect(document.getElementById('search-container')!.classList.contains('active')).toBe(true)
    expect(document.querySelector('.sidebar-content')!.classList.contains('backwards')).toBe(false)
  })
})

describe('Sidebar — размонтирование колонки', () => {
  it('в документе не остаётся ни узлов владельца, ни ul списков; консоль пуста', async () => {
    const error = vi.spyOn(console, 'error')
    const { unmount } = await renderSidebar()
    expect(frames()).toHaveLength(2)

    unmount()

    expect(document.querySelector('.chatlist-overlay')).toBe(null)
    expect(document.querySelector('#folders-container')).toBe(null)
    expect(document.querySelector('.folders-scrollable')).toBe(null)
    expect(document.querySelector('ul.chatlist')).toBe(null)
    // Узлы уехали бы и вместе с хостом React; снят ли САМ владелец, видно по
    // его следам вне колонки. Мутация: не гасить владельца в teardown острова —
    // `onClick()` проекции останется его `selectTab` над снятыми узлами.
    expect(useFolders().onClick()).toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  it('StrictMode (start → destroy → start): один комплект узлов, «Все чаты» с первой страницей', async () => {
    const error = vi.spyOn(console, 'error')
    const { getDialogs, unmount } = await renderSidebar({}, { strict: true })

    expect(document.querySelectorAll('.chatlist-overlay')).toHaveLength(1)
    expect(document.querySelectorAll('#folders-container')).toHaveLength(1)
    expect(frames().map((f) => f.dataset.filterId)).toEqual(['0', '7'])
    expect(activeFrame()).toBe(frameOf(ALL_FOLDER_ID))
    expect(pagesOf(getDialogs, ALL_FOLDER_ID)).toBeGreaterThanOrEqual(1)
    expect(firstRowIn(frameOf(ALL_FOLDER_ID))!.getAttribute('href')).toBe('#1')

    unmount()
    expect(document.querySelector('.folders-scrollable')).toBe(null)
    expect(error).not.toHaveBeenCalled()
  })
})
