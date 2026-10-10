// Шаг v6 офлайн-стора: порог номеров клиента выровнен с tweb
// (`MESSAGE_ID_OFFSET` 0xFFFFFFFF → 0x100000000), и записи прошлого
// пространства на диске не переживают апгрейд (`core/store/persist.ts`).
//
// Отдельный файл: модуль `persist` мемоизирует соединение, поэтому базу v5
// надо положить ДО первого обращения к нему.
import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

describe('persist v6', () => {
  it('апгрейд с v5 пересоздаёт сообщения и диалоги, карточки остаются', async () => {
    const open5 = indexedDB.open('msgr-store', 5)
    open5.onupgradeneeded = () => {
      const db = open5.result
      db.createObjectStore('meta')
      db.createObjectStore('state')
      db.createObjectStore('dialogs', { keyPath: 'peerId' })
      db.createObjectStore('users', { keyPath: 'id' })
      db.createObjectStore('chats', { keyPath: 'id' })
      db.createObjectStore('messages', { keyPath: 'pk' }).createIndex('byPeer', 'peerId')
    }
    const db5 = await req(open5)
    const tx = db5.transaction(['dialogs', 'messages', 'users'], 'readwrite')
    const oldMid = 0xFFFFFFFF + 7
    tx.objectStore('dialogs').put({ peerId: 5, top_message: oldMid })
    tx.objectStore('messages').put({ pk: `5:${oldMid}`, peerId: 5, id: oldMid })
    tx.objectStore('users').put({ _: 'user', id: 9 })
    await new Promise((resolve) => { tx.oncomplete = resolve })
    db5.close()

    const { loadDialogs, loadMessages, loadUsers, DB_VERSION } = await import('./persist')
    expect(DB_VERSION).toBe(6)
    expect(await loadDialogs()).toEqual([])
    expect(await loadMessages(5)).toEqual([])
    expect((await loadUsers()).map((u) => u.id)).toEqual([9])
  })
})
