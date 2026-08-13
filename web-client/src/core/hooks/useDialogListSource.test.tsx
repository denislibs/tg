// Этап 3 (виртуальный список), Task 6: источник данных списка папки.
//
// Пины здесь про две вещи сразу: (1) `items` — ПРОИЗВОДНАЯ от зеркала, а не
// свой список (тот же фильтр папки, что у владельца; порядок берётся как есть),
// (2) постраничная догрузка идёт через `SequentialCursorFetcher` к
// `managers.dialogs.getDialogs` ровно теми параметрами, что в tweb.
import type { ReactNode } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { DIALOG_LOAD_COUNT, guessLoadCount, useDialogListSource } from './useDialogListSource'
import { ManagersProvider } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { useFoldersStore } from '../../stores/foldersStore'
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

/** Фейк владельца: отдаёт заранее подготовленные страницы и пишет свои вызовы. */
function fakeManagers(pages: DialogsPage[] = [{ dialogs: [], count: 0, isEnd: true }]) {
  const calls: { offsetIndex?: number; limit?: number; filterId?: number }[] = []
  let n = 0
  const getDialogs = vi.fn(async (o: { offsetIndex?: number; limit?: number; filterId?: number } = {}) => {
    calls.push(o)
    return pages[Math.min(n++, pages.length - 1)]
  })
  return { managers: { dialogs: { getDialogs } }, getDialogs, calls }
}

function setWindowHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

const originalHeight = window.innerHeight

beforeEach(() => {
  seedMirror([])
  useFoldersStore.setState({ contactIds: new Set() })
  useAppStateStore.setState({ folders: [], drafts: [] })
})

afterEach(() => { setWindowHeight(originalHeight) })

describe('guessLoadCount — порт tweb base.ts:216-219', () => {
  it('DIALOG_LOAD_COUNT = 20 (base.ts:23)', () => {
    expect(DIALOG_LOAD_COUNT).toBe(20)
  })

  it('маленький экран — не меньше DIALOG_LOAD_COUNT', () => {
    setWindowHeight(600) // 600 / 64 * 1.25 = 11.7 -> 11
    expect(guessLoadCount()).toBe(20)
  })

  it('большой экран — ровно значение формулы max(h / 64 * 1.25 | 0, 20)', () => {
    setWindowHeight(2000)
    expect(guessLoadCount()).toBe(39) // 2000 / 64 * 1.25 = 39.0625 -> 39
    setWindowHeight(1080)
    expect(guessLoadCount()).toBe(21) // 1080 / 64 * 1.25 = 21.09 -> 21
  })
})

describe('useDialogListSource: items — производная от зеркала', () => {
  it('«Все чаты» — всё зеркало, кроме архива', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2, { archived: true }), index: 20 },
      { dialog: dialog(3), index: 10 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })

    expect(result.current.items.map((i) => i.id)).toEqual([1, 3])
  })

  it('«Архив» — ровно архивные', () => {
    seedMirror([
      { dialog: dialog(1), index: 30 },
      { dialog: dialog(2, { archived: true }), index: 20 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(ARCHIVE_FOLDER_ID), { wrapper: wrapper(managers) })

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

    const { result } = renderHook(() => useDialogListSource(7), { wrapper: wrapper(managers) })

    // группа 1 — да; приватный 2 — нет (нет флага типа); архивная группа 3 — нет.
    expect(result.current.items.map((i) => i.id)).toEqual([1])
  })

  it('определения папки ещё нет — список пуст (а не «показать всё»)', () => {
    seedMirror([{ dialog: dialog(1), index: 30 }])
    const { managers } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(7), { wrapper: wrapper(managers) })

    expect(result.current.items).toEqual([])
  })

  it('порядок — тот, что пришёл из зеркала: хук не пересортировывает', () => {
    seedMirror([
      { dialog: dialog(1), index: 10 },
      { dialog: dialog(2), index: 30 },
      { dialog: dialog(3), index: 20 },
    ])
    const { managers } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })

    expect(result.current.items.map((i) => i.id)).toEqual(useChatsStore.getState().dialogs.map((d) => d.chatId))
    expect(result.current.items.map((i) => i.id)).toEqual([2, 3, 1])
  })

  it('каждый item несёт ГОТОВЫЙ индекс порядка из зеркала', () => {
    seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 10 }])
    const { managers } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })

    expect(result.current.items.map((i) => i.index)).toEqual([30, 10])
  })
})

describe('useDialogListSource: постраничная догрузка', () => {
  it('requestItemForIdx доходит до getDialogs страницей guessLoadCount() и с filterId папки', async () => {
    setWindowHeight(2000)
    const { managers, calls } = fakeManagers()

    const { result } = renderHook(() => useDialogListSource(7), { wrapper: wrapper(managers) })
    await act(async () => { result.current.requestItemForIdx(5, 0) })

    expect(calls).toEqual([{ offsetIndex: undefined, limit: 39, filterId: 7 }])
  })

  it('повторный запрос того же индекса не плодит запросов (фетчер сериализует)', async () => {
    const { managers, getDialogs } = fakeManagers([{ dialogs: [], count: 0, isEnd: true }])

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })
    await act(async () => {
      result.current.requestItemForIdx(5, 0)
      result.current.requestItemForIdx(5, 0)
      result.current.requestItemForIdx(3, 0)
    })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })

  // В оригинале `revealIdx` после первой отдачи не учитывает закреплённых, и
  // список зовёт `requestItemForIdx(idx - pinnedItems.length, …)` с
  // ОТРИЦАТЕЛЬНЫМ индексом. Такой вызов не просит ни одной строки — но, дойдя
  // до `fetchUntil(idx + 1, itemsLength)`, обнулил бы фетчеру «уже набрано» при
  // сохранённом `neededCount` прошлых запросов и запустил бы новый цикл
  // догрузки на пустом месте. Поэтому до фетчера он не доходит вовсе.
  it('ОТРИЦАТЕЛЬНЫЙ индекс не доходит до фетчера и не запускает лишнюю догрузку', async () => {
    const { managers, getDialogs } = fakeManagers([{ dialogs: [], count: 0, isEnd: true }])
    getDialogs.mockImplementationOnce(async () => {
      seedMirror([{ dialog: dialog(1), index: 30 }])
      return { dialogs: [dialog(1)], count: 9, isEnd: false }
    })

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })
    // Цикл нужного количества (4) не добрал — набралась одна строка и конец.
    await act(async () => { result.current.requestItemForIdx(3, 0) })
    expect(getDialogs).toHaveBeenCalledTimes(2)

    await act(async () => { result.current.requestItemForIdx(-1, 0) })

    expect(getDialogs).toHaveBeenCalledTimes(2)
  })

  it('totalCount и isEnd берутся из ответа getDialogs', async () => {
    const { managers } = fakeManagers([{ dialogs: [], count: 137, isEnd: true }])

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })
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
    const page1 = [dialog(1), dialog(2)]
    const { managers, calls, getDialogs } = fakeManagers([
      { dialogs: page1, count: 4, isEnd: false },
      { dialogs: [dialog(3)], count: 4, isEnd: true },
    ])
    getDialogs.mockImplementationOnce(async (o = {}) => {
      calls.push(o)
      seedMirror([{ dialog: dialog(1), index: 30 }, { dialog: dialog(2), index: 20 }])
      return { dialogs: page1, count: 4, isEnd: false }
    })

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })
    await act(async () => { result.current.requestItemForIdx(3, 0) })

    expect(calls.map((c) => c.offsetIndex)).toEqual([undefined, 20])
  })

  it('курсор не сдвинулся — цикл фетчера останавливается, а не долбит владельца', async () => {
    // Индексов приехавших диалогов в зеркале нет (насос ещё не поднят) —
    // следующий запрос ушёл бы с тем же offsetIndex и вернул ту же страницу.
    const { managers, getDialogs } = fakeManagers([{ dialogs: [dialog(1), dialog(2)], count: 99, isEnd: false }])

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })
    await act(async () => { result.current.requestItemForIdx(50, 0) })

    expect(getDialogs).toHaveBeenCalledTimes(1)
  })
})

describe('useDialogListSource: анимация первой загрузки', () => {
  it('animate ложен, пока первая загрузка не завершилась, и истинен после', async () => {
    let release!: (p: DialogsPage) => void
    const getDialogs = vi.fn(() => new Promise<DialogsPage>((res) => { release = res }))
    const managers = { dialogs: { getDialogs } }

    const { result } = renderHook(() => useDialogListSource(ALL_FOLDER_ID), { wrapper: wrapper(managers) })

    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(result.current.animate).toBe(false)

    await act(async () => { release({ dialogs: [], count: 0, isEnd: true }) })
    expect(result.current.animate).toBe(true)
  })

  it('глушилка — СЧЁТЧИК, а не флаг: две первые загрузки внахлёст отпускают анимацию только обе', async () => {
    const released: ((p: DialogsPage) => void)[] = []
    const getDialogs = vi.fn(() => new Promise<DialogsPage>((res) => { released.push(res) }))
    const managers = { dialogs: { getDialogs } }
    useAppStateStore.setState({ folders: [folder({ id: 7, groups: true })] })

    const { result, rerender } = renderHook(({ fid }) => useDialogListSource(fid), {
      wrapper: wrapper(managers), initialProps: { fid: ALL_FOLDER_ID },
    })

    // Первая загрузка «Всех чатов» ещё летит, когда папку переключили — и её
    // первая загрузка глушит анимацию вторым блоком.
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    rerender({ fid: 7 })
    await act(async () => { result.current.requestItemForIdx(0, 0) })
    expect(released).toHaveLength(2)
    expect(result.current.animate).toBe(false)

    // Ответ ПЕРВОЙ (уже неактуальной) загрузки анимацию отпускать не вправе —
    // булев флаг отпустил бы здесь, счётчик держит.
    await act(async () => { released[0]({ dialogs: [], count: 0, isEnd: true }) })
    expect(result.current.animate).toBe(false)

    await act(async () => { released[1]({ dialogs: [], count: 0, isEnd: true }) })
    expect(result.current.animate).toBe(true)
  })
})
