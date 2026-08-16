// Этап 3 (виртуальный список), Task 6: источник данных списка папки.
//
// Пины здесь про три вещи: (1) `items` — ПРОИЗВОДНАЯ от зеркала, а не свой
// список (порядок берётся как есть); (2) правило папки в хуке РОВНО ОДНО — им
// считаются и строки, и размер набора для фетчера; (3) постраничная догрузка
// идёт через `SequentialCursorFetcher` к `managers.dialogs.getDialogs` теми же
// параметрами, что в tweb.
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDialogListSource } from './useDialogListSource'
import { useChatList } from './useChatList'
import { useShouldAnimate } from '../../components/virtual/useShouldAnimate'
import { ManagersProvider } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useFoldersStore } from '../../stores/foldersStore'
import { useNotifyStore } from '../../stores/notifyStore'
import { useAppStateStore } from '../../stores/appState'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../folderIds'
import type { Folder } from '../managers/foldersManager'
import type { Dialog } from '../models'
import type { DialogsPage } from '../managers/dialogsManager'

const dialog = (chatId: number, over: Partial<Dialog> = {}): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false, ...over,
} as Dialog)

const folder = (over: Partial<Folder> = {}): Folder => ({
  id: 7, title: 'Папка', pos: 0,
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [], ...over,
})

const page = (dialogs: Dialog[], over: Partial<DialogsPage> = {}): DialogsPage =>
  ({ dialogs, count: 0, isEnd: false, ...over })

/** Кладём диалоги в зеркало ТЕМ ЖЕ путём, что проектор — операцией владельца. */
function seedMirror(items: { dialog: Dialog; index: number }[]) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: false })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items }])
}

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

/**
 * `chats` хук принимает пропом (см. докблок): в тестах — той же `useChatList`,
 * что отдаст Sidebar, чтобы витрина и зеркало не разъезжались по построению.
 */
function renderSource(managers: unknown, filterId: number) {
  return renderHook(({ fid }) => useDialogListSource(fid, useChatList()), {
    wrapper: wrapper(managers), initialProps: { fid: filterId },
  })
}

/**
 * Фейк владельца: отдаёт заранее подготовленные страницы.
 *
 * `MAX_CALLS` — предохранитель: цикл `SequentialCursorFetcher` обязан
 * останавливаться сам. Если он этого не делает (снят гвард залипшего курсора),
 * фейк бросает, и тест падает диагностируемым ассертом про число вызовов, а не
 * крашем воркера vitest от бесконечного цикла.
 */
const MAX_CALLS = 12
/**
 * Запрос строки «Архив» (`ensureArchiveHydrated`), а не страница списка: у него
 * фиксированный лимит `archiveDialog.tsx:27` и нет курсора. Страницы самого
 * списка архива приезжают с `guessLoadCount()` — с этим не пересекаются.
 */
const ARCHIVE_ROW_LIMIT = 10
type DialogsQuery = { offsetIndex?: number; limit?: number; filterId?: number }
const isArchiveRowRequest = (o: DialogsQuery) =>
  o.filterId === ARCHIVE_FOLDER_ID && o.offsetIndex === undefined && o.limit === ARCHIVE_ROW_LIMIT

function fakeManagers(pages: DialogsPage[] = [page([], { isEnd: true })]) {
  const calls: DialogsQuery[] = []
  const getDialogs = vi.fn(async (o: DialogsQuery = {}) => {
    calls.push(o)
    if (calls.length > MAX_CALLS) throw new Error(`getDialogs зациклился: ${calls.length} вызовов`)
    return pages[Math.min(calls.length - 1, pages.length - 1)]
  })
  const { dialogs, archiveRowCalls, failNextArchiveRow } = withArchiveRow(getDialogs)
  return { managers: { dialogs }, getDialogs, calls, archiveRowCalls, failNextArchiveRow }
}

/**
 * Гидратация строки «Архив» идёт ПАРАЛЛЕЛЬНО загрузке списка (порт
 * `ensureArchiveDialogHydrated`) и к его курсору отношения не имеет — отводим
 * её ДО мока страниц: иначе она съедала бы и сценарий `pages`, и
 * `mockImplementationOnce`, и счётчик вызовов у тестов про пагинацию.
 */
function withArchiveRow(getDialogs: (o?: DialogsQuery) => Promise<DialogsPage>) {
  const archiveRowCalls: DialogsQuery[] = []
  const fail = { next: false }
  return {
    archiveRowCalls,
    /** Уронить ближайший запрос строки «Архив» — оффлайн/401 на старте. */
    failNextArchiveRow: () => { fail.next = true },
    dialogs: {
      getDialogs: (o: DialogsQuery = {}) => {
        if (!isArchiveRowRequest(o)) return getDialogs(o)
        archiveRowCalls.push(o)
        if (fail.next) { fail.next = false; return Promise.reject(new Error('offline')) }
        return Promise.resolve(page([], { isEnd: true }))
      },
    },
  }
}

/** Фейк с ручным разрешением каждого запроса — для гвардов актуальности.
 *  Запрос строки «Архив» разрешается сразу и в очередь не встаёт (см.
 *  `withArchiveRow`). */
function deferredManagers() {
  const pending: ((p: DialogsPage) => void)[] = []
  const getDialogs = vi.fn(() => new Promise<DialogsPage>((res) => { pending.push(res) }))
  const { dialogs } = withArchiveRow(getDialogs)
  return { managers: { dialogs }, getDialogs, pending }
}

const originalHeight = window.innerHeight

function setWindowHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

beforeEach(() => {
  seedMirror([])
  useFoldersStore.setState({ contactIds: new Set() })
  useAppStateStore.setState({ folders: [], drafts: [] })
  useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: false, preview: true }, channels: { muted: false, preview: true } } })
})

afterEach(() => { setWindowHeight(originalHeight) })

describe('useDialogListSource: items — производная от зеркала', () => {
  it('«Все чаты» — всё зеркало, кроме архива', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2, { archived: true }), index: 20 },
      { dialog: dialog(3), index: 10 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)

    expect(result.current.items.map((i) => i.id)).toEqual([1, 3])
  })

  it('«Архив» — ровно архивные', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2, { archived: true }), index: 20 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, ARCHIVE_FOLDER_ID)

    expect(result.current.items.map((i) => i.id)).toEqual([2])
  })

  it('пользовательская папка — тот же matchesFolder, что у владельца', () => {
    seedMirror([
      { dialog: dialog(1, { type: 'group' }), index: 30 },
      { dialog: dialog(2), index: 20 },
      { dialog: dialog(3, { type: 'group', archived: true }), index: 10 },
    ])
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, 7)

    // группа 1 — да; приватный 2 — нет (нет флага типа); архивная группа 3 — нет.
    expect(result.current.items.map((i) => i.id)).toEqual([1])
  })

  it('определения папки ещё нет — список пуст (а не «показать всё»)', () => {
    seedMirror([{ dialog: dialog(1), index: 30 }])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, 7)

    expect(result.current.items).toEqual([])
  })

  it('порядок — тот, что пришёл из зеркала: хук не пересортировывает', () => {
    seedMirror([
      { dialog: dialog(1), index: 10 },
      { dialog: dialog(2), index: 30 },
      { dialog: dialog(3), index: 20 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)

    expect(result.current.items.map((i) => i.id)).toEqual(useChatsStore.getState().dialogs.map((d) => d.chatId))
    expect(result.current.items.map((i) => i.id)).toEqual([2, 3, 1])
  })

  // `chats` по контракту — полная витрина зеркала, поэтому в норме такой строки
  // не бывает. Если она всё же появится, показать её нечем: строка без
  // витринного значения — это падение рендера.
  it('диалог, которого нет в пропе chats, в items не попадает', () => {
    seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 }])
    const { managers } = fakeManagers()

    const { result } = renderHook(
      () => useDialogListSource(ALL_FOLDER_ID, useChatList().filter((c) => c.id !== '2')),
      { wrapper: wrapper(managers) },
    )

    expect(result.current.items.map((i) => i.id)).toEqual([1])
  })

})

// Контракт пропа `items` ядра (`components/virtual/DeferredSortedVirtualList.tsx:64-80`).
// Обе его половины держит ref-кэш обёрток; вторая половина (стабильность ссылок)
// — не украшение, а условие работы `useShouldAnimate`: он сравнивает элементы
// старого и нового списка ПО ССЫЛКЕ, и на пересоздаваемых обёртках пересечение
// «видимые до»/«видимые сейчас» всегда пусто — компенсация равномерного сдвига
// не срабатывает никогда (см. describe ниже, он проверяет это по результату).
describe('useDialogListSource: ссылки в items', () => {
  it('пересчёт, ничего не изменивший в списке, отдаёт ТОТ ЖЕ массив', () => {
    seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 }])
    const { managers } = fakeManagers()

    const { result, rerender } = renderSource(managers, ALL_FOLDER_ID)
    const before = result.current.items

    rerender({ fid: ALL_FOLDER_ID })

    expect(result.current.items).toBe(before)
  })

  // Пересчёт, который список не изменил, обязан вернуть ПРЕЖНИЙ массив: смена
  // его ссылки — это команда `useShouldAnimate` пересчитать решение об анимации,
  // а здесь пересчитывать нечего (правка приехала в чат другой папки).
  it('правка вне папки пересчитывает items, но ссылка на массив прежняя', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2, { archived: true }), index: 20 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    const before = result.current.items
    expect(before.map((i) => i.id)).toEqual([1])

    act(() => {
      useChatsStore.getState().applyDialogOps([{ op: 'patch', chatId: 2, fields: { unread: 7 } }])
    })

    expect(result.current.items).toBe(before)
  })

  it('изменилась одна строка — её обёртка новая, у остальных ТЕ ЖЕ ссылки', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2), index: 20 },
      { dialog: dialog(3), index: 10 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    const before = result.current.items

    act(() => {
      useChatsStore.getState().applyDialogOps([{ op: 'patch', chatId: 2, fields: { unread: 5 } }])
    })
    const after = result.current.items

    expect(after).not.toBe(before) // список изменился — новая ссылка на массив
    expect(after[1]).not.toBe(before[1]) // строка обёрнута в memo и сравнивает item по ссылке
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
  })
})

// Проверка ПО РЕЗУЛЬТАТУ, а не по реализации: механизм `useShouldAnimate`
// действительно живой. Критерий приёмки №4 спеки этапа — новый чат сверху
// поднимает свою строку, а остальные видимые не дёргаются: вместо анимации
// список компенсирует равномерный сдвиг записью в `scrollTop`.
describe('useDialogListSource + useShouldAnimate: компенсация равномерного сдвига', () => {
  const ITEM_HEIGHT = 72
  const HOST_HEIGHT = 144
  // Прокручены так, что видимы строки 4..7 — появление чата НАД ними сдвигает
  // весь видимый кусок ровно на одну позицию.
  const SCROLL_AMOUNT = 5 * ITEM_HEIGHT

  function renderWithAnimation(managers: unknown, onScrollShift: (amount: number) => void) {
    return renderHook(() => {
      const source = useDialogListSource(ALL_FOLDER_ID, useChatList())
      const shouldAnimate = useShouldAnimate({
        list: source.items,
        scrollAmount: SCROLL_AMOUNT,
        hostHeight: HOST_HEIGHT,
        itemHeight: ITEM_HEIGHT,
        onScrollShift,
      })
      return { items: source.items, shouldAnimate }
    }, { wrapper: wrapper(managers) })
  }

  it('чат появился НАД видимой областью — сдвиг компенсирован, анимации нет', () => {
    seedMirror(Array.from({ length: 10 }, (_, i) => ({ dialog: dialog(i + 1), index: (10 - i) * 10 })))
    const { managers } = fakeManagers()
    const shifts: number[] = []

    const { result } = renderWithAnimation(managers, (amount) => shifts.push(amount))
    expect(result.current.items).toHaveLength(10)

    act(() => {
      useChatsStore.getState().applyDialogOps([{ op: 'upsert', items: [{ dialog: dialog(99), index: 1000 }] }])
    })

    expect(result.current.items[0].id).toBe(99)
    expect(shifts).toEqual([-ITEM_HEIGHT])
    expect(result.current.shouldAnimate).toBe(false)
  })
})

// Правило принадлежности папке в хуке ОДНО: им считаются и строки, и размер
// набора, который хук отдаёт фетчеру. Два адаптера (`Chat` для строк, `Dialog`
// для размера) расходились бы ровно на `muted`: `useChatList` навешивает его
// ещё и по глобально выключенному ТИПУ чатов, а у `Dialog.muted` этого нет.
// В папке с `excludeMuted` набор оказывался бы БОЛЬШЕ списка, фетчер считал бы
// нужное количество набранным, и папка не наполнялась бы никогда.
describe('useDialogListSource: строки и размер набора считаются одним правилом', () => {
  it('excludeMuted + глобально заглушённый тип: чат не в списке И не в размере набора', async () => {
    seedMirror([
      { dialog: dialog(1, { type: 'group', unread: 1 }), index: 30 },
      { dialog: dialog(2, { type: 'group', unread: 1 }), index: 20 },
    ])
    // Сами диалоги НЕ заглушены — заглушён весь тип «группы» (tweb respectType).
    useNotifyStore.setState({ settings: { private: { muted: false, preview: true }, groups: { muted: true, preview: true }, channels: { muted: false, preview: true } } })
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true, excludeMuted: true })] })
    const { managers, getDialogs } = fakeManagers([
      page([dialog(1, { type: 'group', unread: 1 })]),
      page([dialog(2, { type: 'group', unread: 1 })]),
      page([], { isEnd: true }),
    ])

    const { result } = renderSource(managers, 7)
    expect(result.current.items).toEqual([])

    await act(async () => { result.current.requestItemForIdx(1, 0) })

    // Набор папки пуст ровно так же, как список, поэтому цикл догрузки идёт до
    // конца набора (3 запроса), а не обрывается на первой же странице.
    expect(getDialogs).toHaveBeenCalledTimes(3)
  })
})

describe('useDialogListSource: постраничная догрузка', () => {
  it('requestItemForIdx доходит до getDialogs страницей guessLoadCount() и с filterId папки', async () => {
    setWindowHeight(2000)
    const { managers, calls } = fakeManagers()

    const { result } = renderSource(managers, 7)
    await act(async () => { result.current.requestItemForIdx(5, 0) })

    expect(calls).toEqual([{ offsetIndex: undefined, limit: 39, filterId: 7 }])
  })

  it('повторный запрос того же индекса не плодит запросов (фетчер сериализует)', async () => {
    const { managers, getDialogs } = fakeManagers([page([], { isEnd: true })])

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => {
      result.current.requestItemForIdx(5, 0)
      result.current.requestItemForIdx(5, 0)
      result.current.requestItemForIdx(3, 0)
    })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })

  // В оригинале `revealIdx` после первой отдачи не учитывает закреплённых, и
  // список зовёт `requestItemForIdx(idx - pinnedItems.length, …)` с
  // ОТРИЦАТЕЛЬНЫМ индексом. Такой вызов не просит ни одной строки, но, дойдя до
  // `fetchUntil(idx + 1, itemsLength)`, перепишет фетчеру «уже набрано» при
  // сохранённом `neededCount` прошлых запросов и запустит новый цикл догрузки
  // на пустом месте. Поэтому до фетчера он не доходит вовсе.
  it('ОТРИЦАТЕЛЬНЫЙ индекс не доходит до фетчера и не запускает лишнюю догрузку', async () => {
    const { managers, getDialogs } = fakeManagers([page([], { isEnd: true })])
    getDialogs.mockImplementationOnce(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      return page([dialog(1)], { count: 9 })
    })

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    // Цикл нужного количества (4) не добрал — набралась одна строка и конец.
    await act(async () => { result.current.requestItemForIdx(3, 0) })
    expect(getDialogs).toHaveBeenCalledTimes(2)

    await act(async () => { result.current.requestItemForIdx(-1, 0) })

    expect(getDialogs).toHaveBeenCalledTimes(2)
  })

  it('totalCount и isEnd берутся из ответа getDialogs', async () => {
    const { managers } = fakeManagers([page([], { count: 137, isEnd: true })])

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    expect(result.current.totalCount).toBe(0)
    expect(result.current.wasAtLeastOnceFetched).toBe(false)

    await act(async () => { result.current.requestItemForIdx(0, 0) })

    expect(result.current.totalCount).toBe(137)
    expect(result.current.isEnd).toBe(true)
    expect(result.current.wasAtLeastOnceFetched).toBe(true)
  })

  it('следующая страница уходит с курсором = минимальный индекс предыдущей (base.ts:274-277)', async () => {
    // Зеркало наполняет проектор: к моменту ответа RPC индексы страницы в нём
    // уже есть (кадр rt:dialog_op уходит из воркера раньше ответа).
    const { managers, calls, getDialogs } = fakeManagers([page([dialog(3)], { count: 4, isEnd: true })])
    getDialogs.mockImplementationOnce(async (o = {}) => {
      calls.push(o)
      seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 }])
      return page([dialog(1), dialog(2)], { count: 4 })
    })

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(3, 0) })

    expect(calls.map((c) => c.offsetIndex)).toEqual([undefined, 20])
  })

  it('курсор не сдвинулся — цикл фетчера останавливается, а не долбит владельца', async () => {
    // Индексов приехавших диалогов в зеркале нет (насос ещё не поднят) —
    // следующий запрос ушёл бы с тем же offsetIndex и вернул ту же страницу.
    const { managers, getDialogs } = fakeManagers([page([dialog(1), dialog(2)], { count: 99 })])

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(5, 0) })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })

  // Порт `sortedList.itemsLength()` (base.ts:297): фетчеру отдаётся размер
  // НАБОРА в зеркале, а не длина страницы. Владелец режет свой кэш по
  // курсору-значению, поэтому страницы перекрываются, и `fetchedItemsCount +=
  // count` считал бы уже известные строки заново — цикл оборвался бы, не добрав
  // до нужного индекса, и в списке остались бы пустые строки.
  it('фетчеру отдаётся размер набора в зеркале, а не длина страницы', async () => {
    const { managers, getDialogs } = fakeManagers([page([], { isEnd: true })])
    getDialogs.mockImplementationOnce(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 }, { dialog: dialog(3), index: 10 }])
      return page([dialog(1), dialog(2), dialog(3)], { count: 9 })
    })
    // Вторая страница перекрывается первой: три отданных диалога, новый — один.
    getDialogs.mockImplementationOnce(async () => {
      seedMirror([
        { dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 },
        { dialog: dialog(3), index: 10 }, { dialog: dialog(4), index: 5 },
      ])
      return page([dialog(3), dialog(4)], { count: 9 })
    })

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(4, 0) })

    // Набрано 4 из нужных 5 → идём за третьей страницей (она пустая, конец).
    expect(getDialogs).toHaveBeenCalledTimes(3)
  })
})

// Ответ, доехавший после размонтирования или после переключения папки, не имеет
// права ни писать в состояние хука, ни двигать курсор уже нового цикла.
describe('useDialogListSource: гвард актуальности ответа', () => {
  it('хук размонтирован — цикл догрузки не продолжается', async () => {
    const { managers, getDialogs, pending } = deferredManagers()

    const { result, unmount } = renderSource(managers, ALL_FOLDER_ID)
    act(() => { result.current.requestItemForIdx(4, 0) })
    expect(pending).toHaveLength(1)

    unmount()
    await act(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      pending[0](page([dialog(1)], { count: 9 }))
    })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })

  it('папку переключили, пока страница летела — цикл прошлой папки не продолжается', async () => {
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })
    const { managers, getDialogs, pending } = deferredManagers()

    const { result, rerender } = renderSource(managers, ALL_FOLDER_ID)
    act(() => { result.current.requestItemForIdx(4, 0) })
    expect(pending).toHaveLength(1)

    rerender({ fid: 7 })
    await act(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      pending[0](page([dialog(1)], { count: 9 }))
    })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })

  it('смена папки сбрасывает totalCount/isEnd/wasAtLeastOnceFetched', async () => {
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })
    const { managers } = fakeManagers([page([], { count: 137, isEnd: true })])

    const { result, rerender } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(result.current.totalCount).toBe(137)
    expect(result.current.isEnd).toBe(true)
    expect(result.current.wasAtLeastOnceFetched).toBe(true)

    rerender({ fid: 7 })

    expect(result.current.totalCount).toBe(0)
    expect(result.current.isEnd).toBe(false)
    expect(result.current.wasAtLeastOnceFetched).toBe(false)
  })
})

describe('useDialogListSource: анимация первой загрузки', () => {
  it('animate ложен, пока первая загрузка не завершилась, и истинен после', async () => {
    const { managers, pending } = deferredManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)

    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(result.current.animate).toBe(false)

    await act(async () => { pending[0](page([], { isEnd: true })) })
    expect(result.current.animate).toBe(true)
  })

  it('глушилка — СЧЁТЧИК, а не флаг: две первые загрузки внахлёст отпускают анимацию только обе', async () => {
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })
    const { managers, pending } = deferredManagers()

    const { result, rerender } = renderSource(managers, ALL_FOLDER_ID)

    // Первая загрузка «Всех чатов» ещё летит, когда папку переключили — и её
    // первая загрузка глушит анимацию вторым блоком.
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    rerender({ fid: 7 })
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(pending).toHaveLength(2)
    expect(result.current.animate).toBe(false)

    // Ответ ПЕРВОЙ (уже неактуальной) загрузки анимацию отпускать не вправе —
    // булев флаг отпустил бы здесь, счётчик держит.
    await act(async () => { pending[0](page([], { isEnd: true })) })
    expect(result.current.animate).toBe(false)

    await act(async () => { pending[1](page([], { isEnd: true })) })
    expect(result.current.animate).toBe(true)
  })
})

// Порт `AutonomousDialogList.ensureArchiveDialogHydrated`
// (`autonomousDialogList/dialogs.ts:263-276` + `archiveDialog.tsx:27,124-137`):
// список «Всех чатов» тянет страницу строки «Архив» ПАРАЛЛЕЛЬНО каждой своей
// загрузке. Без неё строки не бывает вовсе — её гейт это архивные диалоги в
// зеркале, а страницы «Всех чатов» уходят за своей выборкой (`folder_id=0`) и
// архива не приносят никогда (спека, «Дополнение: вход в архив»).
describe('useDialogListSource: гидратация строки «Архив»', () => {
  it('загрузка «Всех чатов» тянет страницу архивной выборки', async () => {
    const { managers, archiveRowCalls } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })

    expect(archiveRowCalls).toEqual([{ filterId: ARCHIVE_FOLDER_ID, limit: ARCHIVE_ROW_LIMIT }])
  })

  // Своя страница архива уже привезла его в зеркало — перезапрашивать нечего
  // (порт условия `hasDialogs()`/refetch, archiveDialog.tsx:106,162-171).
  it('архив уже в зеркале — страница строки не запрашивается', async () => {
    seedMirror([{ dialog: dialog(9, { archived: true }), index: 10 }])
    const { managers, archiveRowCalls } = fakeManagers()

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })

    expect(archiveRowCalls).toEqual([])
  })

  // Порт правила перезапроса (`archiveDialog.tsx:162-171`: список строки
  // сократился — просим страницу заново). У нас архив выпадает из зеркала
  // штатно: `refresh()` читает окно ГЛОБАЛЬНОЙ выборки, и архивные диалоги,
  // лежащие ниже окна, в него не попадают.
  it('архив, выпавший из зеркала, гидрируется заново следующей страницей', async () => {
    seedMirror([{ dialog: dialog(9, { archived: true }), index: 10 }])
    const { managers, archiveRowCalls } = fakeManagers([
      page([dialog(1)], { count: 99 }), page([], { isEnd: true }),
    ])

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(archiveRowCalls).toEqual([]) // архив на месте — просить нечего

    await act(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }]) // окно refresh() архив не накрыло
      result.current.requestItemForIdx(5, 0)
    })

    expect(archiveRowCalls).toHaveLength(1)
  })

  // У пользователя БЕЗ архива гейт по зеркалу не закроется никогда — запрос
  // уходил бы на каждую страницу списка. Оригинал спрашивает один раз
  // (`archiveDialog.tsx:170` — `if(canFetch()) return`); у нас признак ставит
  // сам ответ («пусто и это конец»), чтобы перезапрос при выпавшем из зеркала
  // архиве остался.
  it('владелец ответил «архива нет» — на следующих страницах не переспрашиваем', async () => {
    const { managers, archiveRowCalls } = fakeManagers([
      page([dialog(1)], { count: 99 }), page([dialog(2)], { count: 99 }), page([], { isEnd: true }),
    ])

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(archiveRowCalls).toHaveLength(1)

    await act(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      result.current.requestItemForIdx(5, 0)
    })

    expect(archiveRowCalls).toHaveLength(1)
  })

  // РЕТРАЙ, которого не даёт эффект монтирования: запрос fire-and-forget, и
  // упади он (моргнула сеть на старте), строки «Архив» не будет до перезагрузки
  // вкладки — кадр списка «Все чаты» переживает переключение папок (`TabSlide
  // keepMounted`). В оригинале ретрай встроен тем, что гидратация висит на
  // КАЖДОЙ загрузке списка (dialogs.ts:248-276), а не на его создании.
  it('упавший запрос повторяется следующей страницей списка', async () => {
    const { managers, archiveRowCalls, failNextArchiveRow } = fakeManagers([
      page([dialog(1)], { count: 99 }), page([], { isEnd: true }),
    ])
    failNextArchiveRow()

    const { result } = renderSource(managers, ALL_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(archiveRowCalls).toHaveLength(1) // первая попытка упала — архива в зеркале так и нет

    await act(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      result.current.requestItemForIdx(5, 0)
    })

    expect(archiveRowCalls).toHaveLength(2)
  })

  it('список пользовательской папки страницу архива не просит', async () => {
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })
    const { managers, archiveRowCalls } = fakeManagers()

    const { result } = renderSource(managers, 7)
    await act(async () => { result.current.requestItemForIdx(0, 0) })

    expect(archiveRowCalls).toEqual([])
  })

  it('сам список архива своей строки не гидрирует — он листается курсором', async () => {
    const { managers, archiveRowCalls, calls } = fakeManagers()

    const { result } = renderSource(managers, ARCHIVE_FOLDER_ID)
    await act(async () => { result.current.requestItemForIdx(0, 0) })

    expect(archiveRowCalls).toEqual([])
    expect(calls).toHaveLength(1)
    expect(calls[0].filterId).toBe(ARCHIVE_FOLDER_ID)
  })
})
