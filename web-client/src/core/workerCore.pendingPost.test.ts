// Пин ПРОВОДКИ вида чата в владельца оптимистичного бабла: стрелка
// `isBroadcastChat` в `createWorkerCore()` соединяет `messagesManager` с кэшем
// карточек воркера (`peers.cachedPeer` + предикат `isBroadcast`).
//
// Зачем отдельный файл, а не пин в `workerCore.send.test.ts`: живой бабл на
// уровне воркера требует поднятой истории чата по сети (та же причина, по
// которой `workerCore.pendingFrames.test.ts` подменяет pending-механику
// заглушкой). Механика флага покрыта у владельца — `managers/messages/
// pending.test.ts` («в вещательном канале временный бабл рождается с
// pFlags.post»); здесь предмет другой — что стрелка реально соединена, а не
// забыта. Без неё бабл поста стоял бы СПРАВА до ответа сервера и прыгал влево
// на эхе (`isOurMessage`, tweb chat.ts:1379 — `&& !message.pFlags.post`).
//
// Приём — частичный `vi.mock` messagesManager, чтобы перехватить deps, которыми
// его собрал workerCore (тот же приём ловит подмену стрелки на заглушку, а не
// только её удаление).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'

let capturedDeps: Parameters<typeof import('./managers/messagesManager')['newMessagesManager']>[0] | null = null
vi.mock('./managers/messagesManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./managers/messagesManager')>()
  return {
    ...actual,
    newMessagesManager: (deps: Parameters<typeof actual.newMessagesManager>[0]) => {
      capturedDeps = deps
      return actual.newMessagesManager(deps)
    },
  }
})

import { createWorkerCore } from './workerCore'

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedDeps = null
})

describe('createWorkerCore(): вид чата доезжает до владельца временного бабла', () => {
  it('isBroadcastChat отвечает по карточке из кэша воркера', () => {
    const core = createWorkerCore()
    expect(capturedDeps).not.toBeNull()

    core.registry.peers.saveApiPeers({
      chats: [
        { _: 'channel', id: 5, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } },
        { _: 'channel', id: 6, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
      ],
    })

    // Вещательный канал — да; супергруппа (у нас это ЛЮБАЯ группа) — нет:
    // порт `appChatsManager.isBroadcast` (канал, который не мегагруппа).
    expect(capturedDeps!.isBroadcastChat!(-5)).toBe(true)
    expect(capturedDeps!.isBroadcastChat!(-6)).toBe(false)
    // Карточки нет — «не канал», как и у оригинала (`if(!chat) return false`).
    expect(capturedDeps!.isBroadcastChat!(-7)).toBe(false)
  })
})
