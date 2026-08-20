// Fix (финальное ревью, Minor #2): владелец списка диалогов читает State через
// ту же СЕМАНТИКУ, что и main.
//
// Порядок диалогов зависит от State-ключей `pinnedOrders`/`drafts`
// (`core/dialogs/dialogIndex.ts`). Main читает State через `loadStateOnce()`
// (`core/state/loadState.ts`), который при несовпадении `STATE_VERSION` отдаёт
// ЧИСТЫЕ ДЕФОЛТЫ — схема прошлой сборки может быть несовместима по форме, и
// склеивать половинки нельзя (порт tweb STATE_VERSION/STATE_INIT). Воркерная
// зависимость `loadState` в workerCore.ts звала голый `loadStateAll()` мимо
// гейта: после ближайшего бампа версии main жил бы на дефолтах, а владелец
// сортировал бы по СТАРЫМ ключам — два разных ответа на один вопрос.
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
import type { Dialog, Draft } from './models'
import { makeDialog, makeLastMessage } from './dialogs/testDialog'

const dialog = (peerId: number, at: string): Dialog => makeDialog({ peerId, lastMessage: makeLastMessage({ peerId, seq: 1, senderId: 1, text: 'x', createdAt: at }) })

const draft = (peerId: number, updatedAt: string): Draft => ({ peerId, text: 'чер', replyToId: null, updatedAt })

// Черновик свежее последнего сообщения поднимает диалог наверх — наблюдаемое
// следствие того, что ключ `drafts` вообще прочитан владельцем.
async function seedDisk(version: number): Promise<void> {
  await saveDialogs([dialog(1, '2026-08-09T10:00:00Z'), dialog(2, '2026-08-09T12:00:00Z')])
  await saveStateKey('drafts', [draft(1, '2026-08-09T13:00:00Z')])
  await saveStateKey('version', version)
}

// vi.stubGlobal (не прямое присваивание indexedDB=…) — как в
// workerCore.dialogs.test.ts: линт-ворота запрещают НОВЫЕ находки
// eslint(no-global-assign).
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('createWorkerCore(): владелец диалогов читает State через версионный гейт (Minor #2)', () => {
  it('версия схемы совпала — State применяется (черновик поднимает диалог)', async () => {
    await seedDisk(STATE_VERSION)

    const core = createWorkerCore()
    const op = await core.registry.dialogs.fillMirror()

    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([1, 2])
  })

  it('версия схемы чужая — владелец идёт на дефолтах, как и main, а не сортирует по старым ключам', async () => {
    await seedDisk(STATE_VERSION + 100)

    const core = createWorkerCore()
    const op = await core.registry.dialogs.fillMirror()

    // Черновик прошлой схемы проигнорирован — порядок чисто по дате активности.
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.peerId)).toEqual([2, 1])
  })
})
