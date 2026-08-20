// Тесты нормализованного офлайн-персиста. Реальный IndexedDB эмулируется
// fake-indexeddb; passcode читается из msgr/kv (idbKv) — тот же fake-IDB.
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { idbDel } from './idbKv'
import {
  persistScope, persistClearAll, persistGetToken,
  saveDialogs, loadDialogs, saveMe, loadMe,
  saveUsers, loadUsers,
  saveMessages, loadMessages, deletePersistedMessage, clearPersistedChat,
  saveFolders, loadFolders, saveDrafts, loadDrafts,
  DB_VERSION,
} from './persist'
import type { Dialog, MessageReal, MyMessage, Draft } from '../models'
import type { Folder } from '../managers/foldersManager'
import type { PeerProfile } from '../managers/authManager'
import { makeDialog, makeLastMessage } from '../dialogs/testDialog'

// passcode-лок (locked()) мемоизирован на 3с внутри модуля, поэтому его переключение
// здесь не тестируем (флаки по времени); проверяем только логику стора при откл. коде.

const dialog = (peerId: number, secret = false, last?: Partial<MessageReal>): Dialog =>
  makeDialog({
    peerId,
    secret,
    lastMessage: last
      ? { ...makeLastMessage({ peerId, id: 1, fromId: 1, createdAt: '2026-01-01T00:00:00Z' }), ...last }
      : undefined,
  })

const msg = (peerId: number, id: number, over: Partial<MessageReal> = {}): MyMessage =>
  ({ ...makeLastMessage({ peerId, id, fromId: 1, text: `m${id}`, createdAt: '2026-01-01T00:00:00Z' }), ...over })

async function wipe(): Promise<void> {
  await idbDel('passcode')
  await persistClearAll()
}

describe('persist (normalized offline store)', () => {
  beforeEach(wipe)

  it('round-trips dialogs and me', async () => {
    await persistScope('tok')
    await saveDialogs([dialog(1), dialog(2)])
    await saveMe({ user: { _: 'user', id: 7, first_name: 'Me' }, fullUser: { _: 'userFull', id: 7 }, canMessage: true } as PeerProfile)
    expect((await loadDialogs()).map((d) => d.peerId).sort((a, b) => a - b)).toEqual([1, 2])
    expect((await loadMe())?.user.id).toBe(7)
  })

  it('round-trips folders and drafts', async () => {
    const folder: Folder = { id: 1, title: 'Work', pos: 0, contacts: false, nonContacts: false, groups: true, broadcasts: false, excludeMuted: false, excludeRead: false, includeChats: [5], excludeChats: [] }
    const draft: Draft = { peerId: 9, text: 'wip', replyToId: null, updatedAt: '2026-01-01T00:00:00Z' }
    await saveFolders([folder])
    await saveDrafts([draft])
    expect((await loadFolders()).map((f) => f.title)).toEqual(['Work'])
    expect((await loadDrafts()).map((d) => d.peerId)).toEqual([9])
  })

  it('clears folders + drafts on account switch', async () => {
    await persistScope('A')
    await saveFolders([{ id: 1, title: 'X', pos: 0, contacts: false, nonContacts: false, groups: true, broadcasts: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [] }])
    await saveDrafts([{ peerId: 1, text: 't', replyToId: null, updatedAt: '2026-01-01T00:00:00Z' }])
    await persistScope('B') // смена аккаунта
    expect(await loadFolders()).toEqual([])
    expect(await loadDrafts()).toEqual([])
  })

  it('round-trips users (merge by id)', async () => {
    await saveUsers([{ _: 'user', id: 1, username: 'a', first_name: 'A' }])
    await saveUsers([{ _: 'user', id: 2, username: 'b', first_name: 'B' }])
    expect((await loadUsers()).map((u) => u.id).sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('round-trips + deletes messages by chat', async () => {
    await saveMessages(10, [msg(10, 1), msg(10, 2), msg(10, 3)])
    await saveMessages(20, [msg(20, 1)])
    expect((await loadMessages(10)).map((m) => m.id)).toEqual([1, 2, 3]) // ascending
    expect((await loadMessages(20)).map((m) => m.id)).toEqual([1])
    await deletePersistedMessage(10, 2)
    expect((await loadMessages(10)).map((m) => m.id)).toEqual([1, 3])
    await clearPersistedChat(10)
    expect(await loadMessages(10)).toEqual([])
    expect((await loadMessages(20)).length).toBe(1) // другой чат не тронут
  })

  it('does not persist secret plaintext (dialogs preview + messages)', async () => {
    await saveDialogs([dialog(1, true, { message: 'secret preview', enc_body: 'cipher' })])
    const [d] = await loadDialogs()
    expect((d.lastMessage as MessageReal | undefined)?.message).toBe('')
    expect((d.lastMessage as MessageReal | undefined)?.enc_body).toBeUndefined()

    // Двух признаков, а не трёх: отдельного `type === 'encrypted'` больше нет —
    // вид сообщения производится из `enc_body`, а не едет полем рядом.
    await saveMessages(1, [msg(1, 1, { secret: true, message: 'plain' }), msg(1, 2, { enc_body: 'x' })])
    expect(await loadMessages(1)).toEqual([]) // оба отфильтрованы
  })

  it('persistScope clears data only when switching to a different non-null token', async () => {
    await persistScope('A')
    await saveDialogs([dialog(1)])
    await saveMessages(1, [msg(1, 1)])

    await persistScope('A') // тот же токен — no-op
    expect((await loadDialogs()).length).toBe(1)

    await persistScope('B') // смена аккаунта — стереть
    expect(await loadDialogs()).toEqual([])
    expect(await loadMessages(1)).toEqual([])
    expect(await persistGetToken()).toBe('B')
  })

  it('adopts data on null→token (fresh login) without clearing', async () => {
    // данные персистнуты в сессии, когда meta.token ещё null
    await saveDialogs([dialog(5)])
    expect(await persistGetToken()).toBeNull()
    await persistScope('newtok') // первая привязка после входа — не стирать
    expect((await loadDialogs()).map((d) => d.peerId)).toEqual([5])
    expect(await persistGetToken()).toBe('newtok')
  })

  // ── Микротаск-батчинг записей ────────────────────────────────────────────────

  it('coalesces N rapid saveMessages in one tick into a single readwrite transaction', async () => {
    // Прогрев: persistScope прогревает memoized locked()-кэш (false), а первый
    // saveMessages открывает БД — чтобы замер считал только транзакции пачки.
    await persistScope('tok')
    await saveMessages(1, [msg(1, 1)])

    // eslint-disable-next-line @typescript-eslint/unbound-method -- намеренный monkeypatch метода прототипа для замера числа транзакций
    const orig = IDBDatabase.prototype.transaction
    let rw = 0
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof orig>): IDBTransaction {
      if (args[1] === 'readwrite') rw++
      return orig.apply(this, args)
    }
    try {
      await Promise.all([
        saveMessages(1, [msg(1, 10)]),
        saveMessages(1, [msg(1, 11)]),
        saveMessages(1, [msg(1, 12)]),
      ])
    } finally {
      IDBDatabase.prototype.transaction = orig
    }

    expect(rw).toBe(1) // три save одного тика → одна транзакция
    expect((await loadMessages(1)).map((m) => m.id)).toEqual([1, 10, 11, 12])
  })

  it('read-after-write: loadMessages sees enqueued-but-not-yet-flushed writes in the same tick', async () => {
    await persistScope('tok') // прогрев locked()-кэша
    const p1 = saveMessages(2, [msg(2, 1)])
    const p2 = saveMessages(2, [msg(2, 2)])
    // p1/p2 намеренно НЕ ждём по отдельности: read обязан сфлашить буфер до чтения
    expect((await loadMessages(2)).map((m) => m.id)).toEqual([1, 2])
    await Promise.all([p1, p2]) // и промисы записи резолвятся по факту коммита
  })

  it('read-after-write across stores + program order within a batch (clear then puts)', async () => {
    await persistScope('tok')
    const pu = saveUsers([{ _: 'user', id: 1, username: 'a', first_name: 'A' }])
    expect((await loadUsers()).map((u) => u.id)).toEqual([1]) // видно до явного await pu
    await pu

    // saveDialogs кладёт в ОДИН батч [clear, put, put]: операции проигрываются в
    // одной транзакции в порядке постановки — clear идёт первым, puts после него
    // выживают. Это тот же механизм, что и «delete после put того же ключа побеждает».
    await saveDialogs([dialog(1), dialog(2)])
    expect((await loadDialogs()).map((d) => d.peerId).sort((a, b) => a - b)).toEqual([1, 2])
  })

  // ── Схема/миграции ────────────────────────────────────────────────────────────

  it('opening at current VERSION is a no-op upgrade and preserves user data (no wipe)', async () => {
    await persistScope('tok')
    await saveMessages(4, [msg(4, 1), msg(4, 2)])

    // Независимое соединение к тому же msgr-store на текущей VERSION: onupgradeneeded
    // не должен сработать (oldVersion уже == VERSION), схема и данные — на месте.
    let upgraded = false
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('msgr-store', DB_VERSION)
      req.onupgradeneeded = () => { upgraded = true }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      expect(upgraded).toBe(false) // апгрейда нет — данные не тронуты
      expect([...db.objectStoreNames].sort()).toEqual(['chats', 'dialogs', 'messages', 'meta', 'state', 'users'])
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const r = db.transaction('messages', 'readonly').objectStore('messages').index('byPeer').getAll(IDBKeyRange.only(4))
        r.onsuccess = () => resolve(r.result as unknown[])
        r.onerror = () => reject(r.error)
      })
      expect(rows.length).toBe(2) // сообщения пережили reopen
    } finally {
      db.close()
    }
  })
})
