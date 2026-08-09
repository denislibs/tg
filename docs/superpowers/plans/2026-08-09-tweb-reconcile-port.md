# Реконсайл данных 1:1 с tweb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить «запросили и перезаписали целиком» на модель tweb: сущности живут в map по id, сетевой ответ **сверяется** с имеющимся и применяется точечно, порядок — производная от данных, а не порядок массива из ответа.

**Architecture:** Сейчас `setFolders(await list())` и `setDialogs(await listDialogs())` заменяют массив целиком — отсюда перетасовка списка на каждом старте (замерено: t=121 мс первый «Денис Марамыгин», t=375 мс уже «Команда Альфа») и перерисовка всех потребителей даже когда данные не изменились. В tweb этого не бывает по трём причинам: (1) данные лежат в map по id + массив-проекция, (2) сетевой ответ проходит через `saveDialogFilter`, который **сливает** ответ с существующей записью, а не подменяет её, и рассылает гранулярные события (`filter_new` / `filter_update` / `filter_delete` / `filter_order`), (3) порядок задаёт вычисленный из данных числовой индекс (`generateDialogIndex`), а не позиция в ответе. Плюс сам запрос идёт **cache-first**: если данные уже в памяти, сеть не дёргается вообще — инвалидация только по апдейту сервера.

**Tech Stack:** TypeScript strict (TS7 native `tsc`), React 19, Zustand 5, vitest, oxlint.

## Global Constraints

- Ответы и комментарии в коде — по-русски. Поведение брать 1:1 из tweb, не выдумывать; сомневаешься — открой tweb и посмотри.
- tweb-чекаут: `/Users/denisurevic/Documents/tweb` на `e52b5d931`. **Только чтение**, ничего там не менять.
- TS strict: без `any`, неиспользуемые переменные не пройдут сборку.
- Перед «готово» — `npm run typecheck`, `npm test`, `npm run lint` зелёные.
- Не ломать инвариант однонаправленного потока (`web-client/CLAUDE.md`): подписка на сокет только в `realtimeBridge`, компоненты читают из стора.

## Зависимость от плана State

Задача 4 кладёт `pinnedOrders` в `AppState`. Это требует, чтобы был выполнен [план порта State](./2026-08-09-tweb-state-port.md) (как минимум задачи 1–4). Добавление нового ключа в `AppState` миграции IndexedDB **не требует** — `loadStateOnce` делает `{ ...STATE_INIT, ...stored }`, и недостающий ключ приходит со своим дефолтом.

Задачи 1, 2, 3 и 6 от плана State не зависят и могут идти раньше (6 — только от задачи 6 плана State, где черновики переезжают в State).

---

## Справка: как это устроено в tweb (проверено по исходникам)

Раздел нужен исполнителю, чтобы не изобретать. Все ссылки — рабочие, проверены.

### 1. Структуры хранения — `lib/storages/filters.ts:37-43`

```ts
private filters: {[filterId: string]: MyDialogFilter};  // канон: map по id
private filtersArr: Array<MyDialogFilter>;              // проекция-массив (порядок)
private localFilters: {[filterId: string]: MyDialogFilter}; // синтетические «Все»/«Архив»
private localId: number;                                 // ключ сортировки filtersArr
```

Канон — **map по id**. Массив — производная проекция, нужная только для порядка. Порядок держит `localId`, а не позиция в ответе сервера.

### 2. Запрос — cache-first, `filters.ts:475-484`

```ts
public async getDialogFilters(overwrite = false): Promise<MyDialogFilter[]> {
  const keys = Object.keys(this.filters);
  if(keys.length > PREPENDED_FILTERS && !overwrite) {
    return keys.map((filterId) => this.filters[filterId]).sort((a, b) => a.localId - b.localId);
  }

  const messagesDialogFilters = await this.apiManager.invokeApiSingle('messages.getDialogFilters');
  const prepended = this.prependFilters(messagesDialogFilters.filters);
  return prepended.map((filter) => this.saveDialogFilter(filter, overwrite)).filter(Boolean);
}
```

**Данные уже в памяти → сети нет вообще.** Запрос уходит только когда память пуста либо явно попросили `overwrite = true`. Единственный источник `overwrite = true` — `onUpdateDialogFilters`, то есть **пуш сервера «что-то изменилось»** (`filters.ts:167`).

Сравни с нашим `loadFolders`: он безусловно дёргает сеть на каждом старте и затирает результат.

### 3. Слияние вместо подмены — `filters.ts:513-518`

```ts
const oldFilter = this.filters[filter.id];
if(oldFilter) {
  filter = Object.assign(oldFilter, filter);  // ← слить В существующий объект
} else {
  this.filters[filter.id] = filter;
}
this.setLocalId(filter);
```

Существующая запись **не подменяется**, в неё сливаются поля. Идентичность объекта сохраняется.

### 4. Гранулярные события — `filters.ts:520-526`, `:154`, `:194`

```ts
if(!silent) {
  if(update)         this.rootScope.dispatchEvent('filter_update', filter);
  else if(!oldFilter) this.rootScope.dispatchEvent('filter_new', filter);
}
```
плюс `filter_delete` (`:154`) и `filter_order` (`:194`). UI слушает их, а не «список сменился целиком».

### 5. Диff при общем апдейте — `filters.ts:162-176`

```ts
const oldFilters = copy(this.filters);
this.getDialogFilters(true).then((filters) => {
  for(const _filterId in oldFilters) {
    const filterId = +_filterId;
    if(!filters.find((filter) => filter.id === filterId)) {   // исчезла в ответе
      this.onUpdateDialogFilter({_: 'updateDialogFilter', id: filterId});  // → filter_delete
    }
  }
  this.onUpdateDialogFilterOrder({_: 'updateDialogFilterOrder', order: filters.map((f) => f.id)});
});
```

Удаления вычисляются диффом «что было ↔ что пришло». Обновления/добавления уже применил `saveDialogFilter` внутри `getDialogFilters`.

### 6. State — проекция, а не хранилище — `filters.ts:199-200`

```ts
private pushToState() {
  this.appStateManager.pushToState('filtersArr', this.filtersArr);
}
```

State обновляется **после** того, как дифф применён. Это снимок для следующего старта, а не способ применить изменение.

### 7. Порядок диалогов — производная от данных

`dialogs.ts:605-608`:
```ts
public generateDialogIndex(date?: number, isPinned?: boolean) {
  date ??= tsNow(true) + this.timeManager.getServerTimeOffset();
  return (date * 0x10000) + (isPinned ? 0 : (++this.dialogsNum & 0xFFFF));
}
```

`dialogs.ts:868-921` (`generateIndexForDialog`) — как считается `date`:
- закреплён → `generateDialogPinnedDate(dialog)`;
- иначе → дата top-сообщения, но не меньше `channel.date` для каналов и не меньше `draft.date`, если черновик свежее;
- если ничего нет → `tsNow()`.

`dialogs.ts:922-925` + `:928-943` — закреплённые:
```ts
public generateDialogPinnedDateByIndex(pinnedIndex: number) {
  return 0x7fff0000 + (pinnedIndex & 0xFFFF);
}
public generateDialogPinnedDate(dialog: AnyDialog) {
  const order = this.getPinnedOrdersByDialog(dialog);
  let pinnedIndex = order.indexOf(getDialogKey(dialog));
  if(pinnedIndex === -1) { order.unshift(dialogKey); pinnedIndex = 0; this.savePinnedOrders(); }
  return this.generateDialogPinnedDateByIndex(order.length - 1 - pinnedIndex);
}
```

Смысл формулы: `0x7fff0000` — заведомо больше любой реальной даты, поэтому закреплённые всегда выше. `order.length - 1 - pinnedIndex` переворачивает индекс: нулевой в списке закреплённых получает наибольшее значение и встаёт первым. Младшие 16 бит у незакреплённых — счётчик-разрешитель ничьей, чтобы диалоги с одинаковой датой не прыгали между сортировками.

`pinnedOrders` живёт в State: пишется `dialogs.ts:357` (`pushToState('pinnedOrders', ...)`), восстанавливается `dialogs.ts:207-214`.

---

## ВАЖНО: одна осознанная правка при переводе на React

**`Object.assign(oldFilter, filter)` из `filters.ts:515` в лоб переносить НЕЛЬЗЯ.**

В tweb UI на Solid: там реактивность отслеживает изменения полей, поэтому мутация существующего объекта — правильный ход, она сохраняет идентичность и обновляет подписчиков конкретных полей.

React работает наоборот: он сравнивает **ссылки**. Мутация в существующем объекте не вызовет перерисовку — мемоизированный `MessageRow`/строка списка просто не увидит изменения.

Наш эквивалент того же намерения:

> Вернуть **старый объект по ссылке**, если после слияния он структурно не изменился; вернуть **новый объект**, если изменился.

Это даёт ровно то, ради чего tweb мутирует:
- ничего не поменялось → ссылка та же → мемо-компонент не перерисовывается;
- поменялось → новая ссылка → перерисовывается только эта строка;
- список без изменений → **тот же массив** → не перерисовывается ни один подписчик.

Все остальные части (map по id, cache-first, дифф на удаление, гранулярные события, индекс) переносятся буквально.

---

## File Structure

**Создаём:**

| Файл | Ответственность |
|---|---|
| `web-client/src/core/store/reconcile.ts` | Чистое ядро: `reconcileEntity`, `reconcileById`, `diffRemoved`. Никаких знаний о домене. |
| `web-client/src/core/store/reconcile.test.ts` | Тесты ядра, включая сохранение ссылок. |
| `web-client/src/core/dialogs/dialogIndex.ts` | Порт `generateDialogIndex` / `generateIndexForDialog` / `generateDialogPinnedDate`. |
| `web-client/src/core/dialogs/dialogIndex.test.ts` | Тесты формулы порядка. |

**Меняем:**

| Файл | Что |
|---|---|
| `web-client/src/stores/foldersStore.ts` | Cache-first запрос + реконсайл + гранулярные события. |
| `web-client/src/stores/chatsStore.ts` | `setDialogs`/`upsertDialog` через один путь; `applyChatMeta` для снимка `chat_update`. |
| `web-client/src/core/state/state.ts` | Ключи `pinnedOrders`, `starsBalance`. |
| `web-client/src/client/realtime/refetchSubscriber.ts` | Папки и метаданные чата применяются из события, без похода в сеть. |
| `web-client/src/core/realtime/events.ts` | Тип `ChatUpdateEvt`. |
| `web-client/src/stores/draftsStore.ts` | Cache-first. |
| `web-client/src/stores/starsStore.ts` | Баланс переезжает в State + cache-first. |

---

## Task 1: Чистое ядро реконсайла

Ядро не знает ни про папки, ни про диалоги — только «сущности с id». Это делает его тестируемым и переиспользуемым для следующих сущностей.

**Files:**
- Create: `web-client/src/core/store/reconcile.ts`
- Test: `web-client/src/core/store/reconcile.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `reconcileEntity<T>(prev: T | undefined, next: T): T`
  - `reconcileById<T>(prev: readonly T[], next: readonly T[], key: (e: T) => number | string): { list: T[]; added: T[]; updated: T[]; removed: T[]; changed: boolean }`

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/core/store/reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reconcileEntity, reconcileById } from './reconcile'

const byId = (e: { id: number }) => e.id

describe('reconcileEntity', () => {
  it('данные не изменились — возвращает СТАРЫЙ объект (та же ссылка)', () => {
    const prev = { id: 1, title: 'Работа' }

    expect(reconcileEntity(prev, { id: 1, title: 'Работа' })).toBe(prev)
  })

  it('поле изменилось — новый объект', () => {
    const prev = { id: 1, title: 'Работа' }
    const out = reconcileEntity(prev, { id: 1, title: 'Отдых' })

    expect(out).not.toBe(prev)
    expect(out.title).toBe('Отдых')
  })

  it('прежнего нет — возвращает пришедший', () => {
    const next = { id: 2, title: 'Новая' }

    expect(reconcileEntity(undefined, next)).toBe(next)
  })

  it('сравнение глубокое: вложенный массив без изменений — та же ссылка', () => {
    const prev = { id: 1, peerIds: [1, 2, 3] }

    expect(reconcileEntity(prev, { id: 1, peerIds: [1, 2, 3] })).toBe(prev)
  })
})

describe('reconcileById', () => {
  it('ответ идентичен — тот же массив по ссылке и changed=false', () => {
    const prev = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }]

    const r = reconcileById(prev, [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], byId)

    expect(r.changed).toBe(false)
    expect(r.list).toBe(prev)
  })

  it('одна запись изменилась — новая ссылка только у неё', () => {
    const a = { id: 1, t: 'a' }
    const b = { id: 2, t: 'b' }

    const r = reconcileById([a, b], [{ id: 1, t: 'a' }, { id: 2, t: 'B!' }], byId)

    expect(r.changed).toBe(true)
    expect(r.list[0]).toBe(a)          // не тронута — ссылка сохранена
    expect(r.list[1]).not.toBe(b)
    expect(r.updated.map(byId)).toEqual([2])
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
  })

  it('добавление и удаление разложены по корзинам', () => {
    const r = reconcileById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], byId)

    expect(r.added.map(byId)).toEqual([3])
    expect(r.removed.map(byId)).toEqual([1])
    expect(r.list.map(byId)).toEqual([2, 3])
  })

  it('порядок берётся из next (порядок задаёт вызывающий)', () => {
    const r = reconcileById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }], byId)

    expect(r.list.map(byId)).toEqual([2, 1])
    expect(r.changed).toBe(true)
  })
})
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/core/store/reconcile.test.ts`
Ожидаемо: FAIL — модуля нет.

- [ ] **Шаг 3: Реализовать ядро**

Создать `web-client/src/core/store/reconcile.ts`:

```ts
// Ядро реконсайла — порт намерения tweb `saveDialogFilter` (lib/storages/filters.ts:513-518):
//
//   const oldFilter = this.filters[filter.id];
//   if(oldFilter) filter = Object.assign(oldFilter, filter);
//   else          this.filters[filter.id] = filter;
//
// В tweb UI на Solid, поэтому там сливают ПОЛЯ В существующий объект: идентичность
// сохраняется, а реактивность ловит изменения полей. React так не умеет — он
// сравнивает ссылки, и мутация прошла бы мимо мемоизированных компонентов.
// Поэтому у нас то же намерение выражено иначе: вернуть СТАРЫЙ объект, если после
// слияния он структурно не изменился, и НОВЫЙ, если изменился. Итог тот же:
//   • не изменилось → ссылка прежняя → мемо-компонент не перерисовывается;
//   • изменилось    → новая ссылка   → перерисовывается только эта строка.
//
// Домена ядро не знает: работает с любыми сущностями, у которых есть id.

/** Структурное сравнение. Значения — JSON-совместимые (то, что приходит с бэка). */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => equal(v, b[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  if (ak.length !== Object.keys(bo).length) return false
  return ak.every((k) => Object.hasOwn(bo, k) && equal(ao[k], bo[k]))
}

/** Одна сущность: прежняя ссылка, если ничего не изменилось. */
export function reconcileEntity<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next
  return equal(prev, next) ? prev : next
}

export interface ReconcileResult<T> {
  /** Итоговый список. Если ничего не изменилось — ИСХОДНЫЙ массив по ссылке. */
  list: T[]
  added: T[]
  updated: T[]
  removed: T[]
  changed: boolean
}

/**
 * Свести `next` с `prev` по id. Порядок итога — из `next`: сортировку решает
 * вызывающий (для диалогов это индекс, для папок — localId).
 */
export function reconcileById<T>(
  prev: readonly T[],
  next: readonly T[],
  key: (e: T) => number | string,
): ReconcileResult<T> {
  const prevByKey = new Map<number | string, T>()
  for (const e of prev) prevByKey.set(key(e), e)

  const added: T[] = []
  const updated: T[] = []
  const list: T[] = []
  let changed = prev.length !== next.length

  next.forEach((incoming, i) => {
    const k = key(incoming)
    const old = prevByKey.get(k)
    const merged = reconcileEntity(old, incoming)
    list.push(merged)

    if (old === undefined) added.push(merged)
    else if (merged !== old) updated.push(merged)

    // порядок тоже изменение: строка переехала
    if (!changed && prev[i] !== merged) changed = true
    prevByKey.delete(k)
  })

  const removed = [...prevByKey.values()]
  if (removed.length) changed = true

  // Ничего не изменилось — отдаём ИСХОДНЫЙ массив: новая ссылка на массив
  // перерисовала бы всех подписчиков списка впустую.
  return { list: changed ? list : (prev as T[]), added, updated, removed, changed }
}
```

- [ ] **Шаг 4: Прогнать тест — должен пройти**

Запустить: `cd web-client && npx vitest run src/core/store/reconcile.test.ts`
Ожидаемо: PASS (9 тестов).

- [ ] **Шаг 5: Коммит**

```bash
git add web-client/src/core/store/reconcile.ts web-client/src/core/store/reconcile.test.ts
git commit -m "feat(store): ядро реконсайла — слияние по id с сохранением ссылок (порт tweb saveDialogFilter)"
```

---

## Task 2: Папки — cache-first запрос и реконсайл

**Files:**
- Modify: `web-client/src/stores/foldersStore.ts`
- Modify: `web-client/src/client/realtime/refetchSubscriber.ts`
- Test: `web-client/src/stores/foldersStore.reconcile.test.ts` (создать)

**Interfaces:**
- Consumes: `reconcileById` (Task 1); `setAppState`/`useAppStateStore` (план State, задача 3).
- Produces: `loadFolders(managers, { overwrite? })`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/foldersStore.reconcile.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadFolders } from './foldersStore'

const stateKey = vi.fn().mockResolvedValue(undefined)
const work = { id: 7, title: 'Работа', peerIds: [1, 2], flags: 0 }
const fun = { id: 8, title: 'Отдых', peerIds: [], flags: 0 }

function managersWith(list: typeof work[], contacts: number[] = []) {
  return {
    folders: { list: vi.fn().mockResolvedValue(list) },
    contacts: { list: vi.fn().mockResolvedValue(contacts.map((userId) => ({ userId }))) },
  }
}

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  stateKey.mockClear()
  setStateWriter({ stateKey })
})

describe('loadFolders: cache-first', () => {
  it('папки уже в памяти — в сеть НЕ ходим', async () => {
    useAppStateStore.setState({ folders: [work] })
    const m = managersWith([work])

    await loadFolders(m)

    expect(m.folders.list).not.toHaveBeenCalled()
  })

  it('память пуста — идём в сеть', async () => {
    const m = managersWith([work])

    await loadFolders(m)

    expect(m.folders.list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().folders).toEqual([work])
  })

  it('overwrite: true — идём в сеть даже с непустой памятью', async () => {
    useAppStateStore.setState({ folders: [work] })
    const m = managersWith([work, fun])

    await loadFolders(m, { overwrite: true })

    expect(m.folders.list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([7, 8])
  })
})

describe('loadFolders: реконсайл', () => {
  it('ответ идентичен памяти — массив НЕ пересоздаётся и в IDB не пишем', async () => {
    useAppStateStore.setState({ folders: [work] })
    const before = useAppStateStore.getState().folders
    stateKey.mockClear()

    await loadFolders(managersWith([{ ...work }]), { overwrite: true })

    expect(useAppStateStore.getState().folders).toBe(before)
    expect(stateKey).not.toHaveBeenCalledWith('folders', expect.anything())
  })

  it('изменилась одна папка — у второй ссылка сохраняется', async () => {
    useAppStateStore.setState({ folders: [work, fun] })
    const funBefore = useAppStateStore.getState().folders[1]

    await loadFolders(managersWith([{ ...work, title: 'Работа!' }, { ...fun }]), { overwrite: true })

    const after = useAppStateStore.getState().folders
    expect(after[0].title).toBe('Работа!')
    expect(after[1]).toBe(funBefore)
  })

  it('папка исчезла из ответа — удаляется', async () => {
    useAppStateStore.setState({ folders: [work, fun] })

    await loadFolders(managersWith([{ ...work }]), { overwrite: true })

    expect(useAppStateStore.getState().folders.map((f) => f.id)).toEqual([7])
  })

  it('сеть упала — память не трогаем', async () => {
    useAppStateStore.setState({ folders: [work] })
    const before = useAppStateStore.getState().folders

    await loadFolders({
      folders: { list: vi.fn().mockRejectedValue(new Error('offline')) },
      contacts: { list: vi.fn().mockRejectedValue(new Error('offline')) },
    }, { overwrite: true })

    expect(useAppStateStore.getState().folders).toBe(before)
  })
})
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/stores/foldersStore.reconcile.test.ts`
Ожидаемо: FAIL — `loadFolders` не принимает опций и всегда ходит в сеть.

- [ ] **Шаг 3: Переписать loadFolders**

В `web-client/src/stores/foldersStore.ts` заменить функцию `loadFolders`:

```ts
/**
 * Порт tweb `FiltersStorage.getDialogFilters` (lib/storages/filters.ts:475-484).
 *
 * Cache-first: папки уже в памяти (подняты из State в boot.ts) — сеть НЕ дёргаем.
 * В tweb это `if (keys.length > PREPENDED_FILTERS && !overwrite) return ...` —
 * список папок меняется редко, и сервер сам присылает `updateDialogFilters`,
 * когда что-то изменилось. Опрашивать его на каждом старте незачем.
 *
 * `overwrite: true` — единственный путь к сети при непустой памяти; его зовёт
 * подписчик realtime по апдейту сервера (tweb filters.ts:167).
 */
export async function loadFolders(
  managers: {
    folders: { list(): Promise<Folder[]> }
    contacts: { list(): Promise<Contact[]> }
  },
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<void> {
  const cached = useAppStateStore.getState().folders
  if (cached.length && !overwrite) {
    // Контакты всё равно обновим: они нужны правилам contacts/non_contacts и
    // меняются независимо от папок.
    await loadContacts(managers)
    return
  }

  try {
    const incoming = await managers.folders.list()
    // Реконсайл вместо подмены: неизменившиеся папки сохраняют ссылки, и если
    // ответ совпал с памятью — не будет ни перерисовки, ни записи в IDB.
    const r = reconcileById(useAppStateStore.getState().folders, incoming, (f) => f.id)
    if (r.changed) setAppState('folders', r.list)
  } catch {
    /* оффлайн — остаёмся на том, что подняли из State */
  }

  await loadContacts(managers)
}

async function loadContacts(managers: { contacts: { list(): Promise<Contact[]> } }): Promise<void> {
  try {
    useFoldersStore.getState().setContacts((await managers.contacts.list()).map((c) => c.userId))
  } catch {
    /* без контактов правила contacts/non_contacts считают всех не-контактами */
  }
}
```

Добавить импорты в шапку файла:

```ts
import { reconcileById } from '../core/store/reconcile'
```

- [ ] **Шаг 4: Применять пуш сервера напрямую, без похода в сеть**

Здесь мы можем сделать **лучше tweb**, и это не отсебятина, а следствие разницы протоколов.

tweb на `updateDialogFilters` вынужден перезапрашивать весь список (`filters.ts:167`), потому что апдейт MTProto не несёт самих фильтров. Наш бэкенд шлёт в `folder_update` **абсолютный снимок папки** — `backend/internal/usecase/folders/folders.go:92-103`, и комментарий там прямо это фиксирует: «клиент заменяет определение целиком, порядок доставки апдейтов не важен — идемпотентно». Плюс апдейт пишется в пер-юзерный лог с плотным `pts` (`folders.go:116`), то есть пропущенные события догоняются после оффлайна.

Значит round trip не нужен вовсе: снимок из события кладём в State тем же реконсайлом.

Заменить обработчик в `web-client/src/client/realtime/refetchSubscriber.ts:34-36`:

```ts
  // Папки изменились на другом устройстве/вкладке. Бэкенд шлёт АБСОЛЮТНЫЙ снимок
  // папки (backend folders.go:92-103), поэтому в сеть не идём — применяем прямо
  // из события. tweb здесь вынужден перезапрашивать список (filters.ts:167):
  // апдейт MTProto самих фильтров не несёт. Пропуски после оффлайна закрывает
  // догон апдейт-лога по pts.
  eventBus.subscribe(RT.folderUpdate, (raw) => {
    const e = raw as { folder_id?: number; deleted?: boolean } & Folder
    const prev = useAppStateStore.getState().folders
    const next = e.deleted
      ? prev.filter((f) => f.id !== e.folder_id)
      : upsertSorted(prev, e)
    const r = reconcileById(prev, next, (f) => f.id)
    if (r.changed) setAppState('folders', r.list)
  })
```

Вспомогательная функция — рядом в том же файле:

```ts
// Вставка/замена с сохранением порядка по `pos` (бэкенд отдаёт позицию в снимке).
function upsertSorted(folders: Folder[], incoming: Folder): Folder[] {
  const rest = folders.filter((f) => f.id !== incoming.id)
  return [...rest, incoming].sort((a, b) => a.pos - b.pos)
}
```

Проверить фактическую форму payload перед реализацией: `grep -n "folderJSON" -A 12 backend/internal/usecase/folders/folders.go` и как его раскладывает воркер (`web-client/src/core/worker.ts:159`). Имена полей брать оттуда, не выдумывать: в снимке `id/title/pos/contacts/non_contacts/groups/broadcasts/bots/exclude_muted/exclude_read/include_chats/exclude_chats`, а у удаления — `{folder_id, deleted: true}`.

Если формы разойдутся с нашим типом `Folder` — привести маппинг в одном месте, а не растаскивать по обработчику.

- [ ] **Шаг 5: Прогнать тесты и тайпчек**

Запустить: `cd web-client && npm run typecheck && npx vitest run`
Ожидаемо: всё зелёное.

- [ ] **Шаг 6: Коммит**

```bash
git add -A web-client/src
git commit -m "refactor(folders): cache-first запрос + реконсайл вместо перезаписи (порт tweb getDialogFilters)"
```

---

## Task 3: `chat_update` — применять снимок вместо рефетча всего списка

Тот же паттерн, что с папками, но радиус больше: `publishChatUpdate` зовётся из **13 мест** бэкенда (переименование, фото, участники, права, настройки, слоумод), и сейчас каждое из них заставляет клиент **каждого участника** перезагрузить весь список диалогов.

**Files:**
- Modify: `web-client/src/client/realtime/refetchSubscriber.ts`
- Modify: `web-client/src/stores/chatsStore.ts`
- Test: `web-client/src/stores/chatsStore.chatMeta.test.ts` (создать)

**Interfaces:**
- Consumes: `reconcileById` (Task 1).
- Produces: `applyChatMeta(evt)` в `useChatsStore`.

- [ ] **Шаг 1: Свериться с формой payload**

Запустить: `sed -n '18,42p' backend/internal/usecase/chat/chat_update.go`

Поля снимка: `chat_id, type, title, about, username, is_public, member_count, photo_media_id, settings{...}` (+ `signatures`/`signature_profiles` у каналов). Поля `Dialog` на нашей стороне — `core/models.ts:88-118`: сюда ложатся `title`, `username`, `photoUrl` (строится из `photo_media_id` тем же способом, что и в остальном коде — посмотреть `core/mediaUrl.ts`, не выдумывать путь).

- [ ] **Шаг 2: Написать падающий тест**

Создать `web-client/src/stores/chatsStore.chatMeta.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatsStore } from './chatsStore'
import type { Dialog } from '../core/models'

const dlg = (chatId: number, title: string): Dialog =>
  ({ chatId, type: 'group', title, pinned: false, lastMessage: { at: '2026-08-09T10:00:00Z' } } as Dialog)

beforeEach(() => { useChatsStore.setState({ dialogs: [dlg(1, 'Альфа'), dlg(2, 'Бета')], loaded: true }) })

describe('applyChatMeta', () => {
  it('применяет снимок в существующий диалог', () => {
    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа+', username: 'alpha' })

    const d = useChatsStore.getState().dialogs.find((x) => x.chatId === 1)
    expect(d?.title).toBe('Альфа+')
    expect(d?.username).toBe('alpha')
  })

  it('соседний диалог сохраняет ССЫЛКУ (не перерисовывается)', () => {
    const betaBefore = useChatsStore.getState().dialogs.find((x) => x.chatId === 2)

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа+' })

    expect(useChatsStore.getState().dialogs.find((x) => x.chatId === 2)).toBe(betaBefore)
  })

  it('снимок совпал с текущим — массив НЕ пересоздаётся', () => {
    const before = useChatsStore.getState().dialogs

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа' })

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('чата нет в списке — ничего не делаем и не падаем', () => {
    const before = useChatsStore.getState().dialogs

    useChatsStore.getState().applyChatMeta({ chat_id: 999, title: 'Чужой' })

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('порядок не меняется: метаданные не влияют на сортировку', () => {
    useChatsStore.getState().applyChatMeta({ chat_id: 2, title: 'Бета+' })

    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1, 2])
  })
})
```

- [ ] **Шаг 3: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/stores/chatsStore.chatMeta.test.ts`
Ожидаемо: FAIL — метода `applyChatMeta` нет.

- [ ] **Шаг 4: Реализовать applyChatMeta**

В `web-client/src/stores/chatsStore.ts` — добавить в интерфейс стора и в реализацию:

```ts
  /** Снимок метаданных чата из realtime-события `chat_update`. */
  applyChatMeta: (m: ChatUpdateEvt) => void
```

```ts
  // Бэкенд шлёт в `chat_update` АБСОЛЮТНЫЙ снимок метаданных чата
  // (backend chat_update.go:44-47), поэтому запрашивать список заново не нужно:
  // сливаем снимок в существующий диалог. Раньше здесь был полный рефетч /chats
  // на каждое изменение — а зовётся publishChatUpdate из 13 мест бэкенда.
  applyChatMeta: (m) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === m.chat_id)
      if (idx === -1) return s // чата нет в списке — появится при следующей загрузке
      const next = s.dialogs.slice()
      next[idx] = {
        ...s.dialogs[idx],
        title: m.title,
        username: m.username,
        ...(m.photo_media_id !== undefined ? { photoUrl: mediaContentUrl(m.photo_media_id) } : {}),
      }
      // Через общий путь: reconcileById вернёт ИСХОДНЫЙ массив, если снимок
      // совпал с текущим состоянием, и не тронет ссылки соседей.
      return { dialogs: applyDialogs(s.dialogs, next) }
    }),
```

Тип события положить рядом с остальными в `core/realtime/events.ts`:

```ts
export interface ChatUpdateEvt {
  chat_id: number
  title?: string
  username?: string
  photo_media_id?: number | null
  member_count?: number
}
```

**Важно:** если `applyDialogs` из Task 5 ещё не существует (эта задача идёт раньше), собрать список без него — `next` уже в правильном порядке, достаточно `reconcileById(s.dialogs, next, (d) => d.chatId).list`. После Task 5 переключить на `applyDialogs`, чтобы путь остался один.

- [ ] **Шаг 5: Заменить обработчик**

В `web-client/src/client/realtime/refetchSubscriber.ts:33` заменить рефетч:

```ts
  // Метаданные чата сменились (title/photo/права/…). Бэкенд шлёт абсолютный
  // снимок (chat_update.go:44-47) — применяем его, в сеть не идём.
  eventBus.subscribe(RT.chatUpdate, (raw) => {
    useChatsStore.getState().applyChatMeta(raw as ChatUpdateEvt)
  })
```

Проверить, не осталась ли `reloadChats` без потребителей: она ещё нужна `rt:resync`. Если после правки дебаунсер используется только там — оставить, но убедиться, что импорт `useFoldersStore` из файла ушёл, если он больше не нужен.

- [ ] **Шаг 6: Прогнать всё**

Запустить: `cd web-client && npm run typecheck && npx vitest run`

- [ ] **Шаг 7: Коммит**

```bash
git add -A web-client/src
git commit -m "perf(chats): chat_update применяется снимком, без рефетча списка диалогов"
```

---

## Task 4: Индекс диалога — порядок как производная от данных

**Files:**
- Create: `web-client/src/core/dialogs/dialogIndex.ts`
- Test: `web-client/src/core/dialogs/dialogIndex.test.ts`
- Modify: `web-client/src/core/state/state.ts` (ключ `pinnedOrders`)

**Interfaces:**
- Consumes: `AppState` (план State).
- Produces: `dialogIndex(dialog, pinnedOrder): number`, `PINNED_BASE`.

- [ ] **Шаг 1: Добавить ключ pinnedOrders в State**

В `web-client/src/core/state/state.ts` — в интерфейс и в `STATE_INIT`:

```ts
  /** порядок закреплённых по папкам: folderId → chatId[] (tweb `pinnedOrders`) */
  pinnedOrders: Record<number, number[]>
```
```ts
  pinnedOrders: {},
```

Миграция IndexedDB не нужна: `loadStateOnce` добирает недостающие ключи из `STATE_INIT`.

- [ ] **Шаг 2: Написать падающий тест**

Создать `web-client/src/core/dialogs/dialogIndex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dialogIndex } from './dialogIndex'
import type { Dialog } from '../models'

const at = (iso: string) => ({ at: iso })
const dlg = (over: Partial<Dialog>): Dialog => ({
  chatId: 1, type: 'private', pinned: false, lastMessage: at('2026-08-09T10:00:00Z'), ...over,
} as Dialog)

describe('dialogIndex', () => {
  it('свежее сообщение — больший индекс (выше в списке)', () => {
    const older = dialogIndex(dlg({ chatId: 1, lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const newer = dialogIndex(dlg({ chatId: 2, lastMessage: at('2026-08-09T11:00:00Z') }), [])

    expect(newer).toBeGreaterThan(older)
  })

  it('закреплённый всегда выше любого незакреплённого', () => {
    const pinnedOld = dialogIndex(dlg({ chatId: 1, pinned: true, lastMessage: at('2020-01-01T00:00:00Z') }), [1])
    const freshUnpinned = dialogIndex(dlg({ chatId: 2, lastMessage: at('2026-08-09T23:59:00Z') }), [])

    expect(pinnedOld).toBeGreaterThan(freshUnpinned)
  })

  it('порядок закреплённых — по позиции в pinnedOrder', () => {
    const order = [5, 6, 7]
    const first = dialogIndex(dlg({ chatId: 5, pinned: true }), order)
    const second = dialogIndex(dlg({ chatId: 6, pinned: true }), order)
    const third = dialogIndex(dlg({ chatId: 7, pinned: true }), order)

    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
  })

  it('черновик свежее последнего сообщения — поднимает диалог', () => {
    const withoutDraft = dialogIndex(dlg({ lastMessage: at('2026-08-09T10:00:00Z') }), [])
    const withDraft = dialogIndex(
      dlg({ lastMessage: at('2026-08-09T10:00:00Z'), draftAt: '2026-08-09T12:00:00Z' } as Partial<Dialog>),
      [],
    )

    expect(withDraft).toBeGreaterThan(withoutDraft)
  })

  it('детерминированность: те же данные — тот же индекс', () => {
    const d = dlg({ chatId: 3, lastMessage: at('2026-08-09T10:00:00Z') })

    expect(dialogIndex(d, [])).toBe(dialogIndex(d, []))
  })

  it('диалог без сообщений не падает', () => {
    expect(Number.isFinite(dialogIndex(dlg({ lastMessage: undefined }), []))).toBe(true)
  })
})
```

- [ ] **Шаг 3: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/core/dialogs/dialogIndex.test.ts`
Ожидаемо: FAIL — модуля нет.

- [ ] **Шаг 4: Реализовать индекс**

Создать `web-client/src/core/dialogs/dialogIndex.ts`:

```ts
// Порт порядка диалогов из tweb (lib/storages/dialogs.ts). Смысл: порядок —
// ПРОИЗВОДНАЯ ОТ ДАННЫХ, а не позиция в ответе сервера. Из одних и тех же данных
// всегда получается один и тот же порядок, поэтому кэш и сеть не расходятся и
// список не перетасовывается после ответа сети.
//
// Оригинал (dialogs.ts:605-608):
//   generateDialogIndex(date, isPinned) => (date * 0x10000) + (isPinned ? 0 : (++dialogsNum & 0xFFFF))
//
// Отличие от tweb: там младшие 16 бит — инкрементный счётчик экземпляра
// (разрешитель ничьей при равных датах). Счётчик зависит от порядка вызовов, то
// есть НЕ детерминирован между кэшем и сетью — ровно то, чего мы избегаем.
// Берём вместо него chatId: так же разводит ничьи, но одинаково при любом порядке.
import type { Dialog } from '../models'

/** tweb `generateDialogPinnedDateByIndex` (dialogs.ts:922-925): заведомо больше любой реальной даты. */
export const PINNED_BASE = 0x7fff0000

const secs = (iso: string | undefined): number => {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/**
 * Числовой индекс диалога: больше — выше в списке.
 *
 * @param pinnedOrder порядок закреплённых в текущей папке (State `pinnedOrders`)
 */
export function dialogIndex(dialog: Dialog, pinnedOrder: readonly number[]): number {
  const date = dialog.pinned ? pinnedDate(dialog, pinnedOrder) : activityDate(dialog)
  // Младшие 16 бит — разрешитель ничьей (tweb: ++dialogsNum, у нас chatId).
  return date * 0x10000 + (dialog.pinned ? 0 : (dialog.chatId & 0xffff))
}

/** tweb `generateDialogPinnedDate` (dialogs.ts:928-943). */
function pinnedDate(dialog: Dialog, order: readonly number[]): number {
  const idx = order.indexOf(dialog.chatId)
  // Не нашли в сохранённом порядке — считаем самым верхним (tweb: order.unshift).
  const pinnedIndex = idx === -1 ? 0 : idx
  const len = idx === -1 ? order.length + 1 : order.length
  // Переворот: нулевой в порядке закреплённых получает наибольшее значение.
  return PINNED_BASE + ((len - 1 - pinnedIndex) & 0xffff)
}

/** tweb `generateIndexForDialog` (dialogs.ts:868-921): дата последней активности. */
function activityDate(dialog: Dialog): number {
  let top = secs(dialog.lastMessage?.at)
  // Черновик свежее последнего сообщения поднимает диалог (dialogs.ts:903-908).
  const draft = secs((dialog as Dialog & { draftAt?: string }).draftAt)
  if (draft > top) top = draft
  // Пустой диалог не должен улетать в самый низ навсегда (tweb: topDate ||= tsNow()).
  return top || 0
}
```

- [ ] **Шаг 5: Прогнать тест — должен пройти**

Запустить: `cd web-client && npx vitest run src/core/dialogs/dialogIndex.test.ts`
Ожидаемо: PASS (6 тестов). Если поле черновика в `Dialog` называется иначе — посмотреть `core/models.ts` и поправить И тест, И реализацию, не выдумывая поле.

- [ ] **Шаг 6: Коммит**

```bash
git add web-client/src/core/dialogs/ web-client/src/core/state/state.ts
git commit -m "feat(dialogs): индекс порядка как производная от данных (порт tweb generateDialogIndex)"
```

---

## Task 5: chatsStore — один путь применения

Это задача, которая чинит перетасовку списка.

**Files:**
- Modify: `web-client/src/stores/chatsStore.ts`
- Test: `web-client/src/stores/chatsStore.order.test.ts` (создать)

**Interfaces:**
- Consumes: `reconcileById` (Task 1), `dialogIndex` (Task 4).
- Produces: `setDialogs`, `upsertDialog` — оба через `applyDialogs`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/chatsStore.order.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatsStore } from './chatsStore'
import type { Dialog } from '../core/models'

const dlg = (chatId: number, at: string, pinned = false): Dialog =>
  ({ chatId, type: 'private', pinned, lastMessage: { at } } as Dialog)

const ids = () => useChatsStore.getState().dialogs.map((d) => d.chatId)

beforeEach(() => { useChatsStore.setState({ dialogs: [], loaded: false }) })

describe('chatsStore: порядок производный', () => {
  it('порядок не зависит от порядка входного массива', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T10:00:00Z'),
      dlg(2, '2026-08-09T12:00:00Z'),
      dlg(3, '2026-08-09T11:00:00Z'),
    ])
    const first = ids()

    useChatsStore.getState().setDialogs([
      dlg(3, '2026-08-09T11:00:00Z'),
      dlg(1, '2026-08-09T10:00:00Z'),
      dlg(2, '2026-08-09T12:00:00Z'),
    ])

    expect(ids()).toEqual(first)
    expect(ids()).toEqual([2, 3, 1])
  })

  it('кэш и сеть с одинаковыми данными дают одинаковый список по ССЫЛКЕ', () => {
    const cache = [dlg(1, '2026-08-09T10:00:00Z'), dlg(2, '2026-08-09T12:00:00Z')]
    useChatsStore.getState().setDialogs(cache)
    const before = useChatsStore.getState().dialogs

    useChatsStore.getState().setDialogs([dlg(2, '2026-08-09T12:00:00Z'), dlg(1, '2026-08-09T10:00:00Z')])

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('закреплённые сверху независимо от даты', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T12:00:00Z'),
      dlg(2, '2020-01-01T00:00:00Z', true),
    ])

    expect(ids()).toEqual([2, 1])
  })

  it('upsert живого сообщения поднимает диалог тем же правилом', () => {
    useChatsStore.getState().setDialogs([
      dlg(1, '2026-08-09T10:00:00Z'),
      dlg(2, '2026-08-09T12:00:00Z'),
    ])

    useChatsStore.getState().upsertDialog(dlg(1, '2026-08-09T13:00:00Z'))

    expect(ids()).toEqual([1, 2])
  })
})
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/stores/chatsStore.order.test.ts`
Ожидаемо: FAIL — сейчас порядок берётся из входного массива.

- [ ] **Шаг 3: Свести оба пути в один**

В `web-client/src/stores/chatsStore.ts`:

Добавить импорты:

```ts
import { reconcileById } from '../core/store/reconcile'
import { dialogIndex } from '../core/dialogs/dialogIndex'
import { useAppStateStore } from './appState'
```

Добавить общий применятель (единственное место, где меняется список):

```ts
// ЕДИНСТВЕННЫЙ путь изменения списка диалогов. Раньше правил было два — порядок
// входного массива в setDialogs и ручная splice-логика в upsertDialog — и они
// расходились: кэш давал один порядок, ответ сети другой, список перетасовывался
// через ~250 мс после первого кадра. Теперь порядок производный (dialogIndex),
// поэтому из одних данных всегда один результат (tweb: index_N + sorted list).
function applyDialogs(prev: Dialog[], incoming: Dialog[]): Dialog[] {
  const pinnedOrder = useAppStateStore.getState().pinnedOrders[0] ?? []
  const sorted = incoming
    .map((d) => [d, dialogIndex(d, pinnedOrder)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
  return reconcileById(prev, sorted, (d) => d.chatId).list
}
```

Заменить `setDialogs`:

```ts
  setDialogs: (dialogs) => set((s) => ({ dialogs: applyDialogs(s.dialogs, dialogs), loaded: true })),
```

Заменить тело `upsertDialog` (существующая ручная логика с `firstUnpinned` и `slice` удаляется целиком):

```ts
  upsertDialog: (d) =>
    set((s) => {
      const rest = s.dialogs.filter((x) => x.chatId !== d.chatId)
      return { dialogs: applyDialogs(s.dialogs, [...rest, d]) }
    }),
```

- [ ] **Шаг 4: Проверить остальных мутаторов списка**

Запустить: `cd web-client && grep -n "dialogs:" src/stores/chatsStore.ts`

Каждый сеттер, который переставляет диалоги (`setDialogPinned`, архивация и т. п.), перевести на `applyDialogs` — ручных `slice`/`splice`-перестановок в файле остаться не должно. `setDialogPinned` дополнительно обновляет `pinnedOrders` в State:

```ts
  setDialogPinned: (chatId, pinned) =>
    set((s) => {
      const next = s.dialogs.map((d) => (d.chatId === chatId ? { ...d, pinned } : d))
      const order = useAppStateStore.getState().pinnedOrders[0] ?? []
      // tweb: закреплённый встаёт первым в порядке (dialogs.ts:934 order.unshift)
      const nextOrder = pinned
        ? [chatId, ...order.filter((id) => id !== chatId)]
        : order.filter((id) => id !== chatId)
      setAppState('pinnedOrders', { ...useAppStateStore.getState().pinnedOrders, 0: nextOrder })
      return { dialogs: applyDialogs(s.dialogs, next) }
    }),
```

- [ ] **Шаг 5: Прогнать всё**

Запустить: `cd web-client && npm run typecheck && npx vitest run`
Ожидаемо: всё зелёное. Тесты `chatsStore.test.ts`, которые ожидали старый порядок вставки, придётся поправить — но только если они проверяли ПОЗИЦИЮ, а не поведение; если тест падает потому, что порядок теперь правильный, поправь ожидание и оставь комментарий почему.

- [ ] **Шаг 6: Коммит**

```bash
git add -A web-client/src
git commit -m "fix(dialogs): один путь применения — список больше не перетасовывается после ответа сети"
```

---

## Task 6: Cache-first для черновиков и звёзд

Оба события логируются с плотным `pts` и попадают в `/difference` (тесты `backend/internal/usecase/chat/wave2_updates_test.go:221-224,243-245`), то есть пропуски после оффлайна догоняются. Значит опрашивать сеть на каждом старте незачем — как и с папками.

**Требует:** задачу 6 плана State (черновики переезжают в `AppState`).

**Files:**
- Modify: `web-client/src/core/state/state.ts` (ключ `starsBalance`)
- Modify: `web-client/src/stores/draftsStore.ts`
- Modify: `web-client/src/stores/starsStore.ts`
- Test: `web-client/src/stores/cacheFirst.test.ts` (создать)

- [ ] **Шаг 1: Написать падающий тест**

Создать `web-client/src/stores/cacheFirst.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STATE_INIT } from '../core/state/state'
import { useAppStateStore, setStateWriter } from './appState'
import { loadDrafts } from './draftsStore'
import { loadStars } from './starsStore'

const draft = { chatId: 3, text: 'привет', replyToId: null, updatedAt: '2026-08-09T00:00:00Z' }

beforeEach(() => {
  useAppStateStore.setState({ ...STATE_INIT }, true)
  setStateWriter({ stateKey: vi.fn().mockResolvedValue(undefined) })
})

describe('черновики: cache-first', () => {
  it('черновики есть в State — в сеть не идём', async () => {
    useAppStateStore.setState({ drafts: [draft] })
    const list = vi.fn()

    await loadDrafts({ drafts: { list } })

    expect(list).not.toHaveBeenCalled()
  })

  it('черновиков нет — запрашиваем', async () => {
    const list = vi.fn().mockResolvedValue([draft])

    await loadDrafts({ drafts: { list } })

    expect(list).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().drafts).toEqual([draft])
  })
})

describe('звёзды: cache-first', () => {
  it('баланс уже известен — в сеть не идём', async () => {
    useAppStateStore.setState({ starsBalance: 42 })
    const balance = vi.fn()

    await loadStars({ stars: { balance } })

    expect(balance).not.toHaveBeenCalled()
  })

  it('баланс никогда не грузился (null) — запрашиваем', async () => {
    const balance = vi.fn().mockResolvedValue(7)

    await loadStars({ stars: { balance } })

    expect(balance).toHaveBeenCalledTimes(1)
    expect(useAppStateStore.getState().starsBalance).toBe(7)
  })

  it('нулевой баланс — это ЗНАЧЕНИЕ, повторно не запрашиваем', async () => {
    useAppStateStore.setState({ starsBalance: 0 })
    const balance = vi.fn()

    await loadStars({ stars: { balance } })

    expect(balance).not.toHaveBeenCalled()
  })
})
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

Запустить: `cd web-client && npx vitest run src/stores/cacheFirst.test.ts`

- [ ] **Шаг 3: Добавить starsBalance в State**

В `web-client/src/core/state/state.ts`:

```ts
  /** баланс звёзд; null — ни разу не загружался (0 — законное значение) */
  starsBalance: number | null
```
```ts
  starsBalance: null,
```

Отличие от папок и черновиков: там «пусто» и «не загружено» можно не различать (пустой список — валидный ответ, и повторный запрос дёшев). У баланса `0` — законное значение, поэтому нужен явный `null`.

- [ ] **Шаг 4: Реализовать cache-first**

`draftsStore.ts` — в `loadDrafts`:

```ts
export async function loadDrafts(managers: { drafts: { list(): Promise<Draft[]> } }): Promise<void> {
  // Cache-first: черновики подняты из State в boot.ts, а изменения приходят
  // событием draft_update (логируется с pts, догоняется через /difference).
  // Оговорка та же, что у tweb с папками: «пусто» и «не загружено» не различаем,
  // поэтому у пользователя без черновиков запрос уйдёт на каждом старте. Он дешёвый.
  if (useAppStateStore.getState().drafts.length) return
  try {
    setAllDrafts(await managers.drafts.list())
  } catch {
    /* оффлайн — остаёмся на черновиках из State */
  }
}
```

`starsStore.ts` — баланс переезжает в State, локальный `balance`/`loaded` удаляются:

```ts
export function useStarsBalance(): number {
  return useAppStateKey('starsBalance') ?? 0
}

export async function loadStars(managers: { stars: { balance(): Promise<number> } }): Promise<void> {
  if (useAppStateStore.getState().starsBalance !== null) return
  try {
    setAppState('starsBalance', await managers.stars.balance())
  } catch {
    /* stars могут быть недоступны — фича мягко отключается */
  }
}
```

- [ ] **Шаг 5: Перевести потребителей звёзд**

Запустить: `cd web-client && grep -rn "useStarsStore" src/`
Заменить чтение `balance` на `useStarsBalance()`, запись из realtime (`RT.balanceUpdate`) — на `setAppState('starsBalance', n)`. Проверить, что обработчик `balanceUpdate` в `storeProjection.ts` тоже переведён, иначе баланс перестанет обновляться живьём.

- [ ] **Шаг 6: Прогнать всё**

Запустить: `cd web-client && npm run typecheck && npx vitest run`

- [ ] **Шаг 7: Коммит**

```bash
git add -A web-client/src
git commit -m "perf(boot): cache-first для черновиков и баланса звёзд"
```

---

## Task 7: Инвариант — порядок нигде не задаётся вручную

**Files:**
- Create: `web-client/src/stores/noManualOrder.test.ts`
- Modify: `web-client/CLAUDE.md`

- [ ] **Шаг 1: Написать тест-инвариант**

Создать `web-client/src/stores/noManualOrder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Порядок диалогов — производная от данных (dialogIndex). Любая ручная
// перестановка возвращает второе правило сортировки, а два правила = перетасовка
// списка между кэшем и сетью (см. план 2026-08-09-tweb-reconcile-port.md).
describe('chatsStore: порядок только через dialogIndex', () => {
  it('нет ручных перестановок массива диалогов', () => {
    const src = readFileSync(join(__dirname, 'chatsStore.ts'), 'utf8')

    // единственная разрешённая сортировка живёт в applyDialogs
    const applyDialogs = src.slice(src.indexOf('function applyDialogs'))
    const body = src.replace(applyDialogs, '')

    expect(body).not.toMatch(/\.splice\(/)
    expect(body).not.toMatch(/\.sort\(/)
    expect(body).not.toMatch(/firstUnpinned/)
  })
})
```

- [ ] **Шаг 2: Прогнать тест**

Запустить: `cd web-client && npx vitest run src/stores/noManualOrder.test.ts`
Ожидаемо: PASS. Если FAIL — значит в задаче 4 остался мутатор с ручной перестановкой; перевести его на `applyDialogs`, а не смягчать тест.

- [ ] **Шаг 3: Записать правила в CLAUDE.md**

В `web-client/CLAUDE.md`, в блок «НЕЛЬЗЯ» раздела «Архитектура клиента»:

```markdown
- Задавать порядок списка позицией в массиве или ручным `splice`. Порядок диалогов —
  производная от данных (`core/dialogs/dialogIndex.ts`, порт tweb `generateDialogIndex`).
  Два правила сортировки = список перетасовывается между кэшем и ответом сети.
- Применять ответ сети полной подменой коллекции. Сводить через
  `core/store/reconcile.ts`: неизменившиеся записи сохраняют ссылки, идентичный
  ответ не даёт ни перерисовки, ни записи в IDB (порт tweb `saveDialogFilter`).
- Опрашивать сеть на каждом старте за тем, что уже есть в памяти. Cache-first:
  сеть только при пустой памяти или по апдейту сервера (порт tweb `getDialogFilters`).
```

- [ ] **Шаг 4: Финальная проверка**

Запустить: `cd web-client && npm run typecheck && npm run lint && npx vitest run`

- [ ] **Шаг 5: Коммит**

```bash
git add web-client/src/stores/noManualOrder.test.ts web-client/CLAUDE.md
git commit -m "test(dialogs): инвариант — порядок только через dialogIndex"
```

---

## Проверка результата

На стенде (`https://localhost:38443`, вкладки закрыть и открыть заново — SharedWorker переживает обновление фронта), тем же способом, каким ловили баг:

```js
// initScript при reload
const rec = { t0: performance.now(), f: [] }
const sample = () => {
  const t = Math.round(performance.now() - rec.t0)
  if (t > 4000) return
  const first = document.querySelector('.chatlist-chat')
  rec.f.push({ t, rows: document.querySelectorAll('.chatlist-chat').length,
               first: first?.querySelector('.peer-title')?.textContent })
  requestAnimationFrame(sample)
}
requestAnimationFrame(sample)
```

**Критерий:** с момента появления строк и до конца записи поле `first` не меняется.

Замер до правки (эталон бага):
```
t=121ms  49 строк, первая «Денис Марамыгин»
t=375ms  49 строк, первая «Команда Альфа»   ← перетасовка
```

Дополнительно проверить в Network, что на повторном старте запроса за списком папок **нет** (cache-first), а после изменения папки с другого устройства он появляется.

---

## Что осознанно НЕ переносим

- **`SortedList`/`SortedUserList`** — императивные списки tweb, которые двигают DOM-узлы. У нас список рендерит React по массиву; сортировка массива по индексу даёт тот же результат.
- **`index_${folderId}` на самом диалоге** — tweb хранит индекс на объекте по одному на папку. У нас папка одна активная, индекс считается на лету в `applyDialogs`; кэшировать его на объекте есть смысл, только если профайлер покажет проблему.
- **`localId` у папок** — порядок папок сейчас берётся из ответа бэка. Отдельная задача, если появится ручная сортировка папок в UI.
