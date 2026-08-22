// src/stores/messagesStore.ts
//
// Normalized message windows, single-sourced in a store so that (a) realtimeBridge
// can apply server frames to a chat even when it isn't open, and (b) the window
// survives a Chat unmount. `useMessageWindow` is a thin selector/
// actions wrapper over this store and keeps the same shape.
//
// Окна ключуются чатом ИЛИ тредом чата (tweb: history по threadId): "peerId" —
// основное окно, "peerId:root" — окно форум-топика/комментариев. Live-события
// с peer_id применяются ко ВСЕМ окнам этого чата (applyToChat), новое сообщение
// с thread_root_id попадает и в основное окно, и в окно своего треда.
import { create } from 'zustand'
import { getThreadRootId, type MyMessage, type MessageReal, type MessageEntity, type FactCheck, type ReactionCount } from '../core/models'
import type { MessageMedia, MessageMediaPoll, MessageMediaToDo } from '../core/media/messageMedia'
import type { ReplyMarkup } from '../core/markup/replyMarkup'
import { reactionDelta } from '../core/reactionDelta'
import { dedupAsc, applyOp, type MessageOp } from '../core/realtime/messageOps'
import { winKey } from '../core/history/messagesMirror'

// Ключ окна: основное окно чата или тред (форум-топик / комментарии).
// Определение переехало в `core/history/messagesMirror` — ключ принадлежит окну,
// а не его zustand-копии, и этот стор уходит вместе с React-лентой (этап 7).
// Реэкспорт — чтобы существующие импорты `@stores/messagesStore` не разъехались.
export { winKey }

export interface ChatWindow {
  msgs: MyMessage[]
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

// Абсолютный агрегат сервера поверх окна. `mine` берётся ИЗ ОКНА: кадр помечен
// `pFlags.min` — пер-зрительской части в общем теле нет, и «сервер не сообщил»
// это не «я не ставил». Прежде сюда ехали ещё два внешних сигнала (мой эмодзи и
// действие), которых в самом агрегате не было вовсе, — они ушли вместе с диффом.
function setReactions(
  prev: ReactionCount[] | undefined,
  counts: ReactionCount[],
): ReactionCount[] | undefined {
  const prevMine = new Set((prev ?? []).filter((r) => r.mine).map((r) => r.emoji))
  const next = counts.map((c) => ({ ...c, mine: prevMine.has(c.emoji) }))
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
  setWindow: (key: string, w: { msgs: MyMessage[]; reachedTop: boolean; reachedBottom: boolean; cached?: boolean }) => void
  setLoadingOlder: (key: string, v: boolean) => void
  setLoadingNewer: (key: string, v: boolean) => void
  prepend: (key: string, msgs: MyMessage[], reachedTop: boolean) => void
  append: (key: string, msgs: MyMessage[], reachedBottom: boolean) => void
  appendLocal: (key: string, m: MyMessage) => void
  /** Новое сообщение чата: в основное окно + в окно своего треда (если открыто). */
  applyIncoming: (peerId: number, m: MyMessage) => void
  /** Stage 1B.2 (Task 4): переигрывает операции воркера (rt:message_op) поверх
   * окон — единственный писатель окна для входящих сообщений (заменяет прямой
   * вызов applyIncoming из RT.newMessage). Окно, не загруженное на этой вкладке
   * (`!byKey[op.key]`), пропускается — та же гарантия, что и у applyIncoming
   * (иначе окно завелось бы «на лету» с одним сообщением вместо честного fetch). */
  applyOps: (ops: MessageOp[]) => void
  applyEdit: (peerId: number, msgId: number, message: string, editDate: number | undefined, entities?: MessageEntity[], replyMarkup?: ReplyMarkup | null) => void
  /** Живая трансляция подвинулась: вложение целиком (`messageMediaGeoLive`) плюс
   *  время обновления — оно же `edit_date` сообщения, своего времени у гео в
   *  схеме нет. */
  applyGeoLive: (peerId: number, msgId: number, media: MessageMedia, editDate: number | undefined) => void
  /** «Проверка фактов» прикреплена/изменена/снята (factcheck_update). undefined — снята. */
  applyFactCheck: (peerId: number, msgId: number, factcheck: FactCheck | undefined) => void
  applyDelete: (peerId: number, msgId: number) => void
  /** Patch channel-post view counts from a per-open view_counts fetch. */
  patchViews: (peerId: number, views: Map<number, number>) => void
  /** Полная замена вложения-опроса (ответ на свой голос — он несёт мой
   * `pFlags.chosen`, которого нет в общем кадре poll_update). Live-агрегат сюда
   * не идёт — окно правит операция patch (cachePoll → RT.messageOp → applyOps),
   * а выбор сохраняется слиянием патча (core/realtime/messageOps.ts).
   *
   * Розыгрышу такой пары БОЛЬШЕ НЕТ: участие уехало из вложения в отдельную
   * ручку, и локального состояния, ради которого стоял `setGiveaway`, не
   * осталось. */
  setPollMedia: (peerId: number, media: MessageMediaPoll) => void
  /** Обновление вложения-чек-листа (ответ на toggle/add): отметки глобальны
   * (видно, кто отметил) — локального состояния нет, полная замена. */
  setChecklistMedia: (peerId: number, media: MessageMediaToDo) => void
  /** АБСОЛЮТНЫЙ агрегат реакций (rt:reaction / catch-up): ставим counts verbatim,
   * `mine` сохраняем из окна — кадр помечен `pFlags.min`, пер-зрительской части
   * в нём нет. Идемпотентно на реплей (тот же агрегат → no-op).
   *
   * starTotal — платная ⭐-реакция ТОГО ЖЕ агрегата (чип reactionPaid), 0 значит
   * «платных нет». Отдельного кадра у неё не существует, поэтому и отдельного
   * применения быть не должно: половина агрегата утверждала бы, что другой
   * половины нет. Свой вклад звёздами сохраняется по той же причине, что `mine`. */
  applyReaction: (peerId: number, msgId: number, counts: ReactionCount[], starTotal: number) => void
  /** Оптимистичный клик (дельта до эха, всегда моё действие): count±1 по emoji +
   * mine. Абсолютное эхо сервера следом перезапишет агрегат авторитетно. */
  applyReactionOptimistic: (
    peerId: number,
    msgId: number,
    emoji: string,
    action: 'add' | 'remove',
    /** КЛЮЧ зрителя — чтобы своя реакция сразу показала аватар, а не число
     *  (имя и фото чип берёт из зеркала пиров) */
    me?: PeerId,
  ) => void
  /** Платная ⭐-реакция ИЗ ОТВЕТА ручки: там известен и агрегат, и свой вклад.
   * Живое эхо приходит не сюда, а в applyReaction — кадром общей реакции. */
  applyStarReaction: (peerId: number, msgId: number, total: number, mine?: number) => void
}

/** Обычное сообщение, а не пилюля: у `messageService` нет ни текста, ни медиа,
 *  ни опроса — правки содержимого к ней просто неприменимы. */
const isReal = (m: MyMessage): m is MessageReal => m._ === 'message'

// Update a single window immutably.
function patch(
  state: MessagesState,
  key: string,
  fn: (w: ChatWindow) => Partial<ChatWindow>,
): Pick<MessagesState, 'byKey'> {
  const cur = state.byKey[key] ?? EMPTY_WINDOW
  return { byKey: { ...state.byKey, [key]: { ...cur, ...fn(cur) } } }
}

// Live-события несут только peer_id — применяем ко всем загруженным окнам
// этого чата (основное + треды). fn возвращает новый msgs или null (без изменений).
function patchChat(
  state: MessagesState,
  peerId: number,
  fn: (w: ChatWindow) => MyMessage[] | null,
): Pick<MessagesState, 'byKey'> | Record<string, never> {
  const prefix = String(peerId)
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

/**
 * Заменить ВЛОЖЕНИЕ у сообщений, чьё вложение опознал предикат. Ответ ручки
 * опроса и чек-листа адресует сообщение не номером, а идентификатором внутри
 * вложения — номера в ответе нет вовсе, как и в кадре.
 */
function setMediaWhere(
  state: MessagesState,
  peerId: number,
  match: (m: MessageReal) => boolean,
  media: MessageMedia,
): Pick<MessagesState, 'byKey'> | Record<string, never> {
  const hit = (m: MyMessage): boolean => isReal(m) && match(m)
  return patchChat(state, peerId, (w) =>
    w.msgs.some(hit) ? w.msgs.map((m) => (hit(m) ? { ...m, media } as MessageReal : m)) : null)
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

  applyIncoming: (peerId, m) =>
    set((s) => {
      // В основное окно чата И (для сообщения треда) в окно самого треда —
      // каждое только если загружено (иначе догрузится при открытии). Корень
      // треда живёт в `reply_to.reply_to_top_id`: отдельного поля в схеме нет.
      const root = getThreadRootId(m)
      const keys = root ? [winKey(peerId), winKey(peerId, root)] : [winKey(peerId)]
      let out: Pick<MessagesState, 'byKey'> | Record<string, never> = {}
      let cur = s
      for (const key of keys) {
        if (!cur.byKey[key]) continue
        // Семантика вставки (ack-then-echo, слияние с оптимистичным баблом по
        // random_id) живёт в ОДНОМ месте — `applyOp`. Второй экземпляр той же
        // семантики здесь и был бы вторым выводом одного факта.
        out = patch(cur as MessagesState, key, (w) => ({ msgs: applyOp(w.msgs, { op: 'insert', key, msg: m }) }))
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

  setPollMedia: (peerId, media) =>
    set((s) => setMediaWhere(s, peerId, (m) => m.media?._ === 'messageMediaPoll' && m.media.poll.id === media.poll.id, media)),

  setChecklistMedia: (peerId, media) =>
    set((s) => setMediaWhere(s, peerId, (m) => m.media?._ === 'messageMediaToDo' && m.media.todo.id === media.todo.id, media)),

  applyEdit: (peerId, msgId, message, editDate, entities, replyMarkup) =>
    set((s) =>
      patchChat(s, peerId, (w) =>
        w.msgs.some((m) => isReal(m) && m.id === msgId)
          ? w.msgs.map((m) =>
              isReal(m) && m.id === msgId
                ? { ...m, message, edit_date: editDate, entities, ...(replyMarkup !== undefined ? { reply_markup: replyMarkup ?? undefined } : {}) }
                : m,
            )
          : null,
      )),

  applyGeoLive: (peerId, msgId, media, editDate) =>
    set((s) =>
      patchChat(s, peerId, (w) =>
        w.msgs.some((m) => isReal(m) && m.id === msgId)
          ? w.msgs.map((m) => (isReal(m) && m.id === msgId ? { ...m, media, edit_date: editDate } : m))
          : null,
      )),

  applyFactCheck: (peerId, msgId, factcheck) =>
    set((s) =>
      patchChat(s, peerId, (w) =>
        w.msgs.some((m) => isReal(m) && m.id === msgId)
          ? w.msgs.map((m) => (isReal(m) && m.id === msgId ? { ...m, factcheck } : m))
          : null,
      )),

  applyDelete: (peerId, msgId) =>
    set((s) =>
      patchChat(s, peerId, (w) =>
        w.msgs.some((m) => m.id === msgId) ? w.msgs.filter((m) => m.id !== msgId) : null,
      )),

  patchViews: (peerId, views) =>
    set((s) =>
      patchChat(s, peerId, (w) =>
        // Only rebuild rows whose count actually changed, so unaffected bubbles keep
        // their reference (memoized rows don't re-render).
        w.msgs.some((m) => isReal(m) && views.has(m.id) && views.get(m.id) !== m.views)
          ? w.msgs.map((m) => (isReal(m) && views.has(m.id) && views.get(m.id) !== m.views ? { ...m, views: views.get(m.id) } : m))
          : null,
      )),

  applyReaction: (peerId, msgId, counts, starTotal) =>
    set((s) =>
      patchChat(s, peerId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        let changed = false
        const msgs = w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const next = setReactions(m.reactions, counts)
          const star = starTotal > 0 ? { total: starTotal, mine: m.starReaction?.mine ?? 0 } : undefined
          if (sameReactions(m.reactions, next) && (m.starReaction?.total ?? 0) === starTotal) return m
          changed = true
          return { ...m, reactions: next, starReaction: star }
        })
        return changed ? msgs : null
      })),

  applyReactionOptimistic: (peerId, msgId, emoji, action, me) =>
    set((s) =>
      patchChat(s, peerId, (w) => {
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

  applyStarReaction: (peerId, msgId, total, mine) =>
    set((s) =>
      patchChat(s, peerId, (w) => {
        if (!w.msgs.some((m) => m.id === msgId)) return null
        return w.msgs.map((m) => {
          if (m.id !== msgId) return m
          const nextMine = mine !== undefined ? mine : (m.starReaction?.mine ?? 0)
          return { ...m, starReaction: { total, mine: nextMine } }
        })
      })),
}))
