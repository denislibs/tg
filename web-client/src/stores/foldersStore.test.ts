import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import {
  applyFolderUpdate, applyOrder, applyOrderFrame, loadFolders, sendOrder, useFoldersStore,
} from './foldersStore'
import { ALL_FOLDER_ID } from '../core/folderIds'
import type { Folder } from '../core/managers/foldersManager'

const stateKey = vi.fn().mockResolvedValue(undefined)
// Форма Folder — из core/managers/foldersManager.ts, не выдумывать.
const folder: Folder = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  useFoldersStore.setState({ selectedId: ALL_FOLDER_ID, contactIds: new Set() })
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('foldersStore', () => {
  it('загрузка с сети кладёт папки в State (и персистит)', async () => {
    await loadFolders({
      folders: { list: () => Promise.resolve({ folders: [folder], allChatsPos: 0 }) },
      contacts: { list: () => Promise.resolve([]) },
      dialogs: { setContactIds: async () => {} },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
    expect(stateKey).toHaveBeenCalledWith('folders', [folder])
  })

  it('оффлайн: сеть упала — папки из State остаются', async () => {
    useAppStateStore.setState({ folders: [folder] })

    await loadFolders({
      folders: { list: () => Promise.reject(new Error('offline')) },
      contacts: { list: () => Promise.reject(new Error('offline')) },
      dialogs: { setContactIds: async () => {} },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
  })

  it('выбранная папка — UI-состояние, в State не попадает', () => {
    useFoldersStore.getState().select(7)

    expect(useFoldersStore.getState().selectedId).toBe(7)
    expect(stateKey).not.toHaveBeenCalledWith('selectedId', expect.anything())
  })

  // Писатель выбора один — владелец папок (`lib/appDialogsManager.ts`): удаление
  // активной папки он видит подпиской на состав и сам переключает на «Все
  // чаты» (пины — `lib/appDialogsManager.filters.test.ts`, «удалённая АКТИВНАЯ
  // папка»). Стор своего сброса не держит — иначе писателей `selectedId` два.
  it('удаление папки (локально и пушем) выбор в сторе не трогает — его сбрасывает владелец папок', () => {
    useAppStateStore.setState({ folders: [folder, { ...folder, id: 9, title: 'Другая', pos: 1 }] })
    useFoldersStore.getState().select(7)

    useFoldersStore.getState().remove(7)
    expect(useFoldersStore.getState().selectedId).toBe(7)

    applyFolderUpdate({ folder_id: 9, deleted: true })
    expect(useAppStateStore.getState().folders).toEqual([])
    expect(useFoldersStore.getState().selectedId).toBe(7)
  })

  it('пуш об удалении ДРУГОЙ папки выбор не трогает', () => {
    const other: Folder = { ...folder, id: 9, title: 'Другая', pos: 1 }
    useAppStateStore.setState({ folders: [folder, other] })
    useFoldersStore.getState().select(7)

    applyFolderUpdate({ folder_id: 9, deleted: true })

    expect(useAppStateStore.getState().folders).toEqual([folder])
    expect(useFoldersStore.getState().selectedId).toBe(7)
  })
})

// Ф7-З: порядок папок — `updateDialogFilterOrder` (tweb filters.ts:179-199) и свой
// `messages.updateDialogFiltersOrder` (:424-433) сходятся в одном `applyOrder`.
describe('foldersStore.applyOrder', () => {
  const mk = (id: number, pos: number): Folder => ({ ...folder, id, title: 'f' + id, pos })
  const ids = () => useAppStateStore.getState().folders.map((f) => f.id)

  beforeEach(() => {
    useAppStateStore.setState({ folders: [mk(1, 0), mk(2, 1), mk(3, 2)] })
  })

  it('applyOrder([3,1,2]) переставляет папки и перенумеровывает pos', () => {
    applyOrder([3, 1, 2])

    expect(ids()).toEqual([3, 1, 2])
    expect(useAppStateStore.getState().folders.map((f) => f.pos)).toEqual([0, 1, 2])
    expect(stateKey).toHaveBeenCalledWith('folders', expect.any(Array))
  })

  it('неперечисленные папки идут в хвост в прежнем порядке; неизвестные id игнорируются', () => {
    applyOrder([3, 99])

    expect(ids()).toEqual([3, 1, 2])
  })

  it('applyOrder([1, 0, 2]) ставит allChatsPos = 1 (индекс 0 в order)', () => {
    applyOrder([1, 0, 2])

    expect(useAppStateStore.getState().allChatsPos).toBe(1)
    expect(ids()).toEqual([1, 2, 3])
    expect(stateKey).toHaveBeenCalledWith('allChatsPos', 1)
  })

  it('без 0 в order allChatsPos не меняется (не-премиум вырезает 0)', () => {
    useAppStateStore.setState({ allChatsPos: 2 })

    applyOrder([2, 1, 3])

    expect(useAppStateStore.getState().allChatsPos).toBe(2)
  })

  it('перестановка премиума с «Все чаты» пишет и папки, и место — одним проходом подписчиков', () => {
    let notified = 0
    const off = useAppStateStore.subscribe(() => { ++notified })

    applyOrder([3, 0, 1, 2])
    off()

    expect(notified).toBe(1)
    expect(useAppStateStore.getState().allChatsPos).toBe(1)
    expect(ids()).toEqual([3, 1, 2])
  })

  it('кадр без order (null/undefined) ничего не ломает и ничего не меняет', () => {
    const before = useAppStateStore.getState().folders

    applyOrderFrame(undefined)
    applyOrderFrame(null)

    expect(useAppStateStore.getState().folders).toBe(before)
  })

  const mgr = (updateOrder: (order: number[]) => Promise<void>, list = vi.fn().mockResolvedValue({ folders: [], allChatsPos: 0 })) => ({
    folders: { list, updateOrder },
    contacts: { list: () => Promise.resolve([]) },
    dialogs: { setContactIds: async () => {} },
  })

  it('своя перестановка применяется сразу, запросы идут по одному; кадры в полёте откладываются, применяется последний', async () => {
    const finish: Array<() => void> = []
    const updateOrder = vi.fn(() => new Promise<void>((resolve) => { finish.push(resolve) }))
    const m = mgr(updateOrder)

    const first = sendOrder(m, [3, 1, 2])
    const second = sendOrder(m, [2, 3, 1])
    expect(ids()).toEqual([2, 3, 1])
    await vi.waitFor(() => expect(finish).toHaveLength(1))
    expect(updateOrder).toHaveBeenCalledTimes(1)

    applyOrderFrame([3, 1, 2]) // эхо первой — строки не дёргаются
    expect(ids()).toEqual([2, 3, 1])

    finish[0]()
    await first
    await vi.waitFor(() => expect(finish).toHaveLength(2))
    expect(updateOrder).toHaveBeenLastCalledWith([2, 3, 1])
    applyOrderFrame([2, 3, 1]) // эхо второй — последнее, оно и есть итог
    finish[1]()
    await second

    expect(ids()).toEqual([2, 3, 1])
    applyOrderFrame([1, 2, 3]) // очередь пуста — чужая перестановка применяется сразу
    expect(ids()).toEqual([1, 2, 3])
  })

  it('чужая перестановка, пришедшая после своего коммита, не теряется', async () => {
    let finish: (() => void) | undefined
    const m = mgr(() => new Promise<void>((resolve) => { finish = resolve }))

    const sent = sendOrder(m, [3, 1, 2])
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    applyOrderFrame([2, 1, 3]) // с другого устройства, закоммичена после нашей
    finish!()
    await sent

    expect(ids()).toEqual([2, 1, 3])
  })

  it('отказ сервера и недоступный список: возврат к подтверждённому порядку и месту «Все чаты»', async () => {
    useAppStateStore.setState({ allChatsPos: 2 })
    const m = mgr(() => Promise.reject(new Error('offline')), vi.fn().mockRejectedValue(new Error('offline')))

    await sendOrder(m, [3, 0, 1, 2])

    expect(ids()).toEqual([1, 2, 3])
    expect(useAppStateStore.getState().allChatsPos).toBe(2)
  })

  it('отказ первой перестановки при второй в очереди: итог — вторая, как на сервере', async () => {
    const updateOrder = vi.fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce(undefined)
    const m = mgr(updateOrder)

    await Promise.all([sendOrder(m, [3, 1, 2]), sendOrder(m, [2, 3, 1])])

    expect(updateOrder).toHaveBeenCalledTimes(2)
    expect(m.folders.list).not.toHaveBeenCalled()
    expect(ids()).toEqual([2, 3, 1])
  })

  it('успех первой и отказ второй: возврат к порядку первой (он на сервере)', async () => {
    const m = mgr(vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('503')),
      vi.fn().mockRejectedValue(new Error('offline')))

    await Promise.all([sendOrder(m, [3, 1, 2]), sendOrder(m, [2, 3, 1])])

    expect(ids()).toEqual([3, 1, 2])
  })

  it('тот же порядок повторно — ни записи на диск, ни новых ссылок (эхо своего действия)', () => {
    applyOrder([3, 1, 2])
    const after = useAppStateStore.getState().folders
    stateKey.mockClear()

    applyOrder([3, 1, 2])

    expect(useAppStateStore.getState().folders).toBe(after)
    expect(stateKey).not.toHaveBeenCalled()
  })
})

describe('loadFolders: место «Все чаты»', () => {
  it('ответ сервера кладёт allChatsPos в State', async () => {
    await loadFolders({
      folders: { list: () => Promise.resolve({ folders: [folder], allChatsPos: 1 }) },
      contacts: { list: () => Promise.resolve([]) },
      dialogs: { setContactIds: async () => {} },
    })

    expect(useAppStateStore.getState().allChatsPos).toBe(1)
  })
})
