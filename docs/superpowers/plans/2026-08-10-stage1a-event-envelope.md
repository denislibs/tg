# Этап 1A: порт rootScope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить наши самодельные шины (`eventBus` + `uiEvents`) дословным портом шины tweb: `EventListenerBase` + `rootScope` — те же имена, тот же API, тот же способ применения. Плюс происхождение кадра (`catchUp`) как второй аргумент события — штатная возможность `EventListenerBase`, а не наша надстройка.

**Architecture:** `rootScope` — единственная шина главного потока. Событие, пришедшее из воркера, ре-эмитится строго локально (`dispatchEventSingle`), иначе получится кольцо; событие, порождённое вкладкой, уходит через `dispatchEvent` и ретранслируется воркером во все **остальные** вкладки — ровно инвариант tweb. Метаданные кадра (`pts`, `catchUp`) заполняет только funnel воркера и передаёт вторым аргументом события.

**Tech Stack:** TS strict, vitest + happy-dom, SharedWorker + SuperMessagePort, Zustand.

## Global Constraints

- **Имена и API — 1:1 tweb, не изобретать своих.** `EventListenerBase` (`addEventListener` / `addMultipleEventsListeners` / `removeEventListener` / `dispatchEvent` / `dispatchResultableEvent` / `cleanup` / флаг `reuseResults`), `rootScope`, `dispatchEventSingle`, `BroadcastEvents` / `BroadcastEventsListeners`. Никаких `subscribe`/`publish`/`publishEverywhere`/`subscribeSticky`.
- **Способ применения — 1:1 tweb.** Подписка: `rootScope.addEventListener('rt:new_message', (payload, meta) => …)`; массовая подписка: `rootScope.addMultipleEventsListeners({…})`; локальный ре-эмит принятого из воркера: `rootScope.dispatchEventSingle(...)`; порождение своего события: `rootScope.dispatchEvent(...)`.
- `src/helpers/eventListenerBase.ts` — **вендор tweb 1:1** (как `middleware.ts`): шапка `// @ts-nocheck — вендорено из tweb 1:1 (src/helpers/eventListenerBase.ts)`, тело символ-в-символ из `/Users/denisurevic/Documents/tweb/src/helpers/eventListenerBase.ts:46-188`. Не форкать, не «улучшать» под наш линтер.
- `rootScope.ts` — не вендор (у tweb он завязан на MTProto/аккаунты), но **структура и имена методов** повторяют `/Users/denisurevic/Documents/tweb/src/lib/rootScope.ts:252-315`.
- **Один писатель meta.** `meta` (второй аргумент события) заполняет только funnel воркера. Ни менеджер, ни подписчик её не сочиняют.
- **Вне объёма (следующие планы Этапа 1):** воркерный инстанс rootScope вместо функции `broadcast` (1C, приедет вместе с операциями над зеркалами); миграция сторов на replay операций; ликвидация дублей фактов; E2E-расшифровка до funnel'а и снос `PTS_SYNC_DELAY` (1D).
- Асинхронщина — по конвенции `web-client/CLAUDE.md` («Асинхронщина и актуальность (middleware)»).
- Комментарии по-русски, в стиле окружающего кода.
- Команды из `web-client/`: `npm test`, `npm run typecheck`, `npx oxlint <файлы>`, `npm run build`.
  `npm run lint` выходит с кодом 1 и на main (вендореный `src/helpers/middleware.ts`) — ворота: не добавлять НОВЫХ находок в изменённых файлах (вендор-файлы этого правила не нарушают — они дают находки того же класса, что уже есть).
- **Git-гигиена:** только точечный `git add <файлы>` + `git commit`. Запрещены `git reset`, `git rebase`, `git commit --amend`, `git checkout`/`restore`, `git stash`, `git add -A`/`.`, `git commit -a`.
- Коммиты на русском с трейлерами:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UJM3i1Gj8Lfz2REQDrCiLX
  ```

---

### Task 1: Вендор-порт EventListenerBase

**Files:**
- Create: `web-client/src/helpers/eventListenerBase.ts`
- Test: `web-client/src/helpers/eventListenerBase.test.ts`

**Interfaces:**
- Produces: `export default class EventListenerBase<Listeners extends EventListenerListeners>` с методами `addEventListener(name, callback, options?)`, `addMultipleEventsListeners(obj)`, `removeEventListener(name, callback, options?)`, `dispatchEvent(name, ...args)`, `dispatchResultableEvent(name, ...args)`, `cleanup()`; конструктор принимает `reuseResults?: boolean`; `export type EventListenerListeners = Record<string, Function>`.

- [ ] **Step 1: Написать падающие тесты** (пины ключевых гарантий, на которые обопрётся rootScope):

```ts
// web-client/src/helpers/eventListenerBase.test.ts
// Пины семантики вендореного из tweb EventListenerBase (файл не менять).
import { describe, expect, it, vi } from 'vitest'
import EventListenerBase from './eventListenerBase'

type L = { evt: (a: number, b?: string) => void }

describe('EventListenerBase: пины семантики tweb', () => {
  it('доставляет все аргументы события подписчику', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb)
    b.dispatchEvent('evt', 1, 'x')
    expect(cb).toHaveBeenCalledWith(1, 'x')
  })

  it('reuseResults: подписчик, пришедший ПОСЛЕ события, получает его немедленно', () => {
    const b = new EventListenerBase<L>(true)
    b.dispatchEvent('evt', 7)
    const late = vi.fn()
    b.addEventListener('evt', late)
    expect(late).toHaveBeenCalledWith(7)
  })

  it('без reuseResults поздний подписчик ничего не получает', () => {
    const b = new EventListenerBase<L>()
    b.dispatchEvent('evt', 7)
    const late = vi.fn()
    b.addEventListener('evt', late)
    expect(late).not.toHaveBeenCalled()
  })

  it('once снимает подписку после первой доставки', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb, { once: true })
    b.dispatchEvent('evt', 1)
    b.dispatchEvent('evt', 2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('исключение в одном подписчике не мешает остальным', () => {
    const b = new EventListenerBase<L>()
    const ok = vi.fn()
    b.addEventListener('evt', () => { throw new Error('boom') })
    b.addEventListener('evt', ok)
    b.dispatchEvent('evt', 1)
    expect(ok).toHaveBeenCalled()
  })

  it('removeEventListener снимает конкретный колбэк', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addEventListener('evt', cb)
    b.removeEventListener('evt', cb)
    b.dispatchEvent('evt', 1)
    expect(cb).not.toHaveBeenCalled()
  })

  it('addMultipleEventsListeners подписывает пачкой', () => {
    const b = new EventListenerBase<L>()
    const cb = vi.fn()
    b.addMultipleEventsListeners({ evt: cb })
    b.dispatchEvent('evt', 3)
    expect(cb).toHaveBeenCalledWith(3)
  })
})
```

- [ ] **Step 2: FAIL** — `npx vitest run src/helpers/eventListenerBase.test.ts` («Cannot find module»).

- [ ] **Step 3: Портировать дословно** из `/Users/denisurevic/Documents/tweb/src/helpers/eventListenerBase.ts` строки 46-188 (то есть без закомментированной шапки 1-45), добавив первой строкой:
  ```ts
  // @ts-nocheck — вендорено из tweb 1:1 (src/helpers/eventListenerBase.ts)
  ```
  Зависимые типы (`ArgumentTypes`, `SuperReturnType`) — проверить, есть ли они в дереве (`src/types` / глобальные d.ts); если нет — объявить их рядом **тем же кодом, что в tweb**, не переписывая.

- [ ] **Step 4: PASS + `npm run typecheck` + `npx oxlint src/helpers/eventListenerBase.test.ts`.**

- [ ] **Step 5: Commit** — `feat(rootscope): вендор-порт EventListenerBase из tweb 1:1`

---

### Task 2: rootScope — каталог событий и класс

**Files:**
- Create: `web-client/src/lib/rootScope.ts`
- Test: `web-client/src/lib/rootScope.test.ts`

**Interfaces:**
- Consumes: `EventListenerBase` (Task 1); `RT` из `../core/realtime/events`; типы `*Evt` оттуда же.
- Produces:
  ```ts
  export type BroadcastEvents = { /* событие → кортеж аргументов слушателя */ }
  export type BroadcastEventsListeners = { [K in keyof BroadcastEvents]: (...args: BroadcastEvents[K]) => void }
  export class RootScope extends EventListenerBase<BroadcastEventsListeners> {
    dispatchEventSingle<T extends keyof BroadcastEventsListeners>(name: T, ...args: Parameters<BroadcastEventsListeners[T]>): void
  }
  const rootScope: RootScope
  export default rootScope
  ```

**Заметка по форме каталога.** У tweb `BroadcastEvents` — «событие → один payload» (`rootScope.ts:29-246`), а слушатель выводится как `(e: payload) => void` (`:248-250`). Нам нужен второй аргумент (`meta`), и `EventListenerBase` это поддерживает штатно (`dispatchEvent(name, ...args)`), поэтому каталог объявляем как **кортеж аргументов**: `[payload]` для обычных событий и `[payload, EventMeta?]` для тех, что проходят через funnel. Это не отход от tweb — это тот же механизм в его полной форме.

- [ ] **Step 1: Написать падающие тесты**

```ts
// web-client/src/lib/rootScope.test.ts
import { describe, expect, it, vi } from 'vitest'
import rootScope from './rootScope'

describe('rootScope', () => {
  it('dispatchEventSingle доставляет локально и НЕ уходит в воркер', () => {
    const sent: unknown[] = []
    rootScope.setPort({ emit: (e: string, p: unknown, m?: unknown) => sent.push([e, p, m]) })
    const cb = vi.fn()
    rootScope.addEventListener('rt:test_local', cb)
    rootScope.dispatchEventSingle('rt:test_local', { a: 1 })
    expect(cb).toHaveBeenCalledWith({ a: 1 })
    expect(sent).toEqual([])
    rootScope.removeEventListener('rt:test_local', cb)
  })

  it('dispatchEvent доставляет локально И отправляет в воркер (ретрансляция другим вкладкам)', () => {
    const sent: unknown[][] = []
    rootScope.setPort({ emit: (e: string, p: unknown, m?: unknown) => sent.push([e, p, m]) })
    const cb = vi.fn()
    rootScope.addEventListener('rt:test_prop', cb)
    rootScope.dispatchEvent('rt:test_prop', { a: 2 })
    expect(cb).toHaveBeenCalledWith({ a: 2 })
    expect(sent).toEqual([['rt:test_prop', { a: 2 }, undefined]])
    rootScope.removeEventListener('rt:test_prop', cb)
  })

  it('второй аргумент (meta) доезжает до подписчика', () => {
    const cb = vi.fn()
    rootScope.addEventListener('rt:test_meta', cb)
    rootScope.dispatchEventSingle('rt:test_meta', { a: 3 }, { pts: 9, catchUp: true })
    expect(cb).toHaveBeenCalledWith({ a: 3 }, { pts: 9, catchUp: true })
    rootScope.removeEventListener('rt:test_meta', cb)
  })
})
```

- [ ] **Step 2: FAIL** — `npx vitest run src/lib/rootScope.test.ts`.

- [ ] **Step 3: Реализация.** Каталог `BroadcastEvents` собрать переносом **всего содержимого** `RtEventMap` из `src/core/realtime/eventBus.ts` (каждый ключ → кортеж), дополнив его:
  - событиями, которых в карте не было: `RT.pendingNew`/`pendingMedia`/`pendingFail`/`pendingRetry`/`pendingRemove`, `RT.folderUpdate`, `RT.userUpdate`;
  - служебными: `'rt:resync': [null]`, `'media:upload_progress': [{ id: string; loaded: number; total: number }]`, `'state:mirror': [{ key: string; value: unknown }]`;
  - UI-командами из удаляемого `uiEvents` (Task 5): `'ui:toast': [string]`, `'ui:savedTagsChanged': [void]`;
  - для событий, идущих через funnel (все `logged` + `new_message`), второй элемент кортежа — `EventMeta?`.

  Класс — по структуре `TWEB/src/lib/rootScope.ts:252-315`:
  ```ts
  export interface EventMeta { pts?: number; catchUp?: boolean }

  /** Порт в воркер. Отдельным сеттером, а не импортом bootstrap: rootScope не
   *  должен тянуть за собой поднятие SharedWorker (его импортируют и тесты). */
  interface RootScopePort { emit(event: string, payload: unknown, meta?: EventMeta): void }

  export class RootScope extends EventListenerBase<BroadcastEventsListeners> {
    private port: RootScopePort | null = null

    constructor() {
      super()
      // Порождённое вкладкой событие уходит и локальным подписчикам, и в воркер —
      // тот ретранслирует его ОСТАЛЬНЫМ вкладкам (tweb rootScope.ts:280-290).
      // Принятое из воркера ре-эмитится через dispatchEventSingle, иначе кольцо.
      this.dispatchEvent = (name, ...args) => {
        super.dispatchEvent(name, ...args)
        this.port?.emit(name as string, args[0], args[1] as EventMeta | undefined)
      }
    }

    public setPort(port: RootScopePort | null) { this.port = port }

    public dispatchEventSingle<T extends keyof BroadcastEventsListeners>(
      name: T,
      ...args: Parameters<BroadcastEventsListeners[T]>
    ) {
      super.dispatchEvent(name, ...args)
    }
  }

  const rootScope = new RootScope()
  export default rootScope
  ```

- [ ] **Step 4: PASS + typecheck + oxlint по новым файлам.**

- [ ] **Step 5: Commit** — `feat(rootscope): rootScope с каталогом BroadcastEvents (структура tweb)`

---

### Task 3: Ретрансляция события воркером остальным вкладкам

Порт `TWEB/src/lib/mainWorker/index.worker.ts:116-119` (`port.invokeExceptSource('event', payload, source)`).

**Files:**
- Modify: `web-client/src/rpc/superMessagePort.ts` (передача `meta` в кадре события + признак источника)
- Modify: `web-client/src/core/worker.ts` (обработчик входящего события от вкладки)
- Test: `web-client/src/rpc/superMessagePort.test.ts` (создать)

**Interfaces:**
- Produces: `SuperMessagePort.emit(event: string, payload: unknown, meta?: EventMeta)`; `on<T>(event, cb: (payload: T, meta?: EventMeta) => void)`; в воркере — рассылка принятого события всем портам, **кроме** порта-источника.

- [ ] **Step 1: Тесты SMP** — как в предыдущей редакции плана: `meta` доезжает вторым аргументом; без `meta` подписчик получает `undefined`; подписчик-одноаргументник продолжает работать (обратная совместимость). Харнес — пара эндпоинтов поверх колбэков (в happy-dom `MessageChannel` не гарантирован).

- [ ] **Step 2: FAIL**, затем реализация в `superMessagePort.ts`:
  - `export interface EventMeta` **не дублировать** — импортировать из `../lib/rootScope`? Нет: нижний слой не должен зависеть от верхнего. Объявить `EventMeta` в `superMessagePort.ts` и **реэкспортировать** из `rootScope.ts` (`export type { EventMeta } from '../rpc/superMessagePort'`), чтобы тип был один.
  - `Task` вариант события: `| { kind: 'event'; event: string; payload: unknown; meta?: EventMeta }`;
  - `listeners`, `on`, `emit`, ветка `event` в `onMessage` — прокидывают `meta`.

- [ ] **Step 3: Воркер — ретрансляция.** В `bind(ep)` после `registerManagers(...)` подписать порт на входящие события вкладки и разослать остальным:
  ```ts
  // Событие, порождённое вкладкой (rootScope.dispatchEvent), ретранслируем всем
  // ОСТАЛЬНЫМ вкладкам — порт tweb index.worker.ts:116-119 (invokeExceptSource).
  // Источнику не шлём: у него оно уже доставлено локально, иначе кольцо.
  smp.onAny((event, payload, meta) => {
    for (const p of ports) if (p !== smp) p.emit(event, payload, meta)
  })
  ```
  Для этого добавить в `SuperMessagePort` метод `onAny(cb: (event: string, payload: unknown, meta?: EventMeta) => void)` — подписка на любое событие (у tweb роль играет типизированный листенер `event`; у нас имена событий плоские, поэтому нужен catch-all). Реализация: массив `anyListeners`, вызывается в ветке `event` после адресных слушателей.

- [ ] **Step 4: Тест ретрансляции** — дописать в `superMessagePort.test.ts`: три порта (A, B — «вкладки», W — «воркер»); событие, пришедшее в W от A, доезжает до B и **не** возвращается в A.

- [ ] **Step 5: PASS + `npm test` + typecheck + oxlint по изменённым файлам.**

- [ ] **Step 6: Commit** — `feat(rootscope): воркер ретранслирует событие вкладки остальным вкладкам`

---

### Task 4: Насос воркер → rootScope

**Files:**
- Modify: `web-client/src/client/realtimeBridge.ts`

- [ ] **Step 1:** Заменить публикацию в `eventBus` на локальный ре-эмит и подключить порт:
  ```ts
  // Единственный потребитель smp: ре-эмитит события воркера в rootScope СТРОГО
  // локально (tweb apiManagerProxy.ts:347-352 — dispatchEventSingle), иначе
  // событие ушло бы обратно в воркер и закольцевалось.
  for (const ev of WORKER_EVENTS) smp.on(ev, (p, m) => rootScope.dispatchEventSingle(ev as never, p as never, m as never))
  // Порт для событий, порождённых этой вкладкой (rootScope.dispatchEvent).
  rootScope.setPort(smp)
  ```

- [ ] **Step 2: Проверка** — `npm test`, `npm run typecheck`.

- [ ] **Step 3: Commit** — `feat(rootscope): насос воркер→rootScope через dispatchEventSingle`

---

### Task 5: Миграция потребителей, снос eventBus и uiEvents

**Files:**
- Modify: все потребители (`grep -rn "eventBus\|uiEvents" src/`) — проектор, soundSubscriber, notificationSubscriber, callSubscriber, refetchSubscriber, `useChatScroll`, компоненты с тостами
- Delete: `web-client/src/core/realtime/eventBus.ts`, `web-client/src/core/hooks/uiEvents.ts` (и их тесты, если есть)

- [ ] **Step 1: Механическая замена** по всем файлам:
  - `eventBus.subscribe(X, cb)` → `rootScope.addEventListener(X, cb)`;
  - `eventBus.publish(X, p)` → `rootScope.dispatchEventSingle(X, p)` (внутри вкладки; в воркер ничего слать не надо);
  - `uiEvents.on(X, cb)` → `rootScope.addEventListener(X, cb)`;
  - `uiEvents.emit(X, p)` → `rootScope.dispatchEvent(X, p)` (тост — событие вкладки; ретрансляция другим вкладкам безвредна и соответствует модели tweb).
  - **Внимание к отписке:** `eventBus.subscribe` возвращал функцию отписки, `addEventListener` — нет (как в tweb). Везде, где возврат использовался в `useEffect`-cleanup, ставить `return () => rootScope.removeEventListener(X, cb)` с именованным колбэком.

- [ ] **Step 2: Проверка** — `grep -rn "eventBus\|uiEvents" src/` пуст; `npm test`; `npm run typecheck`; `npm run build`.

- [ ] **Step 3: Commit** — `refactor(rootscope): потребители переведены на rootScope, eventBus и uiEvents удалены`

---

### Task 6: Funnel воркера заполняет meta

**Files:**
- Modify: `web-client/src/core/worker.ts` (`broadcast`, `dispatch`, `routeNewMessage`, `applyUpdate`, `drainPending`)
- Modify: `web-client/src/core/realtime/channelFunnel.ts`
- Test: `web-client/src/core/realtime/channelFunnel.test.ts` (дописать)

- [ ] **Step 1: Правки воркера** (искать по содержимому, не по номерам строк):
  - `const broadcast = (event: string, payload: unknown, meta?: EventMeta) => { for (const p of ports) p.emit(event, payload, meta) }`;
  - `dispatch(t, d, meta?)` → `routeNewMessage(d as NewMessageEvt, meta)` / `broadcast(h.rt, d, meta)`;
  - `applyUpdate`: live-ветка → `dispatch(t, d, { pts, catchUp: false })`; `/sync`-ветка → `dispatch(t, d, { pts, catchUp: true })`; ветка без `pts` → `dispatch(t, d)` (происхождение не определено);
  - `drainPending` → `dispatch(item.t, item.d, { pts: item.pts, catchUp: false })` (кадр был живым, лишь придержан).

- [ ] **Step 2: `channelFunnel.ts`** — `ChannelFunnelDeps.dispatch: (t: string, d: unknown, meta?: EventMeta) => void`; `applyLive` (включая ветку первого несидированного кадра и `drainPending`) → `catchUp: false`; `catchUp()` → `catchUp: true`.

- [ ] **Step 3: Тест**

```ts
it('живой кадр помечается catchUp:false, кадр из difference — catchUp:true', async () => {
  const seen: Array<{ t: string; catchUp?: boolean }> = []
  const funnel = newChannelFunnel({
    dispatch: (t, _d, meta) => { seen.push({ t, catchUp: meta?.catchUp }) },
    getDifference: async () => ({ updates: [{ t: 'new_message', pts: 2, d: {} }], pts: 2, slice: false }),
    loadPts: async () => 1,
    savePts: () => {},
  })
  funnel.applyLive(1, 'new_message', 5, {})
  expect(seen).toEqual([{ t: 'new_message', catchUp: false }])
  seen.length = 0
  await funnel.open(2)
  expect(seen.some((x) => x.catchUp === true)).toBe(true)
})
```

- [ ] **Step 4: Прогон + typecheck + oxlint. Commit** — `feat(worker): funnel помечает происхождение кадра (catchUp) в meta`

---

### Task 7: Звук и нотификации читают meta

Дедуп при catch-up сейчас держится **целиком** на побочном эффекте дедупа funnel'а по pts (история: `6edebfd`, `07c8967`). Делаем зависимость явной.

**Files:**
- Modify: `web-client/src/client/realtime/soundSubscriber.ts`, `web-client/src/client/realtime/notificationSubscriber.ts`
- Test: `web-client/src/client/realtime/soundSubscriber.test.ts` (создать/дописать)

- [ ] **Step 1: Падающий тест** — два события `RT.newMessage`: живое (`meta.catchUp === false`) и из catch-up (`true`). Живое даёт звук, catch-up — нет. До фикса тест красный (подписчик meta не смотрит). Моки звука — по образцу соседних тестов подписчиков.

- [ ] **Step 2: FAIL** — приложить вывод.

- [ ] **Step 3: Реализация** — первой строкой обработчика в обоих подписчиках:
  ```ts
  // Кадр из catch-up (reconnect/backfill) — уже «прошлое»: звук и нотификация не
  // играют. Раньше это держалось только на дедупе funnel'а по pts.
  if (meta?.catchUp) return
  ```

- [ ] **Step 4: PASS + `npm test` + typecheck + oxlint. Commit** — `fix(realtime): звук и нотификации молчат на catch-up-кадрах (meta)`

---

### Task 8: Проектор без ручных кастов

`BroadcastEventsListeners` даёт точные типы аргументов, поэтому `raw as XxxEvt` в реестре становятся не нужны.

**Files:**
- Modify: `web-client/src/client/realtime/storeProjection.ts`

- [ ] **Step 1: Типизировать реестр:**
  ```ts
  // Реестр «1:1» — типы аргументов приходят из BroadcastEventsListeners,
  // ручные касты не нужны; пропущенное/переименованное событие ловит компилятор.
  type Projector = { [K in keyof BroadcastEventsListeners]?: BroadcastEventsListeners[K] }
  const APPLY: Projector = { … }
  ```
  и убрать `as XxxEvt` в теле обработчиков реестра. Обработчики с побочными эффектами (ниже по файлу) в этой задаче не трогать — их касты снимаются при следующем касании.

- [ ] **Step 2: Подписка пачкой** — вместо ручного цикла использовать штатный метод tweb:
  ```ts
  rootScope.addMultipleEventsListeners(APPLY)
  ```

- [ ] **Step 3: Проверка** — `npm test`, `npm run typecheck` (главное: ни один обработчик не потерял поля), oxlint. **Commit** — `refactor(realtime): проектор типизирован от BroadcastEventsListeners`

---

### Task 9: Документация инварианта

**Files:**
- Modify: `web-client/CLAUDE.md` (блок «Архитектура клиента (инварианты — НЕ нарушать)»)

- [ ] **Step 1:** Заменить упоминания `eventBus`/`uiEvents` на `rootScope`; в «НЕЛЬЗЯ» добавить:
  ```md
  - Ре-эмитить принятое из воркера событие через `dispatchEvent` — только
    `dispatchEventSingle` (иначе событие уйдёт обратно в воркер и закольцуется;
    инвариант tweb: `apiManagerProxy` ре-эмитит принятое строго локально).
  - Сочинять `meta` события вне funnel'а воркера. Происхождение кадра
    (`pts`, `catchUp`) знает только он; подписчику, которому важно отличать живой
    кадр от catch-up (звук, нотификации), читать `meta.catchUp`, а не полагаться
    на побочный эффект дедупа по pts.
  ```

- [ ] **Step 2: Commit** — `docs(claude): инварианты rootScope (dispatchEventSingle, meta от funnel)`

---

## Self-Review

- Имена и способ применения совпадают с tweb: `EventListenerBase` (вендор 1:1), `rootScope`, `addEventListener` / `addMultipleEventsListeners` / `removeEventListener` / `dispatchEvent` / `dispatchEventSingle`, `BroadcastEvents` / `BroadcastEventsListeners`. Изобретённых имён нет.
- Инвариант «принятое из воркера — только `dispatchEventSingle`» закреплён и кодом (Task 4), и документом (Task 9).
- `EventMeta` объявлен один раз в нижнем слое (`superMessagePort.ts`) и реэкспортируется из `rootScope.ts` — обратной зависимости нет.
- Порядок задач по зависимостям: T2←T1, T3←T2, T4←T3, T5←T4, T6←T3, T7←T6, T8←T5.
- Сознательно вне объёма: воркерный инстанс rootScope вместо `broadcast` (1C), sticky-события (`reuseResults` есть в вендоре, но ни одно наше событие пока не объявлено sticky — включать по мере надобности), миграция сторов на операции, снос `PTS_SYNC_DELAY` (1D).
