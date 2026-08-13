// Этап 2 (пагинация диалогов), Task 6: фильтр папки считает ВЛАДЕЛЕЦ списка, в
// воркере (`dialogsManager.getDialogs({filterId})`). Здесь проверяется ПРОВОДКА
// определений папок в воркер — сам фильтр покрыт dialogsManager.pagination.test.ts.
//
// Каналов ровно два, и оба обязаны работать:
//  1) холодный старт — `loadState()` в workerCore.ts читает ключ `folders` С
//     ДИСКА (на первом кадре State никто не ПИШЕТ: boot.ts поднимает его
//     `setAppStateSilent`, поэтому зеркала ключа в этот момент не будет вовсе);
//  2) изменение — `persist.stateKey('folders', …)` → `dialogs.setStateKey`.
//
// Прогон настоящий: createWorkerCore() — та же проводка, что в проде (по
// образцу workerCore.dialogsReset.test.ts).
//
// fake-indexeddb — ПЕРВОЙ строкой: newCursor()/newConnectionManager() читают
// IndexedDB прямо в конструкторе.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveDialogs, saveStateKey } from './store/persist'
import { STATE_VERSION } from './state/state'
import type { Dialog } from './models'
import type { Folder } from './managers/foldersManager'

const dialog = (chatId: number, over: Partial<Dialog> = {}): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at: '2026-08-0' + chatId + 'T00:00:00Z' },
  ...over,
} as Dialog)

// Папка «Контакты» — id 7, как у пользовательской папки из Postgres.
const contactsFolder: Folder = {
  id: 7, title: 'Контакты', pos: 0,
  contacts: true, nonContacts: false, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

const peer = (id: number) => ({ peer: { id, displayName: 'p' + id, avatarUrl: '' } })

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => { throw new Error('unexpected fetch ' + String(url)) }))
})

afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): определения папок доезжают до владельца списка', () => {
  it('холодный старт: папки читаются с диска вместе с pinnedOrders/drafts', async () => {
    await saveStateKey('version', STATE_VERSION)
    await saveStateKey('folders', [contactsFolder])
    await saveDialogs([dialog(1, peer(7)), dialog(2, peer(9))])
    const core = createWorkerCore()
    core.registry.dialogs.setContactIds([7])

    const page = await core.registry.dialogs.getDialogs({ filterId: 7, limit: 10 })

    // Без чтения ключа `folders` с диска папка воркеру неизвестна и страница
    // была бы пустой (см. «неизвестная папка → пустая страница»).
    expect(page.dialogs.map((d) => d.chatId)).toEqual([1])
  })

  // Папка с ДРУГИМ id (8): соединение с IndexedDB кэшируется на модуль
  // (persist.ts::open), поэтому диск между тестами файла не обнуляется —
  // «этой папки на диске не было» проверяем новым id, а не чистотой стора.
  it('изменение папок (persist.stateKey) доезжает тем же каналом, что pinnedOrders/drafts', async () => {
    await saveStateKey('version', STATE_VERSION)
    await saveDialogs([dialog(1, peer(7)), dialog(2, peer(9))])
    const core = createWorkerCore()
    core.registry.dialogs.setContactIds([7])
    expect((await core.registry.dialogs.getDialogs({ filterId: 8, limit: 10 })).dialogs).toEqual([])

    await core.registry.persist.stateKey('folders', [{ ...contactsFolder, id: 8 }])

    const page = await core.registry.dialogs.getDialogs({ filterId: 8, limit: 10 })
    expect(page.dialogs.map((d) => d.chatId)).toEqual([1])
  })
})
