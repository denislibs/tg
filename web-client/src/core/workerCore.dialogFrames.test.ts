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

const dialog = (peerId: number, at: string): Dialog => ({
  peerId, type: 'private', title: 't' + peerId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

beforeEach(() => {
  // vi.stubGlobal (не прямое присваивание indexedDB=...) — та же замена, что и в
  // workerCore.test.ts/workerCore.dialogs.test.ts, без нового eslint(no-global-assign).
  vi.stubGlobal('indexedDB', new IDBFactory())
  capturedConnDeps = null
})

/** Поднимает воркер с диалогом peerId=1 уже в кэше dialogsManager (через fillMirror). */
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
      peer_id: 1, msg_id: 9, seq: 2, sender_id: 9, type: 'text', text: 'привет',
      media_id: null, created_at: '2026-08-01T00:00:01Z',
    })

    expect(dialogOps).toHaveLength(1)
    const op = dialogOps[0] as Extract<DialogOp, { op: 'patch' }>
    expect(op.peerId).toBe(1)
    expect(op.fields.lastMessage?.text).toBe('привет')
  })

  // `core.start()` здесь не звался (см. докблок выше) — `me` в воркере null,
  // поэтому applyRead(e, meId) идёт веткой «чужое прочтение» (meId=null !==
  // user_id=7); ветка «моё прочтение» и её идемпотентность — предмет
  // dialogsManager.test.ts, здесь важен сам факт вызова владельца из dispatch.
  it('read (без pts) → dialogs.applyRead → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('read', { peer_id: 1, user_id: 7, up_to_seq: 1 })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { peerReadSeq: 1 } }])
  })

  it('chat_update (без pts) → dialogs.applyChatMeta → rt:dialog_op patch, index не участвует', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // Кадр несёт `messages.chatFull` — ТОТ ЖЕ объект, что отдаёт ручка
    // карточки чата; своей формы у кадра больше нет.
    capturedConnDeps!.onFrame('chat_update', {
      peer_id: 1,
      chat_full: {
        _: 'messages.chatFull',
        full_chat: { _: 'channelFull', id: 1, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
        chats: [{ _: 'channel', id: 1, title: 'Новое имя', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }],
        users: [],
      },
    })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { title: 'Новое имя', username: undefined, photo: { _: 'chatPhotoEmpty' }, isForum: undefined } }])
  })

  // Пин пробела D2.5 №1 на втором его пути. Кадр `chat_update` несёт
  // АБСОЛЮТНЫЙ снимок карточки, из которого строке диалога нужны четыре поля;
  // весь остальной чат (`pFlags`, права, `default_banned_rights`) живёт в
  // зеркале пиров и попадает туда ТОЛЬКО через `peers.saveApiPeers` в
  // `dispatch` (порт `apiUpdatesManager.processUpdateMessage:239-240`).
  // Удаление той строки красит этот кейс: `rt:peer_op` не уйдёт вовсе.
  it('chat_update → peers.saveApiPeers → rt:peer_op с конструктором чата', async () => {
    await saveDialogs([dialog(1, '2026-08-01T00:00:00Z')])
    const core = createWorkerCore()
    const [epWorker, epTab] = pair()
    core.bind(epWorker)
    const tab = new SuperMessagePort(epTab)
    const peerOps: { op: string; peers: unknown[] }[] = []
    tab.on('rt:peer_op', (p) => peerOps.push(...(p as { ops: { op: string; peers: unknown[] }[] }).ops))
    await tab.invoke('manager', { name: 'dialogs', method: 'fillMirror', args: [] })

    const chat = { _: 'channel', id: 1, title: 'Новое имя', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }
    capturedConnDeps!.onFrame('chat_update', {
      peer_id: 1,
      chat_full: {
        _: 'messages.chatFull',
        full_chat: { _: 'channelFull', id: 1, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
        chats: [chat],
        users: [],
      },
    })

    expect(peerOps).toEqual([{ op: 'upsert', peers: [chat] }])
  })

  it('chat_removed (без pts) → dialogs.applyRemoved → rt:dialog_op remove', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_removed', { peer_id: 1, removed: true })

    expect(dialogOps).toEqual([{ op: 'remove', peerId: 1 }])
  })

  // author_id/user_id в payload сверяются с me?.id — в этом стенде core.start() не
  // звался (только bind()), поэтому `me` остаётся null: author_id тоже не задаём
  // (undefined === undefined), реагирующий (user_id) — любой другой id.
  it('reaction на моё сообщение от чужого (без pts) → dialogs.bumpUnreadReactions → rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('reaction', {
      peer_id: 1, msg_id: 5, user_id: 9, emoji: '👍', action: 'add', unread_reactions: 3,
    })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { unreadReactions: 3 } }])
  })

  it('reaction от меня самого — bumpUnreadReactions НЕ зовётся (isMine)', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    // user_id не задан → тоже undefined === me?.id, т.е. «это моя реакция» — гасим бампинг.
    capturedConnDeps!.onFrame('reaction', {
      peer_id: 1, msg_id: 5, action: 'add', emoji: '👍', unread_reactions: 3,
    })

    expect(dialogOps).toEqual([])
  })
})

// Task 4 (действия без оптимистики): то же действие с ДРУГОГО устройства/вкладки
// доезжает этими 4 кадрами (backend logAndPublish на все устройства владельца/
// участников) — проверяем, что workerCore.ts::dispatch реально зовёт применялку
// владельца (не только что dialogsManager сам умеет считать patch из этих
// аргументов — это отдельно покрыто dialogsManager.test.ts), и что применение
// происходит РОВНО ОДИН РАЗ (ops длиной 1, не 2 — раньше эти же 4 кадра ЕЩЁ и
// разбирала витрина напрямую через storeProjection.ts/chatsStore-мутаторы;
// тот путь убран вместе с мутаторами — второго применения быть не может).
describe('createWorkerCore(): realtime-эхо действий (mute/pin/archive/theme) применяет владелец РОВНО ОДИН РАЗ (Task 4)', () => {
  it('dialog_mute (без pts) → dialogs.applyMute → ровно один rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('dialog_mute', { peer_id: 1, muted: true })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { muted: true } }])
  })

  it('dialog_archive (без pts) → dialogs.applyArchived → ровно один rt:dialog_op patch (сбрасывает pinned)', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('dialog_archive', { peer_id: 1, archived: true })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { archived: true, pinned: false } }])
  })

  it('chat_theme_update (без pts) → dialogs.applyTheme → ровно один rt:dialog_op patch', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('chat_theme_update', { peer_id: 1, theme_id: 'sunset' })

    expect(dialogOps).toEqual([{ op: 'patch', peerId: 1, fields: { themeId: 'sunset' } }])
  })

  it('dialog_pin (без pts) → dialogs.applyPinned → ровно один патч + reindex, не двойное применение', async () => {
    const { dialogOps } = await bootWithSeededDialog()

    capturedConnDeps!.onFrame('dialog_pin', { peer_id: 1, pinned: true })

    // patch (поле pinned) + reindex (порядок закреплённых) — обе от ОДНОГО
    // вызова applyPinned, не два независимых применения одного и того же факта.
    expect(dialogOps).toHaveLength(2)
    expect(dialogOps[0]).toMatchObject({ op: 'patch', peerId: 1, fields: { pinned: true } })
    expect(dialogOps[1]).toMatchObject({ op: 'reindex' })
  })
})
