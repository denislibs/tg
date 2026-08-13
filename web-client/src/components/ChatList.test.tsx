// Этап 3 (виртуальный список), Task 7: список чатов переехал на виртуальное ядро.
//
// Пины здесь про то, что даёт именно ЭТА проводка (само ядро покрыто
// `virtual/*.test.tsx`, источник — `core/hooks/useDialogListSource.test.tsx`):
// (1) в DOM живут только строки окна, а не весь список; (2) `ul` — это
// `chatlist virtual-chatlist` с высотой под весь набор; (3) архив — ПЕРВЫЙ
// элемент ВНУТРИ `ul`, а не узел над ним; (4) позиционирование строки навешивает
// список; (5) кадр скролла не перерисовывает строки, оставшиеся в окне;
// (6) свёрнутый режим и canvas-плейсхолдер переезд пережили.
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у контейнера прокрутки) подставляются стабом на прототипе —
// тот же приём, что в `virtual/VerticalVirtualList.test.tsx`, только узел
// создаёт сам `ChatList`, поэтому стаб общий, а не на конкретном элементе.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'

import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatList } from '../core/hooks/useChatList'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { ALL_FOLDER_ID } from '../core/folderIds'
import itemStyles from './virtual/DeferredSortedVirtualList.module.scss'
import rowStyles from './ChatListItem.module.scss'
import type { Dialog } from '../core/models'
import type { DialogsPage } from '../core/managers/dialogsManager'
import type { Chat } from '../data'

// Счётчик рендеров строки. Обёртка `memo` ВОКРУГ настоящей строки: DOM остаётся
// настоящим (классы/`top` проверяются на нём же), а граница мемоизации ровно та
// же, что у самой строки, — поэтому счётчик краснеет ровно тогда, когда ломается
// стабильность пропсов, приезжающих строке из `ChatList` (нестабильный
// `renderItem`/`onSelect` — и на каждом кадре скролла перерисовывается всё окно).
const { rowRenders } = vi.hoisted(() => ({ rowRenders: [] as string[] }))

vi.mock('./ChatListItem', async (importOriginal) => {
  const { memo } = await import('react')
  const mod = await importOriginal<typeof import('./ChatListItem')>()
  const Real = mod.default
  const Counting = (props: ComponentProps<typeof Real>) => {
    rowRenders.push(props.chat.id)
    return <Real {...props} />
  }
  return { default: memo(Counting) }
})

import ChatList, { type ChatListProps } from './ChatList'

const HOST_HEIGHT = 720
const ITEM = 72

const dialog = (chatId: number, over: Partial<Dialog> = {}): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false, ...over,
} as Dialog)

const page = (over: Partial<DialogsPage> = {}): DialogsPage =>
  ({ dialogs: [], count: 0, isEnd: true, ...over })

/** Кладём диалоги в зеркало ТЕМ ЖЕ путём, что проектор — операцией владельца. */
function seedMirror(items: { dialog: Dialog; index: number }[]) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items }])
}

function seedDialogs(count: number) {
  seedMirror(Array.from({ length: count }, (_, i) => ({ dialog: dialog(i + 1), index: count - i })))
}

function fakeManagers(response: DialogsPage | ((o: { filterId: number }) => DialogsPage)) {
  const getDialogs = vi.fn(async (o: { filterId: number }) =>
    typeof response === 'function' ? response(o) : response)
  return { managers: { dialogs: { getDialogs } } as never, getDialogs }
}

/**
 * `chats` приезжают ChatList'у пропом — той же `useChatList`, что отдаёт Sidebar
 * (витрина зеркала ЦЕЛИКОМ: по папке список фильтрует себя сам).
 */
function Harness(props: Partial<ChatListProps>) {
  const chats = useChatList()
  return (
    <ChatList
      chats={chats}
      selectedId=""
      // Инлайновые стрелки — НОВАЯ ссылка на каждом рендере родителя, ровно как
      // их отдаёт Sidebar; строки от этого перерисовываться не должны.
      onSelect={() => {}}
      onOpenArchive={() => {}}
      loaded
      folder={ALL_FOLDER_ID}
      folderOrder={[ALL_FOLDER_ID]}
      {...props}
    />
  )
}

function wrapper(managers: never) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers}>{children}</ManagersProvider>
  )
}

/** Рендер + доводка первой загрузки папки (её запускает сам ChatList). */
async function renderList(managers: never, props: Partial<ChatListProps> = {}) {
  const Wrapper = wrapper(managers)
  const view = render(<Wrapper><Harness {...props} /></Wrapper>)
  await act(async () => {})
  return {
    ...view,
    rerender: (next: Partial<ChatListProps> = {}) =>
      view.rerender(<Wrapper><Harness {...props} {...next} /></Wrapper>),
  }
}

const scroller = () => document.querySelector('.folders-scrollable') as HTMLElement
const list = () => document.querySelector('ul.chatlist') as HTMLElement
const rows = () => Array.from(list().querySelectorAll<HTMLElement>('a.chatlist-chat'))

/** Троттлинг измерения скролла в happy-dom уходит в `setTimeout(24)`. */
async function flushScroll() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function scrollTo(top: number) {
  const host = scroller()
  act(() => {
    host.scrollTop = top
    host.dispatchEvent(new Event('scroll'))
  })
  await flushScroll()
}

let sizeStubbed = false

beforeEach(() => {
  rowRenders.length = 0
  seedMirror([])
  useFoldersStore.setState({ contactIds: new Set() })
  useAppStateStore.setState({ folders: [], drafts: [] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })

  if (!sizeStubbed) {
    sizeStubbed = true
    // Высота есть только у контейнера прокрутки — из неё считается окно видимости.
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
  vi.restoreAllMocks()
})

describe('ChatList — окно видимости вместо всего списка', () => {
  it('500 диалогов: в DOM только строки окна (14 = экран 720/72 + overscan 4)', async () => {
    seedDialogs(500)
    const { managers } = fakeManagers(page({ count: 500 }))

    await renderList(managers)

    // idx * 72 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 72 <= 0 + 720 + 288 = 1008 → idx <= 13 (у idx=13 РОВНО 1008).
    expect(rows()).toHaveLength(14)
    expect(rows()[0].getAttribute('href')).toBe('#1')
    expect(rows()[13].getAttribute('href')).toBe('#14')
  })

  it('скролл двигает окно: в DOM въезжают следующие строки, уехавшие уходят', async () => {
    seedDialogs(500)
    const { managers } = fakeManagers(page({ count: 500 }))

    await renderList(managers)
    await scrollTo(HOST_HEIGHT)

    // Нижняя: idx * 72 >= 720 - 288 = 432 → idx >= 6; верхняя: idx <= 23.
    expect(rows()).toHaveLength(18)
    expect(rows()[0].getAttribute('href')).toBe('#7')
    expect(rows()[17].getAttribute('href')).toBe('#24')
  })
})

describe('ChatList — ul виртуального списка', () => {
  it('ul несёт chatlist + virtual-chatlist и высоту под ВЕСЬ набор (500 * 72 + 8)', async () => {
    seedDialogs(500)
    const { managers } = fakeManagers(page({ count: 500 }))

    await renderList(managers)

    expect(list().className).toBe('chatlist virtual-chatlist')
    expect(list().style.height).toBe(500 * ITEM + 8 + 'px')
  })

  it('первая загрузка папки уходит владельцу сама (onChatsScroll → requestItemForIdx(0))', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))

    await renderList(managers)

    expect(getDialogs).toHaveBeenCalledTimes(1)
    expect(getDialogs).toHaveBeenCalledWith(expect.objectContaining({ offsetIndex: undefined, filterId: ALL_FOLDER_ID }))
  })

  it('смена папки запускает первую загрузку НОВОЙ папки', async () => {
    seedDialogs(3)
    useAppStateStore.setState({
      folders: [{ id: 7, title: 'Папка', pos: 0, contacts: false, nonContacts: false, groups: false, broadcasts: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [] }],
      drafts: [],
    })
    // Папка 7 у владельца пуста — иначе её `count` породил бы «дырки», и каждая
    // из них попросила бы свою страницу сверх запроса самой смены папки.
    const { managers, getDialogs } = fakeManagers((o) => page({ count: o.filterId === ALL_FOLDER_ID ? 3 : 0 }))

    const { rerender } = await renderList(managers)
    expect(getDialogs).toHaveBeenCalledTimes(1)

    await act(async () => { rerender({ folder: 7, folderOrder: [ALL_FOLDER_ID, 7] }) })

    expect(getDialogs).toHaveBeenCalledTimes(2)
    expect(getDialogs).toHaveBeenLastCalledWith(expect.objectContaining({ filterId: 7 }))
  })
})

describe('ChatList — архив внутри списка', () => {
  const archived: Chat[] = [{ id: '900', name: 'Архивный', avatar: '', date: '', preview: '', type: 'private', unread: 3 }]

  it('архив — ПЕРВЫЙ элемент ul (top 0), первый чат уезжает на 72', async () => {
    seedDialogs(3)
    const { managers } = fakeManagers(page({ count: 3 }))

    await renderList(managers, { archived, onOpenArchive: () => {} })

    const first = list().children[0] as HTMLElement
    expect(first.textContent).toContain('Архивный')
    expect(first.style.top).toBe('0px')
    // ...и никакого узла архива НАД списком не осталось
    expect(scroller().textContent?.indexOf('Архивный')).toBe(list().textContent?.indexOf('Архивный'))
    expect(rows()[0].style.top).toBe(ITEM + 'px')
  })

  it('архив пуст — его нет, первый элемент ul это обычный чат', async () => {
    seedDialogs(3)
    const { managers } = fakeManagers(page({ count: 3 }))

    await renderList(managers, { archived: [], onOpenArchive: () => {} })

    expect(list().children[0]).toBe(rows()[0])
    expect(rows()[0].style.top).toBe('0px')
  })

  it('закреплённый архив увеличивает высоту ul на строку', async () => {
    seedDialogs(3)
    const { managers } = fakeManagers(page({ count: 3 }))

    await renderList(managers, { archived, onOpenArchive: () => {} })

    expect(list().style.height).toBe(4 * ITEM + 8 + 'px')
  })
})

describe('ChatList — позиционирование строки навешивает список', () => {
  it('каждая строка несёт класс .Item и инлайновый top, кратный 72', async () => {
    seedDialogs(20)
    const { managers } = fakeManagers(page({ count: 20 }))

    await renderList(managers)

    rows().forEach((row, i) => {
      expect(row.classList.contains(itemStyles.Item)).toBe(true)
      expect(row.style.top).toBe(i * ITEM + 'px')
    })
  })
})

describe('ChatList — мемоизация строки переезд пережила', () => {
  it('кадр скролла не перерисовывает строки, оставшиеся в окне', async () => {
    seedDialogs(500)
    const { managers } = fakeManagers(page({ count: 500 }))

    const { rerender } = await renderList(managers)

    const stayed = () => rowRenders.filter((id) => Number(id) >= 7 && Number(id) <= 14).length
    expect(stayed()).toBe(8) // строки 7..14 (idx 6..13) отрисованы по разу

    await scrollTo(HOST_HEIGHT)

    expect(rows()[0].getAttribute('href')).toBe('#7') // окно действительно уехало
    // Мутация: снять `useCallback` с `renderItem` — каждая из оставшихся в окне
    // строк отрендерится по второму разу.
    expect(stayed()).toBe(8)
    // Въехавшие (15..24) — ровно по разу.
    expect(rowRenders.filter((id) => Number(id) >= 15 && Number(id) <= 24).length).toBe(10)

    // Ре-рендер родителя с НОВЫМИ инлайновыми обработчиками (то, что даёт Sidebar
    // на каждом своём рендере) строк тоже не касается. Мутация: убрать `useEvent`
    // вокруг `onSelect`/`onOpenArchive` — `renderItem` начнёт меняться вместе с
    // ними, и всё окно перерисуется.
    await act(async () => { rerender({}) })

    expect(stayed()).toBe(8)
  })
})

describe('ChatList — свёрнутая колонка', () => {
  it('collapsed: разметка виртуального списка на месте, строки свёрнуты, архива нет', async () => {
    seedDialogs(20)
    const { managers } = fakeManagers(page({ count: 20 }))

    await renderList(managers, {
      collapsed: true,
      archived: [{ id: '900', name: 'Архивный', avatar: '', date: '', preview: '', type: 'private' }],
      onOpenArchive: () => {},
    })

    expect(list().className).toBe('chatlist virtual-chatlist')
    expect(list().style.height).toBe(20 * ITEM + 8 + 'px')
    expect(list().children[0]).toBe(rows()[0])
    expect(rows()[0].classList.contains(rowStyles.rowCollapsed)).toBe(true)
    expect(rows()[0].style.top).toBe('0px')
  })
})

describe('ChatList — canvas-плейсхолдер первой загрузки', () => {
  it('до loaded канвас висит на контейнере ПРОКРУТКИ, после — снят (detach)', async () => {
    const { managers } = fakeManagers(page())

    const { rerender } = await renderList(managers, { loaded: false })

    const canvas = scroller().querySelector('canvas.dialogs-placeholder-canvas')
    expect(canvas).not.toBe(null)

    seedDialogs(3)
    await act(async () => { rerender({ loaded: true }) })

    // Мутация: убрать вызов `detach` — канвас остаётся поверх списка навсегда.
    expect(document.querySelector('canvas.dialogs-placeholder-canvas')).toBe(null)
  })
})
