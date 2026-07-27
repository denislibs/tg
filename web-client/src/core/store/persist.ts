// Нормализованный офлайн-персист (аналог tweb appStoragesManager / loadStorages):
// диалоги, юзеры и сообщения хранятся по id в IndexedDB и поднимаются на холодном
// старте до сети (offline-first). В отличие от прежнего chats_cache (последние 100
// диалогов, без сообщений) — полный нормализованный стор:
//   • dialogs  — весь список (keyPath chatId), пишет main-thread-стор;
//   • users    — peer-метаданные (keyPath id), пишет peersManager воркера;
//   • messages — история чатов (keyPath `${chatId}:${seq}`, индекс byChat),
//                пишет messagesManager воркера;
//   • meta     — token (скоуп мультиаккаунта) + me (свой профиль для мгновенного UI).
//
// Инварианты безопасности (как в chats_cache):
//   • скоуп по session_token — при смене аккаунта данные предыдущего стираются;
//   • под passcode-локом ничего не пишем и не читаем (нет plaintext at rest);
//   • секретные чаты (E2E) не персистятся в открытом виде (text/encBody вырезаются).
//
// Чистый IndexedDB, без DOM — работает и в воркере, и в main-thread (одна БЛ origin).
import { idbGet } from './idbKv'
import type { Dialog, Message, Draft } from '../models'
import type { User } from '../managers/authManager'
import type { Folder } from '../managers/foldersManager'

const DB = 'msgr-store'
const VERSION = 1
const S_META = 'meta'
const S_DIALOGS = 'dialogs'
const S_USERS = 'users'
const S_MESSAGES = 'messages'

// Нормализованный peer (то, что отдаёт peersManager) — минимум для офлайн-резолва
// имени/аватара при отсутствии сети.
export interface PersistUser { id: number; username: string; displayName: string; avatarUrl: string }

interface StoredMessage extends Message { pk: string }

let dbPromise: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(S_META)) db.createObjectStore(S_META)
      if (!db.objectStoreNames.contains(S_DIALOGS)) db.createObjectStore(S_DIALOGS, { keyPath: 'chatId' })
      if (!db.objectStoreNames.contains(S_USERS)) db.createObjectStore(S_USERS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(S_MESSAGES)) {
        db.createObjectStore(S_MESSAGES, { keyPath: 'pk' }).createIndex('byChat', 'chatId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

// Один readonly-запрос.
function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction(store, 'readonly').objectStore(store))
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
  }))
}

// Пачка изменений в одной транзакции (резолвится по oncomplete — гарантия записи).
function write(store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
  return open().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    fn(tx.objectStore(store))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

// Passcode-лок: наличие ключа `passcode` в msgr/kv означает включённый код-пароль.
// Мемоизация на 3 с — put/get сообщений вызываются часто, но плейнтекст-at-rest
// не должен утечь дольше пары секунд после включения кода в этой же сессии.
let lockedCache: { at: number; val: boolean } | null = null
async function locked(): Promise<boolean> {
  const now = Date.now()
  if (lockedCache && now - lockedCache.at < 3000) return lockedCache.val
  let val = false
  try { val = !!(await idbGet('passcode')) } catch { val = false }
  lockedCache = { at: now, val }
  return val
}

// ── Скоуп/сброс ───────────────────────────────────────────────────────────────

export async function persistGetToken(): Promise<string | null> {
  try { return (await read<string | undefined>(S_META, (s) => s.get('token'))) ?? null } catch { return null }
}

// Привязать стор к токену. Стираем данные ТОЛЬКО при смене одного НЕПУСТОГО
// токена на другой (реальная смена аккаунта). Переход null→token — это первая
// привязка после свежего входа: данные, персистнутые в этой же сессии (когда
// meta.token ещё был null), принадлежат текущему аккаунту — их не трогаем, иначе
// первый reload после входа терял бы офлайн-стор. Идемпотентно (тот же токен —
// no-op); безопасно звать и из воркера, и из main-thread на старте.
export async function persistScope(token: string | null): Promise<void> {
  try {
    const prev = await persistGetToken()
    if (prev === token) return
    if (prev) { // был другой аккаунт — стереть его данные
      await Promise.all([
        write(S_DIALOGS, (s) => s.clear()),
        write(S_USERS, (s) => s.clear()),
        write(S_MESSAGES, (s) => s.clear()),
        write(S_META, (s) => { s.delete('me'); s.delete('folders'); s.delete('drafts') }),
      ])
    }
    await write(S_META, (s) => { if (token) s.put(token, 'token'); else s.delete('token') })
  } catch { /* idb недоступен */ }
}

export async function persistClearAll(): Promise<void> {
  try {
    await Promise.all([
      write(S_DIALOGS, (s) => s.clear()),
      write(S_USERS, (s) => s.clear()),
      write(S_MESSAGES, (s) => s.clear()),
      write(S_META, (s) => s.clear()),
    ])
  } catch { /* idb недоступен */ }
}

// ── Диалоги + me (пишет main-thread-стор через chatsCache) ─────────────────────

// Секретные чаты: не персистим расшифрованный текст/шифр-блоб превью (E2E).
function sanitizeDialog(d: Dialog): Dialog {
  if (d.type !== 'secret' || !d.lastMessage) return d
  return { ...d, lastMessage: { ...d.lastMessage, text: '', encBody: undefined } }
}

export async function saveDialogs(dialogs: Dialog[]): Promise<void> {
  if (await locked()) return
  try {
    await write(S_DIALOGS, (s) => { s.clear(); for (const d of dialogs) s.put(sanitizeDialog(d)) })
  } catch { /* idb недоступен */ }
}

export async function loadDialogs(): Promise<Dialog[]> {
  if (await locked()) return []
  try { return (await read<Dialog[]>(S_DIALOGS, (s) => s.getAll())) ?? [] } catch { return [] }
}

export async function saveMe(me: User | null): Promise<void> {
  if (await locked()) return
  try { await write(S_META, (s) => { if (me) s.put(me, 'me'); else s.delete('me') }) } catch { /* idb недоступен */ }
}

export async function loadMe(): Promise<User | null> {
  if (await locked()) return null
  try { return (await read<User | undefined>(S_META, (s) => s.get('me'))) ?? null } catch { return null }
}

// ── Папки + черновики (пишет main-thread стор подпиской, как диалоги) ──────────
// Небольшие списки — храним целым блобом в meta (как tweb: filtersArr / drafts в
// state), а не отдельным стором. Черновики — локальный ввод пользователя, поэтому
// под passcode-локом не персистятся (общий гард locked()).

export async function saveFolders(folders: Folder[]): Promise<void> {
  if (await locked()) return
  try { await write(S_META, (s) => s.put(folders, 'folders')) } catch { /* idb недоступен */ }
}

export async function loadFolders(): Promise<Folder[]> {
  if (await locked()) return []
  try { return (await read<Folder[] | undefined>(S_META, (s) => s.get('folders'))) ?? [] } catch { return [] }
}

export async function saveDrafts(drafts: Draft[]): Promise<void> {
  if (await locked()) return
  try { await write(S_META, (s) => s.put(drafts, 'drafts')) } catch { /* idb недоступен */ }
}

export async function loadDrafts(): Promise<Draft[]> {
  if (await locked()) return []
  try { return (await read<Draft[] | undefined>(S_META, (s) => s.get('drafts'))) ?? [] } catch { return [] }
}

// ── Юзеры (пишет peersManager воркера) ─────────────────────────────────────────

export async function saveUsers(users: PersistUser[]): Promise<void> {
  if (!users.length || (await locked())) return
  try { await write(S_USERS, (s) => { for (const u of users) s.put(u) }) } catch { /* idb недоступен */ }
}

export async function loadUsers(): Promise<PersistUser[]> {
  if (await locked()) return []
  try { return (await read<PersistUser[]>(S_USERS, (s) => s.getAll())) ?? [] } catch { return [] }
}

// ── Сообщения (пишет messagesManager воркера) ──────────────────────────────────

export async function saveMessages(chatId: number, msgs: Message[]): Promise<void> {
  if (await locked()) return
  // Секретные (E2E) не персистим в открытом виде: text/entities расшифрованы в памяти.
  const safe = msgs.filter((m) => !m.secret && !m.encBody && m.type !== 'encrypted')
  if (!safe.length) return
  try {
    await write(S_MESSAGES, (s) => { for (const m of safe) s.put({ ...m, pk: `${chatId}:${m.seq}` }) })
  } catch { /* idb недоступен */ }
}

export async function loadMessages(chatId: number): Promise<Message[]> {
  if (await locked()) return []
  try {
    const rows = await read<StoredMessage[]>(S_MESSAGES, (s) => s.index('byChat').getAll(IDBKeyRange.only(chatId)))
    return (rows ?? [])
      .map((r) => { const m = { ...r } as Partial<StoredMessage>; delete m.pk; return m as Message })
      .sort((a, b) => a.seq - b.seq)
  } catch { return [] }
}

export async function deletePersistedMessage(chatId: number, seq: number): Promise<void> {
  try { await write(S_MESSAGES, (s) => s.delete(`${chatId}:${seq}`)) } catch { /* idb недоступен */ }
}

export async function clearPersistedChat(chatId: number): Promise<void> {
  try {
    await write(S_MESSAGES, (s) => {
      const req = s.index('byChat').openKeyCursor(IDBKeyRange.only(chatId))
      req.onsuccess = () => { const c = req.result; if (c) { s.delete(c.primaryKey); c.continue() } }
    })
  } catch { /* idb недоступен */ }
}
