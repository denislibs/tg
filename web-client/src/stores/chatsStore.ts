// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'
import type { PresenceEvt, TypingAction } from '../core/realtime/events'
import { reconcileById } from '../core/store/reconcile'
import type { DialogOp } from '../core/dialogs/dialogOps'

// Per-chat typing state: chatId -> userId -> {action, at}. `at` is the event
// timestamp (ms) so stale entries can be ignored; entries are also actively
// cleared on a timer / when the user sends a message.
export interface TypingEntry { action: TypingAction; at: number }
export type ChatTyping = Record<number, TypingEntry>

interface ChatsState {
  dialogs: Dialog[]
  /** Task 2 (перенос владения диалогами): индекс из последней операции воркера
   * (rt:dialog_op) — хранится В СОСТОЯНИИ стора (не модульной переменной), чтобы
   * reset и смена аккаунта чистили его естественно тем же set(), что и dialogs.
   * Читает только sortDialogsByIndex. */
  dialogIndexById: Record<number, number>
  me: User | null
  meId: number | null
  loaded: boolean
  activeChatId: number | null
  presence: Record<number, { online: boolean; lastSeen: number }>
  typing: Record<number, ChatTyping>
  /**
   * Task 2 (перенос владения диалогами): ЕДИНСТВЕННЫЙ вход и ЕДИНСТВЕННЫЙ
   * писатель списка диалогов (Task 6 снесла легаси-путь `setDialogs`/
   * `applyDialogs`, см. `stores/noDuplicateDialogs.test.ts`) — пишет проектор
   * (`client/realtime/storeProjection.ts`, APPLY[RT.dialogOp]) и холодный старт
   * (`client/boot.ts`, ответ fillMirror() ДО первого рендера). Индекс приходит
   * ГОТОВЫМ в операции — воркерный dialogsManager уже посчитал его (порт tweb
   * `generateDialogIndex`, `core/dialogs/dialogIndex.ts` — единственное место
   * его вызова, см. `stores/noManualOrder.test.ts`); здесь он только хранится
   * и сортирует (см. докблок sortDialogsByIndex).
   */
  applyDialogOps: (ops: DialogOp[]) => void
  /** meId выводится из me (единый писатель) — отдельного setMeId нет, чтобы id и
   * профиль не расходились. Сам факт `me` вычисляет ТОЛЬКО воркер
   * (workerCore.ts::setMe → rt:me, Stage 1C.2 Task 1); канонический вызывающий —
   * storeProjection (APPLY[RT.me]). Прямые вызовы из витрины — allow-listed
   * исключения (оптимистика/гидратация), см. stores/noDuplicateMe.test.ts. */
  setMe: (u: User | null) => void
  setActiveChat: (id: number | null) => void
  // Task 3 (перенос владения диалогами): removeDialog/applyChatMeta/applyNewMessage/
  // applyRead/bumpUnreadReactions отсюда убраны — их тела переехали во владельца
  // (core/managers/dialogsManager.ts), выход теперь операция rt:dialog_op через
  // applyDialogOps, а не прямая запись в этот стор.
  // Task 4 (действия без оптимистики): setDialogMuted/setDialogPinned/
  // setDialogTheme/setDialogArchived отсюда тоже убраны — тела переехали во
  // владельца (dialogsManager.applyMute/applyPinned/applyTheme/applyArchived),
  // сетевые менеджеры (groupsManager/chatThemesManager) зовут их сами ПОСЛЕ
  // успешного REST-ответа; вызывавшая их витрина (ChatListItem/Chat/
  // useMuteToggle/useAppHotkeys/ChatThemesPicker) больше их не трогает.
  setPresence: (p: PresenceEvt) => void
  setTyping: (chatId: number, userId: number, action: TypingAction, at: number) => void
  clearTyping: (chatId: number, userId: number) => void
}

/**
 * Сортировка зеркала (Task 2, перенос владения диалогами в воркер; Task 6 снесла
 * легаси-путь `applyDialogs`/`dialogIndex`, который раньше жил рядом и считал
 * порядок сам — см. `stores/noManualOrder.test.ts`). Индекс здесь НЕ
 * пересчитывается — он уже готов в DialogOp (воркерный dialogsManager посчитал
 * его чистой `dialogIndex()`, порт tweb `generateDialogIndex`, см. докблок
 * dialogsManager.ts). Пересчёт dialogIndex на main воссоздал бы исходный баг
 * (два источника порядка — кэш и сеть/main расходятся), только теперь между
 * воркером и main.
 */
function sortDialogsByIndex(dialogs: Dialog[], indexById: Record<number, number>): Dialog[] {
  return [...dialogs].sort((a, b) => (indexById[b.chatId] ?? 0) - (indexById[a.chatId] ?? 0))
}

/**
 * Fix (финальное ревью, Important #4): реконсил сохранил ссылки на все элементы
 * и порядок тот же — значит СОДЕРЖИМОЕ не изменилось. `sortDialogsByIndex`
 * аллоцирует всегда (`[...dialogs].sort`), поэтому без этой сверки совпавший
 * `reset` (любой `refresh()` без реальных изменений на сервере) отдавал бы
 * новую ссылку на массив и перерисовывал ВСЕХ подписчиков списка. Инвариант
 * «совпавший ответ не даёт ни перерисовки, ни записи в IDB» —
 * web-client/CLAUDE.md, «Применять ответ сети полной подменой коллекции».
 */
function sameList(a: readonly Dialog[], b: readonly Dialog[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i])
}

/** Тот же смысл для карты индексов: значения те же — держим прежний объект. */
function sameIndex(a: Record<number, number>, b: Record<number, number>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[Number(k)] === b[Number(k)])
}

export const useChatsStore = create<ChatsState>((set) => ({
  dialogs: [],
  dialogIndexById: {},
  me: null,
  meId: null,
  loaded: false,
  activeChatId: null,
  presence: {},
  typing: {},
  applyDialogOps: (ops) =>
    set((s) => {
      let list = s.dialogs
      let indexById = s.dialogIndexById
      for (const op of ops) {
        if (op.op === 'reset') {
          indexById = {}
          for (const it of op.items) indexById[it.dialog.chatId] = it.index
          list = reconcileById(list, op.items.map((i) => i.dialog), (d) => d.chatId).list
        } else if (op.op === 'upsert') {
          indexById = { ...indexById }
          for (const it of op.items) indexById[it.dialog.chatId] = it.index
          const byId = new Map(op.items.map((i) => [i.dialog.chatId, i.dialog]))
          const merged = list.map((d) => byId.get(d.chatId) ?? d)
          for (const it of op.items) {
            if (!list.some((d) => d.chatId === it.dialog.chatId)) merged.push(it.dialog)
          }
          list = reconcileById(list, merged, (d) => d.chatId).list
        } else if (op.op === 'patch') {
          if (op.index !== undefined) indexById = { ...indexById, [op.chatId]: op.index }
          list = list.map((d) => (d.chatId === op.chatId ? { ...d, ...op.fields } : d))
        } else if (op.op === 'reindex') {
          indexById = { ...indexById }
          for (const it of op.items) indexById[it.chatId] = it.index
        } else {
          const nextIndex = { ...indexById }
          delete nextIndex[op.chatId]
          indexById = nextIndex
          list = list.filter((d) => d.chatId !== op.chatId)
        }
      }
      let dialogs = sortDialogsByIndex(list, indexById)
      if (sameList(dialogs, s.dialogs)) {
        dialogs = s.dialogs
        if (sameIndex(indexById, s.dialogIndexById)) indexById = s.dialogIndexById
      }
      return { dialogs, dialogIndexById: indexById, loaded: true }
    }),
  setMe: (me) => set({ me, meId: me?.id ?? null }),
  setActiveChat: (activeChatId) => set({ activeChatId }),
  // Task 3 (перенос владения диалогами): removeDialog/applyChatMeta ушли
  // отсюда — их тела переехали в core/managers/dialogsManager.ts
  // (applyRemoved/applyChatMeta), вызываются из workerCore.ts::dispatch по тем
  // же кадрам (chat_removed/chat_update) и публикуют rt:dialog_op вместо
  // прямой записи в этот стор.
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.user_id]: { online: p.online, lastSeen: p.last_seen } } })),
  setTyping: (chatId, userId, action, at) =>
    set((s) => ({
      typing: { ...s.typing, [chatId]: { ...s.typing[chatId], [userId]: { action, at } } },
    })),
  clearTyping: (chatId, userId) =>
    set((s) => {
      const chat = s.typing[chatId]
      if (!chat || !(userId in chat)) return {}
      const next = { ...chat }
      delete next[userId]
      return { typing: { ...s.typing, [chatId]: next } }
    }),
  // Task 3: applyNewMessage/applyRead/bumpUnreadReactions отсюда убраны — их
  // тела переехали в dialogsManager (см. докблок setPresence выше). Typing
  // сюда не входила бы: чистка typing-индикатора отправителя на новом
  // сообщении — эфемерика, остаётся на main (storeProjection.ts, обработчик
  // RT.newMessage зовёт store.clearTyping напрямую).
}))

interface LoadDeps {
  auth: { me(): Promise<User | null> }
}

// Fetch the current user and populate the store. Task 6 (перенос владения
// диалогами): диалоговая половина ушла владельцу (`core/managers/
// dialogsManager.ts`, `fillMirror()`/`refresh()`), здесь остаётся только `me` —
// расшифровка превью секретных чатов тоже переехала туда же (та же причина, что
// у самих диалогов: `secretManager` живёт в воркере, RPC на main не нужен).
// На холодном старте принимает уже летящий промис (prefetch из main.tsx) — так
// первый вызов не плодит второй round-trip и переиспользует me(), запущенный до
// монтирования React.
export async function loadChats(
  managers: LoadDeps,
  prefetch?: { me: Promise<User | null> },
): Promise<void> {
  const me = await (prefetch?.me ?? managers.auth.me())
  // ИСКЛЮЧЕНИЕ из «пишет только проектор» (Stage 1C.2, Task 1 — см. докблок
  // setMe в ChatsState выше и stores/noDuplicateMe.test.ts) — НЕ уступка
  // тесту, а единственный надёжный канал холодного старта: `SuperMessagePort`
  // не буферизует события (`rpc/superMessagePort.ts`), а `smp.on(RT.me, ...)`
  // подключается в `startRealtime()`, из эффекта — ПОСЛЕ первого рендера
  // (`useAppBootstrap.ts`). Воркерный `/me` вполне может разрешиться и
  // разослать `rt:me` РАНЬШЕ, чем эта вкладка вообще успела подписаться —
  // тогда стартовый broadcast просто не доедет, и `me` в сторе не выставится
  // никогда. Прямой RPC здесь (`managers.auth.me()`, тот же `authManager`,
  // тот же токен, что и в boot-цепочке воркера) — не второй вывод факта, а
  // альтернативный путь ЗАПРОСА уже посчитанного значения, устойчивый к
  // порядку подписки. `loadChats` тестируется в изоляции без воркера/rootScope
  // (chatsStore.test.ts: «loadChats populates me/meId») — не выпиливать.
  useChatsStore.getState().setMe(me) // meId выводится из me внутри setMe
}

// Seed online / last-seen for a set of users (or all private-dialog peers when
// no ids are given). Live updates then arrive via rt:presence.
export async function loadPresence(
  managers: { presence: { get(ids: number[]): Promise<PresenceEvt[]> } },
  ids?: number[],
): Promise<void> {
  const st = useChatsStore.getState()
  const targets =
    ids ?? st.dialogs.filter((d) => d.type === 'private' && d.peer).map((d) => d.peer!.id)
  if (!targets.length) return
  const list = await managers.presence.get(targets)
  for (const p of list) st.setPresence(p)
}
