// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'
import type { PeerProfile } from '../core/managers/authManager'
import type { PresenceEvt, TypingAction } from '../core/realtime/events'
import { reconcileById } from '../core/store/reconcile'
import type { DialogOp } from '../core/dialogs/dialogOps'
import type { UserStatus } from '../core/peers/peer'
import { isUser } from '../core/peers/peerId'

// Per-chat typing state: peerId -> userId -> {action, at}. `at` is the event
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
  me: PeerProfile | null
  meId: number | null
  loaded: boolean
  activePeerId: number | null
  /** присутствие по id пользователя — КОНСТРУКТОР `UserStatus` (объединение
   *  схемы), а не пара `{online, lastSeen}`. «Онлайн» выводится предикатом
   *  `isUserStatusOnline(status, now)` (порт `appUsersManager.isUserOnline`):
   *  у `userStatusOnline` есть `expires`, и статус гаснет сам — потерянный
   *  кадр больше не оставляет человека онлайн навсегда. */
  presence: Record<number, UserStatus>
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
  setMe: (u: PeerProfile | null) => void
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
  setTyping: (peerId: number, userId: number, action: TypingAction, at: number) => void
  clearTyping: (peerId: number, userId: number) => void
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
  return [...dialogs].sort((a, b) => (indexById[b.peerId] ?? 0) - (indexById[a.peerId] ?? 0))
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
  activePeerId: null,
  presence: {},
  typing: {},
  applyDialogOps: (ops) =>
    set((s) => {
      let list = s.dialogs
      let indexById = s.dialogIndexById
      for (const op of ops) {
        if (op.op === 'reset') {
          indexById = {}
          for (const it of op.items) indexById[it.dialog.peerId] = it.index
          list = reconcileById(list, op.items.map((i) => i.dialog), (d) => d.peerId).list
        } else if (op.op === 'upsert') {
          indexById = { ...indexById }
          for (const it of op.items) indexById[it.dialog.peerId] = it.index
          const byId = new Map(op.items.map((i) => [i.dialog.peerId, i.dialog]))
          const merged = list.map((d) => byId.get(d.peerId) ?? d)
          for (const it of op.items) {
            if (!list.some((d) => d.peerId === it.dialog.peerId)) merged.push(it.dialog)
          }
          list = reconcileById(list, merged, (d) => d.peerId).list
        } else if (op.op === 'patch') {
          if (op.index !== undefined) indexById = { ...indexById, [op.peerId]: op.index }
          list = list.map((d) => (d.peerId === op.peerId ? { ...d, ...op.fields } : d))
        } else if (op.op === 'reindex') {
          indexById = { ...indexById }
          for (const it of op.items) indexById[it.peerId] = it.index
        } else {
          const nextIndex = { ...indexById }
          delete nextIndex[op.peerId]
          indexById = nextIndex
          list = list.filter((d) => d.peerId !== op.peerId)
        }
      }
      let dialogs = sortDialogsByIndex(list, indexById)
      if (sameList(dialogs, s.dialogs)) {
        dialogs = s.dialogs
        if (sameIndex(indexById, s.dialogIndexById)) indexById = s.dialogIndexById
      }
      return { dialogs, dialogIndexById: indexById, loaded: true }
    }),
  setMe: (me) => set({ me, meId: me?.user.id ?? null }),
  setActiveChat: (activePeerId) => set({ activePeerId }),
  // Task 3 (перенос владения диалогами): removeDialog/applyChatMeta ушли
  // отсюда — их тела переехали в core/managers/dialogsManager.ts
  // (applyRemoved/applyChatMeta), вызываются из workerCore.ts::dispatch по тем
  // же кадрам (chat_removed/chat_update) и публикуют rt:dialog_op вместо
  // прямой записи в этот стор.
  setPresence: (p) => set((s) => ({ presence: { ...s.presence, [p.user_id]: p.status } })),
  setTyping: (peerId, userId, action, at) =>
    set((s) => ({
      typing: { ...s.typing, [peerId]: { ...s.typing[peerId], [userId]: { action, at } } },
    })),
  clearTyping: (peerId, userId) =>
    set((s) => {
      const chat = s.typing[peerId]
      if (!chat || !(userId in chat)) return {}
      const next = { ...chat }
      delete next[userId]
      return { typing: { ...s.typing, [peerId]: next } }
    }),
  // Task 3: applyNewMessage/applyRead/bumpUnreadReactions отсюда убраны — их
  // тела переехали в dialogsManager (см. докблок setPresence выше). Typing
  // сюда не входила бы: чистка typing-индикатора отправителя на новом
  // сообщении — эфемерика, остаётся на main (storeProjection.ts, обработчик
  // RT.newMessage зовёт store.clearTyping напрямую).
}))

interface LoadDeps {
  auth: { me(): Promise<PeerProfile | null> }
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
  prefetch?: { me: Promise<PeerProfile | null> },
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

/**
 * Погасить ИСТЁКШИЕ онлайны — порт `appUsersManager.updateUsersStatuses` +
 * `updateUserStatus` (`appUsersManager.ts:872-889`).
 *
 * `userStatusOnline` несёт `expires` — ДЕДЛАЙН, после которого статус
 * недействителен. Кадр `rt:presence` с переходом в offline может не доехать
 * (вкладка спала, сокет рвался, difference пропустил эфемерный апдейт), и без
 * этого перевода человек висел бы онлайн ВЕЧНО — ровно тот дефект, ради
 * которого `expires` и появился на проводе (шаг C).
 *
 * Переводим в `userStatusOffline{was_online: expires}` — как в оригинале: «был
 * в сети» ровно в момент, до которого онлайн был подтверждён, а не «сейчас».
 */
export function degradeExpiredPresence(now = Math.floor(Date.now() / 1000)): void {
  const cur = useChatsStore.getState().presence
  let next: Record<number, UserStatus> | undefined
  for (const key in cur) {
    const st = cur[key]
    if (st._ !== 'userStatusOnline' || st.expires > now) continue
    next ??= { ...cur }
    next[key] = { _: 'userStatusOffline', was_online: st.expires }
  }
  if (next) useChatsStore.setState({ presence: next })
}

/** Период проверки — 60 с, дословно `setInterval(this.updateUsersStatuses,
 *  60000)` (`appUsersManager.ts:68`). */
export const PRESENCE_DEGRADE_INTERVAL_MS = 60_000

/**
 * Запустить проверку. В оригинале интервал заводит сам менеджер пользователей
 * в `after()`; у нас карточка пира и её статус разъехались по двум владельцам
 * (пиры — воркерный `peersManager`, присутствие — этот стор на главном
 * потоке), поэтому интервал живёт там же, где данные, а его жизненный цикл —
 * у `useAppBootstrap`. Возвращает функцию остановки.
 */
export function startPresenceDegradation(): () => void {
  const id = setInterval(() => degradeExpiredPresence(), PRESENCE_DEGRADE_INTERVAL_MS)
  return () => clearInterval(id)
}

// Seed online / last-seen for a set of users (or all private-dialog peers when
// no ids are given). Live updates then arrive via rt:presence.
export async function loadPresence(
  managers: { presence: { get(ids: number[]): Promise<PresenceEvt[]> } },
  ids?: number[],
): Promise<void> {
  const st = useChatsStore.getState()
  // Ключ приватного диалога И ЕСТЬ id собеседника, а «приватный» — это ключ
  // ПОЛЬЗОВАТЕЛЯ: строки `type` у диалога больше нет, вопрос задаётся знаку
  // ключа (`core/peers/peerId.ts`).
  const targets = ids ?? st.dialogs.filter((d) => isUser(d.peerId)).map((d) => d.peerId)
  if (!targets.length) return
  const list = await managers.presence.get(targets)
  for (const p of list) st.setPresence(p)
  // Сверка дедлайнов сразу после сида — аналог `state_synchronized` оригинала
  // (`appUsersManager.ts:70`): ответ мог ехать дольше, чем жил онлайн, и без
  // этой строки истёкший статус висел бы до первого тика интервала.
  degradeExpiredPresence()
}
