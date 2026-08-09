# Порт подхода tweb `State` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести из tweb модель чтения персистентного состояния: единый объект `State`, одно батч-чтение IndexedDB до первого рендера, дальше — только синхронные чтения из памяти и write-through записи.

**Architecture:** Сейчас у каждого стора свой асинхронный вход в IndexedDB (`loadFolders`, `loadDrafts`, `loadMe`, `loadDialogs`), часть зовётся из `boot.ts` (до рендера), часть из `useAppBootstrap` (после первой отрисовки) — отсюда рваная гидрация: список чатов есть в кадре 0, табы папок приезжают позже. tweb решает это одним объектом `State` (`config/state.ts`), который читается ОДИН раз батчем (`loadStateForAllAccountsOnce`, `loadState.ts:528-531`), ждётся до построения UI (`index.ts:455`) и кладётся в реактивный стор синхронно (`apiManagerProxy.ts:963-965` → `setAppStateSilent`). Порт повторяет ровно эту схему: `AppState` + `STATE_INIT` → однократный мемоизированный ридер → Zustand-стор с `setAppState` (write-through) / `setAppStateSilent` (гидрация) → вызов из `boot.ts` до `render()`.

**Tech Stack:** TypeScript strict (TS7 native `tsc`), React 19, Zustand 5, IndexedDB (свой слой `core/store/persist.ts`), vitest, oxlint.

## Global Constraints

- Ответы и комментарии в коде — по-русски; вёрстку/поведение брать 1:1 из tweb, не выдумывать.
- TS strict: без `any`, неиспользуемые переменные не пройдут сборку.
- Персист пишет ТОЛЬКО воркер (один writer на все вкладки); main-thread — читатель. Инвариант сохранить.
- Под passcode-локом персист не читается и не пишется (нет plaintext at rest) — гард `locked()` в `core/store/persist.ts`.
- Миграции IndexedDB только расширяют/переливают данные, никогда не стирают пользовательские (конвенция в шапке `core/store/persist.ts`).
- Перед «готово» — `npm run typecheck`, `npm test`, `npm run lint` зелёные.

### Что НЕ входит в State (важно, иначе порт разъедется с оригиналом)

В tweb `State` — маленький конфиг-блоб, который целиком сериализуется на каждое изменение ключа. Сущности там НЕ лежат: диалоги/сообщения/юзеры живут в отдельных IDB-сторах (`config/databases/state.ts:5`) и в менеджерах воркера.

Поэтому **в `AppState` не кладём**: `dialogs`, `messages`, `users`, `me`, presence, typing. Они остаются в своих сторах и своих сторах IDB как сейчас. Нарушение этого правила превратит каждое новое сообщение в перезапись всего блоба.

### Не входит в этот план

Потерянная строка модульного вызова `updateColumnWidths()` (tweb `helpers/updateColumnWidths.ts:394`) — отдельный однострочный фикс выезда колонки, к State отношения не имеет.

---

## File Structure

**Создаём:**

| Файл | Ответственность |
|---|---|
| `web-client/src/core/state/state.ts` | Форма `AppState`, `STATE_INIT`, `STATE_VERSION`, `STATE_KEYS`. Порт `config/state.ts`. |
| `web-client/src/core/state/loadState.ts` | Однократное мемоизированное чтение + версионный гейт. Порт `loadState.ts:528-531`. |
| `web-client/src/core/state/loadState.test.ts` | Тесты ридера. |
| `web-client/src/stores/appState.ts` | Реактивный стор + `setAppState` / `setAppStateSilent` / `useAppStateKey`. Порт `stores/appState.ts`. |
| `web-client/src/stores/appState.test.ts` | Тесты стора. |
| `web-client/src/core/store/persist.state.test.ts` | Тесты стора `state` в IDB и миграции v2. |
| `web-client/src/core/state/noAdHocReads.test.ts` | Инвариант: чтений персиста вне boot нет. |

**Меняем:**

| Файл | Что |
|---|---|
| `web-client/src/core/store/persist.ts` | Стор `state` + миграция v2 (перелив `meta.folders`/`meta.drafts`), `saveStateKey`, `loadStateAll`. |
| `web-client/src/core/managers/persistManager.ts` | RPC `stateKey(key, value)`. |
| `web-client/src/client/boot.ts` | Гидрация State в общем батче до `render()`; регистрация writer'а. |
| `web-client/src/stores/foldersStore.ts` | `folders` уезжают в State; в сторе остаётся UI-состояние. |
| `web-client/src/stores/draftsStore.ts` | `byChat` уезжает в State. |
| Потребители папок (6 файлов) | Переход на `useFolders()`. |

---

## Task 1: Схема State и стор `state` в IndexedDB

**Files:**
- Create: `web-client/src/core/state/state.ts`
- Modify: `web-client/src/core/store/persist.ts`
- Test: `web-client/src/core/store/persist.state.test.ts`

**Interfaces:**
- Produces: `AppState`, `STATE_INIT`, `STATE_VERSION`, `STATE_KEYS` из `core/state/state.ts`; `saveStateKey(key, value)`, `loadStateAll()` из `core/store/persist.ts`.
- Consumes: ничего.

- [ ] **Шаг 1: Написать схему State**

Создать `web-client/src/core/state/state.ts`:

```ts
// Порт tweb `src/config/state.ts`: ЕДИНЫЙ объект персистентного состояния
// приложения. Читается один раз батчем на старте (core/state/loadState.ts),
// живёт в памяти (stores/appState.ts), пишется по одному ключу write-through.
//
// Что сюда НЕ кладём (как и tweb): диалоги, сообщения, юзеров, me. Они лежат в
// своих сторах IndexedDB (tweb config/databases/state.ts:5) — State целиком
// перезаписывается на каждое изменение ключа, и сущности сделали бы это тяжёлым.
import type { Folder } from '../managers/foldersManager'
import type { Draft } from '../models'

export interface AppState {
  /** версия схемы State (tweb STATE_VERSION) — при несовпадении стартуем с STATE_INIT */
  version: number
  /** папки-фильтры (tweb `filtersArr`) */
  folders: Folder[]
  /** облачные черновики по чатам (tweb `drafts`) */
  drafts: Draft[]
  /** свёрнутые пользователем пин-плашки: chatId → msgId (tweb `hiddenPinnedMessages`) */
  hiddenPinnedMessages: Record<number, number>
  /** недавние в глобальном поиске (tweb `recentSearch`) */
  recentSearch: number[]
}

export const STATE_VERSION = 1

/** tweb `STATE_INIT` — дефолты и одновременно источник списка ключей. */
export const STATE_INIT: AppState = {
  version: STATE_VERSION,
  folders: [],
  drafts: [],
  hiddenPinnedMessages: {},
  recentSearch: [],
}

/** tweb `ALL_KEYS = Object.keys(STATE_INIT)` (loadState.ts:43) */
export const STATE_KEYS = Object.keys(STATE_INIT) as (keyof AppState)[]
```

- [ ] **Шаг 2: Написать падающий тест на стор `state` и миграцию**

Создать `web-client/src/core/store/persist.state.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { saveStateKey, loadStateAll } from './persist'

describe('persist: стор state', () => {
  beforeEach(() => { indexedDB.deleteDatabase('msgr-store') })

  it('пишет и читает ключи State', async () => {
    await saveStateKey('recentSearch', [1, 2, 3])
    await saveStateKey('hiddenPinnedMessages', { 5: 42 })

    expect(await loadStateAll()).toEqual({
      recentSearch: [1, 2, 3],
      hiddenPinnedMessages: { 5: 42 },
    })
  })

  it('пустой стор отдаёт пустой объект, а не падает', async () => {
    expect(await loadStateAll()).toEqual({})
  })

  it('читает ВСЕ ключи одной транзакцией', async () => {
    await saveStateKey('version', 1)
    await saveStateKey('folders', [])
    await saveStateKey('recentSearch', [7])

    const all = await loadStateAll()
    expect(Object.keys(all).sort()).toEqual(['folders', 'recentSearch', 'version'])
  })
})
```

- [ ] **Шаг 3: Прогнать тест и убедиться, что он падает**

Запустить: `cd web-client && npx vitest run src/core/store/persist.state.test.ts`
Ожидаемо: FAIL — `saveStateKey`/`loadStateAll` не экспортируются.

- [ ] **Шаг 4: Добавить стор, миграцию и функции в persist.ts**

В `web-client/src/core/store/persist.ts`:

Поднять версию и добавить константу стора рядом с остальными:

```ts
const VERSION = 2
const S_STATE = 'state'
```

Добавить шаг миграции в `MIGRATIONS` (существующий шаг `1` не трогать):

```ts
  // v2 — стор `state`: единый объект персистентного состояния (порт tweb
  // StateStorage поверх стора `session`). Ключи out-of-line — имена полей AppState.
  // Переливаем уже накопленные folders/drafts из meta, чтобы апгрейд не сбросил
  // папки и черновики (конвенция: миграция расширяет, а не стирает).
  2: (db, tx) => {
    if (!db.objectStoreNames.contains(S_STATE)) db.createObjectStore(S_STATE)
    const meta = tx.objectStore(S_META)
    const state = tx.objectStore(S_STATE)
    for (const key of ['folders', 'drafts'] as const) {
      const req = meta.get(key)
      req.onsuccess = () => { if (req.result !== undefined) state.put(req.result, key) }
    }
  },
```

Добавить в конец файла:

```ts
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
        keysReq.result.forEach((k, i) => { out[String(k)] = valuesReq.result[i] })
        resolve(out as Partial<AppState>)
      }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { return {} }
}
```

Добавить импорт типа в шапку файла:

```ts
import type { AppState } from '../state/state'
```

Дописать `S_STATE` в очистку — в `persistClearAll` и в ветку смены аккаунта `persistScope` (там, где уже стоят `S_DIALOGS`/`S_USERS`/`S_MESSAGES`):

```ts
      enqueue(S_STATE, { kind: 'clear' }),
```

- [ ] **Шаг 5: Прогнать тест — должен пройти**

Запустить: `cd web-client && npx vitest run src/core/store/persist.state.test.ts`
Ожидаемо: PASS (3 теста).

- [ ] **Шаг 6: Коммит**

```bash
git add web-client/src/core/state/state.ts web-client/src/core/store/persist.ts web-client/src/core/store/persist.state.test.ts
git commit -m "feat(state): схема AppState + стор state в IndexedDB (порт tweb config/state.ts)"
```

---

## Task 2: Однократное мемоизированное чтение State

**Files:**
- Create: `web-client/src/core/state/loadState.ts`
- Test: `web-client/src/core/state/loadState.test.ts`

**Interfaces:**
- Consumes: `AppState`, `STATE_INIT`, `STATE_VERSION` (Task 1); `loadStateAll()` (Task 1).
- Produces: `loadStateOnce(): Promise<AppState>`, `resetStateCache(): void`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/core/state/loadState.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT, STATE_VERSION } from './state'

const loadStateAll = vi.fn()
vi.mock('../store/persist', () => ({ loadStateAll: () => loadStateAll() }))

const { loadStateOnce, resetStateCache } = await import('./loadState')

describe('loadStateOnce', () => {
  beforeEach(() => { resetStateCache(); loadStateAll.mockReset() })

  it('читает базу ОДИН раз даже при нескольких вызовах', async () => {
    loadStateAll.mockResolvedValue({ version: STATE_VERSION, recentSearch: [1] })

    const [a, b] = await Promise.all([loadStateOnce(), loadStateOnce()])

    expect(loadStateAll).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('недостающие ключи добираются из STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({ version: STATE_VERSION, recentSearch: [7] })

    const state = await loadStateOnce()

    expect(state.recentSearch).toEqual([7])
    expect(state.folders).toEqual([])
    expect(state.hiddenPinnedMessages).toEqual({})
  })

  it('чужая версия схемы — стартуем с чистого STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({ version: 0, recentSearch: [1, 2, 3] })

    expect(await loadStateOnce()).toEqual(STATE_INIT)
  })

  it('пустая база — STATE_INIT', async () => {
    loadStateAll.mockResolvedValue({})

    expect(await loadStateOnce()).toEqual(STATE_INIT)
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Запустить: `cd web-client && npx vitest run src/core/state/loadState.test.ts`
Ожидаемо: FAIL — модуль `./loadState` не существует.

- [ ] **Шаг 3: Реализовать ридер**

Создать `web-client/src/core/state/loadState.ts`:

```ts
// Порт tweb `lib/appManagers/utils/state/loadState.ts:528-531`:
//
//   let promise: ReturnType<typeof loadStateForAllAccounts>;
//   export default function loadStateForAllAccountsOnce() {
//     return promise ??= loadStateForAllAccounts();
//   }
//
// Смысл мемоизации: чтение персиста должно случиться РОВНО ОДИН раз за запуск.
// Кто бы ни спросил State вторым — получает тот же промис, а не второй поход в IDB.
import { loadStateAll } from '../store/persist'
import { STATE_INIT, STATE_VERSION, type AppState } from './state'

let promise: Promise<AppState> | null = null

/** Единственная точка чтения State. Повторный вызов отдаёт тот же промис. */
export function loadStateOnce(): Promise<AppState> {
  return (promise ??= read())
}

/** Сбросить кэш — смена аккаунта (persistScope стёр данные) и тесты. */
export function resetStateCache(): void {
  promise = null
}

async function read(): Promise<AppState> {
  const stored = await loadStateAll()
  // Версионный гейт (tweb STATE_VERSION/BUILD, loadState.ts:40-41): схема из
  // прошлой сборки может быть несовместима по форме — начинаем с дефолтов, а не
  // склеиваем половинки. Запись новой версии делает гидрация в boot.ts.
  if (stored.version !== STATE_VERSION) return { ...STATE_INIT }
  return { ...STATE_INIT, ...stored }
}
```

- [ ] **Шаг 4: Прогнать тест — должен пройти**

Запустить: `cd web-client && npx vitest run src/core/state/loadState.test.ts`
Ожидаемо: PASS (4 теста).

- [ ] **Шаг 5: Коммит**

```bash
git add web-client/src/core/state/loadState.ts web-client/src/core/state/loadState.test.ts
git commit -m "feat(state): однократное мемоизированное чтение State (порт tweb loadStateForAllAccountsOnce)"
```

---

## Task 3: Реактивный стор appState + write-through

**Files:**
- Create: `web-client/src/stores/appState.ts`
- Test: `web-client/src/stores/appState.test.ts`

**Interfaces:**
- Consumes: `AppState`, `STATE_INIT` (Task 1).
- Produces: `useAppStateStore`, `setAppState(key, value)`, `setAppStateSilent(patch)`, `useAppStateKey(key)`, `setStateWriter(w)`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/appState.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setAppState, setAppStateSilent, setStateWriter } from './appState'

const stateKey = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('appState', () => {
  it('setAppState пишет в память И персистит (write-through)', () => {
    setAppState('recentSearch', [42])

    expect(useAppStateStore.getState().recentSearch).toEqual([42])
    expect(stateKey).toHaveBeenCalledWith('recentSearch', [42])
  })

  it('setAppStateSilent наполняет память БЕЗ записи (гидрация)', () => {
    setAppStateSilent({ recentSearch: [1], hiddenPinnedMessages: { 3: 9 } })

    expect(useAppStateStore.getState().recentSearch).toEqual([1])
    expect(stateKey).not.toHaveBeenCalled()
  })

  it('запись одного ключа не меняет ссылки на соседние (нет лишних ре-рендеров)', () => {
    const foldersBefore = useAppStateStore.getState().folders

    setAppState('recentSearch', [5])

    expect(useAppStateStore.getState().folders).toBe(foldersBefore)
  })

  it('без writer-а не падает (тесты/логаут)', () => {
    setStateWriter(null)

    expect(() => setAppState('recentSearch', [1])).not.toThrow()
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Запустить: `cd web-client && npx vitest run src/stores/appState.test.ts`
Ожидаемо: FAIL — модуль `./appState` не существует.

- [ ] **Шаг 3: Реализовать стор**

Создать `web-client/src/stores/appState.ts`:

```ts
// Порт tweb `src/stores/appState.ts`. Там это Solid-стор:
//
//   const [appState, _setAppState] = createRoot(() => createStore<State>({}));
//   const setAppState = (...args) => { _setAppState(...args);
//     return rootScope.managers.appStateManager.setByKey(key, unwrap(appState[key])); };
//   const setAppStateSilent = (key, value) => _setAppState(key, reconcile(value));
//
// У нас та же пара ролей на Zustand:
//   setAppState       — пользовательское изменение: память + персист (write-through);
//   setAppStateSilent — гидрация с диска: только память, без обратной записи
//                       (иначе прочитанное тут же поехало бы обратно в IDB).
//
// Роль solid-овского `reconcile` (сохранить ссылки на неизменившиеся куски) у нас
// закрывает точечный setState по ключу: соседние поля сохраняют идентичность,
// поэтому селекторы по ним не перерисовываются.
import { create } from 'zustand'
import { STATE_INIT, type AppState } from '../core/state/state'

/** Писатель персиста — фасад воркера (persistManager). Ставит boot.ts. */
export type StateWriter = { stateKey(key: string, value: unknown): Promise<void> }

let writer: StateWriter | null = null

export function setStateWriter(w: StateWriter | null): void {
  writer = w
}

export const useAppStateStore = create<AppState>(() => ({ ...STATE_INIT }))

/** Изменение пользователем: в память и на диск (tweb setAppState). */
export function setAppState<K extends keyof AppState>(key: K, value: AppState[K]): void {
  useAppStateStore.setState({ [key]: value } as Pick<AppState, K>)
  void writer?.stateKey(key, value)
}

/** Гидрация с диска: только память (tweb setAppStateSilent). */
export function setAppStateSilent(patch: Partial<AppState>): void {
  useAppStateStore.setState(patch)
}

/** Реактивное чтение одного ключа — аналог `appState.folders` в tweb. */
export function useAppStateKey<K extends keyof AppState>(key: K): AppState[K] {
  return useAppStateStore((s) => s[key])
}
```

- [ ] **Шаг 4: Прогнать тест — должен пройти**

Запустить: `cd web-client && npx vitest run src/stores/appState.test.ts`
Ожидаемо: PASS (4 теста).

- [ ] **Шаг 5: Коммит**

```bash
git add web-client/src/stores/appState.ts web-client/src/stores/appState.test.ts
git commit -m "feat(state): реактивный стор appState с write-through (порт tweb stores/appState.ts)"
```

---

## Task 4: Гидрация до первого рендера + writer в воркер

**Files:**
- Modify: `web-client/src/core/managers/persistManager.ts`
- Modify: `web-client/src/client/boot.ts`
- Test: `web-client/src/client/boot.state.test.ts` (создать)

**Interfaces:**
- Consumes: `loadStateOnce` (Task 2), `setAppStateSilent`/`setAppState`/`setStateWriter` (Task 3), `saveStateKey` (Task 1).
- Produces: к моменту `render()` стор `appState` заполнен.

- [ ] **Шаг 1: Добавить RPC записи ключа в воркер**

В `web-client/src/core/managers/persistManager.ts` — добавить импорт `saveStateKey` к существующим и метод в фасад, рядом с `folders`/`drafts`:

```ts
    // Один ключ State (tweb appStateManager.setByKey). Типизация — на вызывающей
    // стороне (stores/appState.ts): через RPC-границу идут сериализуемые значения.
    stateKey: (key: string, value: unknown): Promise<void> =>
      saveStateKey(key as never, value as never),
```

- [ ] **Шаг 2: Написать падающий тест на порядок гидрации**

Создать `web-client/src/client/boot.state.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { STATE_VERSION } from '../core/state/state'

// Проверяем контракт, а не весь boot: гидрация обязана положить прочитанный
// State в стор ДО того, как кто-либо отрисуется, и не писать его обратно.
describe('boot: гидрация State', () => {
  it('прочитанный State попадает в стор без обратной записи', async () => {
    const { useAppStateStore, setAppStateSilent, setStateWriter } = await import('../stores/appState')
    const stateKey = vi.fn().mockResolvedValue(undefined)
    setStateWriter({ stateKey })

    setAppStateSilent({ version: STATE_VERSION, recentSearch: [11] })

    expect(useAppStateStore.getState().recentSearch).toEqual([11])
    expect(stateKey).not.toHaveBeenCalled()
  })
})
```

- [ ] **Шаг 3: Прогнать тест**

Запустить: `cd web-client && npx vitest run src/client/boot.state.test.ts`
Ожидаемо: PASS (зависимости из Task 3 уже есть) — тест фиксирует контракт для следующего шага.

- [ ] **Шаг 4: Встроить гидрацию в boot.ts**

В `web-client/src/client/boot.ts` добавить импорты:

```ts
import { loadStateOnce } from '../core/state/loadState'
import { setAppState, setAppStateSilent, setStateWriter } from '../stores/appState'
import { STATE_INIT, STATE_VERSION } from '../core/state/state'
```

Заменить существующий блок `#2` (`const [hydratedFromCache] = await Promise.all([...])`) на:

```ts
  // #2 — offline-first: ОДНО батч-чтение персиста до первого кадра. State
  // (папки/черновики/прочий конфиг) читается целиком за одну транзакцию — как в
  // tweb, где `await apiManagerProxy.loadAllStates()` стоит до построения UI
  // (index.ts:455). Диалоги — свой стор (в tweb они тоже вне State).
  setStateWriter(managers.persist)
  const [hydratedFromCache, state] = await Promise.all([
    locked ? Promise.resolve(false) : hydrateDialogsFromPersist(),
    locked ? Promise.resolve({ ...STATE_INIT }) : loadStateOnce(),
    loadLang(getInitial()),
  ])
  setAppStateSilent(state)
  // Схема была чужой версии (или базы не было) — фиксируем текущую, чтобы
  // следующий старт прошёл гейт (tweb пушит STATE_INIT при смене версии).
  if (!locked && state.version !== STATE_VERSION) setAppState('version', STATE_VERSION)
```

Внимание: `Promise.all` из трёх элементов, деструктурируем два — третий (`loadLang`) нужен только как ожидание. Оставить именно так, порядок не менять.

- [ ] **Шаг 5: Прогнать весь набор тестов и тайпчек**

Запустить: `cd web-client && npm run typecheck && npx vitest run`
Ожидаемо: всё зелёное.

- [ ] **Шаг 6: Коммит**

```bash
git add web-client/src/client/boot.ts web-client/src/client/boot.state.test.ts web-client/src/core/managers/persistManager.ts
git commit -m "feat(state): State гидрируется одним батчем до первого рендера (порт tweb index.ts:455)"
```

---

## Task 5: Папки переезжают в State

Это задача, которая чинит исходную жалобу «табы появляются не сразу»: после неё папки есть в кадре 0, как и список чатов.

**Files:**
- Modify: `web-client/src/stores/foldersStore.ts`
- Modify: `web-client/src/core/hooks/useSidebarFolders.tsx`
- Modify: `web-client/src/core/hooks/useChatAutoDownload.ts`
- Modify: `web-client/src/components/messages/ChatDialogs.tsx`
- Modify: `web-client/src/components/folders/FolderEditor.tsx`
- Modify: `web-client/src/components/folders/ChatFoldersSettings.tsx`
- Modify: `web-client/src/client/realtime/refetchSubscriber.ts`
- Modify: `web-client/src/core/hooks/useAppBootstrap.ts`
- Test: `web-client/src/stores/foldersStore.test.ts` (создать)

**Interfaces:**
- Consumes: `useAppStateKey`, `setAppState` (Task 3).
- Produces: `useFolders(): Folder[]`, `useFoldersStore` (только UI-состояние: `selectedId`, `contactIds`), `loadFolders(managers)`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/foldersStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadFolders, useFoldersStore, ALL_FOLDER_ID } from './foldersStore'

const stateKey = vi.fn().mockResolvedValue(undefined)
// Форма Folder — из core/managers/foldersManager.ts, не выдумывать.
const folder: Folder = {
  id: 7, title: 'Работа', pos: 0,
  contacts: false, nonContacts: false, groups: true, broadcasts: false,
  excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
}

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('foldersStore', () => {
  it('загрузка с сети кладёт папки в State (и персистит)', async () => {
    await loadFolders({
      folders: { list: () => Promise.resolve([folder]) },
      contacts: { list: () => Promise.resolve([]) },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
    expect(stateKey).toHaveBeenCalledWith('folders', [folder])
  })

  it('оффлайн: сеть упала — папки из State остаются', async () => {
    useAppStateStore.setState({ folders: [folder] })

    await loadFolders({
      folders: { list: () => Promise.reject(new Error('offline')) },
      contacts: { list: () => Promise.reject(new Error('offline')) },
    })

    expect(useAppStateStore.getState().folders).toEqual([folder])
  })

  it('выбранная папка — UI-состояние, в State не попадает', () => {
    useFoldersStore.getState().select(7)

    expect(useFoldersStore.getState().selectedId).toBe(7)
    expect(stateKey).not.toHaveBeenCalledWith('selectedId', expect.anything())
  })

  it('удаление папки сбрасывает выбор на «Все чаты»', () => {
    useAppStateStore.setState({ folders: [folder] })
    useFoldersStore.getState().select(7)

    useFoldersStore.getState().remove(7)

    expect(useAppStateStore.getState().folders).toEqual([])
    expect(useFoldersStore.getState().selectedId).toBe(ALL_FOLDER_ID)
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Запустить: `cd web-client && npx vitest run src/stores/foldersStore.test.ts`
Ожидаемо: FAIL — `loadFolders` всё ещё читает персист и пишет в свой стор.

- [ ] **Шаг 3: Переписать foldersStore**

Заменить содержимое `web-client/src/stores/foldersStore.ts`:

```ts
// Папки чатов. Сами определения папок живут в State (tweb `filtersArr`) —
// читаются с диска одним батчем на старте (client/boot.ts), поэтому табы есть
// уже в первом кадре. Здесь остаётся только UI-состояние, которое в tweb тоже
// не персистится: выбранный таб и set контактов для правил contacts/non_contacts.
import { create } from 'zustand'
import type { Folder } from '../core/managers/foldersManager'
import type { Contact } from '../core/managers/contactsManager'
import { useAppStateKey, useAppStateStore, setAppState } from './appState'

/** id псевдо-папки «Все чаты» (tweb FOLDER_ID_ALL) */
export const ALL_FOLDER_ID = 0

interface FoldersUiState {
  selectedId: number
  contactIds: Set<number>
  select: (id: number) => void
  setContacts: (ids: number[]) => void
  upsert: (f: Folder) => void
  remove: (id: number) => void
}

export const useFoldersStore = create<FoldersUiState>((set) => ({
  selectedId: ALL_FOLDER_ID,
  contactIds: new Set(),
  select: (selectedId) => set({ selectedId }),
  setContacts: (ids) => set({ contactIds: new Set(ids) }),
  upsert: (f) => {
    const folders = useAppStateStore.getState().folders.slice()
    const idx = folders.findIndex((x) => x.id === f.id)
    if (idx === -1) folders.push(f)
    else folders[idx] = f
    setAppState('folders', folders)
  },
  remove: (id) => {
    setAppState('folders', useAppStateStore.getState().folders.filter((f) => f.id !== id))
    set((s) => (s.selectedId === id ? { selectedId: ALL_FOLDER_ID } : s))
  },
}))

/** Реактивное чтение папок — единственный способ их получить в UI. */
export function useFolders(): Folder[] {
  return useAppStateKey('folders')
}

export async function loadFolders(managers: {
  folders: { list(): Promise<Folder[]> }
  contacts: { list(): Promise<Contact[]> }
}): Promise<void> {
  // Персист тут больше НЕ читаем: State уже поднят в boot.ts до рендера.
  // Остаётся только реконсайл поверх свежими данными сети.
  try {
    setAppState('folders', await managers.folders.list())
  } catch {
    /* оффлайн — остаёмся на том, что подняли из State */
  }
  try {
    useFoldersStore.getState().setContacts((await managers.contacts.list()).map((c) => c.userId))
  } catch {
    /* без контактов правила contacts/non_contacts считают всех не-контактами */
  }
}
```

Функция `startFoldersPersist` удаляется полностью — её роль (дебаунс-запись по подписке) закрывает write-through в `setAppState`.

- [ ] **Шаг 4: Убрать вызов startFoldersPersist**

Найти и удалить вызов: `cd web-client && grep -rn "startFoldersPersist" src/`
Удалить строку вызова и импорт в найденном файле.

- [ ] **Шаг 5: Перевести потребителей на useFolders()**

В каждом из файлов заменить чтение папок из стора на новый хук:

```ts
// было
const folders = useFoldersStore((s) => s.folders)
// стало
const folders = useFolders()
```

Файлы: `core/hooks/useSidebarFolders.tsx`, `core/hooks/useChatAutoDownload.ts`, `components/messages/ChatDialogs.tsx`, `components/folders/FolderEditor.tsx`, `components/folders/ChatFoldersSettings.tsx`.

В не-React коде (`client/realtime/refetchSubscriber.ts`) читать без хука:

```ts
import { useAppStateStore } from '../../stores/appState'
const folders = useAppStateStore.getState().folders
```

Обращения к `loaded` заменить на проверку по данным (`folders.length > 0`) либо удалить: флаг «загружено» больше не нужен — State поднят до рендера.

- [ ] **Шаг 6: Прогнать тесты и тайпчек**

Запустить: `cd web-client && npm run typecheck && npx vitest run`
Ожидаемо: всё зелёное. Тайпчек поймает пропущенных потребителей `s.folders` / `s.loaded`.

- [ ] **Шаг 7: Коммит**

```bash
git add -A web-client/src
git commit -m "refactor(state): папки переехали в State — табы есть в первом кадре"
```

---

## Task 6: Черновики переезжают в State

**Files:**
- Modify: `web-client/src/stores/draftsStore.ts`
- Modify: `web-client/src/core/hooks/useAppBootstrap.ts`
- Test: `web-client/src/stores/draftsStore.test.ts` (создать)

**Interfaces:**
- Consumes: `useAppStateKey`, `setAppState`, `useAppStateStore` (Task 3).
- Produces: `useDrafts(): Record<number, Draft>`, `loadDrafts(managers)`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/draftsStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { setDraft, removeDraft, draftFor } from './draftsStore'

const stateKey = vi.fn().mockResolvedValue(undefined)
const draft = { chatId: 3, text: 'привет', replyToId: null, updatedAt: '2026-08-09T00:00:00Z' }

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('draftsStore поверх State', () => {
  it('черновик пишется в State и персистится', () => {
    setDraft(draft)

    expect(draftFor(3)).toEqual(draft)
    expect(stateKey).toHaveBeenCalledWith('drafts', [draft])
  })

  it('удаление убирает черновик из State', () => {
    setDraft(draft)
    stateKey.mockClear()

    removeDraft(3)

    expect(draftFor(3)).toBeUndefined()
    expect(stateKey).toHaveBeenCalledWith('drafts', [])
  })

  it('повторная запись того же чата заменяет, а не дублирует', () => {
    setDraft(draft)
    setDraft({ ...draft, text: 'пока' })

    expect(useAppStateStore.getState().drafts).toHaveLength(1)
    expect(draftFor(3)?.text).toBe('пока')
  })
})
```

- [ ] **Шаг 2: Прогнать тест и убедиться, что он падает**

Запустить: `cd web-client && npx vitest run src/stores/draftsStore.test.ts`
Ожидаемо: FAIL — экспортов `setDraft`/`removeDraft`/`draftFor` нет.

- [ ] **Шаг 3: Переписать draftsStore**

Заменить содержимое `web-client/src/stores/draftsStore.ts`:

```ts
// Облачные черновики. Живут в State (tweb `drafts` в StateStorage) — читаются
// одним батчем на старте, поэтому текст композера доступен уже в первом кадре.
// Форма хранения — массив (как в State), доступ по чату — через мемо-хук.
import { useMemo } from 'react'
import type { Draft } from '../core/models'
import { useAppStateKey, useAppStateStore, setAppState } from './appState'

export function useDrafts(): Record<number, Draft> {
  const drafts = useAppStateKey('drafts')
  return useMemo(() => Object.fromEntries(drafts.map((d) => [d.chatId, d])), [drafts])
}

/** Чтение вне React (realtimeBridge/хуки композера). */
export function draftFor(chatId: number): Draft | undefined {
  return useAppStateStore.getState().drafts.find((d) => d.chatId === chatId)
}

export function setDraft(d: Draft): void {
  const rest = useAppStateStore.getState().drafts.filter((x) => x.chatId !== d.chatId)
  setAppState('drafts', [...rest, d])
}

export function removeDraft(chatId: number): void {
  setAppState('drafts', useAppStateStore.getState().drafts.filter((d) => d.chatId !== chatId))
}

export function setAllDrafts(list: Draft[]): void {
  setAppState('drafts', list)
}

export async function loadDrafts(managers: { drafts: { list(): Promise<Draft[]> } }): Promise<void> {
  // Персист не читаем: State поднят в boot.ts. Только реконсайл сетью.
  try {
    setAllDrafts(await managers.drafts.list())
  } catch {
    /* оффлайн — остаёмся на черновиках из State */
  }
}
```

- [ ] **Шаг 4: Перевести потребителей**

Запустить: `cd web-client && grep -rn "useDraftsStore" src/`
Заменить: чтение `byChat[chatId]` → `useDrafts()[chatId]` в React, `draftFor(chatId)` вне React; `setDraft`/`removeDraft`/`setAll` → одноимённые функции (`setAll` → `setAllDrafts`).

- [ ] **Шаг 5: Прогнать тесты и тайпчек**

Запустить: `cd web-client && npm run typecheck && npx vitest run`
Ожидаемо: всё зелёное.

- [ ] **Шаг 6: Коммит**

```bash
git add -A web-client/src
git commit -m "refactor(state): черновики переехали в State"
```

---

## Task 7: Инвариант «персист читают только на старте»

Без этого шага следующий стор с кэшем повторит исходную ошибку — асинхронное чтение из эффекта после первого кадра.

**Files:**
- Create: `web-client/src/core/state/noAdHocReads.test.ts`
- Modify: `web-client/CLAUDE.md`
- Modify: `web-client/src/core/store/persist.ts` (только комментарий)

**Interfaces:**
- Consumes: ничего.
- Produces: тест-инвариант.

- [ ] **Шаг 1: Написать тест-инвариант**

Создать `web-client/src/core/state/noAdHocReads.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Инвариант модели tweb: асинхронное чтение персиста происходит РОВНО ОДИН раз,
// на старте. Любое чтение из компонента/хука возвращает нас к рваной гидрации —
// список есть в первом кадре, а папки/черновики приезжают позже и всё дёргается.
const READERS = ['loadStateAll', 'loadDialogs', 'loadMe', 'loadUsers']
const ALLOWED = ['core/state/loadState.ts', 'stores/dialogsPersist.ts', 'core/store/persist.ts']

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
  }
  return acc
}

describe('персист читается только на старте', () => {
  it('нет чтений персиста вне разрешённых модулей', () => {
    const root = join(__dirname, '..', '..')
    const offenders = walk(root)
      .filter((f) => !ALLOWED.some((a) => f.replaceAll('\\', '/').endsWith(a)))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        return READERS.some((r) => new RegExp(`\\b${r}\\s*\\(`).test(src))
      })
      .map((f) => f.slice(root.length + 1))

    expect(offenders).toEqual([])
  })
})
```

- [ ] **Шаг 2: Прогнать тест**

Запустить: `cd web-client && npx vitest run src/core/state/noAdHocReads.test.ts`
Ожидаемо: PASS. Если FAIL — в списке остались модули, не переведённые в задачах 5-6; перевести их, а не расширять `ALLOWED`.

- [ ] **Шаг 3: Записать правило в CLAUDE.md**

В `web-client/CLAUDE.md`, в раздел «Архитектура клиента (инварианты — НЕ нарушать)», в блок «НЕЛЬЗЯ» добавить:

```markdown
- Читать персист (`core/store/persist.ts`) откуда-либо, кроме старта. Модель tweb: одно
  батч-чтение `State` до первого рендера (`client/boot.ts` → `loadStateOnce`), дальше
  только синхронные чтения из `stores/appState` и write-through записи через `setAppState`.
  Асинхронное чтение из хука/компонента = рваная гидрация (список есть, папки приезжают
  позже, вёрстка прыгает). Инвариант держит `core/state/noAdHocReads.test.ts`.
- Класть в `AppState` сущности (диалоги, сообщения, юзеров). State целиком
  перезаписывается на каждое изменение ключа — там только конфиг, как в tweb.
```

- [ ] **Шаг 4: Финальная проверка**

Запустить: `cd web-client && npm run typecheck && npm run lint && npx vitest run`
Ожидаемо: всё зелёное.

- [ ] **Шаг 5: Коммит**

```bash
git add web-client/src/core/state/noAdHocReads.test.ts web-client/CLAUDE.md web-client/src/core/store/persist.ts
git commit -m "test(state): инвариант — персист читается только на старте"
```

---

## Проверка результата

Ручная проверка на стенде (`https://localhost:38443`, вкладки закрыть и открыть заново — SharedWorker переживает обновление фронта):

1. Открыть чат, обновить страницу.
2. Табы папок должны быть на месте **в первом же кадре**, вместе со списком чатов — без подрастания шапки и прыжка списка.

Инструментальная проверка тем же способом, каким баг ловили:

```js
// initScript при reload
const rec = { t0: performance.now(), f: [] }
const sample = () => {
  const t = Math.round(performance.now() - rec.t0)
  if (t > 2000) return
  const tabs = document.querySelector('.folders-tabs-scrollable')
  rec.f.push({ t, tabs: !!tabs, rows: document.querySelectorAll('.chatlist-chat').length })
  requestAnimationFrame(sample)
}
requestAnimationFrame(sample)
```

Критерий: в первом кадре, где `rows > 0`, уже `tabs === true`. Сейчас между ними разрыв.
