# Владение диалогами в воркере — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести владение списком диалогов из `chatsStore` (main-thread) в новый воркерный `dialogsManager`, сделав стор зеркалом — по паттерну `rt:peer_op`.

**Architecture:** Воркерный `dialogsManager` держит кэш диалогов с посчитанным `index`, применяет realtime-кадры и действия, публикует `rt:dialog_op`. `chatsStore.dialogs` пишет только `storeProjection`. Порядок больше не считается на main. Действия применяются после ответа сервера (как в tweb), оптимистика удаляется.

**Tech Stack:** TypeScript strict, Zustand 5, SharedWorker + SuperMessagePort (RPC), vitest, oxlint.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md`.
- Отвечать и комментировать код по-русски; референс — tweb (`~/Documents/tweb`), отступления помечать комментарием ПРЯМО У КОДА.
- Норма тестов (`web-client/CLAUDE.md`): каждая строка проводки обязана либо иметь тест, чья мутация краснеет, либо явную пометку с причиной. Мутацию проверять реально и приводить вывод vitest.
- Оптимистики в действиях быть не должно: `RPC → успех → владелец применяет и публикует` (tweb `appMessagesManager.ts:5687-5699`, `appNotificationsManager.ts:121-126`).
- Команды: `npm test`, `npm run typecheck`, `npm run lint` из `web-client/`.
- Этап 1 не меняет вёрстку и стили. Виртуализация — этап 3, отдельный план.

## Файловая структура

| Файл | Ответственность |
|---|---|
| `src/core/dialogs/dialogOps.ts` (создать) | тип `DialogOp`/`DialogItem` — контракт канала |
| `src/core/managers/dialogsManager.ts` (создать) | владелец: кэш, индекс, применение кадров и действий, публикация операций |
| `src/core/dialogs/dialogIndex.ts` (есть) | чистая функция индекса — переиспользуется воркером как есть |
| `src/core/realtime/events.ts` (правка) | `RT.dialogOp` |
| `src/lib/rootScope.ts` (правка) | тип payload `rt:dialog_op` |
| `src/core/workerCore.ts` (правка) | создание менеджера, проводка `onDialogOps`, реестр, прокидывание ключей State |
| `src/core/managers/persistManager.ts` (правка) | колбэк `onStateKey` — владелец узнаёт про `pinnedOrders`/`drafts` |
| `src/stores/chatsStore.ts` (правка) | `applyDialogOps` вместо мутаторов; `applyDialogs`/`dialogIndex` уходят |
| `src/client/realtime/storeProjection.ts` (правка) | `APPLY[RT.dialogOp]` — единственный писатель зеркала |
| `src/client/boot.ts` (правка) | `dialogs.fillMirror()` вместо `chats.listDialogs()` + гидрации |
| `src/stores/dialogsPersist.ts` (удалить) | персист переезжает в воркер |
| `src/components/ChatListItem.tsx`, `Chat.tsx`, `core/hooks/useMuteToggle.ts`, `useAppHotkeys.ts`, `useGroupEdit.ts`, `components/ChatThemesPicker.tsx` (правки) | вызовы RPC вместо прямых мутаций стора |

---

### Task 1: Тип операций, владелец и канал

**Files:**
- Create: `web-client/src/core/dialogs/dialogOps.ts`
- Create: `web-client/src/core/managers/dialogsManager.ts`
- Create: `web-client/src/core/managers/dialogsManager.test.ts`
- Modify: `web-client/src/core/realtime/events.ts`, `web-client/src/lib/rootScope.ts`, `web-client/src/core/workerCore.ts`, `web-client/src/core/managers/persistManager.ts`
- Test: `web-client/src/core/workerCore.dialogs.test.ts`

**Interfaces:**
- Consumes: `dialogIndex(dialog, pinnedOrder, draft?)` из `core/dialogs/dialogIndex.ts`; `loadStateAll()`, `loadDialogs()` из `core/store/persist.ts`; `RestClient`.
- Produces:
  ```ts
  export type DialogItem = { dialog: Dialog; index: number }
  export type DialogOp =
    | { op: 'reset';   items: DialogItem[] }
    | { op: 'upsert';  items: DialogItem[] }
    | { op: 'patch';   chatId: number; fields: Partial<Dialog>; index?: number }
    | { op: 'reindex'; items: { chatId: number; index: number }[] }
    | { op: 'remove';  chatId: number }

  newDialogsManager(deps): {
    fillMirror(): Promise<DialogOp>            // всегда reset, даже при попадании в кэш
    refresh(): Promise<void>                   // сетевой догон, публикует reset
    getSnapshot(): DialogItem[]
    setStateKey(key: string, value: unknown): void
  }
  ```

- [ ] **Step 1: Написать падающий тест на порядок и снимок владельца**

`web-client/src/core/managers/dialogsManager.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import type { Dialog } from '../models'

const dialog = (chatId: number, at: string, pinned = false): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

const restStub = (chats: unknown[]) => ({ get: vi.fn(async () => ({ chats })) })

describe('dialogsManager: владелец порядка', () => {
  it('fillMirror отдаёт reset, отсортированный по индексу (свежие выше)', async () => {
    const ops: unknown[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()

    expect(op.op).toBe('reset')
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([2, 1])
    // Пробел зеркала объявлен → владелец обязан ответить и веером тоже.
    expect(ops).toHaveLength(1)
  })

  it('закреплённый всегда выше незакреплённого, как бы стар он ни был', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2020-01-01T00:00:00Z', true), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd web-client && npx vitest run src/core/managers/dialogsManager.test.ts`
Expected: FAIL — `Failed to resolve import "./dialogsManager"`.

- [ ] **Step 3: Создать тип операций**

`web-client/src/core/dialogs/dialogOps.ts`:

```ts
// Контракт канала rt:dialog_op — порт модели tweb, где витрина получает СОБЫТИЕ СО
// ЗНАЧЕНИЕМ (`dialogs_multiupdate: Map<PeerId, {dialog}>`, rootScope.ts:74), а не
// «пойди перечитай». Индекс едет внутри значения — как `{id, index, value}` у
// SortedDialogList (sortedDialogList.ts:132-139): зеркало сортирует по готовому
// индексу и своего порядка не выводит.
import type { Dialog } from '../models'

export type DialogItem = { dialog: Dialog; index: number }

export type DialogOp =
  /** первичная загрузка, ответ на объявленный пробел, resync */
  | { op: 'reset'; items: DialogItem[] }
  /** новый или заменённый диалог */
  | { op: 'upsert'; items: DialogItem[] }
  /** точечное изменение полей; index — если оно сдвинуло диалог */
  | { op: 'patch'; chatId: number; fields: Partial<Dialog>; index?: number }
  /** сменился pinnedOrders/черновик — значения те же, порядок другой */
  | { op: 'reindex'; items: { chatId: number; index: number }[] }
  | { op: 'remove'; chatId: number }
```

- [ ] **Step 4: Создать владельца**

`web-client/src/core/managers/dialogsManager.ts`:

```ts
// Владелец списка диалогов (порт модели tweb: dialogsStorage живёт в воркере
// вместе с generateDialogIndex, черновиками и порядком закреплённых).
// Витрина (`stores/chatsStore.ts`) — зеркало, её единственный писатель — проектор.
//
// Отступление от tweb: у них представление — сам DOM, которым владеет
// SortedDialogList, массива диалогов на main нет; у нас представление — React,
// читающий из стора, поэтому зеркало массивом. См. спеку
// docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md.
import type { RestClient } from '../net/restClient'
import { HttpError } from '../net/restClient'
import { mapDialog, type Dialog, type Draft, type RawDialog } from '../models'
import { dialogIndex } from '../dialogs/dialogIndex'
import type { DialogItem, DialogOp } from '../dialogs/dialogOps'

/** Наше закрепление пер-юзерное и на весь список сразу — запись одна (см. chatsStore). */
const ALL_FOLDER_ID = 0

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /** ключи State, от которых зависит порядок (persist.loadStateAll) */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; drafts: Draft[] }>
}

export function newDialogsManager({ rest, onDialogOps, loadCache, loadState }: DialogsDeps) {
  let items: DialogItem[] = []
  let pinnedOrder: number[] = []
  let drafts: Draft[] = []
  let hydrated = false

  const publish = (ops: DialogOp[]) => onDialogOps?.(ops)
  const draftFor = (chatId: number) => drafts.find((d) => d.chatId === chatId)

  /** Порядок — производная от данных (tweb generateDialogIndex, dialogs.ts:605-608). */
  const sort = (dialogs: Dialog[]): DialogItem[] =>
    dialogs
      .map((dialog) => ({ dialog, index: dialogIndex(dialog, pinnedOrder, draftFor(dialog.chatId)) }))
      .sort((a, b) => b.index - a.index)

  const setAll = (dialogs: Dialog[]): DialogOp => {
    items = sort(dialogs)
    return { op: 'reset', items }
  }

  async function hydrate(): Promise<void> {
    if (hydrated) return
    hydrated = true
    const state = await loadState()
    pinnedOrder = state.pinnedOrders[ALL_FOLDER_ID] ?? []
    drafts = state.drafts
    if (!items.length) setAll(await loadCache())
  }

  return {
    /**
     * Зеркало объявило пробел. Отвечаем ВСЕГДА — и ответом RPC (его ждёт boot.ts
     * до первого рендера), и веером (соседние вкладки). «Уже публиковали» не
     * считается доставкой: SuperMessagePort кадры не буферизует.
     */
    async fillMirror(): Promise<DialogOp> {
      await hydrate()
      const op: DialogOp = { op: 'reset', items }
      publish([op])
      return op
    },

    /** Сетевой догон. Офлайн — молча остаёмся на кэше (как прежний listDialogs). */
    async refresh(): Promise<void> {
      await hydrate()
      try {
        const r = await rest.get<{ chats?: RawDialog[] }>('/chats')
        publish([setAll((r.chats ?? []).map(mapDialog))])
      } catch (e) {
        if (e instanceof HttpError) throw e
      }
    },

    getSnapshot: (): DialogItem[] => items,

    /**
     * Ключ State, от которого зависит порядок, изменился (пишет persistManager).
     * Значения диалогов те же — публикуем reindex, а не reset.
     */
    setStateKey(key: string, value: unknown): void {
      if (key === 'pinnedOrders') pinnedOrder = (value as Record<number, number[]>)[ALL_FOLDER_ID] ?? []
      else if (key === 'drafts') drafts = value as Draft[]
      else return
      items = sort(items.map((i) => i.dialog))
      publish([{ op: 'reindex', items: items.map((i) => ({ chatId: i.dialog.chatId, index: i.index })) }])
    },
  }
}
```

- [ ] **Step 5: Запустить тест — должен пройти**

Run: `cd web-client && npx vitest run src/core/managers/dialogsManager.test.ts`
Expected: PASS (2 теста).

- [ ] **Step 6: Завести канал события**

В `web-client/src/core/realtime/events.ts` рядом с `peerOp: 'rt:peer_op'`:

```ts
  // Stage «владение диалогами» (этап 1): список диалогов — владелец воркерный
  // dialogsManager, витрина только зеркалит. Событие несёт ЗНАЧЕНИЕ с индексом
  // (порт tweb dialogs_multiupdate), а не «перечитай».
  dialogOp: 'rt:dialog_op',
```

В `web-client/src/lib/rootScope.ts` рядом с типом `rt:peer_op`:

```ts
  'rt:dialog_op': { ops: DialogOp[] },
```

(импорт `import type { DialogOp } from '../core/dialogs/dialogOps'`).

- [ ] **Step 7: Написать падающий тест на проводку в workerCore**

`web-client/src/core/workerCore.dialogs.test.ts` — по образцу `workerCore.connectionStatus.test.ts`: поднять `createWorkerCore()` с фейковым эндпоинтом, дёрнуть `dialogs.fillMirror()` через RPC и проверить, что подключённая вкладка получила кадр `rt:dialog_op`.

```ts
it('fillMirror доезжает до вкладки кадром rt:dialog_op', async () => {
  const { frames, invoke } = await bootWorkerWithFakeTab() // helper как в workerCore.test.ts
  await invoke('dialogs', 'fillMirror', [])
  expect(frames.map((f) => f.event)).toContain('rt:dialog_op')
})
```

- [ ] **Step 8: Запустить — падает**

Run: `cd web-client && npx vitest run src/core/workerCore.dialogs.test.ts`
Expected: FAIL — менеджера `dialogs` нет в реестре.

- [ ] **Step 9: Подключить владельца в workerCore**

Рядом с `const peers = newPeersManager({ rest, onPeerOps: (ops) => broadcast(RT.peerOp, { ops }) })` (`workerCore.ts:150`):

```ts
  const dialogs = newDialogsManager({
    rest,
    onDialogOps: (ops) => broadcast(RT.dialogOp, { ops }),
    loadCache: () => loadDialogs(),
    loadState: async () => {
      const st = await loadStateAll()
      return { pinnedOrders: st.pinnedOrders ?? {}, drafts: st.drafts ?? [] }
    },
  })
```

Добавить `dialogs` в `registry` (`workerCore.ts:404`).

`persistManager` получает третий канал — владелец обязан узнать про смену ключей, влияющих на порядок:

```ts
export function newPersistManager(
  mirrorStateKey?: (key: string, value: unknown) => void,
  onStateKey?: (key: string, value: unknown) => void,
) {
  ...
    stateKey: async (key: string, value: unknown): Promise<void> => {
      await saveStateKey(key as keyof AppState, value as AppState[keyof AppState])
      mirrorStateKey?.(key, value)
      // Порядок диалогов зависит от pinnedOrders/drafts — владелец пересчитывает
      // индексы и публикует reindex (сам он в стор не ходит).
      onStateKey?.(key, value)
    },
```

и в `workerCore`: `const persist = newPersistManager(mirrorStateKey, (k, v) => dialogs.setStateKey(k, v))`.

- [ ] **Step 10: Прогнать тесты**

Run: `cd web-client && npx vitest run src/core/workerCore.dialogs.test.ts src/core/managers/dialogsManager.test.ts`
Expected: PASS.

- [ ] **Step 11: Проверить, что мутация краснеет**

Временно заменить `onDialogOps: (ops) => broadcast(RT.dialogOp, { ops })` на `onDialogOps: () => {}` → `workerCore.dialogs.test.ts` обязан упасть. Вернуть обратно, привести вывод в отчёте.

- [ ] **Step 12: Коммит**

```bash
git add web-client/src/core/dialogs/dialogOps.ts web-client/src/core/managers/dialogsManager.ts \
        web-client/src/core/managers/dialogsManager.test.ts web-client/src/core/workerCore.dialogs.test.ts \
        web-client/src/core/realtime/events.ts web-client/src/lib/rootScope.ts \
        web-client/src/core/workerCore.ts web-client/src/core/managers/persistManager.ts
git commit -m "feat(dialogs): воркерный владелец списка диалогов + канал rt:dialog_op"
```

---

### Task 2: Зеркало на main и холодный старт

**Files:**
- Modify: `web-client/src/stores/chatsStore.ts`, `web-client/src/client/realtime/storeProjection.ts`, `web-client/src/client/boot.ts`
- Test: `web-client/src/client/realtime/storeProjection.dialogs.test.ts`, `web-client/src/stores/chatsStore.test.ts`

**Interfaces:**
- Consumes: `DialogOp` (Task 1), `managers.dialogs.fillMirror()`.
- Produces: `useChatsStore.getState().applyDialogOps(ops: DialogOp[]): void` — единственный вход в зеркало.

- [ ] **Step 1: Написать падающий тест зеркала — владелец против стора**

`web-client/src/client/realtime/storeProjection.dialogs.test.ts`. Ключевое (по образцу `storeProjection.peers.test.ts`): сравнивать **ответ владельца** с состоянием зеркала, а не зеркало с самим собой.

```ts
it('состояние зеркала совпадает с ответом владельца', async () => {
  const mgr = newDialogsManager({ /* как в dialogsManager.test.ts, два диалога */ })
  const op = await mgr.fillMirror()

  useChatsStore.getState().applyDialogOps([op])

  expect(useChatsStore.getState().dialogs.map((d) => d.chatId))
    .toEqual(mgr.getSnapshot().map((i) => i.dialog.chatId))
})

it('reindex меняет порядок, не трогая значения', () => {
  const st = useChatsStore.getState()
  st.applyDialogOps([{ op: 'reset', items: [
    { dialog: dialog(1), index: 10 }, { dialog: dialog(2), index: 20 },
  ] }])
  st.applyDialogOps([{ op: 'reindex', items: [{ chatId: 1, index: 30 }] }])

  expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1, 2])
})
```

- [ ] **Step 2: Запустить — падает**

Run: `cd web-client && npx vitest run src/client/realtime/storeProjection.dialogs.test.ts`
Expected: FAIL — `applyDialogOps is not a function`.

- [ ] **Step 3: Реализовать зеркало**

В `chatsStore.ts` завести внутреннее хранение индекса и единственный вход:

```ts
// Зеркало владельца: индекс приходит В ЗНАЧЕНИИ операции, здесь он только
// хранится и сортирует. Ни dialogIndex, ни pinnedOrders на main больше нет —
// порядок считает воркерный dialogsManager (пин: stores/noManualOrder.test.ts).
const indexById = new Map<number, number>()

const sorted = (dialogs: Dialog[]): Dialog[] =>
  [...dialogs].sort((a, b) => (indexById.get(b.chatId) ?? 0) - (indexById.get(a.chatId) ?? 0))

  applyDialogOps: (ops) =>
    set((s) => {
      let list = s.dialogs
      for (const op of ops) {
        if (op.op === 'reset') {
          indexById.clear()
          for (const it of op.items) indexById.set(it.dialog.chatId, it.index)
          list = reconcileById(list, op.items.map((i) => i.dialog), (d) => d.chatId).list
        } else if (op.op === 'upsert') {
          for (const it of op.items) indexById.set(it.dialog.chatId, it.index)
          const byId = new Map(op.items.map((i) => [i.dialog.chatId, i.dialog]))
          const merged = list.map((d) => byId.get(d.chatId) ?? d)
          for (const it of op.items) if (!list.some((d) => d.chatId === it.dialog.chatId)) merged.push(it.dialog)
          list = reconcileById(list, merged, (d) => d.chatId).list
        } else if (op.op === 'patch') {
          if (op.index !== undefined) indexById.set(op.chatId, op.index)
          list = list.map((d) => (d.chatId === op.chatId ? { ...d, ...op.fields } : d))
        } else if (op.op === 'reindex') {
          for (const it of op.items) indexById.set(it.chatId, it.index)
        } else {
          indexById.delete(op.chatId)
          list = list.filter((d) => d.chatId !== op.chatId)
        }
      }
      return { dialogs: sorted(list), loaded: true }
    }),
```

- [ ] **Step 4: Подключить проектор**

В `storeProjection.ts` рядом с `[RT.peerOp]`:

```ts
  // Этап 1 «владение диалогами»: список диалогов — владелец воркерный
  // dialogsManager. Проектор — ЕДИНСТВЕННЫЙ писатель зеркала
  // (пин — stores/noDuplicateDialogs.test.ts).
  [RT.dialogOp]: (e) => { useChatsStore.getState().applyDialogOps(e.ops) },
```

- [ ] **Step 5: Прогнать тесты**

Run: `cd web-client && npx vitest run src/client/realtime/storeProjection.dialogs.test.ts`
Expected: PASS.

- [ ] **Step 6: Переключить холодный старт**

В `boot.ts` заменить префетч диалогов и гидрацию:

```ts
  // Диалоги: владелец в воркере. Он сам поднимает кэш прошлой сессии и отвечает
  // reset'ом — ответ RPC ждём ДО первого рендера (подписка на rt:dialog_op ещё не
  // поднята, кадры не буферизуются). Сеть догоняет отдельно (refresh) и публикует
  // reset поверх.
  const dialogsOp: Promise<DialogOp | null> = locked ? Promise.resolve(null) : managers.dialogs.fillMirror()
```

и после гидрации State:

```ts
  const op = await dialogsOp
  if (op) useChatsStore.getState().applyDialogOps([op])
  if (!locked) void managers.dialogs.refresh()
```

`hydrateDialogsFromPersist()` из `boot.ts` убрать (сам модуль удаляется в Task 5), `loadChats` в Task 3 теряет диалоговую половину.

- [ ] **Step 7: Прогон и проверка мутацией**

Run: `cd web-client && npm test`
Мутация: убрать строку `[RT.dialogOp]` из `APPLY` → `storeProjection.dialogs.test.ts` должен покраснеть (тест регистрирует проектор, а не зовёт `applyDialogOps` напрямую). Вернуть, привести вывод.

- [ ] **Step 8: Коммит**

```bash
git add web-client/src/stores/chatsStore.ts web-client/src/client/realtime/storeProjection.ts \
        web-client/src/client/boot.ts web-client/src/client/realtime/storeProjection.dialogs.test.ts
git commit -m "feat(dialogs): chatsStore становится зеркалом, холодный старт через fillMirror"
```

---

### Task 3: Realtime-кадры применяет владелец

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts`, `web-client/src/core/workerCore.ts`, `web-client/src/client/realtime/storeProjection.ts`, `web-client/src/stores/chatsStore.ts`
- Test: `web-client/src/core/managers/dialogsManager.test.ts`

**Interfaces:**
- Produces (на `dialogsManager`):
  ```ts
  applyNewMessage(e: NewMessageEvt): void
  applyRead(e: ReadEvt, meId: number | null): void
  applyChatMeta(e: ChatUpdateEvt): void
  bumpUnreadReactions(chatId: number, count?: number): void
  applyRemoved(chatId: number): void
  ```
  Каждый метод публикует `patch` (с `index`, если сдвинулся порядок) или `remove`.

- [ ] **Step 1: Тест — новое сообщение поднимает диалог и публикует patch с индексом**

```ts
it('new_message публикует patch с новым индексом и превью', async () => {
  const ops: DialogOp[] = []
  const mgr = newDialogsManager({ /* … */ onDialogOps: (o) => ops.push(...o),
    loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')] })
  await mgr.fillMirror()
  ops.length = 0

  mgr.applyNewMessage({ chat_id: 1, seq: 7, text: 'привет', sender_id: 9,
    created_at: '2026-08-03T00:00:00Z', type: 'text' } as NewMessageEvt)

  expect(ops).toHaveLength(1)
  const op = ops[0] as Extract<DialogOp, { op: 'patch' }>
  expect(op.chatId).toBe(1)
  expect(op.fields.lastMessage?.text).toBe('привет')
  expect(op.index).toBeGreaterThan(mgr.getSnapshot()[1].index) // диалог 1 теперь выше
})

it('read моего пользователя гасит непрочитанное и не двигает порядок', async () => { /* … */ })
it('chat_update сливает абсолютный снимок метаданных, index не меняется', async () => { /* … */ })
```

- [ ] **Step 2: Запустить — падает** (`applyNewMessage is not a function`).

- [ ] **Step 3: Перенести тела мутаторов из `chatsStore` во владельца**

Логика переносится как есть (включая `unread ?? +1` fallback, идемпотентность `applyRead`, абсолютный снимок `chat_update` c `photo_media_id → /media/<id>/content`); меняется только выход: вместо `set({dialogs})` — `publish([{ op:'patch', chatId, fields, index }])`. `meId` владелец берёт из `getMeId()` (в `workerCore` уже есть `me`).

- [ ] **Step 4: Перевести подписки воркера**

В `workerCore` там, где кадры уже проходят через `dispatch`, добавить вызовы владельца (`dialogs.applyNewMessage(...)` и т.д.). В `storeProjection` убрать `store.applyNewMessage/applyRead/bumpUnreadReactions/removeDialog` и `[RT.chatRemoved]`; в `chatsStore` удалить одноимённые мутаторы (`typing`-очистку на новом сообщении оставить на main — это эфемерика).

- [ ] **Step 5: Прогон**

Run: `cd web-client && npm test`
Expected: PASS; упавшие тесты `chatsStore.test.ts` на удалённые мутаторы — переписать на владельца.

- [ ] **Step 6: Проверка мутацией**

Убрать `publish` из `applyNewMessage` → тест Task 3 Step 1 краснеет.

- [ ] **Step 7: Коммит**

```bash
git commit -am "feat(dialogs): realtime-кадры применяет владелец, витрина получает операции"
```

---

### Task 4: Действия без оптимистики

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts`, `web-client/src/core/managers/groupsManager.ts`, `web-client/src/core/managers/chatThemesManager.ts`, `web-client/src/core/workerCore.ts`
- Modify: `web-client/src/components/ChatListItem.tsx:56-102`, `web-client/src/components/Chat.tsx:219,895`, `web-client/src/core/hooks/useMuteToggle.ts`, `web-client/src/core/hooks/useAppHotkeys.ts:28-29`, `web-client/src/core/hooks/useGroupEdit.ts:108`, `web-client/src/components/ChatThemesPicker.tsx:40`
- Test: `web-client/src/core/managers/dialogsManager.test.ts`

**Interfaces:**
- `groupsManager` получает зависимость владельца: `newGroupsManager({ rest, dialogs })`, где `dialogs: Pick<DialogsManager, 'applyMute' | 'applyPinned' | 'applyArchived' | 'applyRemoved'>`. Так локальный апдейт стоит там же, где сетевой вызов, — как `toggleDialogPin` в tweb.
- `chatThemesManager`: `newChatThemesManager({ rest, dialogs })` → после успеха `dialogs.applyTheme(chatId, themeId)`.

- [ ] **Step 1: Тест — при ошибке сети ничего не публикуется**

```ts
it('setMute: RPC упал — ни одной операции, кэш не изменился', async () => {
  const ops: DialogOp[] = []
  const dialogs = newDialogsManager({ /* … */ onDialogOps: (o) => ops.push(...o) })
  await dialogs.fillMirror()
  ops.length = 0
  const groups = newGroupsManager({ rest: { post: vi.fn(async () => { throw new Error('offline') }) } as never, dialogs })

  await expect(groups.setMute(1, true)).rejects.toThrow()

  expect(ops).toEqual([])
  expect(dialogs.getSnapshot().find((i) => i.dialog.chatId === 1)!.dialog.muted).toBe(false)
})

it('setMute: успех — patch опубликован ПОСЛЕ ответа сервера', async () => { /* зеркальный кейс */ })
```

- [ ] **Step 2: Запустить — падает**.

- [ ] **Step 3: Добавить владельцу применялки действий**

```ts
    /** Локальный апдейт ПОСЛЕ успеха сети — порт tweb (invokeApi(...).then(saveUpdate)). */
    applyMute(chatId: number, muted: boolean): void { patchDialog(chatId, { muted }) },
    applyArchived(chatId: number, archived: boolean): void { patchDialog(chatId, { archived, pinned: false }) },
    applyTheme(chatId: number, themeId: string): void { patchDialog(chatId, { themeId: themeId || undefined }) },
    applyRemoved(chatId: number): void { … publish([{ op: 'remove', chatId }]) },
    /** Пин двигает и порядок: свежий встаёт первым (tweb order.unshift, dialogs.ts:934). */
    applyPinned(chatId: number, pinned: boolean): void { … },
```

`applyPinned` обновляет `pinnedOrder`, пишет его через `saveStateKey('pinnedOrders', …)`, рассылает зеркало ключа вкладкам тем же `mirrorStateKey`, что и `persistManager`, и публикует `patch` + `reindex`.

- [ ] **Step 4: Дописать вызовы в сетевые менеджеры**

```ts
    async setMute(chatId: number, muted: boolean, until?: number): Promise<void> {
      await rest.post(`/chats/${chatId}/mute`, { muted, until: until ?? null })
      dialogs.applyMute(chatId, muted)   // оптимистики нет: применяем после ответа (tweb)
    },
```

то же для `setPin`, `setArchive`, `setChatTheme`, и для удаления диалога в `useGroupEdit`-пути.

- [ ] **Step 5: Убрать оптимистику из UI**

В `ChatListItem.tsx` строки 56-58 (селекторы мутаторов) и 67-102 (вызовы + `catch`-откаты) заменить на голый вызов RPC; так же в `Chat.tsx:219,895`, `useMuteToggle.ts:10-16`, `useAppHotkeys.ts:28-29`, `ChatThemesPicker.tsx:40`, `useGroupEdit.ts:108`.

- [ ] **Step 6: Прогон + проверка мутацией**

Run: `cd web-client && npm test`
Мутация: перенести `dialogs.applyMute(...)` ПЕРЕД `await rest.post(...)` → тест «RPC упал — ни одной операции» краснеет.

- [ ] **Step 7: Коммит**

```bash
git commit -am "feat(dialogs): действия применяются после ответа сервера, оптимистика удалена"
```

---

### Task 5: Персист переезжает к владельцу

**Files:**
- Modify: `web-client/src/core/managers/dialogsManager.ts`, `web-client/src/core/workerCore.ts`, `web-client/src/client/boot.ts`
- Delete: `web-client/src/stores/dialogsPersist.ts` и его тесты
- Test: `web-client/src/core/managers/dialogsManager.test.ts`

- [ ] **Step 1: Тест — публикация операций ведёт к отложенной записи**

```ts
it('после операции список пишется на диск с дебаунсом (один вызов на серию)', async () => {
  vi.useFakeTimers()
  const save = vi.fn(async () => {})
  const mgr = newDialogsManager({ /* … */ saveCache: save })
  await mgr.fillMirror()
  mgr.applyMute(1, true); mgr.applyMute(1, false); mgr.applyMute(1, true)

  expect(save).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Запустить — падает**.

- [ ] **Step 3: Реализовать дебаунс-запись во владельце** (`saveCache: (dialogs: Dialog[]) => Promise<void>`, в `workerCore` — `saveDialogs`), вызывается после каждой публикации.

- [ ] **Step 4: Удалить `stores/dialogsPersist.ts`** и его подключение из `boot.ts`/`main.tsx`.

- [ ] **Step 5: Прогон**

Run: `cd web-client && npm test && npm run typecheck && npm run lint`

- [ ] **Step 6: Коммит**

```bash
git rm web-client/src/stores/dialogsPersist.ts
git commit -am "refactor(dialogs): персист списка переехал к владельцу, dialogsPersist удалён"
```

---

### Task 6: Снос старого пути и пины владения

**Files:**
- Modify: `web-client/src/stores/chatsStore.ts` (удалить `applyDialogs`, `syncPinnedOrder`, `replace`, `setDialogs`, `setDialog*`, `loadChats`-часть про диалоги), `web-client/src/core/hooks/useAuthGate.ts`
- Move: `web-client/src/core/dialogs/dialogIndex.test.ts` → тесты владельца (сама функция остаётся на месте, её зовёт воркер)
- Create: `web-client/src/stores/noDuplicateDialogs.test.ts`
- Modify: `web-client/src/stores/noManualOrder.test.ts`, `web-client/src/core/state/noAdHocReads.test.ts`

- [ ] **Step 1: Написать пин владения** — копия `noDuplicatePeers.test.ts` с заменой стора:

```ts
const ALLOWED = ['client/realtime/storeProjection.ts']

function writesToChatsDialogs(src: string): boolean {
  return /useChatsStore\.(getState|setState)\s*\(\s*\)?\s*\.?\s*(applyDialogOps|setDialogs|setDialog)/.test(src)
    || /useChatsStore\(\s*\(?[^)]*\)?\s*=>\s*s?\.?\s*\w*\.?(applyDialogOps|setDialogs|setDialog)/.test(src)
}

it('писатели списка диалогов есть только в allow-list', () => { /* как в noDuplicatePeers */ })
```

- [ ] **Step 2: Запустить — падает** (пока писатели остались в UI/хуках).

- [ ] **Step 3: Снести остатки** — удалить мутаторы и `applyDialogs`/`syncPinnedOrder` из `chatsStore`, оставив `dialogs`, `applyDialogOps`, `me`/`meId`, `activeChatId`, `presence`, `typing`; `loadChats` оставить только про `me`; в `useAuthGate` `setDialogs([])` заменить на `applyDialogOps([{ op: 'reset', items: [] }])`.

- [ ] **Step 4: Переориентировать `noManualOrder.test.ts`** — теперь он пинит, что порядок рождается в `core/managers/dialogsManager.ts` (единственное место вызова `dialogIndex`), и что на main его не считают.

- [ ] **Step 5: Обновить `noAdHocReads.test.ts`** — чтение диалогов с main исчезло.

- [ ] **Step 6: Полный прогон с выводом**

Run: `cd web-client && npm test && npm run typecheck && npm run lint`
Expected: всё зелёное; вывод привести в отчёте дословно.

- [ ] **Step 7: Проверка на стенде**

```bash
cd web-client && npx vite build --outDir ../client-build
docker compose -p msgrverify -f ../docker-compose.verify.yml up -d --build
```
Проверить на `:38080`: порядок списка, пины, превью, счётчики, архив, темы; открыть две вкладки и убедиться, что мьют/пин/архив приезжают в обе и НЕ применяются до ответа сервера (throttling в DevTools).

- [ ] **Step 8: Коммит**

```bash
git commit -am "refactor(dialogs): main больше не считает порядок; пины владения"
```

## Self-Review

**Покрытие спеки:** владелец и индекс — Task 1; операции и `fillMirror` — Task 1-2; зеркало и холодный старт — Task 2; realtime-кадры — Task 3; apply-after-success и снятие оптимистики — Task 4; персист — Task 5; снос `applyDialogs`/`dialogIndex` с main, пины и критерии приёмки — Task 6. Отступления (зеркало-массив, один канал вместо пяти) зафиксированы комментариями в Task 1 Step 3-4.

**Плейсхолдеры:** в Task 3 Step 1 два теста обозначены телом `/* … */` — их код повторяет структуру первого теста той же задачи (подготовка владельца из Task 1 Step 1 + проверка опубликованной операции); при исполнении писать по образцу. Остальные шаги содержат конкретный код.

**Согласованность типов:** `DialogOp`/`DialogItem` заданы в Task 1 и используются без переименований в Task 2-6; `fillMirror(): Promise<DialogOp>`, `getSnapshot(): DialogItem[]`, `setStateKey(key, value)` — те же сигнатуры во всех задачах; `applyMute/applyPinned/applyArchived/applyTheme/applyRemoved` введены в Task 4 и там же используются.
