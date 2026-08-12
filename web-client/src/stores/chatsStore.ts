// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'
import type { ChatUpdateEvt, NewMessageEvt, ReadEvt, PresenceEvt, TypingAction } from '../core/realtime/events'
import { reconcileById } from '../core/store/reconcile'
import { dialogIndex } from '../core/dialogs/dialogIndex'
import type { DialogOp } from '../core/dialogs/dialogOps'
import { draftFor } from './draftsStore'
import { ALL_FOLDER_ID } from './foldersStore'
import { useAppStateStore, setAppState } from './appState'

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
   * Читает только sortDialogsByIndex; легаси-мутаторы ниже (setDialogMuted и
   * т.п.) его не трогают — они по-прежнему сортируют через applyDialogs/dialogIndex. */
  dialogIndexById: Record<number, number>
  me: User | null
  meId: number | null
  loaded: boolean
  activeChatId: number | null
  presence: Record<number, { online: boolean; lastSeen: number }>
  typing: Record<number, ChatTyping>
  setDialogs: (d: Dialog[]) => void
  /**
   * Task 2 (перенос владения диалогами): ЕДИНСТВЕННЫЙ вход зеркала для операций
   * воркера (rt:dialog_op) — пишет проектор (`client/realtime/storeProjection.ts`,
   * APPLY[RT.dialogOp]) и холодный старт (`client/boot.ts`, ответ fillMirror()
   * ДО первого рендера). Индекс приходит ГОТОВЫМ в операции — воркерный
   * dialogsManager уже посчитал его; здесь он только хранится и сортирует
   * (см. докблок sortDialogsByIndex). Легаси-мутаторы (setDialogMuted,
   * applyNewMessage, …) пока работают параллельно — их перевод на операции
   * воркера отдельными задачами (Task 4/6).
   */
  applyDialogOps: (ops: DialogOp[]) => void
  /** meId выводится из me (единый писатель) — отдельного setMeId нет, чтобы id и
   * профиль не расходились. Сам факт `me` вычисляет ТОЛЬКО воркер
   * (workerCore.ts::setMe → rt:me, Stage 1C.2 Task 1); канонический вызывающий —
   * storeProjection (APPLY[RT.me]). Прямые вызовы из витрины — allow-listed
   * исключения (оптимистика/гидратация), см. stores/noDuplicateMe.test.ts. */
  setMe: (u: User | null) => void
  setActiveChat: (id: number | null) => void
  setDialogMuted: (chatId: number, muted: boolean) => void
  setDialogPinned: (chatId: number, pinned: boolean) => void
  /** тема оформления чата сменилась (chat_theme_update) — '' сбрасывает к дефолту */
  setDialogTheme: (chatId: number, themeId: string) => void
  setDialogArchived: (chatId: number, archived: boolean) => void
  removeDialog: (chatId: number) => void
  /** снимок метаданных чата из realtime-кадра `chat_update` (title/username/фото) */
  applyChatMeta: (m: ChatUpdateEvt) => void
  applyNewMessage: (m: NewMessageEvt) => void
  applyRead: (r: ReadEvt) => void
  /** кто-то отреагировал на моё сообщение → бампим бейдж непрочитанных реакций диалога */
  bumpUnreadReactions: (chatId: number, count?: number) => void
  setPresence: (p: PresenceEvt) => void
  setTyping: (chatId: number, userId: number, action: TypingAction, at: number) => void
  clearTyping: (chatId: number, userId: number) => void
}

/**
 * ЕДИНСТВЕННЫЙ путь изменения списка диалогов.
 *
 * Раньше правил порядка было ДВА и они расходились: `setDialogs` брал порядок из
 * входного массива (как пришло от сети/из персиста), а живые апдейты
 * двигали строки вручную (`firstUnpinned` + `slice`). Из-за
 * этого кэш давал один порядок, ответ сети другой, и список перетасовывался через
 * ~250 мс после первого кадра.
 *
 * Теперь порядок — ПРОИЗВОДНАЯ ОТ ДАННЫХ (`dialogIndex`, порт tweb
 * `generateDialogIndex`, dialogs.ts:605-608): из одних и тех же данных всегда
 * получается один и тот же список, поэтому кэш и сеть сходятся. Слияние — через
 * `reconcileById`: неизменившиеся диалоги сохраняют ССЫЛКИ, а совпавший с памятью
 * ответ возвращает ИСХОДНЫЙ массив (ни перерисовки, ни записи в IDB).
 *
 * `incoming` строят вызывающие через `map` по текущему списку (без перестановок):
 * при равных индексах сортировка стабильна (ES2019), и относительный порядок
 * ничьих не зависит от того, какой сеттер сработал.
 *
 * Папка: `pinnedOrders` в tweb — по одной записи на папку, у нас закрепление
 * пер-юзерное и на весь список сразу (бэкенд `PinDialog` → `chat_members.pinned`,
 * usecase/chat/dialog_flags.go:18-38; папка — только фильтр той же коллекции, своего
 * пин-состояния у неё нет). Поэтому запись одна — `ALL_FOLDER_ID`.
 */
function applyDialogs(prev: Dialog[], incoming: Dialog[]): Dialog[] {
  const pinnedOrder = useAppStateStore.getState().pinnedOrders[ALL_FOLDER_ID] ?? []
  const sorted = incoming
    // Черновик передаём третьим аргументом: у нас он лежит не в диалоге, а в
    // AppState (tweb — `dialog.draft`, dialogs.ts:904-910). Свежий черновик
    // поднимает диалог, как в оригинале.
    .map((d) => [d, dialogIndex(d, pinnedOrder, draftFor(d.chatId))] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
  syncPinnedOrder(sorted, pinnedOrder)
  return reconcileById(prev, sorted, (d) => d.chatId).list
}

/**
 * Досеять `pinnedOrders` порядком закреплённых из получившегося списка — порт
 * tweb `generateDialogPinnedDate` (dialogs.ts:934-936), где отсутствующий в
 * порядке закреплённый тут же в него добавляется (`order.unshift`) и порядок
 * сохраняется (`savePinnedOrders`).
 *
 * Зачем: `pinned_at` сервер наружу не отдаёт (в `Dialog` только флаг `pinned`),
 * он выражен лишь ПОРЯДКОМ ответа `/chats` (ORDER BY m.pinned_at DESC,
 * chatsrepo.go:225). Первый применённый список этот порядок и фиксирует, дальше
 * он берётся из State — иначе закреплённые с одинаковым индексом (никого нет в
 * порядке) зависели бы от порядка входного массива, то есть от того же
 * расхождения кэш/сеть, ради которого всё и затевалось.
 */
function syncPinnedOrder(sorted: readonly Dialog[], prevOrder: readonly number[]): void {
  const next = sorted.filter((d) => d.pinned).map((d) => d.chatId)
  if (next.length === prevOrder.length && next.every((id, i) => id === prevOrder[i])) return
  setAppState('pinnedOrders', { ...useAppStateStore.getState().pinnedOrders, [ALL_FOLDER_ID]: next })
}

/** Заменить один диалог, НЕ переставляя список: порядок посчитает `applyDialogs`. */
const replace = (dialogs: Dialog[], chatId: number, d: Dialog): Dialog[] =>
  dialogs.map((x) => (x.chatId === chatId ? d : x))

/**
 * Сортировка зеркала (Task 2, перенос владения диалогами в воркер). В отличие
 * от `applyDialogs` выше, индекс здесь НЕ пересчитывается — он уже готов в
 * DialogOp (воркерный dialogsManager посчитал его той же чистой dialogIndex(),
 * см. докблок dialogsManager.ts). Пересчёт dialogIndex на main воссоздал бы
 * исходный баг applyDialogs (два источника порядка — кэш и сеть/main
 * расходятся), только теперь между воркером и main.
 */
function sortDialogsByIndex(dialogs: Dialog[], indexById: Record<number, number>): Dialog[] {
  return [...dialogs].sort((a, b) => (indexById[b.chatId] ?? 0) - (indexById[a.chatId] ?? 0))
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
  setDialogs: (dialogs) => set((s) => ({ dialogs: applyDialogs(s.dialogs, dialogs), loaded: true })),
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
      return { dialogs: sortDialogsByIndex(list, indexById), dialogIndexById: indexById, loaded: true }
    }),
  setMe: (me) => set({ me, meId: me?.id ?? null }),
  setActiveChat: (activeChatId) => set({ activeChatId }),
  setDialogMuted: (chatId, muted) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === chatId)
      if (!cur) return {}
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, chatId, { ...cur, muted })) }
    }),
  setDialogTheme: (chatId, themeId) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === chatId)
      if (!cur) return {}
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, chatId, { ...cur, themeId: themeId || undefined })) }
    }),
  // Закрепить/открепить. Позицию считает dialogIndex по `pinnedOrders`, поэтому
  // здесь обновляется именно порядок: свежий пин встаёт первым (tweb dialogs.ts:934
  // `order.unshift`), анпин выпадает из порядка и возвращается к дате активности.
  setDialogPinned: (chatId, pinned) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === chatId)
      if (!cur) return {}
      const orders = useAppStateStore.getState().pinnedOrders
      const order = orders[ALL_FOLDER_ID] ?? []
      const rest = order.filter((id) => id !== chatId)
      setAppState('pinnedOrders', { ...orders, [ALL_FOLDER_ID]: pinned ? [chatId, ...rest] : rest })
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, chatId, { ...cur, pinned })) }
    }),
  // В архив / из архива; пин при переносе сбрасывается (как на бэке).
  setDialogArchived: (chatId, archived) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === chatId)
      if (!cur) return {}
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, chatId, { ...cur, archived, pinned: false })) }
    }),
  // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
  removeDialog: (chatId) =>
    set((s) => ({
      dialogs: applyDialogs(s.dialogs, s.dialogs.filter((d) => d.chatId !== chatId)),
      activeChatId: s.activeChatId === chatId ? null : s.activeChatId,
    })),
  // Бэкенд шлёт в `chat_update` АБСОЛЮТНЫЙ снимок метаданных чата
  // (backend/internal/usecase/chat/chat_update.go:18-42), поэтому перезапрашивать
  // список диалогов не нужно: сливаем снимок в существующий диалог. Раньше здесь
  // был дебаунснутый рефетч всего /chats на каждое изменение — а publishChatUpdate
  // зовётся из 13 мест бэкенда (переименование, фото, участники, права, слоумод),
  // и рефетч прилетал КАЖДОМУ участнику чата.
  applyChatMeta: (m) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === m.chat_id)
      if (!cur) return {} // чата нет в списке — приедет со следующей загрузкой
      // Пишем только те поля, что реально пришли в снимке: '' и null — это
      // «сброшено» (снимок абсолютный), отсутствие ключа — «не про это событие».
      const updated: Dialog = {
        ...cur,
        ...(m.title !== undefined && { title: m.title }),
        // username кладём verbatim — ровно как маппинг ответа /chats (models.ts:675),
        // где пустая строка остаётся пустой строкой.
        ...(m.username !== undefined && { username: m.username }),
        ...(m.photo_media_id !== undefined && {
          // Тот же путь, что отдаёт /chats (backend chatsrepo.go:190) и который
          // умеет резолвить useAvatarSrc — НЕ готовый URL с медиа-токеном: токен
          // живёт ~15 минут, и его нельзя класть в долгоживущую модель.
          photoUrl: m.photo_media_id === null ? undefined : `/media/${m.photo_media_id}/content`,
        }),
      }
      // Общим путём (Task 5): совпавший с памятью снимок вернёт ИСХОДНЫЙ массив,
      // ссылки соседних диалогов не меняются — перерисуется только эта строка.
      // Метаданные в dialogIndex не участвуют, поэтому порядок остаётся прежним.
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, m.chat_id, updated)) }
    }),
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
  applyNewMessage: (m) =>
    set((s) => {
      const d = s.dialogs.find((x) => x.chatId === m.chat_id)
      if (!d) return {} // unknown chat (will surface on next dialog reload)
      const incoming = m.sender_id !== s.meId
      const bumpUnread = incoming && s.activeChatId !== m.chat_id
      // Wave 3: сервер шлёт авторитетный unread получателям — берём verbatim; локальный
      // +1 остаётся fallback (старый бэк без поля). Активный чат не «моргает» бейджем:
      // мы тут же зовём markRead, поэтому счётчик держим на месте.
      const nextUnread = bumpUnread
        ? (m.unread ?? d.unread + 1)
        : d.unread
      const updated = {
        ...d,
        // carry media so the sidebar preview keeps its thumbnail + type label
        lastMessage: {
          seq: m.seq,
          text: m.text,
          senderId: m.sender_id,
          at: m.created_at,
          mediaId: m.media_id ?? undefined,
          mediaType: m.type || undefined,
          senderName: m.sender_name || undefined,
          // forward arrow in the sidebar preview live (not only on a full reload)
          forwarded: m.fwd_from_user_id != null || m.fwd_from_chat_id != null || undefined,
        },
        unread: nextUnread,
      }
      // A message from a user clears their typing indicator in that chat.
      let typing = s.typing
      const chatTyping = typing[m.chat_id]
      if (chatTyping && m.sender_id in chatTyping) {
        const next = { ...chatTyping }
        delete next[m.sender_id]
        typing = { ...typing, [m.chat_id]: next }
      }
      // Диалог поднимается САМ: свежая `lastMessage.at` даёт больший индекс.
      // Закреплённые при этом не смешиваются с обычными (PINNED_BASE) и между
      // собой не переставляются (их порядок — `pinnedOrders`).
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, m.chat_id, updated)), typing }
    }),
  applyRead: (r) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === r.chat_id)
      if (!cur) return {}
      let updated: typeof cur
      if (r.user_id === s.meId) {
        // my own read (also echoed to my other tabs) → clear unread (+ mentions/reactions) + advance my horizon.
        // Wave 3: авторитетный unread из кадра verbatim (обычно 0); локальный =0 — fallback.
        const unread = r.unread ?? 0
        const lastReadSeq = Math.max(cur.lastReadSeq, r.up_to_seq)
        // Идемпотентность: повторное эхо того же прочтения (up_to_seq ≤ горизонта,
        // unread уже 0) НЕ должно создавать новый dialogs — иначе mark-read-эффект
        // (деп win.msgs) перезапускается и получается бесконечный цикл ре-рендера.
        if (unread === cur.unread && cur.unreadMentions === 0 && cur.unreadReactions === 0 && lastReadSeq === cur.lastReadSeq) return {}
        updated = { ...cur, unread, unreadMentions: 0, unreadReactions: 0, lastReadSeq }
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        const peerReadSeq = Math.max(cur.peerReadSeq, r.up_to_seq)
        if (peerReadSeq === cur.peerReadSeq) return {} // no advance → no-op (без нового dialogs)
        updated = { ...cur, peerReadSeq }
      }
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, r.chat_id, updated)) }
    }),
  bumpUnreadReactions: (chatId, count) =>
    set((s) => {
      const cur = s.dialogs.find((d) => d.chatId === chatId)
      if (!cur) return {}
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : (cur.unreadReactions ?? 0) + 1
      return { dialogs: applyDialogs(s.dialogs, replace(s.dialogs, chatId, { ...cur, unreadReactions: value })) }
    }),
}))

interface LoadDeps {
  auth: { me(): Promise<User | null> }
  chats: { listDialogs(): Promise<Dialog[]> }
  // Секретные чаты: сервер отдаёт шифр-блоб последнего сообщения (plaintext он не
  // знает) — расшифровываем на клиенте ключом из IndexedDB для превью в списке.
  secret?: { decryptMessage(chatId: number, encBody: string): Promise<{ text: string; media?: { mediaType: string } } | null> }
}

// Fetch the current user + dialogs and populate the store. На холодном старте
// принимает уже летящие промисы (prefetch из main.tsx) — так первый вызов не
// плодит второй round-trip и переиспользует me()/listDialogs(), запущенные до
// монтирования React.
export async function loadChats(
  managers: LoadDeps,
  prefetch?: { me: Promise<User | null>; dialogs: Promise<Dialog[]> },
): Promise<void> {
  const [me, dialogs] = await Promise.all([
    prefetch?.me ?? managers.auth.me(),
    prefetch?.dialogs ?? managers.chats.listDialogs(),
  ])
  await decryptSecretPreviews(managers, dialogs)
  const st = useChatsStore.getState()
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
  // (chatsStore.test.ts: «loadChats populates dialogs + meId») — не выпиливать.
  st.setMe(me) // meId выводится из me внутри setMe
  st.setDialogs(dialogs)
}

// Расшифровать последнее сообщение каждого секретного чата для превью в списке
// (холодный старт/reload — live-путь уже кладёт plaintext через applyNewMessage).
// Ошибки дешифровки глотаем: превью просто останется generic-лейблом.
async function decryptSecretPreviews(managers: LoadDeps, dialogs: Dialog[]): Promise<void> {
  if (!managers.secret) return
  await Promise.all(
    dialogs.map(async (d) => {
      const lm = d.lastMessage
      if (d.type !== 'secret' || !lm?.encBody || lm.text) return
      const dec = await managers.secret!.decryptMessage(d.chatId, lm.encBody).catch(() => null)
      if (!dec) return
      lm.text = dec.text
      // Медиа без подписи: показать лейбл типа ('photo'/'video'/…) вместо 'encrypted'.
      if (!dec.text && dec.media) lm.mediaType = dec.media.mediaType
    }),
  )
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
