// Пин проекции папок для Solid — порт tweb `stores/folders.ts` (задача 3 плана
// docs/superpowers/plans/2026-09-07-solid-wave-3-folders-tabs.md).
//
// Стор — модульный синглтон (как `createRoot` у оригинала), а его источники —
// общие Zustand-зеркала. Поэтому каждый кейс начинает с чистых зеркал и с
// `dispose()` прошлой гидрации: иначе подписки прошлого кейса пережили бы его.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import useFolders from './folders.solid'
import { useAppStateStore, setAppState } from './appState'
import { applyFolderUpdate, useFoldersStore } from './foldersStore'
import { useChatsStore } from './chatsStore'
import { useNotifyStore } from './notifyStore'
import { initialState } from '../core/state/state'
import { ALL_FOLDER_ID } from '../core/folderIds'
import { makeDialog } from '../core/dialogs/testDialog'
import { applyPeerOps, resetPeerMirror } from '../core/peerCache'
import type { Folder, RawFolder } from '../core/managers/foldersManager'
import type { Dialog } from '../core/models'

const SETTINGS = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

const raw = (id: number, pos: number, over: Partial<RawFolder> = {}): RawFolder => ({
  id, title: `F${id}`, pos,
  contacts: false, non_contacts: true, groups: false, broadcasts: false, bots: false,
  exclude_muted: false, exclude_read: false, include_chats: [], exclude_chats: [],
  ...over,
})

const setDialogs = (dialogs: Dialog[]) => {
  useChatsStore.getState().applyDialogOps([{
    op: 'reset',
    items: dialogs.map((dialog, i) => ({ dialog, index: dialogs.length - i })),
  }])
}

const folders = useFolders()
const ids = () => folders.folderItems.map((it) => it.id)
const item = (id: number) => folders.folderItems.find((it) => it.id === id)

beforeEach(() => {
  folders.dispose()
  useAppStateStore.setState(initialState(), true)
  useChatsStore.setState({ dialogs: [], dialogIndexById: {} })
  useFoldersStore.setState({ contactIds: new Set(), selectedId: ALL_FOLDER_ID })
  useNotifyStore.setState({ settings: SETTINGS })
  resetPeerMirror()
})

afterEach(() => folders.dispose())

describe('folders.solid — проекция appState.folders', () => {
  it('после hydrate(): «Все чаты» первой, дальше папки в порядке pos, id', () => {
    applyFolderUpdate({ folder: raw(5, 2) })
    applyFolderUpdate({ folder: raw(4, 1) })
    applyFolderUpdate({ folder: raw(3, 1) })

    folders.hydrate()

    expect(ids()).toEqual([ALL_FOLDER_ID, 3, 4, 5])
    // «Все чаты» несёт фильтр с id — вкладка ставит `data-filter-id` из
    // `item.filter.id` и для неё (`foldersTabs.tsx:35`).
    expect(folders.folderItems[0].filter.id).toBe(ALL_FOLDER_ID)
    expect(item(4)?.filter.title).toBe('F4')
  })

  it('без папок — одна «Все чаты» (у оригинала её фильтр есть всегда)', () => {
    folders.hydrate()
    expect(ids()).toEqual([ALL_FOLDER_ID])
  })

  it('добавленная папка встаёт на своё место, удалённая исчезает, смена pos переставляет', () => {
    applyFolderUpdate({ folder: raw(3, 1) })
    applyFolderUpdate({ folder: raw(5, 3) })
    folders.hydrate()

    applyFolderUpdate({ folder: raw(4, 2) })
    expect(ids()).toEqual([ALL_FOLDER_ID, 3, 4, 5])

    applyFolderUpdate({ deleted: true, folder_id: 3 })
    expect(ids()).toEqual([ALL_FOLDER_ID, 4, 5])

    applyFolderUpdate({ folder: raw(5, 0) })
    expect(ids()).toEqual([ALL_FOLDER_ID, 5, 4])
  })

  it('переименование обновляет фильтр на месте — узел элемента тот же (For не пересоздаёт вкладку)', () => {
    applyFolderUpdate({ folder: raw(3, 1) })
    applyFolderUpdate({ folder: raw(4, 2) })
    folders.hydrate()
    const before3 = item(3)
    const before4 = item(4)

    applyFolderUpdate({ folder: raw(4, 2, { title: 'Работа' }) })

    expect(item(4)?.filter.title).toBe('Работа')
    expect(item(4)).toBe(before4)
    expect(item(3)).toBe(before3)
  })

  it('логаут (сброс appState) оставляет одну «Все чаты»', () => {
    applyFolderUpdate({ folder: raw(3, 1) })
    folders.hydrate()

    useAppStateStore.setState(initialState(), true)

    expect(ids()).toEqual([ALL_FOLDER_ID])
  })

  it('dispose() снимает подписки: дальнейшие правки зеркал стор не меняют', () => {
    folders.hydrate()
    folders.dispose()

    const f: Folder = {
      id: 9, title: 'x', pos: 0, contacts: false, nonContacts: true, groups: false, broadcasts: false,
      excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
    }
    setAppState('folders', [f])
    setDialogs([makeDialog({ peerId: 1, unread: 1 })])

    expect(ids()).toEqual([ALL_FOLDER_ID])
    expect(folders.folderItems[0].notifications).toEqual({ count: 0, muted: false })
  })
})

describe('folders.solid — счётчики вкладок', () => {
  it('гидрация сразу несёт счётчики, правка диалогов их пересчитывает', () => {
    applyFolderUpdate({ folder: raw(7, 1) }) // non_contacts — все приватные диалоги
    setDialogs([makeDialog({ peerId: 1, unread: 2 }), makeDialog({ peerId: 2, unread: 1, muteUntil: true })])
    folders.hydrate()

    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 1, muted: false })
    expect(item(7)?.notifications).toEqual({ count: 2, muted: false })

    setDialogs([makeDialog({ peerId: 2, unread: 1, muteUntil: true })])

    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 0, muted: true })
    expect(item(7)?.notifications).toEqual({ count: 1, muted: true })
  })

  it('контакты меняют состав папки contacts/non_contacts — и её счётчик', () => {
    applyFolderUpdate({ folder: raw(7, 1) })
    setDialogs([makeDialog({ peerId: 1, unread: 2 })])
    folders.hydrate()
    expect(item(7)?.notifications?.count).toBe(1)

    useFoldersStore.getState().setContacts([1])

    expect(item(7)?.notifications?.count).toBe(0)
  })

  const upsertBroadcast = () => applyPeerOps([{
    op: 'upsert',
    peers: [{ _: 'channel', id: 50, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } }],
  }])
  const CHANNELS_MUTED = { ...SETTINGS, channels: { muted: true, preview: true } }

  it('глобальный мьют типа перекрашивает бейдж', () => {
    upsertBroadcast()
    setDialogs([makeDialog({ peerId: -50, unread: 3 })])
    folders.hydrate()
    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 1, muted: false })

    useNotifyStore.setState({ settings: CHANNELS_MUTED })

    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 0, muted: true })
  })

  it('доехавшая позже карточка канала перекрашивает бейдж', () => {
    useNotifyStore.setState({ settings: CHANNELS_MUTED })
    setDialogs([makeDialog({ peerId: -50, unread: 3 })])
    folders.hydrate()
    // Карточки ещё нет — предикат считает чат группой, настройка каналов не действует.
    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 1, muted: false })

    upsertBroadcast()

    expect(item(ALL_FOLDER_ID)?.notifications).toEqual({ count: 0, muted: true })
  })

  it('пересчёт счётчиков не пересоздаёт элементы — узлы вкладок живут', () => {
    applyFolderUpdate({ folder: raw(7, 1) })
    folders.hydrate()
    const all = item(ALL_FOLDER_ID)
    const work = item(7)

    setDialogs([makeDialog({ peerId: 1, unread: 1 })])

    expect(item(7)?.notifications?.count).toBe(1)
    expect(item(ALL_FOLDER_ID)).toBe(all)
    expect(item(7)).toBe(work)
  })
})

describe('folders.solid — onClick', () => {
  it('setOnClick кладёт функцию переключения владельца, onClick() её отдаёт', () => {
    const calls: number[] = []
    const selectTab = (index: number) => { calls.push(index) }

    folders.setOnClick(() => selectTab)
    folders.onClick()?.(2)

    expect(calls).toEqual([2])
  })
})
