// Нормализованный офлайн-персист (аналог tweb appStoragesManager / loadStorages):
// диалоги, юзеры и сообщения хранятся по id в IndexedDB и поднимаются на холодном
// старте до сети (offline-first). В отличие от прежнего chats_cache (последние 100
// диалогов, без сообщений) — полный нормализованный стор:
//   • dialogs  — весь список (keyPath peerId);
//   • users    — карточки пиров, конструктор `user` целиком (keyPath id);
//   • messages — история чатов (keyPath `${peerId}:${seq}`, индекс byPeer);
//   • meta     — token (скоуп мультиаккаунта) + me (свой профиль для мгновенного UI).
//
// ЕДИНЫЙ writer — воркер. Все saveX/persistClearAll вызываются из менеджеров воркера:
// peersManager/messagesManager — напрямую; dialogs — из `dialogsManager.ts`
// (владелец списка, дебаунс после каждой публикации операций, Task 5); me — из
// `workerCore.ts::setMe` (write-through, тот же воркерный владелец факта); ключи
// State (folders/drafts/…) — write-through через persistManager. Один SharedWorker
// = одно readwrite-соединение на все вкладки, без конкуренции за транзакции одной
// БД. main — только READER (loadX на холодном старте, State — `loadStateOnce` в
// `client/boot.ts`). persistScope зовётся и там, и там (идемпотентно).
//
// Инварианты безопасности (как в chats_cache):
//   • скоуп по session_token — при смене аккаунта данные предыдущего стираются;
//   • под passcode-локом ничего не пишем и не читаем (нет plaintext at rest);
//   • секретные чаты (E2E) не персистятся в открытом виде (text/encBody вырезаются).
//
// Чистый IndexedDB, без DOM — работает и в воркере, и в main-thread (одна БД origin).
import { idbGet } from './idbKv'
import type { Dialog, Message, Draft } from '../models'
import type { Chat, UserReal } from '../peers/peer'
import type { PeerProfile } from '../managers/authManager'
import type { Folder } from '../managers/foldersManager'
import type { AppState } from '../state/state'

const DB = 'msgr-store'
/** Текущая версия схемы. Экспортируется для тестов, чтобы они не прибивались к литералу. */
export const DB_VERSION = 4
const VERSION = DB_VERSION
const S_META = 'meta'
const S_DIALOGS = 'dialogs'
const S_USERS = 'users'
const S_CHATS = 'chats'
const S_MESSAGES = 'messages'
const S_STATE = 'state'

// Карточка пира в офлайн-сторе — КОНСТРУКТОР `user` схемы целиком, ровно тот,
// что приехал с провода. Прежняя плоская запись `{id, username, displayName,
// avatarUrl, avatarPreview}` формы не имела: `display_name` с провода убран
// (имя собирает клиент), а пять полей аватарки схлопнулись в `photo`.
export type PersistUser = UserReal

// Карточка ЧАТА в офлайн-сторе — конструктор `channel` схемы. Отдельный стор, а
// не общий с пользователями: ключ там `id`, а сырые id чата и человека живут в
// РАЗНЫХ пространствах и совпадают сплошь и рядом (`channel.id === user.id`
// вполне обычное дело) — одна Map склеила бы две разные карточки.
//
// Появился вместе с контейнером `/chats` (шаг C диалогов): до него имя и
// аватарка группы ехали в КАЖДОЙ строке диалога и персистились вместе с ней;
// теперь тело чата едет вектором `chats` контейнера, и без этого стора холодный
// ОФЛАЙН-старт показал бы группы без имён.
export type PersistChat = Chat

interface StoredMessage extends Message { pk: string }

// ── Схема + миграции ────────────────────────────────────────────────────────
// Явный детерминированный путь апгрейда (аналог build-gated VERSION-шага в tweb
// loadState). Ключ MIGRATIONS — ЦЕЛЕВАЯ версия; шаг переводит БД со схемы (v-1) на v.
// В onupgradeneeded прогоняем шаги от oldVersion+1 до VERSION по порядку — так и
// новый пользователь (oldVersion=0), и апгрейд существующего идут одним кодом.
//
// Конвенция при изменении схемы/формы данных:
//   1) подними VERSION на 1;
//   2) добавь запись MIGRATIONS[<новая версия>] с шагом апгрейда;
//   3) шаг ТОЛЬКО расширяет/переливает (createObjectStore / createIndex / перезапись
//      записей через переданный versionchange-tx). НИКОГДА не стирай данные юзера —
//      миграция должна пережить существующий офлайн-стор, а не обнулить его;
//   4) старые шаги не трогай — они гарантируют апгрейд с любой прежней версии.
type Migration = (db: IDBDatabase, tx: IDBTransaction) => void

const MIGRATIONS: Record<number, Migration> = {
  // v1 — базовая схема. Гварды contains() делают шаг идемпотентным на случай
  // частично созданной БД, но реально он исполняется лишь при oldVersion < 1.
  1: (db) => {
    if (!db.objectStoreNames.contains(S_META)) db.createObjectStore(S_META)
    if (!db.objectStoreNames.contains(S_DIALOGS)) db.createObjectStore(S_DIALOGS, { keyPath: 'peerId' })
    if (!db.objectStoreNames.contains(S_USERS)) db.createObjectStore(S_USERS, { keyPath: 'id' })
    if (!db.objectStoreNames.contains(S_MESSAGES)) {
      db.createObjectStore(S_MESSAGES, { keyPath: 'pk' }).createIndex('byPeer', 'peerId')
    }
  },
  // v2 — стор `state`: единый объект персистентного состояния (порт tweb
  // StateStorage поверх стора `session`). Ключи out-of-line — имена полей AppState.
  // Переливаем уже накопленные folders/drafts из meta, чтобы апгрейд не сбросил
  // папки и черновики (конвенция выше: миграция расширяет, а не стирает).
  2: (db, tx) => {
    if (!db.objectStoreNames.contains(S_STATE)) db.createObjectStore(S_STATE)
    const meta = tx.objectStore(S_META)
    const state = tx.objectStore(S_STATE)
    for (const key of ['folders', 'drafts'] as const) {
      const req = meta.get(key)
      req.onsuccess = () => { if (req.result !== undefined) state.put(req.result, key) }
    }
  },
  // v3 — переезд на знаковый `PeerId` и модель пиров схемы TL (шаг D порта).
  //
  // ЕДИНСТВЕННЫЙ шаг, который данные НЕ переливает, а пересоздаёт сторы, и это
  // назвать надо вслух (конвенция выше требует расширять, а не стирать):
  //  • у диалогов сменился keyPath (`peerId` → `peerId`), у сообщений — имя и
  //    поле индекса (`byChat`/`peerId` → `byPeer`/`peerId`); IndexedDB не
  //    умеет менять ни то, ни другое на месте — только пересоздать стор;
  //  • перелить было бы НЕЧЕМ. Ключ приватного диалога — это id СОБЕСЕДНИКА
  //    (см. `core/peers/peerId.ts`), и вывести его из лежащего в базе
  //    внутреннего `peerId` клиент не может: соответствие знает только сервер.
  //    Любая попытка «догадаться» тут и есть та симметризация, которая
  //    перепутывает диалоги;
  //  • у карточек пиров сменилась сама форма (плоская запись → конструктор
  //    `user`), и `display_name`, из которого только и состояло имя, с провода
  //    убран — восстанавливать нечего.
  //
  // Цена — один холодный старт без офлайн-кэша: и диалоги, и история, и
  // карточки перечитываются с сервера. Это кэш, а не источник истины: ничего,
  // кроме скорости первого экрана, не теряется. Черновики, папки и остальное
  // состояние лежат в `state`/`meta` и шагом не затрагиваются.
  3: (db) => {
    for (const store of [S_DIALOGS, S_MESSAGES, S_USERS]) {
      if (db.objectStoreNames.contains(store)) db.deleteObjectStore(store)
    }
    db.createObjectStore(S_DIALOGS, { keyPath: 'peerId' })
    db.createObjectStore(S_USERS, { keyPath: 'id' })
    db.createObjectStore(S_MESSAGES, { keyPath: 'pk' }).createIndex('byPeer', 'peerId')
  },
  // v4 — офлайн-стор КАРТОЧЕК ЧАТОВ (шаг C диалогов). Только расширение: новый
  // стор рядом с существующими, ничего не переливается и не стирается. Причина
  // — контейнер `/chats`: тело группы/канала уехало из строки диалога в вектор
  // `chats`, и персистить его теперь надо там же, где карточки людей.
  4: (db) => {
    if (!db.objectStoreNames.contains(S_CHATS)) db.createObjectStore(S_CHATS, { keyPath: 'id' })
  },
}

let dbPromise: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      const tx = req.transaction
      if (!tx) return
      // Прогон миграций по порядку версий: oldVersion+1 … VERSION.
      for (let v = event.oldVersion + 1; v <= VERSION; v++) MIGRATIONS[v]?.(db, tx)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

// ── Микротаск-батчинг записей (аналог tweb AppStorage saveThrottled/_save) ────
// Прежде каждый saveX открывал СВОЮ readwrite-транзакцию — при пагинации истории и
// живом потоке сообщений это была тяжёлая write-amplification. Теперь put/delete
// копятся в in-memory буфере по каждому стору и сбрасываются ОДНОЙ транзакцией на
// границе микротаска: N быстрых saveMessages в одном тике → одна транзакция.
// Порядок операций сохраняется программный (delete после put того же ключа
// побеждает — они лягут в tx в том же порядке). Возвращаемый промис резолвится по
// oncomplete транзакции — вызывающие делают void, но тесты видят реальную запись.
type Op =
  | { kind: 'put'; value: unknown; key?: IDBValidKey } // key — только для out-of-line стора meta
  | { kind: 'delete'; key: IDBValidKey }
  | { kind: 'clear' }
  | { kind: 'clearByPeer'; peerId: PeerId } // курсорное удаление истории чата по индексу byPeer

interface Batch {
  ops: Op[]
  promise: Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
}

const pending = new Map<string, Batch>()

// Поставить операции в очередь стора. Первый enqueue тика создаёт батч и планирует
// сброс на queueMicrotask; последующие в том же тике доливают в тот же батч и
// получают тот же промис (все резолвятся по завершении единой транзакции).
function enqueue(store: string, ...ops: Op[]): Promise<void> {
  let b = pending.get(store)
  if (!b) {
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    b = { ops: [], promise, resolve, reject }
    pending.set(store, b)
    queueMicrotask(() => flush(store))
  }
  b.ops.push(...ops)
  return b.promise
}

function applyOp(s: IDBObjectStore, op: Op): void {
  switch (op.kind) {
    case 'put': if (op.key !== undefined) s.put(op.value, op.key); else s.put(op.value); break
    case 'delete': s.delete(op.key); break
    case 'clear': s.clear(); break
    case 'clearByPeer': {
      const req = s.index('byPeer').openKeyCursor(IDBKeyRange.only(op.peerId))
      req.onsuccess = () => { const c = req.result; if (c) { s.delete(c.primaryKey); c.continue() } }
      break
    }
  }
}

// Сбросить накопленный батч стора одной транзакцией. Забираем батч из map ДО
// открытия БД: любые enqueue после этого попадут уже в новый батч (следующий тик),
// а зафиксированный тут b.ops больше не меняется.
function flush(store: string): void {
  const b = pending.get(store)
  if (!b) return
  pending.delete(store)
  open().then((db) => {
    const tx = db.transaction(store, 'readwrite')
    const s = tx.objectStore(store)
    for (const op of b.ops) applyOp(s, op)
    tx.oncomplete = () => b.resolve()
    tx.onerror = () => b.reject(tx.error)
    tx.onabort = () => b.reject(tx.error)
  }).catch((e: unknown) => b.reject(e))
}

// Дождаться сброса незакоммиченных записей стора — гарантия read-after-write: read
// увидит уже поставленные в очередь, но ещё не слитые в IDB put/delete этого тика.
function flushStore(store: string): Promise<void> {
  return pending.get(store)?.promise ?? Promise.resolve()
}

// Один readonly-запрос (с flush-before-read для консистентности с буфером записи).
function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return flushStore(store)
    .then(() => open())
    .then((db) => new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(store, 'readonly').objectStore(store))
      r.onsuccess = () => resolve(r.result as T)
      r.onerror = () => reject(r.error)
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
    const writes: Promise<void>[] = []
    if (prev) { // был другой аккаунт — стереть его данные
      writes.push(
        enqueue(S_DIALOGS, { kind: 'clear' }),
        enqueue(S_USERS, { kind: 'clear' }),
        enqueue(S_MESSAGES, { kind: 'clear' }),
        enqueue(S_META, { kind: 'delete', key: 'me' }, { kind: 'delete', key: 'folders' }, { kind: 'delete', key: 'drafts' }),
        enqueue(S_STATE, { kind: 'clear' }),
      )
    }
    writes.push(enqueue(S_META, token ? { kind: 'put', value: token, key: 'token' } : { kind: 'delete', key: 'token' }))
    await Promise.all(writes)
  } catch { /* idb недоступен */ }
}

export async function persistClearAll(): Promise<void> {
  try {
    await Promise.all([
      enqueue(S_DIALOGS, { kind: 'clear' }),
      enqueue(S_USERS, { kind: 'clear' }),
      enqueue(S_CHATS, { kind: 'clear' }),
      enqueue(S_MESSAGES, { kind: 'clear' }),
      enqueue(S_META, { kind: 'clear' }),
      enqueue(S_STATE, { kind: 'clear' }),
    ])
  } catch { /* idb недоступен */ }
}

// ── Диалоги + me (пишет владелец факта в воркере — dialogsManager/setMe, Task 5) ──

// Секретные чаты: не персистим расшифрованный текст/шифр-блоб превью (E2E).
// Признак секретного — НАШ параметр `secret` самого конструктора `dialog`
// (решение Р9), а не прежняя строка `type === 'secret'`.
function sanitizeDialog(d: Dialog): Dialog {
  if (!d.secret || !d.lastMessage) return d
  return { ...d, lastMessage: { ...d.lastMessage, text: '', entities: undefined, encBody: undefined } }
}

export async function saveDialogs(dialogs: Dialog[]): Promise<void> {
  if (await locked()) return
  try {
    // clear + put'ы в одном батче: clear стоит первым, поэтому старый список
    // затирается, а новые диалоги ложатся поверх (program order сохранён).
    const ops: Op[] = [{ kind: 'clear' }]
    for (const d of dialogs) ops.push({ kind: 'put', value: sanitizeDialog(d) })
    await enqueue(S_DIALOGS, ...ops)
  } catch { /* idb недоступен */ }
}

export async function loadDialogs(): Promise<Dialog[]> {
  if (await locked()) return []
  try { return (await read<Dialog[]>(S_DIALOGS, (s) => s.getAll())) ?? [] } catch { return [] }
}

export async function saveMe(me: PeerProfile | null): Promise<void> {
  if (await locked()) return
  try { await enqueue(S_META, me ? { kind: 'put', value: me, key: 'me' } : { kind: 'delete', key: 'me' }) } catch { /* idb недоступен */ }
}

export async function loadMe(): Promise<PeerProfile | null> {
  if (await locked()) return null
  try {
    // Записи прошлой формы (плоская карточка с display_name/avatar_url) после
    // миграции v3 в этом сторе лежать не могут — ключ `me` живёт в `meta`,
    // который шагом не пересоздаётся, поэтому старую форму отсекаем по
    // отсутствию конструктора: без `_` это не `user`, и читателю она врёт.
    const me = (await read<PeerProfile | undefined>(S_META, (s) => s.get('me'))) ?? null
    return me?.user?._ === 'user' ? me : null
  } catch { return null }
}

// ── Папки + черновики (снапшот собирает подписка на main, пишет воркер) ─────────
// Небольшие списки — храним целым блобом в meta (как tweb: filtersArr / drafts в
// state), а не отдельным стором. Черновики — локальный ввод пользователя, поэтому
// под passcode-локом не персистятся (общий гард locked()).

export async function saveFolders(folders: Folder[]): Promise<void> {
  if (await locked()) return
  try { await enqueue(S_META, { kind: 'put', value: folders, key: 'folders' }) } catch { /* idb недоступен */ }
}

export async function loadFolders(): Promise<Folder[]> {
  if (await locked()) return []
  try { return (await read<Folder[] | undefined>(S_META, (s) => s.get('folders'))) ?? [] } catch { return [] }
}

export async function saveDrafts(drafts: Draft[]): Promise<void> {
  if (await locked()) return
  try { await enqueue(S_META, { kind: 'put', value: drafts, key: 'drafts' }) } catch { /* idb недоступен */ }
}

export async function loadDrafts(): Promise<Draft[]> {
  if (await locked()) return []
  try { return (await read<Draft[] | undefined>(S_META, (s) => s.get('drafts'))) ?? [] } catch { return [] }
}

// ── Юзеры (пишет peersManager воркера) ─────────────────────────────────────────

export async function saveUsers(users: PersistUser[]): Promise<void> {
  if (!users.length || (await locked())) return
  try { await enqueue(S_USERS, ...users.map((u): Op => ({ kind: 'put', value: u }))) } catch { /* idb недоступен */ }
}

export async function loadUsers(): Promise<PersistUser[]> {
  if (await locked()) return []
  try { return (await read<PersistUser[]>(S_USERS, (s) => s.getAll())) ?? [] } catch { return [] }
}

// ── Чаты (пишет тот же peersManager воркера) ───────────────────────────────────

export async function saveChats(chats: PersistChat[]): Promise<void> {
  if (!chats.length || (await locked())) return
  try { await enqueue(S_CHATS, ...chats.map((c): Op => ({ kind: 'put', value: c }))) } catch { /* idb недоступен */ }
}

export async function loadChats(): Promise<PersistChat[]> {
  if (await locked()) return []
  try { return (await read<PersistChat[]>(S_CHATS, (s) => s.getAll())) ?? [] } catch { return [] }
}

// ── Сообщения (пишет messagesManager воркера) ──────────────────────────────────

export async function saveMessages(peerId: PeerId, msgs: Message[]): Promise<void> {
  if (await locked()) return
  // Секретные (E2E) не персистим в открытом виде: text/entities расшифрованы в памяти.
  const safe = msgs.filter((m) => !m.secret && !m.encBody && m.type !== 'encrypted')
  if (!safe.length) return
  try {
    await enqueue(S_MESSAGES, ...safe.map((m): Op => ({ kind: 'put', value: { ...m, pk: `${peerId}:${m.seq}` } })))
  } catch { /* idb недоступен */ }
}

export async function loadMessages(peerId: PeerId): Promise<Message[]> {
  if (await locked()) return []
  try {
    const rows = await read<StoredMessage[]>(S_MESSAGES, (s) => s.index('byPeer').getAll(IDBKeyRange.only(peerId)))
    return (rows ?? [])
      .map((r) => { const m = { ...r } as Partial<StoredMessage>; delete m.pk; return m as Message })
      .sort((a, b) => a.seq - b.seq)
  } catch { return [] }
}

export async function deletePersistedMessage(peerId: PeerId, seq: number): Promise<void> {
  try { await enqueue(S_MESSAGES, { kind: 'delete', key: `${peerId}:${seq}` }) } catch { /* idb недоступен */ }
}

export async function clearPersistedChat(peerId: PeerId): Promise<void> {
  try { await enqueue(S_MESSAGES, { kind: 'clearByPeer', peerId }) } catch { /* idb недоступен */ }
}

// ── State: единый объект персистентного состояния ─────────────────────────────
// Пишется по одному ключу (tweb appStateManager.setByKey), читается ВЕСЬ одной
// транзакцией на старте (tweb loadStateForAllAccounts) — это и есть то самое
// «одно асинхронное чтение на весь запуск».

export async function saveStateKey<K extends keyof AppState>(key: K, value: AppState[K]): Promise<void> {
  if (await locked()) return
  try { await enqueue(S_STATE, { kind: 'put', value, key }) } catch { /* idb недоступен */ }
}

export async function loadStateAll(): Promise<Partial<AppState>> {
  if (await locked()) return {}
  try {
    await flushStore(S_STATE)
    const db = await open()
    return await new Promise<Partial<AppState>>((resolve, reject) => {
      const tx = db.transaction(S_STATE, 'readonly')
      const s = tx.objectStore(S_STATE)
      // getAll + getAllKeys в ОДНОЙ транзакции: значения и ключи приходят в
      // одинаковом порядке (спека IDB — обход по возрастанию ключа).
      const valuesReq = s.getAll()
      const keysReq = s.getAllKeys()
      tx.oncomplete = () => {
        const out: Record<string, unknown> = {}
        // Ключи стора — имена полей AppState, то есть всегда строки. Нестроковый
        // ключ ключом State быть не может, поэтому просто пропускаем такой мусор.
        keysReq.result.forEach((k, i) => { if (typeof k === 'string') out[k] = valuesReq.result[i] })
        resolve(out as Partial<AppState>)
      }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { return {} }
}
