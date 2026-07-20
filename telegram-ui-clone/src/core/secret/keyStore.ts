// keyStore.ts — device-local хранилище ключей секретных чатов в IndexedDB.
// CryptoKey structured-clonable → хранится как есть, оставаясь non-extractable.
export interface StoredKey { key: CryptoKey; fingerprint: Uint8Array }

const DB = 'secret-chats'
const STORE = 'keys'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export function saveKey(chatId: number, v: StoredKey): Promise<void> {
  return tx('readwrite', (s) => s.put(v, chatId)).then(() => undefined)
}
export async function loadKey(chatId: number): Promise<StoredKey | null> {
  return (await tx<StoredKey | undefined>('readonly', (s) => s.get(chatId))) ?? null
}
export function deleteKey(chatId: number): Promise<void> {
  return tx('readwrite', (s) => s.delete(chatId)).then(() => undefined)
}
