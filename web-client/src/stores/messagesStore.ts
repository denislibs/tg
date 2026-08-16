// src/stores/messagesStore.ts
//
// Normalized message windows, single-sourced in a store so that (a) realtimeBridge
// can apply server frames to a chat even when it isn't open, and (b) the window
// survives a Chat unmount. `useMessageWindow` is a thin selector/
// actions wrapper over this store and keeps the same shape.
//
// Окна ключуются чатом ИЛИ тредом чата (tweb: history по threadId): "chatId" —
// основное окно, "chatId:root" — окно форум-топика/комментариев. Live-события
// с chat_id применяются ко ВСЕМ окнам этого чата (applyToChat), новое сообщение
// с thread_root_id попадает и в основное окно, и в окно своего треда.
import { create } from 'zustand'
import type { Message, MessageEntity, Poll, Checklist, Giveaway, GeoData, FactCheck, ReactionCount } from '../core/models'
import type { ReplyMarkup } from '../core/managers/botsManager'
import { reactionDelta } from '../core/reactionDelta'
import { dedupAsc, applyOp, type MessageOp } from '../core/realtime/messageOps'

// Ключ окна: основное окно чата или тред (форум-топик / комментарии).
export const winKey = (chatId: number, threadRootId?: number | null): string =>
  threadRootId ? `${chatId}:${threadRootId}` : String(chatId)

export interface ChatWindow {
  msgs: Message[]
  reachedTop: boolean
  reachedBottom: boolean
  loadingOlder: boolean
  loadingNewer: boolean
  loading: boolean
  /** the most recent initial load was served from the in-memory cache (no
   * network) — used to skip the open-chat ladder, matching tweb's setPeerCached */
  loadedFromCache: boolean
}

export const EMPTY_WINDOW: ChatWindow = {
  msgs: [], reachedTop: false, reachedBottom: false,
  loadingOlder: false, loadingNewer: false, loading: true, loadedFromCache: false,
}

// Жизненный цикл неотправленного сообщения (оптимистичный бабл, его ack/ошибка/
// отмена) здесь больше НЕ живёт: он переехал в менеджер воркера
// (core/managers/messages/pending.ts, порт формы tweb appMessagesManager), а
// сюда приезжает готовыми операциями через applyOps. Вместе с ним ушёл и
// reverse-индекс clientMsgId → окно: маршрут знает владелец, регистрация бабла
// по clientMsgId живёт у него (pendingByClientId).

// dedupAsc/dedupKey вынесены в core/realtime/messageOps.ts (Stage 1B.2, Task 2) —
// та же семантика нужна чистой applyOp над окном без стора; см. комментарий там.

// Абсолютный агрегат реакций из серверного counts. `mine` не приходит с сервера
// (counts безличный) → деривим: сохраняем прежний mine для не затронутых emoji,
// а для emoji своего действия ставим (add) / снимаем (remove). myEmoji/myAction
// заданы только когда реагировал я — иначе весь прежний mine переносится as-is.
function setReactions(
  prev: ReactionCount[] | undefined,
  counts: { emoji: string; count: number }[],
  myEmoji: string | null,
  myAction: 'add' | 'remove' | null,
): ReactionCount[] | undefined {
  const prevMine = new Set((prev ?? []).filter((r) => r.mine).map((r) => r.emoji))
  const next = counts.map((c) => {
    let mine = prevMine.has(c.emoji)
    if (myEmoji === c.emoji && myAction) mine = myAction === 'add'
    return { emoji: c.emoji, count: c.count, mine }
  })
  return next.length ? next : undefined
}
function sameReactions(a: ReactionCount[] | undefined, b: ReactionCount[] | undefined): boolean {
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  if (!a || !b) return true
  for (let i = 0; i < a.length; i++) {
    if (a[i].emoji !== b[i].emoji || a[i].count !== b[i].count || a[i].mine !== b[i].mine) return false
  }
  return true
}

interface MessagesState {
  byKey: Record<string, ChatWindow>
  /** Reset a window to the loading state (called on chat/thread open before fetch). */
  beginLoad: (key: string) => void
  /** Replace a window with a freshly loaded page (initial / jumpTo / reloadNewest). */
  setWindow: (key: string, w: { msgs: Message[]; reachedTop: boolean; reachedBottom: boolean; cached?: boolean }) => void
  setLoadingOlder: (key: string, v: boolean) => void
  setLoadingNewer: (key: string, v: boolean) => void
  prepend: (key: string, msgs: Message[], reachedTop: boolean) => void
  append: (key: string, msgs: Message[], reachedBottom: boolean) => void
  appendLocal: (key: string, m: Message) => void
  /** Новое сообщение чата: в основное окно + в окно своего треда (если открыто). */
  applyIncoming: (chatId: number, m: Message) => void
  /** Stage 1B.2 (Task 4): переигрывает операции воркера (rt:message_op) поверх
   * окон — единственный писатель окна для входящих сообщений (заменяет прямой
   * вызов applyIncoming из RT.newMessage). Окно, не загруженное на этой вкладке
   * (`!byKey[op.key]`), пропускается — та же гарантия, что и у applyIncoming
   * (иначе окно завелось бы «на лету» с одним сообщением вместо честного fetch). */
  applyOps: (ops: MessageOp[]) => void
  applyEdit: (chatId: number, msgId: number, text: string, editedAt: string, entities?: MessageEntity[], replyMarkup?: ReplyMarkup | null) => void
  applyGeoLive: (chatId: number, msgId: number, geo: GeoData) => void
  /** «Проверка фактов» прикреплена/изменена/снята (factcheck_update). undefined — снята. */
  applyFactCheck: (chatId: number, msgId: number, factCheck: FactCheck | undefined) => void
  applyDelete: (chatId: number, msgId: number) => void
  /** Patch channel-post view counts from a per-open view_counts fetch. */
  patchViews: (chatId: number, views: Map<number, number>) => void
  /** Полная замена опроса сообщения (ответ на свой голос — с myVotes). Live-
   * агрегат (poll_update) больше сюда не идёт — окно правит операция patch
   * (Stage 1B.3, Task 4: cachePoll → RT.messageOp → applyOps), myVotes
   * сохраняется слиянием патча (core/realtime/messageOps.ts). */
  setPoll: (chatId: number, poll: Poll) => void
  /** Обновление чек-листа (ответ на toggle/add): отметки глобальны (видно, кто
   * отметил) — локального состояния нет, полная замена. Live-агрегат
   * (checklist_update) идёт через операцию patch (см. setPoll выше). */
  applyChecklistUpdate: (chatId: number, checklist: Checklist) => void
  /** Полная замена розыгрыша (ответ на своё участие — с participating/iWon).
   * Live-агрегат (giveaway_update) — операцией patch, см. setPoll выше. */
  setGiveaway: (chatId: number, giveaway: Giveaway) => void
  /** АБСОЛЮТНЫЙ агрегат реакций (rt:reaction c counts / catch-up): ставим counts
   * verbatim. `mine` деривим — сохраняем для не затронутых emoji; для emoji своего
   * действия ставим (add) / снимаем (remove). myEmoji/myAction заданы только когда
   * реагировал я (user_id===meId), иначе null → mine целиком сохраняется. Идемпотентно
   * на реплей (тот же агрегат → no-op). */
  applyReaction: (chatId: number, msgId: number, counts: { emoji: string; count: number }[], myEmoji: string | null, myAction: 'add' | 'remove' | null) => void
  /** Оптимистичный клик (дельта до эха, всегда моё действие): count±1 по emoji +
   * mine. Абсолютное эхо сервера следом перезапишет агрегат авторитетно. */
  applyReactionOptimistic: (
    chatId: number,
    msgId: number,
    emoji: string,
    action: 'add' | 'remove',
    /** карточка зрителя — чтобы своя реакция сразу показала аватар, а не число */
    me?: { id: number; name: string; avatarUrl?: string },
  ) => void
  /** Платная ⭐-реакция: новый агрегат звёзд (total). mine задан только когда это
   * действие самого зрителя (оптимистично / эхо своего апдейта) — иначе не трогаем. */
  applyStarReaction: (chatId: number, msgId: number, total: number, mine?: number) => void
}

// Update a single window immutably.
function patch(
  state: MessagesState,
  key: string,
  fn: (w: ChatWindow) => Partial<ChatWindow>,
): Pick<MessagesState, 'byKey'> {
  const cur = state.byKey[key] ?? EMPTY_WINDOW
  return { byKey: { ...state.byKey, [key]: { ...cur, ...fn(cur) } } }
}

// Live-события несут только chat_id — применяем ко всем загруженным окнам
// этого чата (основное + треды). fn возвращает новый msgs или null (без изменений).
function patchChat(
  state: MessagesState,
  chatId: number,
  fn: (w: ChatWindow) => Message[] | null,
): Pick<MessagesState, 'byKey'> | Record<string, never> {
  const prefix = String(chatId)
  let next: Record<string, ChatWindow> | null = null
  for (const key of Object.keys(state.byKey)) {
    if (key !== prefix && !key.startsWith(`${prefix}:`)) continue
    const w = state.byKey[key]
    const msgs = fn(w)
    if (msgs === null) continue
    if (!next) next = { ...state.byKey }
    next[key] = { ...w, msgs }
  }
  return next ? { byKey: next } : {}
}

export const useMessagesStore = create<MessagesState>((set) => ({
  byKey: {},

  beginLoad: (key) =>
    set((s) => patch(s, key, () => ({ ...EMPTY_WINDOW, loading: true }))),

  setWindow: (key, w) =>
    set((s) =>
      patch(s, key, () => ({
        msgs: dedupAsc(w.msgs),
        reachedTop: w.reachedTop,
        reachedBottom: w.reachedBottom,
        loadedFromCache: !!w.cached,
        loading: false,
      })),
    ),

  setLoadingOlder: (key, v) => set((s) => patch(s, key, () => ({ loadingOlder: v }))),
  setLoadingNewer: (key, v) => set((s) => patch(s, key, () => ({ loadingNewer: v }))),

  prepend: (key, msgs, reachedTop) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...msgs, ...w.msgs]), reachedTop }))),

  append: (key, msgs, reachedBottom) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...w.msgs, ...msgs]), reachedBottom }))),

  appendLocal: (key, m) =>
    set((s) => patch(s, key, (w) => ({ msgs: dedupAsc([...w.msgs, m]) }))),

  applyIncoming: (chatId, m) =>
    set((s) => {
      // Apply to the main chat window AND (for a thread message) that thread's
      // window — each only if loaded (else refetched on open).
      const keys = m.threadRootId ? [winKey(chatId), winKey(chatId, m.threadRootId)] : [winKey(chatId)]
      let out: Pick<MessagesState, 'byKey'> | Record<string, never> = {}
      let cur = s
      for (const key of keys) {
        if (!cur.byKey[key]) continue
        const w = cur.byKey[key]
        // ack-then-echo: бабл уже сверен ack'ом (id=серверный) → эхо здесь дубль, skip.
        if (w.msgs.some((x) => x.id === m.id)) continue
        // Wave 3: эхо своей отправки несёт client_msg_id (m.clientId) → матчим
        // оптимистичный бабл ПО НЕМУ (не по подгаданному tentative seq). Старый
        // бабл (с tentative seq) удаляем и вставляем merged (серверный seq), иначе
        // при расхождении seq остались бы два бабла. Переносим clientId (стабильный
        // React-ключ — appear-анимация не обрывается), localUrl (загруженное фото не
        // рефетчится) и secret-флаг (эхо несёт расшифрованный text без флага).
        const optimistic = m.clientId ? w.msgs.find((x) => x.clientId === m.clientId) : undefined
        const merged = optimistic ? { ...m, clientId: optimistic.clientId, localUrl: optimistic.localUrl, secret: m.secret ?? optimistic.secret } : m
        const base = optimistic ? w.msgs.filter((x) => x !== optimistic) : w.msgs
        out = patch(cur as MessagesState, key, () => ({ msgs: dedupAsc([...base, merged]) }))
        cur = { ...cur, ...out }
      }
      return out
    }),

  // Stage 1B.2 (Task 4): переигрывание операций воркера (rt:message_op) вместо
  // самостоятельного разбора кадра. applyOp — та же чистая функция (insert/replace/
  // remove), что и applyIncoming использовала внутри себя (semantics 1:1, см.
  // core/realtime/messageOps.ts); здесь только маршрутизация по ключу окна + тот
  // же гейт «окно не загружено на этой вкладке — пропустить», что и в applyIncoming.
  applyOps: (ops) =>
    set((s) => {
      let out: Pick<MessagesState, 'byKey'> | Record<string, never> = {}
      let cur = s
      for (const op of ops) {
        if (!cur.byKey[op.key]) continue
        out = patch(cur as MessagesState, op.key, (w) => ({ msgs: applyOp(w.msgs, op) }))
        cur = { ...cur, ...out }
      }
      return out
    }),

  setPoll: (chatId, poll) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.poll?.id === poll.id)
          ? w.msgs.map((m) => (m.poll?.id === poll.id ? { ...m, poll } : m))
          : null,
      )),

  applyChecklistUpdate: (chatId, checklist) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.checklist?.id === checklist.id)
          ? w.msgs.map((m) => (m.checklist?.id === checklist.id ? { ...m, checklist } : m))
          : null,
      )),

  setGiveaway: (chatId, giveaway) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.giveaway?.id === giveaway.id)
          ? w.msgs.map((m) => (m.giveaway?.id === giveaway.id ? { ...m, giveaway } : m))
          : null,
      )),

  applyEdit: (chatId, msgId, text, editedAt, entities, replyMarkup) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) =>
              m.id === msgId
                ? { ...m, text, editedAt, entities, ...(replyMarkup !== undefined ? { replyMarkup: replyMarkup ?? undefined } : {}) }
                : m,
            )
          : null,
      )),

  applyGeoLive: (chatId, msgId, geo) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, geo } : m))
          : null,
      )),

  applyFactCheck: (chatId, msgId, factCheck) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, factCheck } : m))
          : null,
      )),

  applyDelete: (chatId, msgId) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId) ? w.msgs.filter((m) => m.id !== msgId) : null,
      )),

  patchViews: (chatId, views) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        // Only rebuild rows whose count actually changed, so unaffected bubbles keep
        // their reference (memoized rows don't re-render).
        w.msgs.some((m) => views.has(m.id) && views.get(m.id) !== m.views)
          ? w.msgs.map((m) => (views.has(m.id) && views.get(m.id) !== m.views ? { ...m, views: views.get(m.id) } : m))
          : null,
      )),

  applyReaction: (chatId, msgId, counts, myEmoji, myAction) =>
    set((s) =>
      patchChat(s, chatId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        let changed = false
        const msgs = w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const next = setReactions(m.reactions, counts, myEmoji, myAction)
          if (sameReactions(m.reactions, next)) return m
          changed = true
          return { ...m, reactions: next }
        })
        return changed ? msgs : null
      })),

  applyReactionOptimistic: (chatId, msgId, emoji, action, me) =>
    set((s) =>
      patchChat(s, chatId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        let changed = false
        const msgs = w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const next = reactionDelta(m.reactions, emoji, action, true, me)
          if (next === null) return m
          changed = true
          return { ...m, reactions: next }
        })
        return changed ? msgs : null
      })),

  applyStarReaction: (chatId, msgId, total, mine) =>
    set((s) =>
      patchChat(s, chatId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        return w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const nextMine = mine !== undefined ? mine : (m.starReaction?.mine ?? 0)
          return { ...m, starReaction: { total, mine: nextMine } }
        })
      })),
}))
