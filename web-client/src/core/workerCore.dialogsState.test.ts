// Fix (финальное ревью, Minor #2): владелец списка диалогов читает State через
// ту же СЕМАНТИКУ, что и main.
//
// Выборка и порядок диалогов зависят от State-ключей `folders`/`pinnedOrders`
// (`forFilter`, `core/dialogs/dialogIndex.ts`). Main читает State через `loadStateOnce()`
// (`core/state/loadState.ts`), который при несовпадении `STATE_VERSION` отдаёт
// ЧИСТЫЕ ДЕФОЛТЫ — схема прошлой сборки может быть несовместима по форме, и
// склеивать половинки нельзя (порт tweb STATE_VERSION/STATE_INIT). Воркерная
// зависимость `loadState` в workerCore.ts звала голый `loadStateAll()` мимо
// гейта: после ближайшего бампа версии main жил бы на дефолтах, а владелец
// считал бы папки по СТАРЫМ ключам — два разных ответа на один вопрос.
//
// `loadStateOnce()` в воркере не годится и потому не используется: он
// мемоизирует промис на модуль, а воркер обязан перечитать State заново после
// `resetForLogout()` (смена аккаунта) — мемо отдало бы State прошлого. Гейт
// применён на месте, этот тест держит именно его.
//
// fake-indexeddb — ПЕРВОЙ строкой (см. workerCore.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkerCore } from './workerCore'
import { saveDialogs, saveStateKey } from './store/persist'
import { STATE_VERSION } from './state/state'
import type { Dialog } from './models'
import type { Folder } from './managers/foldersManager'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'

const dialog = (peerId: number, at: string): Dialog => makeDialog({ peerId, lastMessage: makeLastMessage({ peerId, id: 1, fromId: 1, text: 'x', createdAt: at }) })

// Папка, собранная одним `include_chats`: правило срабатывает до флагов типов
// (`core/folderFilter.ts`), поэтому карточек пиров и контактов ей не нужно.
const FOLDER: Folder = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [2], excludeChats: [],
}

// Папка, которую владелец не знает, отдаёт ПУСТУЮ страницу (`forFilter` → null),
// а известная — свой единственный диалог: наблюдаемое следствие того, что ключ
// `folders` вообще прочитан владельцем.
async function seedDisk(version: number): Promise<void> {
  await saveDialogs([dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')])
  await saveStateKey('folders', [FOLDER])
  await saveStateKey('version', version)
}

// vi.stubGlobal (не прямое присваивание indexedDB=…) — как в
// workerCore.dialogs.test.ts: линт-ворота запрещают НОВЫЕ находки
// eslint(no-global-assign).
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): владелец диалогов читает State через версионный гейт (Minor #2)', () => {
  it('версия схемы совпала — State применяется (папка с диска отдаёт свой диалог)', async () => {
    await seedDisk(STATE_VERSION)

    const core = createWorkerCore()
    const page = await core.registry.dialogs.getDialogs({ filterId: 7, limit: 1 })

    expect(page.dialogs.map((d) => d.peerId)).toEqual([2])
  })

  it('версия схемы чужая — владелец идёт на дефолтах, как и main, а не считает по старым ключам', async () => {
    await seedDisk(STATE_VERSION + 100)

    const core = createWorkerCore()
    const page = await core.registry.dialogs.getDialogs({ filterId: 7, limit: 1 })

    // Папка прошлой схемы проигнорирована — считать выборку нечем, страница пуста.
    expect(page.dialogs).toEqual([])
  })
})
