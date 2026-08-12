// Task 3 (realtime-кадры применяет владелец): проверяет, что createWorkerCore()
// РЕАЛЬНО зовёт dialogs.applyNewMessage/applyRead/applyChatMeta/applyRemoved/
// bumpUnreadReactions из dispatch()/routeNewMessage() — не только что сам
// dialogsManager умеет считать patch/remove из этих же кадров (это отдельно
// покрыто dialogsManager.test.ts), а что workerCore.ts реально подключает
// вызов владельца к живому WS-кадру.
//
// Приём — тот же, что в workerCore.connectionStatus.test.ts: мокаем
// newConnectionManager ЧАСТИЧНО (importOriginal), перехватываем переданный ему
// onFrame и зовём его НАПРЯМУЮ, как реальный WS-транспорт передал бы кадр —
// сама connectionManager (ws/reconnect) не участвует. Кадры БЕЗ `pts` проходят
// funnel безусловно (globalFunnel.ts: «без pts — эфемерный/устаревший бэк,
// транслируем как есть, не гейтим»), поэтому cursorReady/core.start() здесь не
// нужны — только core.bind().
//
// Файл — НЕ правка workerCore.dialogs.test.ts (Task 1, другой предмет: RPC
// fillMirror/setStateKey, не WS-кадры) и НЕ workerCore.test.ts — отдельный
// набор, чтобы module-scoped vi.mock не задевал уже существующие кейсы (тот же
// приём и то же обоснование, что в workerCore.connectionStatus.test.ts).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { CMDeps } from './realtime/connectionManager'
import { saveDialogs } from './store/persist'
import type { Dialog } from './models'
import type { DialogOp } from './dialogs/dialogOps'

let capturedConnDeps: CMDeps | null = null
vi.mock('./realtime/connectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./realtime/connectionManager')>()
  return {
    ...actual,
    newConnectionManager: (deps: CMDeps) => {
      capturedConnDeps = deps
      return actual.newConnectionManager(deps)
    },
  }
})

import { createWorkerCore } from './workerCore'
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'

// Тот же приём, что и в workerCore.test.ts/workerCore.dialogs.test.ts —
// синхронная пара эндпоинтов.
function pair(): [Endpoint, Endpoint] {
  const listenersA: Array<(ev: MessageEvent) => void> = []
  const listenersB: Array<(ev: MessageEvent) => void> = []
  const epA: Endpoint = {
    postMessage: (m) => { for (const l of listenersB) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersA.push(l) },
  }
  const epB: Endpoint = {
    postMessage: (m) => { for (const l of listenersA) l({ data: m } as MessageEvent) },
    addEventListener: (_t, l) => { listenersB.push(l) },
  }
  return [epA, epB]
}

const dialog = (chatId: number, at: string): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

beforeEach(() => {
  // vi.stubGlobal (не прямое присваивание indexedDB=...) — та же замена, что и в
  // workerCore.test.ts/workerCore.dialogs.test.ts, без нового eslint(no-global-assign).
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

/** Поднимает воркер с диалогом chatId=1 уже в кэше dialogsManager (через fillMirror). */
async function bootWithSeededDialog(): Promise<{ dialogOps: DialogOp[] }> {
  await saveDialogs([dialog(1, '2026-08-01T00:00:00Z')])
  const core = createWorkerCore()
  const [epWorker, epTab] = pair()
  core.bind(epWorker)
  const tab = new SuperMessagePort(epTab)
  const dialogOps: DialogOp[] = []
  tab.on('rt:dialog_op', (p) => dialogOps.push(...(p as { ops: DialogOp[] }).ops))
  await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })
  dialogOps.length = 0 // интересуют только операции от самого кадра, не reset из fillMirror
  expect(capturedConnDeps).not.toBeNull()
  return { dialogOps }
}

describe('createWorkerCore(): realtime-кадры применяет владелец (Task 3)', () => {
  it('new_message (без pts) → dialogs.applyNewMessage → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('new_message', {
      chat_id: 1, msg_id: 9, seq: 2, sender_id: 9, type: 'text', text: 'привет',
      media_id: null, created_at: '2026-08-01T00:00:01Z',
    })

    expect(dialogOps).toHaveLength(1)
    const op = dialogOps[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.chatId).toBe(1)
    expect(op.fields.lastMessage?.text).toBe('привет')
  })

  // `core.start()` здесь не звался (см. докблок выше) — `me` в воркере null,
  // поэтому applyRead(e, meId) идёт веткой «чужое прочтение» (meId=null !==
  // user_id=7); ветка «моё прочтение» и её идемпотентность — предмет
  // dialogsManager.test.ts, здесь важен сам факт вызова владельца из dispatch.
  it('read (без pts) → dialogs.applyRead → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('read', { chat_id: 1, user_id: 7, up_to_seq: 1 })

    expect(dialogOps).toEqual([{ op: 'patch', chatId: 1, fields: { peerReadSeq: 1 } }])
  })

  it('chat_update (без pts) → dialogs.applyChatMeta → rt:dialog_op patch, index не участвует', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_update', { chat_id: 1, title: 'Новое имя' })

    expect(dialogOps).toEqual([{ op: 'patch', chatId: 1, fields: { title: 'Новое имя' } }])
  })

  it('chat_removed (без pts) → dialogs.applyRemoved → rt:dialog_op remove', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_removed', { chat_id: 1, removed: true })

    expect(dialogOps).toEqual([{ op: 'remove', chatId: 1 }])
  })

  // author_id/user_id в payload сверяются с me?.id — в этом стенде core.start() не
  // звался (только bind()), поэтому `me` остаётся null: author_id тоже не задаём
  // (undefined === undefined), реагирующий (user_id) — любой другой id.
  it('reaction на моё сообщение от чужого (без pts) → dialogs.bumpUnreadReactions → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('reaction', {
      chat_id: 1, msg_id: 5, user_id: 9, emoji: '👍', action: 'add', unread_reactions: 3,
    })

    expect(dialogOps).toEqual([{ op: 'patch', chatId: 1, fields: { unreadReactions: 3 } }])
  })

  it('reaction от меня самого — bumpUnreadReactions НЕ зовётся (isMine)', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // user_id не задан → тоже undefined === me?.id, т.е. «это моя реакция» — гасим бампинг.
    capturedConnDeps!.onFrame('reaction', {
      chat_id: 1, msg_id: 5, action: 'add', emoji: '👍', unread_reactions: 3,
    })

    expect(dialogOps).toEqual([])
  })
})
