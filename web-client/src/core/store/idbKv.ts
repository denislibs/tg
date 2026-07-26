// Minimal IndexedDB key/value store (one object store). Usable in a Worker.
const DB = 'msgr'
const STORE = 'kv'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
  })
}

export const idbGet = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key))
export const idbSet = (key: string, val: unknown) => tx<void>('readwrite', (s) => s.put(val, key))
export const idbDel = (key: string) => tx<void>('readwrite', (s) => s.delete(key))
