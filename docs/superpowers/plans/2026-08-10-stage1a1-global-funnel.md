# Этап 1A.1: вынос глобального funnel'а — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вынести funnel апдейтов из `worker.ts` в отдельный модуль с явными зависимостями (по образцу уже существующего `channelFunnel.ts`) и закрыть его тестами — включая раскладку `meta.catchUp`, которая сейчас не защищена ничем.

**Architecture:** `dispatch` / `applyUpdate` / `drainPending` / `schedulePtsSync` / `clearPtsSync` — сейчас приватные замыкания верхнего уровня в `worker.ts`, а импорт этого файла поднимает всё дерево менеджеров и транспорт, поэтому юнит-тест невозможен. Переезжают в `src/core/realtime/globalFunnel.ts` как фабрика `newGlobalFunnel(deps)` с инъекцией зависимостей — ровно та форма, что у `newChannelFunnel(deps)`. Поведение не меняется ни на йоту: это чистый рефактор перемещением.

**Tech Stack:** TS strict, vitest + happy-dom, SharedWorker.

## Global Constraints

- **Рефактор без изменения поведения.** Ни одна ветка, ни один порядок вызовов, ни одно значение курсора не меняются. Если по ходу покажется, что «тут логичнее иначе» — не трогать, записать в отчёт как наблюдение.
- **Форма — как у `channelFunnel.ts`.** Фабрика `newGlobalFunnel(deps)`, зависимости объявлены интерфейсом, возвращается объект с методами. Не изобретать другой стиль.
- **Раскладка `meta` — та, что уже в коде** (её приняло финальное ревью Этапа 1A): live-next → `{pts, catchUp:false}`; `drainPending` → `catchUp:false` (кадр был живым, лишь придержан); `/sync` → `catchUp:true`; ветка без `pts` → без `meta`. Тесты фиксируют именно её.
- `cursor.ts`, `pendingPts.ts`, `channelFunnel.ts` (кроме дописывания тестов), `PTS_SYNC_DELAY` как значение, E2E-расшифровка в `onFrame` — **не трогать**. Снос `PTS_SYNC_DELAY` и перенос расшифровки — это план 1D.
- Комментарии по-русски, в стиле окружающего кода; при переносе комментарии едут вместе с кодом (они объясняют неочевидное — не выбрасывать и не переписывать).
- Команды из `web-client/`: `npm test`, `npm run typecheck`, `npx oxlint <файлы>`, `npm run build`.
  `npm run lint` выходит с кодом 1 и на main (вендореный `src/helpers/middleware.ts`) — ворота: не добавлять НОВЫХ находок в изменённых файлах.
- **Git-гигиена:** только точечный `git add <файлы>` + `git commit`. Запрещены `git reset`, `git rebase`, `git commit --amend`, `git checkout`/`restore`, `git stash`, `git add -A`/`.`, `git commit -a`.
- Коммиты на русском с трейлерами:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UJM3i1Gj8Lfz2REQDrCiLX
  ```

---

### Task 1: Вынос funnel'а в модуль с явными зависимостями

**Files:**
- Create: `web-client/src/core/realtime/globalFunnel.ts`
- Modify: `web-client/src/core/worker.ts` (удалить перенесённое, подключить фабрику)

**Interfaces:**
- Produces:
  ```ts
  export interface GlobalFunnelDeps {
    /** Отражение апдейта в SSOT воркера + broadcast в вкладки (worker.dispatch). */
    dispatch: (t: string, d: unknown, meta?: EventMeta) => void
    cursor: Cursor                       // из './cursor'
    /** Курсор гидратирован из IDB (гейт перед первым apply). */
    isCursorReady: () => boolean
    /** Идёт ли catch-up (syncEngine.isSyncing). */
    isSyncing: () => boolean
    /** Запустить catch-up (syncEngine.catchUp). */
    catchUp: () => void
    /** Задержка перед уходом в catch-up при незакрытой дыре. */
    syncDelay?: number                   // по умолчанию 250 — текущее PTS_SYNC_DELAY
  }

  export function newGlobalFunnel(deps: GlobalFunnelDeps): {
    /** Единый вход: live=true — WS-кадр, live=false — элемент /sync. */
    applyUpdate(t: string, pts: number | undefined, d: unknown, live: boolean): void
    /** Сброс буфера и таймера (полный resync / реконнект с расхождением pts). */
    clear(): void
  }
  ```
- Consumes: `newPendingPts` из `./pendingPts`, `classifyPts` из `./cursor`, `EventMeta` из `../../rpc/superMessagePort`.

**Важно про `dispatch`.** В `worker.ts` функция `dispatch` знает про реестр `APPLY`, `routeNewMessage`, `messages.cacheLive` и `broadcast` — то есть про менеджеры. Она **остаётся в `worker.ts`** и передаётся в фабрику как зависимость. Переезжает только арифметика funnel'а (`applyUpdate`, `drainPending`, `schedulePtsSync`, `clearPtsSync`, владение `pendingPts`).

- [ ] **Step 1: Перенести код.** Взять из `worker.ts` (искать по содержимому) тела `applyUpdate`, `drainPending`, `schedulePtsSync`, `clearPtsSync` и объявления `pendingPts`, `PTS_SYNC_DELAY`, `ptsSyncTimer` — перенести в новый модуль внутрь фабрики, заменив прямые обращения на `deps.*`:
  - `cursor.get().pts` → `deps.cursor.get().pts`; `cursor.advance(pts)` → `deps.cursor.advance(pts)`;
  - `cursorReady` → `deps.isCursorReady()`;
  - `sync.isSyncing()` → `deps.isSyncing()`; `void sync.catchUp()` → `deps.catchUp()`;
  - `dispatch(...)` → `deps.dispatch(...)`;
  - `PTS_SYNC_DELAY` → `deps.syncDelay ?? 250`.
  Комментарии перенести дословно вместе с кодом.

- [ ] **Step 2: Подключить в `worker.ts`.**
  ```ts
  const funnel = newGlobalFunnel({
    dispatch,
    cursor,
    isCursorReady: () => cursorReady,
    isSyncing: () => sync.isSyncing(),
    catchUp: () => { void sync.catchUp() },
  })
  ```
  Все прежние вызовы `applyUpdate(...)` в `onFrame` → `funnel.applyUpdate(...)`; прежние `clearPtsSync()` (в `onResync` и в ветке `hello`) → `funnel.clear()`. Порядок объявлений: фабрика создаётся ПОСЛЕ `dispatch` и `sync` — проверить, что не появилось обращения к переменной до инициализации (TDZ).

- [ ] **Step 3: Проверка «поведение не изменилось».** `npm test` — весь существующий набор обязан пройти без правок тестов. Если хоть один тест потребовал изменения — это не рефактор, а изменение поведения: остановиться и сообщить (BLOCKED) с указанием, какой именно инвариант поехал.

- [ ] **Step 4: `npm run typecheck`, `npx oxlint` по двум файлам, `npm run build`.**

- [ ] **Step 5: Commit** — `refactor(realtime): глобальный funnel вынесен в модуль с явными зависимостями`

---

### Task 2: Тесты глобального funnel'а

Ради этого этап и делается: сейчас мутация `catchUp: false → true` в `worker.ts` проходит мимо всех 1060 тестов.

**Files:**
- Test: `web-client/src/core/realtime/globalFunnel.test.ts` (создать)

**Interfaces:**
- Consumes: `newGlobalFunnel` (Task 1), `newCursor` из `./cursor` (для реального курсора в тесте — фейковый KV подставить как в `cursor.test.ts`).

- [ ] **Step 1: Написать тесты.** Харнес: `dispatch` — шпион, собирающий `{t, pts, catchUp}`; курсор — настоящий `newCursor` с in-memory KV (посмотреть, как это сделано в существующем `cursor.test.ts`, и перенять); `isCursorReady` → `true`; `isSyncing` → управляемый флаг; `catchUp` — шпион.

  Обязательные случаи (каждый должен различать исправную реализацию и сломанную):
  1. **live-next** — `applyUpdate('read', cursor+1, d, true)` → `dispatch` вызван с `catchUp:false`, курсор сдвинулся;
  2. **`/sync`** — `applyUpdate('read', cursor+1, d, false)` → `dispatch` с `catchUp:true`;
  3. **дубль** — `pts <= cursor` (обе ветки, live и sync) → `dispatch` НЕ вызван;
  4. **дыра live** — `pts > cursor+1` → `dispatch` НЕ вызван, кадр придержан; затем приходит недостающий `cursor+1` → оба кадра применены **по порядку**, и придержанный тоже с `catchUp:false` (это ключевой пин: буферный кадр — живой, а не catch-up);
  5. **без pts** — `applyUpdate('typing', undefined, d, true)` → `dispatch` вызван БЕЗ `meta`;
  6. **гейт syncLoading** — при `isSyncing() === true` живой кадр с pts отбрасывается, `dispatch` не вызван;
  7. **гейт гидратации** — при `isCursorReady() === false` живой кадр не применяется, а `catchUp` вызван;
  8. **таймаут дыры** — с `syncDelay: 0` (или через `vi.useFakeTimers()`): дыра, которую никто не закрыл, приводит к вызову `catchUp` и очистке буфера;
  9. **`clear()`** — придержанный кадр после `clear()` не всплывает, когда приходит следующий по порядку.

- [ ] **Step 2: Прогнать.** Все зелёные. Затем **доказать, что тесты кусаются**: по очереди внести три мутации в `globalFunnel.ts`, каждый раз убедиться в красноте и вернуть файл:
  - (а) `/sync`-ветка помечает `catchUp:false` вместо `true`;
  - (б) `drainPending` помечает `catchUp:true` вместо `false`;
  - (в) снят гейт `isSyncing()`.
  Привести реальные красные выводы всех трёх. Если какая-то мутация НЕ покраснела — тест недостаточен, дописать (и сказать об этом в отчёте), а не сдавать как есть.

- [ ] **Step 3: `npm test`, `npm run typecheck`, `npx oxlint` по тесту. Commit** — `test(realtime): пины раскладки meta и гейтов глобального funnel'а`

---

### Task 3: Добор пропусков в тестах канального funnel'а

Ревью Этапа 1A отметило: meta-тест `channelFunnel.test.ts` не покрывает `drainPending` и основную ветку `applyLive` — мутация `catchUp` в них проскочит.

**Files:**
- Test: `web-client/src/core/realtime/channelFunnel.test.ts` (дописать)

- [ ] **Step 1: Дописать два случая** в существующий файл (харнес — тамошний, но `dispatch` должен собирать `meta`, а не игнорировать её):
  1. **основная ветка `applyLive`** (курсор уже сидирован, приходит `pts === cursor+1`) → `dispatch` с `catchUp:false`;
  2. **`drainPending`** — придержанный из-за дыры канальный кадр после прихода недостающего применяется с `catchUp:false`.

- [ ] **Step 2: Доказать укус** — мутация `catchUp` в каждой из двух точек `channelFunnel.ts` даёт красноту; привести выводы; вернуть файл.

- [ ] **Step 3: `npm test`, typecheck, oxlint. Commit** — `test(realtime): meta-пины для drainPending и основной ветки канального funnel'а`

---

## Self-Review

- Цель этапа закрыта: funnel стал тестируемым (T1), его раскладка `meta` и гейты закреплены пинами с доказанным укусом (T2), пропуски канального funnel'а добраны (T3).
- Сознательно вне объёма: снос `PTS_SYNC_DELAY` и перенос E2E-расшифровки до funnel'а (план 1D — там это станет дёшево, потому что funnel уже будет изолирован); очистка `ports` от закрытых вкладок (требует отдельного дизайна: у SharedWorker-порта нет надёжного события закрытия, tweb решает это через `listenMessagePort` + пинги — план 1C, вместе с воркерным инстансом rootScope).
- Риск задачи 1 — «рефактор, который незаметно поменял поведение»; он закрыт требованием, что существующий набор тестов проходит без единой правки.
