// keyStore.ts — device-local хранилище ключей секретных чатов в IndexedDB.
// CryptoKey structured-clonable → хранится как есть, оставаясь non-extractable.
export interface StoredKey { key: CryptoKey; fingerprint: Uint8Array }

const DB = 'secret-chats'
const KEYS = 'keys'
// Приватный ECDH-ключ инициатора между start и complete: общий ключ выводится
// только когда придёт pub получателя, а пару надо пережить перезагрузку.
const PENDING = 'pending'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const db = req.result
      // идемпотентно: апгрейд v1→v2 добавляет только недостающий 'pending'
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS)
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export function saveKey(chatId: number, v: StoredKey): Promise<void> {
  return tx(KEYS, 'readwrite', (s) => s.put(v, chatId)).then(() => undefined)
}
export async function loadKey(chatId: number): Promise<StoredKey | null> {
  return (await tx<StoredKey | undefined>(KEYS, 'readonly', (s) => s.get(chatId))) ?? null
}
export function deleteKey(chatId: number): Promise<void> {
  return tx(KEYS, 'readwrite', (s) => s.delete(chatId)).then(() => undefined)
}

export function savePending(chatId: number, priv: CryptoKey): Promise<void> {
  return tx(PENDING, 'readwrite', (s) => s.put(priv, chatId)).then(() => undefined)
}
export async function loadPending(chatId: number): Promise<CryptoKey | null> {
  return (await tx<CryptoKey | undefined>(PENDING, 'readonly', (s) => s.get(chatId))) ?? null
}
export function clearPending(chatId: number): Promise<void> {
  return tx(PENDING, 'readwrite', (s) => s.delete(chatId)).then(() => undefined)
}
