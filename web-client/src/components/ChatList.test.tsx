// Этап 3 (виртуальный список), Task 7: список чатов переехал на виртуальное ядро;
// задача 6 плана папок: контейнеры папок — у владельца `lib/appDialogsManager.ts`,
// ChatList порталом кладёт в них свои `ul`.
//
// Пины здесь про то, что даёт именно ЭТА проводка (само ядро покрыто
// `virtual/*.test.tsx`, источник — `core/hooks/useDialogListSource.test.tsx`,
// владелец — `lib/appDialogsManager.*.test.ts`):
// (1) в DOM живут только строки окна, а не весь список; (2) `ul` — это
// `chatlist virtual-chatlist` с высотой под весь набор; (3) архив — ПЕРВЫЙ
// элемент ВНУТРИ `ul`, а не узел над ним; (4) позиционирование строки навешивает
// список; (5) кадр скролла не перерисовывает строки, оставшиеся в окне;
// (6) свёрнутый режим и canvas-плейсхолдер переезд пережили; (7) список папки
// живёт в `.chatlist-top` контейнера владельца и отвечает на его хэндл.
//
// happy-dom не считает layout: `offsetHeight`/`offsetWidth` (их читает
// `useElementSize` у контейнера прокрутки) подставляются стабом на прототипе —
// тот же приём, что в `virtual/VerticalVirtualList.test.tsx`, только узел
// создаёт владелец, поэтому стаб общий, а не на конкретном элементе.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, ReactNode } from 'react'

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
import useFolders from '../stores/folders.solid'
import { finishTransition, frameOf, mountOwner, stubGeometry, type Mounted } from '../lib/appDialogsManager.testkit'

// Три протокола, все — про НАСТОЯЩИЕ компоненты, без подмены их поведения.
//
// `rowRenders` — рендеры настоящей `ChatListItem`: считаются по `useTypingLabel`,
//   который строка зовёт ровно один раз за рендер и ровно с её `chatId`. Границей
//   мемоизации при этом остаётся `memo` самой строки, поэтому счётчик краснеет и
//   на снятом `memo` (ChatListItem.tsx), и на нестабильных пропсах из `ChatList`.
// `archiveRenders` — рендеры настоящей `ArchiveRow`: считаются по чтению
//   `s.row` из её CSS-модуля — ровно одно на рендер, и больше этот модуль
//   никто не читает. (Прежде счёт шёл по `useRipple`, но риппла у строки
//   архива больше нет — tweb e934b9039.)
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

vi.mock('./ArchiveRow.module.scss', async (importOriginal) => {
  const mod = await importOriginal<{ default: Record<string, string> }>()
  return {
    default: new Proxy(mod.default, {
      get(target, key: string) {
        if (key === 'row') archiveRenders.count++
        return target[key]
      },
    }),
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

const dialog = (peerId: PeerId, over: Partial<Dialog> = {}): Dialog => ({
  peerId, type: 'private', title: 't' + peerId, unread: 0, unreadMentions: 0, unreadReactions: 0,
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
  // `peers.fillMirror` — объявление пробела зеркала пиров: строка списка берёт
  // из него имя и аватарку (они уехали из диалога в карточку). Здесь пробел
  // объявлять нечем, важно лишь не уронить хук.
  return { managers: { dialogs: { getDialogs }, peers: { fillMirror: vi.fn(async () => {}) } } as never, getDialogs }
}

/**
 * Запросы СТРАНИЦ ПАПКИ. Список, несущий строку «Архив», отдельно гидрирует её
 * саму (`getDialogs({filterId: ARCHIVE_FOLDER_ID})` из
 * `useDialogListSource::ensureArchiveHydrated` — порт
 * `ensureArchiveDialogHydrated`, `autonomousDialogList/dialogs.ts:263-276`), и
 * этот запрос к пагинации папки отношения не имеет — свой пин у него ниже
 * («список «Всех чатов» гидрирует строку архива»), а правила запроса и ретрая —
 * в `core/hooks/useDialogListSource.test.tsx`.
 */
const folderPages = (getDialogs: { mock: { calls: [{ filterId: number }][] } }) =>
  getDialogs.mock.calls.filter(([o]) => o.filterId !== ARCHIVE_FOLDER_ID)

type HarnessProps = Partial<Omit<ChatListProps, 'manager'>>

/**
 * Владелец контейнеров папок — настоящий (`AppDialogsManager`), поднят ДО
 * рендера на колонке-дублёре (`mountOwner`), как его поднимает Sidebar в
 * layout-фазе. Его первый `onClick(0, false)` доигрывает микрозадачей — к этому
 * моменту списки уже отрисованы и зарегистрированы.
 */
let owner: Mounted | undefined

/**
 * `chats` приезжают ChatList'у пропом — той же `useChatList`, что отдаёт Sidebar
 * (витрина зеркала ЦЕЛИКОМ: по папке список фильтрует себя сам).
 */
function Harness(props: HarnessProps) {
  const chats = useChatList()
  return (
    <ChatList
      manager={owner!.manager}
      chats={chats}
      selectedId=""
      // Инлайновые стрелки — НОВАЯ ссылка на каждом рендере родителя, ровно как
      // их отдаёт Sidebar; строки от этого перерисовываться не должны.
      onSelect={() => {}}
      onOpenArchive={() => {}}
      loaded
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
  owner = mountOwner()
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
  useAppStateStore.setState({ folders: [] })
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
  owner?.manager.destroy()
  owner = undefined
  document.body.replaceChildren()
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

  // Первую страницу просит ТОЛЬКО владелец (`onTabChange` → `onChatsScroll` →
  // `requestItemForIdx(0)`, `base.ts:144-146`); хэндл списка регистрируется
  // позже его первого запроса, и `FolderList` держит тот отложенным.
  it('первая страница папки уходит РОВНО один раз — по onChatsScroll владельца', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))

    await renderList(managers)

    // Мутация: вернуть в ChatListFolder `useEffect(() => requestItemForIdx(0))`
    // — страниц станет две (своя на монтировании + владельца).
    expect(folderPages(getDialogs)).toHaveLength(1)
    expect(getDialogs).toHaveBeenCalledWith(expect.objectContaining({ offsetIndex: undefined, filterId: ALL_FOLDER_ID }))
  })

  // Проводка строки «Архив» в сборе: список «Всех чатов» просит её страницу у
  // владельца (порт `ensureArchiveDialogHydrated`; правила запроса и ретрая —
  // у самого источника, `core/hooks/useDialogListSource.test.tsx`). Мутация:
  // снять вызов `ensureArchiveHydrated` в `fetchPage` — запроса с
  // `filterId: ARCHIVE_FOLDER_ID` не будет.
  it('список «Всех чатов» гидрирует строку архива страницей архивной выборки', async () => {
    seedDialogs(3)
    const { managers, getDialogs } = fakeManagers(page({ count: 3 }))

    await renderList(managers)

    expect(getDialogs).toHaveBeenCalledWith({ filterId: ARCHIVE_FOLDER_ID, limit: 10 })
  })

  it('папка, которую ещё не показывали, страницу не просит; показ — первая загрузка', async () => {
    seedDialogs(3)
    useAppStateStore.setState({
      folders: [{ id: 7, title: 'Папка', pos: 0, contacts: false, nonContacts: false, groups: false, broadcasts: false, bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [] }],
    })
    // Папка 7 у владельца пуста — иначе её `count` породил бы «дырки», и каждая
    // из них попросила бы свою страницу сверх запроса самой смены папки.
    const { managers, getDialogs } = fakeManagers((o) => page({ count: o.filterId === ALL_FOLDER_ID ? 3 : 0 }))

    await renderList(managers)
    expect(folderPages(getDialogs)).toHaveLength(1)
    expect(document.querySelectorAll('ul.chatlist')).toHaveLength(2)

    await act(async () => { useFolders().onClick()!(1) })

    expect(folderPages(getDialogs)).toHaveLength(2)
    expect(getDialogs).toHaveBeenLastCalledWith(expect.objectContaining({ filterId: 7 }))
  })
})

describe('ChatList — архив внутри списка', () => {
  const archived: Chat[] = [{ id: '900', name: 'Архивный', avatar: '', preview: '', type: 'private', unread: 3 }]

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
    // Диалогов нет — архив в этом дереве единственный.
    const { managers } = fakeManagers(page({ count: 0 }))

    const { rerender } = await renderList(managers, {
      archived: [{ id: '900', name: 'Архивный', avatar: '', preview: '', type: 'private' }],
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
      archived: [{ id: '900', name: 'Архивный', avatar: '', preview: '', type: 'private' }],
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

// Task 8 → задача 6 плана папок: на каждую папку свой скроллер (у владельца) и
// свой `ul` (у ChatList) — порт tweb `autonomousDialogList/dialogs.ts:207-238`
// + `appDialogsManager.addFilter` (`:1249-1290`). Памяти `scrollTop` у папок в
// tweb НЕТ (поправка 1 плана): переключение = список с начала.
describe('ChatList — свой ul на каждую папку в контейнере владельца', () => {
  /** Папка, под правило которой подходят все диалоги теста (private, не контакты). */
  const WORK = {
    id: 7, title: 'Работа', pos: 0,
    contacts: false, nonContacts: true, groups: false, broadcasts: false,
    bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
  }

  const listIn = (host: HTMLElement) => host.querySelector<HTMLElement>('ul.chatlist') as HTMLElement
  const rowsIn = (host: HTMLElement) => Array.from(listIn(host).querySelectorAll<HTMLElement>('a.chatlist-chat'))

  async function renderTwoFolders(props: HarnessProps = {}) {
    seedDialogs(500)
    useAppStateStore.setState({ folders: [WORK] })
    const { managers, getDialogs } = fakeManagers(page({ count: 500 }))
    const view = await renderList(managers, props)
    const folders = owner!.folders
    stubGeometry(folders)
    return { ...view, getDialogs, folders }
  }

  /** Клик по вкладке — `onClick()` стора, та же `selectTab`, что у полосы и колонки. */
  async function show(index: number, folders: HTMLElement) {
    await act(async () => { useFolders().onClick()!(index) })
    await act(async () => { finishTransition(folders) })
  }

  it('ul папки лежит в .chatlist-top её .folders-scrollable — узле владельца, а не React', async () => {
    const { folders } = await renderTwoFolders()

    for (const id of [ALL_FOLDER_ID, WORK.id]) {
      const frame = frameOf(folders, id)
      const ul = listIn(frame)
      expect(ul.parentElement!.classList.contains('chatlist-top')).toBe(true)
      expect(ul.parentElement!.parentElement).toBe(frame)
      // Своего `.chatlist-bottom` список не рисует — узел владельца один.
      expect(frame.querySelectorAll('.chatlist-bottom')).toHaveLength(1)
    }
  })

  it('по концу перехода у ушедшей папки ul пуст, у открытой — строки с начала', async () => {
    const { folders } = await renderTwoFolders()
    await scrollTo(HOST_HEIGHT) // прокрутили «Все чаты»

    await act(async () => { useFolders().onClick()!(1) })
    // Во время перехода в DOM оба кадра (`from` и `to`).
    expect(frameOf(folders, ALL_FOLDER_ID).classList.contains('from')).toBe(true)
    expect(frameOf(folders, WORK.id).classList.contains('to')).toBe(true)
    await act(async () => { finishTransition(folders) })

    // Мутация: `clear` хэндла без `source.clear()` — ul ушедшей папки остаётся
    // с 18 строками окна.
    expect(listIn(frameOf(folders, ALL_FOLDER_ID)).children).toHaveLength(0)
    expect(rowsIn(frameOf(folders, WORK.id))[0].getAttribute('href')).toBe('#1')
  })

  it('возврат в папку — снова с первой строки, даже если список слышал прокрутку до ухода', async () => {
    const { folders } = await renderTwoFolders()
    await scrollTo(HOST_HEIGHT)
    const all = frameOf(folders, ALL_FOLDER_ID)
    expect(rowsIn(all)[0].getAttribute('href')).toBe('#7')

    await show(1, folders)
    // Браузер: у неактивного кадра `.tabs-tab { display: none }`, бокса нет —
    // позиция скроллера обнулена, и события `scroll` при этом НЕ приходит.
    all.scrollTop = 0

    await show(0, folders)

    // Мутация: снять `key={showId}` у списка — окно останется посчитанным от
    // услышанной до ухода прокрутки (720): первая строка #7 при scrollTop 0.
    expect(all.scrollTop).toBe(0)
    expect(rowsIn(all)[0].getAttribute('href')).toBe('#1')
    expect(rowsIn(all)).toHaveLength(14)
  })

  it('страница просится на КАЖДЫЙ показ папки (из кэша владельца, без сети)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { getDialogs, folders } = await renderTwoFolders()
    const pagesOf = (id: number) => folderPages(getDialogs).filter(([o]) => o.filterId === id).length
    expect(pagesOf(ALL_FOLDER_ID)).toBe(1)
    expect(pagesOf(WORK.id)).toBe(0)

    await show(1, folders)
    expect(pagesOf(WORK.id)).toBe(1)

    await show(0, folders)
    // Возврат — снова первая страница (у tweb `onTabChange` → `onChatsScroll`):
    // у владельца она из кэша, до сети дело не доходит.
    expect(pagesOf(ALL_FOLDER_ID)).toBe(2)
    expect(pagesOf(WORK.id)).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('размонтирование ChatList уносит свои ul из контейнеров владельца, контейнеры остаются', async () => {
    const { unmount, folders } = await renderTwoFolders()
    expect(document.querySelectorAll('ul.chatlist')).toHaveLength(2)

    unmount()

    expect(document.querySelectorAll('ul.chatlist')).toHaveLength(0)
    expect(frameOf(folders, WORK.id).querySelector('.chatlist-top')).not.toBe(null)
  })
})
