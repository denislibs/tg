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
import { createRef } from 'react'
import type { ComponentProps, ReactNode, RefObject } from 'react'

import { ManagersProvider } from '../core/hooks/useManagers'
import { useChatList } from '../core/hooks/useChatList'
import { useChatsStore } from '../stores/chatsStore'
import { useFoldersStore } from '../stores/foldersStore'
import { useNotifyStore } from '../stores/notifyStore'
import { useAppStateStore } from '../stores/appState'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../core/folderIds'
import itemStyles from './virtual/DeferredSortedVirtualList.module.scss'
import rowStyles from './ChatListItem.module.scss'
import type { Dialog } from '../core/models'
import type { DialogsPage } from '../core/managers/dialogsManager'
import type { Chat } from '../data'

// Три протокола, все — про НАСТОЯЩИЕ компоненты, без подмены их поведения.
//
// `rowRenders` — рендеры настоящей `ChatListItem`: считаются по `useTypingLabel`,
//   который строка зовёт ровно один раз за рендер и ровно с её `chatId`. Границей
//   мемоизации при этом остаётся `memo` самой строки, поэтому счётчик краснеет и
//   на снятом `memo` (ChatListItem.tsx), и на нестабильных пропсах из `ChatList`.
// `archiveRenders` — рендеры настоящей `ArchiveRow`: считаются по `useRipple`;
//   в тесте архива список пуст, поэтому кроме архива этот хук звать некому.
// `rowRefs` — какой `ref` приехал строке на каждом её рендере (для этого нужна
//   обёртка, но БЕЗ `memo`: решение «перерисовывать или нет» остаётся за самой
//   строкой, обёртка лишь протоколирует пропсы).
// `listRenderItems` — какая ссылка `renderItem` приехала в ядро списка.
const { rowRenders, archiveRenders, rowRefs, listRenderItems } = vi.hoisted(() => ({
  rowRenders: [] as number[],
  archiveRenders: { count: 0 },
  rowRefs: new Map<string, unknown[]>(),
  listRenderItems: [] as unknown[],
}))

vi.mock('../core/hooks/useTypingLabel', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../core/hooks/useTypingLabel')>()
  return {
    ...mod,
    useTypingLabel: (chatId: number, isGroup: boolean) => {
      rowRenders.push(chatId)
      return mod.useTypingLabel(chatId, isGroup)
    },
  }
})

vi.mock('../shared/ui/Ripple/useRipple', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../shared/ui/Ripple/useRipple')>()
  return {
    ...mod,
    useRipple: () => {
      archiveRenders.count++
      return mod.useRipple()
    },
  }
})

vi.mock('./ChatListItem', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./ChatListItem')>()
  const Real = mod.default
  const Probe = (props: ComponentProps<typeof Real>) => {
    const seen = rowRefs.get(props.chat.id) ?? []
    seen.push(props.ref)
    rowRefs.set(props.chat.id, seen)
    return <Real {...props} />
  }
  return { default: Probe }
})

vi.mock('./virtual/DeferredSortedVirtualList', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./virtual/DeferredSortedVirtualList')>()
  const Real = mod.default
  return {
    ...mod,
    default: (props: ComponentProps<typeof Real>) => {
      listRenderItems.push(props.renderItem)
      return <Real {...props} />
    },
  }
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
 * Запросы СТРАНИЦ ПАПКИ. Список, несущий строку «Архив», отдельно гидрирует её
 * саму (`getDialogs({filterId: ARCHIVE_FOLDER_ID})` в `ChatListFolder` — порт
 * `ensureArchiveDialogHydrated`, `autonomousDialogList/dialogs.ts:263-276`), и
 * этот запрос к пагинации папки отношения не имеет — свой пин у него ниже
 * («список «Всех чатов» гидрирует строку архива»).
 */
const folderPages = (getDialogs: { mock: { calls: [{ filterId: number }][] } }) =>
  getDialogs.mock.calls.filter(([o]) => o.filterId !== ARCHIVE_FOLDER_ID)

/** Обратное к `folderPages` — запросы страницы АРХИВНОЙ выборки. */
const archivePages = (getDialogs: { mock: { calls: [{ filterId: number }][] } }) =>
  getDialogs.mock.calls.filter(([o]) => o.filterId === ARCHIVE_FOLDER_ID)

/** Пропы харнесса: пропы списка + внешний ref (его Sidebar отдаёт ряду историй). */
type HarnessProps = Partial<ChatListProps> & { listRef?: RefObject<HTMLDivElement | null> }

/**
 * `chats` приезжают ChatList'у пропом — той же `useChatList`, что отдаёт Sidebar
 * (витрина зеркала ЦЕЛИКОМ: по папке список фильтрует себя сам).
 */
function Harness({ listRef, ...props }: HarnessProps) {
  const chats = useChatList()
  return (
    <ChatList
      ref={listRef}
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
async function renderList(managers: never, props: HarnessProps = {}) {
  const Wrapper = wrapper(managers)
  const view = render(<Wrapper><Harness {...props} /></Wrapper>)
  await act(async () => {})
  return {
    ...view,
    rerender: (next: HarnessProps = {}) =>
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
  archiveRenders.count = 0
  rowRefs.clear()
  listRenderItems.length = 0
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

    expect(folderPages(getDialogs)).toHaveLength(1)
    expect(getDialogs).toHaveBeenCalledWith(expect.objectContaining({ offsetIndex: undefined, filterId: ALL_FOLDER_ID }))
  })

  // Порт `AutonomousDialogList.ensureArchiveDialogHydrated`
  // (`autonomousDialogList/dialogs.ts:263-276` + `archiveDialog.tsx:27,124-137`):
  // список, который несёт строку «Архив», сам просит её страницу у владельца.
  // Без этого запроса строки не бывает вовсе — её гейт это архивные диалоги в
  // зеркале, а страницы «Всех чатов» уходят за своей выборкой (`folder_id=0`) и
  // архива не приносят никогда. Мутация: снять эффект в `ChatListFolder` —
  // запроса с `filterId: ARCHIVE_FOLDER_ID` не будет.
  it('список «Всех чатов» гидрирует строку архива страницей архивной выборки', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))

    await renderList(managers)

    expect(getDialogs).toHaveBeenCalledWith({ filterId: ARCHIVE_FOLDER_ID, limit: 10 })
  })

  // Ссылка `onOpenArchive` приезжает от Sidebar новой стрелкой на каждом его
  // рендере (в харнессе — тоже инлайновая). Мутация: положить сам колбэк в
  // зависимости эффекта вместо булева признака — гидратация уйдёт заново на
  // КАЖДЫЙ рендер списка.
  it('гидратация строки архива не повторяется на рендерах родителя', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))

    const { rerender } = await renderList(managers)
    await act(async () => { rerender({ selectedId: '2' }) })
    await act(async () => { rerender({ selectedId: '3' }) })

    expect(archivePages(getDialogs)).toHaveLength(1)
  })

  // Порт правила перезапроса (`archiveDialog.tsx:163-171`: архив в состоянии
  // строки сократился — просим страницу заново). У нас он пропадает из зеркала
  // штатно: `refresh()` читает окно ГЛОБАЛЬНОЙ выборки и применяет его полной
  // подменой (`dialogsManager.ts::setAll`), а старые архивные диалоги в это
  // окно не входят. Мутации: снять условие `!archiveEmpty` — краснеет первый
  // ассерт (запрос уйдёт при живом архиве); убрать `archiveEmpty` из
  // зависимостей — краснеет второй (пропавший архив не перезапросят).
  it('архив, пропавший из зеркала, гидрируется заново', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))
    const archived: Chat[] = [{ id: '900', name: 'Архивный', avatar: '', date: '', preview: '', type: 'private', unread: 0 }]

    const { rerender } = await renderList(managers, { archived })
    expect(archivePages(getDialogs)).toHaveLength(0) // архив в зеркале есть — просить нечего

    await act(async () => { rerender({ archived: [] }) })

    expect(archivePages(getDialogs)).toHaveLength(1)
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
    expect(folderPages(getDialogs)).toHaveLength(1)

    await act(async () => { rerender({ folder: 7, folderOrder: [ALL_FOLDER_ID, 7] }) })

    expect(folderPages(getDialogs)).toHaveLength(2)
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
  /** Сколько раз отрисовались НАСТОЯЩИЕ строки 7..14 (idx 6..13 — те, что остаются в окне). */
  const stayed = () => rowRenders.filter((id) => id >= 7 && id <= 14).length

  it('кадр скролла не перерисовывает строки, оставшиеся в окне', async () => {
    seedDialogs(500)
    const { managers } = fakeManagers(page({ count: 500 }))

    const { rerender } = await renderList(managers)

    expect(stayed()).toBe(8) // строки 7..14 отрисованы по разу

    await scrollTo(HOST_HEIGHT)

    expect(rows()[0].getAttribute('href')).toBe('#7') // окно действительно уехало
    expect(stayed()).toBe(8)
    // Въехавшие (15..24) — ровно по разу.
    expect(rowRenders.filter((id) => id >= 15 && id <= 24).length).toBe(10)

    // Ре-рендер родителя с НОВЫМИ инлайновыми обработчиками (то, что даёт Sidebar
    // на каждом своём рендере) строк тоже не касается. Мутация: убрать `useEvent`
    // вокруг `onSelect`/`onOpenArchive` — `renderItem` начнёт меняться вместе с
    // ними, и всё окно перерисуется.
    await act(async () => { rerender({}) })

    expect(stayed()).toBe(8)
  })

  // Сюда `useCallback` вокруг `renderItem` попадает напрямую: тест выше его не
  // видит, потому что пропсы строки стабильны сами по себе и её `memo` гасит
  // лишний рендер даже при меняющемся `renderItem`. А вот ядро списка получает
  // его пропом и по нему решает, перерисовывать ли ВСЁ окно.
  it('ядро списка получает ОДНУ И ТУ ЖЕ ссылку renderItem между рендерами', async () => {
    seedDialogs(20)
    const { managers } = fakeManagers(page({ count: 20 }))

    const { rerender } = await renderList(managers)
    await act(async () => { rerender({}) })

    // Мутация: снять `useCallback` — на каждом рендере ChatList в ядро приезжает
    // новая стрелка.
    expect(listRenderItems.length).toBeGreaterThan(1)
    expect(new Set(listRenderItems).size).toBe(1)
  })

  // Докблок `VirtualListItemProps.itemRef` (`virtual/VerticalVirtualList.tsx:73-80`)
  // требует вешать ref СТАБИЛЬНОЙ ссылкой: нестабильную React отцепляет и
  // прицепляет заново на каждом рендере, а переприкрепление — это повторная
  // синхронизация узла с текущим `top`, и анимация переезда молча исчезает.
  it('строке приезжает СТАБИЛЬНАЯ ссылка ref (а не инлайновая стрелка)', async () => {
    seedDialogs(20)
    const { managers } = fakeManagers(page({ count: 20 }))

    const { rerender } = await renderList(managers)
    // Меняем выделение — это ЕДИНСТВЕННОЕ, что заставляет строку отрисоваться
    // повторно с тем же `itemRef`.
    await act(async () => { rerender({ selectedId: '5' }) })

    const seen = rowRefs.get('3') ?? []
    // Мутация: `ref={(el) => itemRef(el)}` — ссылки перестанут совпадать.
    expect(seen.length).toBeGreaterThan(1)
    expect(new Set(seen).size).toBe(1)
  })

  it('ChatListItem — memo: смена выделения перерисовывает ТОЛЬКО задетые строки', async () => {
    seedDialogs(20)
    const { managers } = fakeManagers(page({ count: 20 }))

    const { rerender } = await renderList(managers)
    const before = rowRenders.length
    expect(before).toBe(14) // всё окно, по разу

    // `renderItem` меняется вместе с `selectedId` → ядро зовёт его для каждой
    // строки окна, но пропсы меняются только у выделенной. Мутация: снять `memo`
    // с `ChatListItem` — перерисуются все 14.
    await act(async () => { rerender({ selectedId: '5' }) })

    expect(rowRenders.slice(before)).toEqual([5])
  })

  it('ArchiveRow — memo: смена выделения закреплённый архив не перерисовывает', async () => {
    // Диалогов нет — `useRipple` в этом дереве зовёт только архив.
    const { managers } = fakeManagers(page({ count: 0 }))

    const { rerender } = await renderList(managers, {
      archived: [{ id: '900', name: 'Архивный', avatar: '', date: '', preview: '', type: 'private' }],
    })
    // Ждём, пока доиграет волна reveal: при пустом наборе `revealIdx` встаёт на
    // 0, закреплённый архив на кадр становится скелетоном и раскрывается
    // следующим шагом волны (штатное поведение оригинала — `revealIdx` про
    // закреплённые не знает). Без этой паузы базовый счётчик был бы гонкой.
    await flushScroll()
    const before = archiveRenders.count
    expect(list().children[0].textContent).toContain('Архивный')

    await act(async () => { rerender({ selectedId: '5' }) })

    // Мутация: снять `memo` с `ArchiveRow` — счётчик вырастет на единицу.
    expect(archiveRenders.count).toBe(before)
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
    // Именно контейнер ПРОКРУТКИ, а не `ul` (tweb: `sortedList.list.parentElement`).
    // Мутация: перевесить `attach` на `ul` — канвас уедет внутрь списка, где его
    // накроет высота `ul` и перекроют абсолютные строки.
    expect(canvas?.parentElement).toBe(scroller())

    seedDialogs(3)
    await act(async () => { rerender({ loaded: true }) })

    // Мутация: убрать вызов `detach` — канвас остаётся поверх списка навсегда.
    expect(document.querySelector('canvas.dialogs-placeholder-canvas')).toBe(null)
  })
})

// Task 8: на каждую папку свой скроллер и свой `ul` — порт tweb
// `autonomousDialogList/dialogs.ts:207-238` (`new Scrollable` на каждый фильтр).
describe('ChatList — свой скроллер и свой ul на каждую папку', () => {
  /** Папка, под правило которой подходят все диалоги теста (private, не контакты). */
  const WORK = {
    id: 7, title: 'Работа', pos: 0,
    contacts: false, nonContacts: true, groups: false, broadcasts: false,
    excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
  }
  const ORDER = [ALL_FOLDER_ID, WORK.id]

  const scrollers = () => Array.from(document.querySelectorAll<HTMLElement>('.folders-scrollable'))
  /** Кадр слайда помечен своим табом — как tweb метит скроллер папки `dataset.filterId`. */
  const scrollerOf = (folder: number) =>
    document.querySelector<HTMLElement>(`.folders-scrollable[data-tab="${folder}"]`) as HTMLElement
  const listIn = (host: HTMLElement) => host.querySelector<HTMLElement>('ul.chatlist') as HTMLElement
  const firstRowIn = (host: HTMLElement) =>
    listIn(host).querySelector<HTMLElement>('a.chatlist-chat') as HTMLElement

  /** Уходящий кадр снимает фолбэк-таймер слайда (TRANSITION_TIME + 100). */
  const flushSlide = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })

  async function renderTwoFolders(props: HarnessProps = {}) {
    seedDialogs(500)
    useAppStateStore.setState({ folders: [WORK], drafts: [] })
    const { managers, getDialogs } = fakeManagers(page({ count: 500 }))
    const view = await renderList(managers, { folderOrder: ORDER, ...props })
    return { ...view, getDialogs }
  }

  it('во время слайда в DOM оба списка, и каждый со своим scrollTop и своим окном', async () => {
    const { rerender } = await renderTwoFolders()
    await scrollTo(HOST_HEIGHT) // прокрутили «Все чаты»

    await act(async () => { rerender({ folder: WORK.id }) })

    // Мутация: убрать `keepMounted` у TabSlide — кадр «Всех» пересоздастся, и
    // прокрутка папки обнулится (ровно то, что раньше делали руками).
    expect(scrollers()).toHaveLength(2)
    expect(document.querySelectorAll('ul.chatlist')).toHaveLength(2)
    expect(scrollerOf(ALL_FOLDER_ID).scrollTop).toBe(HOST_HEIGHT)
    expect(scrollerOf(WORK.id).scrollTop).toBe(0)
    // Окно у каждого своё: прокрученная папка показывает строки с 7-й, новая — с 1-й.
    expect(firstRowIn(scrollerOf(ALL_FOLDER_ID)).getAttribute('href')).toBe('#7')
    expect(firstRowIn(scrollerOf(WORK.id)).getAttribute('href')).toBe('#1')

    // Устройство кадра — как у tweb-скроллера фильтра: `ul` и `.chatlist-bottom`
    // за ним (`scrollable.append(top, bottom)`), клиренс под compose-FAB.
    for (const host of scrollers()) {
      expect(host.lastElementChild?.classList.contains('chatlist-bottom')).toBe(true)
      expect(listIn(host).nextElementSibling).toBe(host.lastElementChild)
    }
  })

  it('возврат в папку восстанавливает её scrollTop и её окно', async () => {
    const { rerender } = await renderTwoFolders()
    await scrollTo(HOST_HEIGHT)
    const all = scrollerOf(ALL_FOLDER_ID)

    await act(async () => { rerender({ folder: WORK.id }) })
    await flushSlide()
    // Слайд доигран: ушедшая папка жива, но спрятана (`active` носит текущая).
    expect(scrollerOf(ALL_FOLDER_ID)).toBe(all)
    expect(all.classList.contains('active')).toBe(false)

    await act(async () => { rerender({ folder: ALL_FOLDER_ID }) })
    await flushSlide()

    expect(scrollerOf(ALL_FOLDER_ID)).toBe(all)
    expect(all.scrollTop).toBe(HOST_HEIGHT)
    expect(firstRowIn(all).getAttribute('href')).toBe('#7')
  })

  it('второй список не дёргает загрузку: страница просится по разу на папку', async () => {
    const { rerender, getDialogs } = await renderTwoFolders()
    expect(folderPages(getDialogs)).toHaveLength(1)

    await act(async () => { rerender({ folder: WORK.id }) })
    await flushSlide()

    // Ушедшая папка своей страницы не перезапрашивает — её курсор на месте.
    expect(folderPages(getDialogs)).toHaveLength(2)
    expect(getDialogs).toHaveBeenLastCalledWith(expect.objectContaining({ filterId: WORK.id }))

    await act(async () => { rerender({ folder: ALL_FOLDER_ID }) })
    await flushSlide()

    // Возврат на живой кадр — тоже не загрузка: первый показ у папки был один.
    expect(folderPages(getDialogs)).toHaveLength(2)
  })

  it('наружу отдаётся скроллер АКТИВНОЙ папки', async () => {
    const listRef = createRef<HTMLDivElement>()
    const { rerender } = await renderTwoFolders({ listRef })

    expect(listRef.current).toBe(scrollerOf(ALL_FOLDER_ID))

    await act(async () => { rerender({ folder: WORK.id }) })
    expect(listRef.current).toBe(scrollerOf(WORK.id))
    await flushSlide()

    // Возврат на УЖЕ ПОКАЗАННУЮ папку: её узел не пересоздаётся, ref-колбэков
    // нет — наружу её отдаёт layout-эффект. Мутация: снять эффект — снаружи
    // останется скроллер прошлой папки.
    await act(async () => { rerender({ folder: ALL_FOLDER_ID }) })
    expect(listRef.current).toBe(scrollerOf(ALL_FOLDER_ID))
    await flushSlide()

    // Папку удалили — её кадр уходит из DOM, но активный скроллер наружу
    // остаётся. Мутация: отдавать наружу узел из ref-колбэка кадра, а не
    // активную папку из карты — уход чужого кадра обнулит ref.
    await act(async () => { rerender({ folderOrder: [ALL_FOLDER_ID] }) })
    expect(scrollerOf(WORK.id)).toBe(null)
    expect(listRef.current).toBe(scrollerOf(ALL_FOLDER_ID))
  })

  it('размонтирование обнуляет внешний ref (не оставляет оторванный узел)', async () => {
    const listRef = createRef<HTMLDivElement>()
    const { unmount } = await renderTwoFolders({ listRef })
    expect(listRef.current).not.toBe(null)

    unmount()

    // Мутация: убрать cleanup у layout-эффекта публикации — снаружи останется
    // узел, которого больше нет в документе.
    expect(listRef.current).toBe(null)
  })

  // Достижимо в проде: `folder_update {deleted}` с другого устройства убирает
  // папку из `folderOrder`, а выбранной она остаётся до того, как это починит
  // владелец выбора (`foldersStore`). Кадр показанной папки обязан пережить
  // этот промежуточный рендер — иначе список чатов исчезает целиком.
  it('показанная папка ушла из folderOrder — её список всё равно на месте', async () => {
    const listRef = createRef<HTMLDivElement>()
    const { rerender } = await renderTwoFolders({ listRef })

    await act(async () => { rerender({ folder: WORK.id }) })
    await flushSlide()

    // Папку удалили на другом устройстве: её больше нет в списке табов.
    await act(async () => { rerender({ folder: WORK.id, folderOrder: [ALL_FOLDER_ID] }) })

    // Мутация: прополка `mounted` по `order` без оговорки `t !== tab` —
    // кадров ноль, `.folders-scrollable.active` нет, наружу уезжает null.
    expect(scrollerOf(WORK.id)).not.toBe(null)
    expect(document.querySelectorAll('.folders-scrollable.active')).toHaveLength(1)
    expect(listRef.current).toBe(scrollerOf(WORK.id))
    expect(firstRowIn(scrollerOf(WORK.id)).getAttribute('href')).toBe('#1')
  })
})
