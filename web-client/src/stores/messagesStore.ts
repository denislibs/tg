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
import type { Message, MessageEntity, Poll, Checklist, Giveaway, GeoData, WebPageData, FactCheck, ReactionCount } from '../core/models'
import type { ReplyMarkup } from '../core/managers/botsManager'
import { reactionDelta } from '../core/reactionDelta'

// Ключ окна: основное окно чата или тред (форум-топик / комментарии).
export const winKey = (chatId: number, threadRootId?: number | null): string =>
  threadRootId ? `${chatId}:${threadRootId}` : String(chatId)

// Локальные данные файла для мгновенного оптимистичного медиабабла.
export interface OptimisticMedia {
  localUrl?: string
  width?: number
  height?: number
  mime?: string
  size?: number
  name?: string
}

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

// Reverse index clientMsgId -> window key. An ack/error frame carries only the
// client_msg_id (no chat_id), so realtimeBridge resolves the window through this.
// Wave 3: бабл матчится по clientId напрямую (эхо new_message несёт client_msg_id),
// поэтому tentative-seq индекс больше не нужен — остался только этот reverse-индекс.
const clientToWin = new Map<string, string>()

// Ключ дедупа: оптимистичный бабл (временный id < 0, ещё не сверен с сервером)
// ключуется по clientId — его seq лишь выдумка клиента (appendOptimistic:
// maxSeq + 1) для порядка внизу окна, не настоящая позиция в истории чата.
// Серверные сообщения (включая уже сверенные баблы — reconcileAck переставляет
// id на положительный) по-прежнему ключуются по seq. Так пространства ключей не
// пересекаются: чужое входящее с тем же tentativeSeq, что и у бабла, не может
// вытеснить его из Map (Task 5 — до фикса dedupAsc ключевал всё по seq, и
// последний вставленный побеждал, молча стирая бабл без ack/error).
function dedupKey(m: Message): string {
  return m.clientId && m.id < 0 ? `c:${m.clientId}` : `s:${m.seq}`
}

function dedupAsc(list: Message[]): Message[] {
  const byKey = new Map<string, Message>()
  for (const m of list) byKey.set(dedupKey(m), m)
  return Array.from(byKey.values()).sort((a, b) => a.seq - b.seq)
}

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
  appendOptimistic: (key: string, text: string, meId: number, clientMsgId: string, mediaId?: number, type?: string, entities?: MessageEntity[], groupedId?: string, media?: OptimisticMedia, extra?: { geo?: { lat: number; lng: number }; contact?: { userId: number; name: string; phone: string }; threadRootId?: number; secret?: boolean; sendAs?: { chatId: number; title: string; photoId?: number } }) => void
  /** Аплоад завершён — проставить оптимистичному сообщению серверный media_id. */
  setOptimisticMedia: (key: string, clientMsgId: string, mediaId: number) => void
  reconcileAck: (key: string, clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimistic: (key: string, clientMsgId: string) => void
  /** Reconcile/fail by clientMsgId alone (ack/error frames carry no chat_id). */
  reconcileAckByClient: (clientMsgId: string, ack: { msgId: number; seq: number; createdAt: string }) => void
  failOptimisticByClient: (clientMsgId: string) => void
  /** Failed bubble → back to 'sending' before the send is retried. */
  retryOptimistic: (key: string, clientMsgId: string) => void
  /** Drop a failed optimistic bubble entirely (user chose «delete»). */
  removeOptimistic: (key: string, clientMsgId: string) => void
  /** То же по одному clientMsgId (отмена аплоада с бабла — окно ищем сами). */
  removeOptimisticByClient: (clientMsgId: string) => void
  /** Новое сообщение чата: в основное окно + в окно своего треда (если открыто). */
  applyIncoming: (chatId: number, m: Message) => void
  applyEdit: (chatId: number, msgId: number, text: string, editedAt: string, entities?: MessageEntity[], replyMarkup?: ReplyMarkup | null) => void
  applyGeoLive: (chatId: number, msgId: number, geo: GeoData) => void
  /** Догоняющее серверное превью ссылки (web_page_update) → карточка web page. */
  applyWebPage: (chatId: number, msgId: number, webPage: WebPageData) => void
  /** «Проверка фактов» прикреплена/изменена/снята (factcheck_update). undefined — снята. */
  applyFactCheck: (chatId: number, msgId: number, factCheck: FactCheck | undefined) => void
  /** Платное медиа разблокировано (paid_media_unlock) → раскрываем баббл: полное
   * медиа + снятый флаг locked приезжают в готовом сообщении. */
  applyPaidUnlock: (chatId: number, msg: Message) => void
  applyDelete: (chatId: number, msgId: number) => void
  /** Голосовое/кружок прослушано → точка media_unread гаснет (обе стороны). */
  applyMediaRead: (chatId: number, msgId: number) => void
  /** Patch channel-post view counts from a per-open view_counts fetch. */
  patchViews: (chatId: number, views: Map<number, number>) => void
  /** Live-агрегаты опроса (poll_update): свой выбор (myVotes) сохраняем локальный. */
  applyPollUpdate: (chatId: number, poll: Poll) => void
  /** Полная замена опроса сообщения (ответ на свой голос — с myVotes). */
  setPoll: (chatId: number, poll: Poll) => void
  /** Обновление чек-листа (checklist_update / ответ на toggle/add): отметки
   * глобальны (видно, кто отметил) — локального состояния нет, полная замена. */
  applyChecklistUpdate: (chatId: number, checklist: Checklist) => void
  /** Live-статус розыгрыша (giveaway_update): своё участие сохраняем локально. */
  applyGiveawayUpdate: (chatId: number, giveaway: Giveaway) => void
  /** Полная замена розыгрыша (ответ на своё участие — с participating/iWon). */
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

export const useMessagesStore = create<MessagesState>((set, get) => ({
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

  appendOptimistic: (key, text, meId, clientMsgId, mediaId, type = 'text', entities, groupedId, media, extra) =>
    set((s) =>
      patch(s, key, (w) => {
        // tentativeSeq лишь упорядочивает бабл внизу окна (dedupAsc сортирует по seq);
        // reconcile матчит по clientId, не по этому seq.
        const maxSeq = w.msgs.length ? w.msgs[w.msgs.length - 1].seq : 0
        const tentativeSeq = maxSeq + 1
        clientToWin.set(clientMsgId, key)
        const tmp: Message = {
          id: -Date.now(), chatId: Number(key.split(':')[0]), seq: tentativeSeq, senderId: meId, type, text, entities,
          replyToId: null, mediaId: mediaId ?? null, createdAt: new Date().toISOString(),
          threadRootId: extra?.threadRootId ?? null, groupedId: groupedId ?? null, clientId: clientMsgId,
          // локальное превью + размеры файла: бабл появляется сразу, до аплоада
          localUrl: media?.localUrl,
          mediaWidth: media?.width, mediaHeight: media?.height,
          mediaMime: media?.mime, mediaSize: media?.size, mediaName: media?.name,
          // сервер ставит media_unread на voice/roundVideo — отразить сразу в
          // оптимистичном бабле, чтобы точка не «моргала» после ack
          mediaUnread: type === 'voice' || type === 'roundVideo' || undefined,
          // гео/контакт: бабл рисуется сразу из локальных данных, до ack
          geo: extra?.geo,
          contact: extra?.contact,
          // секретный чат: плейнтекст локально, бабл сразу помечается secret
          secret: extra?.secret,
          // send-as: бабл сразу от имени выбранной личности (канал/группа),
          // иначе свежий бабл показывался бы как «от себя» до reconcile.
          sendAs: extra?.sendAs,
        }
        return { msgs: dedupAsc([...w.msgs, tmp]) }
      }),
    ),

  setOptimisticMedia: (key, clientMsgId, mediaId) =>
    set((s) =>
      patch(s, key, (w) => ({
        msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, mediaId } : m)),
      })),
    ),

  // Wave 3: матч по clientId (не по фабричному tentative seq). Идемпотентно, если
  // echo new_message уже сверил бабл раньше (ack-then-echo/echo-then-ack — оба
  // порядка сходятся на одном бабле, без дубля).
  reconcileAck: (key, clientMsgId, ack) =>
    set((s) => {
      clientToWin.delete(clientMsgId)
      const w = s.byKey[key]
      if (!w || !w.msgs.some((m) => m.clientId === clientMsgId)) return {}
      return patch(s, key, (win) => ({
        msgs: dedupAsc(
          win.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, id: ack.msgId, seq: ack.seq, createdAt: ack.createdAt } : m)),
        ),
      }))
    }),

  // Rejected send: keep the bubble with a red error mark (tweb sendingerror) —
  // the user decides to retry or delete it. The pending maps stay so a later
  // retry's ack can still reconcile the same bubble.
  failOptimistic: (key, clientMsgId) =>
    set((s) => patch(s, key, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: true } : m)),
    }))),

  retryOptimistic: (key, clientMsgId) =>
    set((s) => patch(s, key, (w) => ({
      msgs: w.msgs.map((m) => (m.clientId === clientMsgId ? { ...m, failed: undefined } : m)),
    }))),

  removeOptimistic: (key, clientMsgId) =>
    set((s) => {
      clientToWin.delete(clientMsgId)
      return patch(s, key, (w) => ({ msgs: w.msgs.filter((m) => m.clientId !== clientMsgId) }))
    }),

  reconcileAckByClient: (clientMsgId, ack) => {
    const key = clientToWin.get(clientMsgId)
    if (key !== undefined) get().reconcileAck(key, clientMsgId, ack)
  },

  failOptimisticByClient: (clientMsgId) => {
    const key = clientToWin.get(clientMsgId)
    if (key !== undefined) get().failOptimistic(key, clientMsgId)
  },

  removeOptimisticByClient: (clientMsgId) => {
    const key = clientToWin.get(clientMsgId)
    if (key !== undefined) get().removeOptimistic(key, clientMsgId)
  },

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

  applyPollUpdate: (chatId, poll) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.poll?.id === poll.id)
          ? w.msgs.map((m) => (m.poll?.id === poll.id ? { ...m, poll: { ...poll, myVotes: m.poll.myVotes } } : m))
          : null,
      )),

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

  applyGiveawayUpdate: (chatId, giveaway) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.giveaway?.id === giveaway.id)
          ? w.msgs.map((m) =>
              m.giveaway?.id === giveaway.id
                ? { ...m, giveaway: { ...giveaway, participating: m.giveaway.participating, iWon: m.giveaway.iWon } }
                : m,
            )
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

  applyWebPage: (chatId, msgId, webPage) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, webPage } : m))
          : null,
      )),

  applyFactCheck: (chatId, msgId, factCheck) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, factCheck } : m))
          : null,
      )),

  applyPaidUnlock: (chatId, msg) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msg.id)
          ? w.msgs.map((m) =>
              m.id === msg.id
                ? {
                    ...m,
                    mediaId: msg.mediaId,
                    mediaWidth: msg.mediaWidth,
                    mediaHeight: msg.mediaHeight,
                    mediaMime: msg.mediaMime,
                    mediaBlur: msg.mediaBlur,
                    mediaHasThumb: msg.mediaHasThumb,
                    mediaDuration: msg.mediaDuration,
                    mediaSize: msg.mediaSize,
                    mediaName: msg.mediaName,
                    paidMedia: msg.paidMedia,
                  }
                : m,
            )
          : null,
      )),

  applyDelete: (chatId, msgId) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId) ? w.msgs.filter((m) => m.id !== msgId) : null,
      )),

  applyMediaRead: (chatId, msgId) =>
    set((s) =>
      patchChat(s, chatId, (w) =>
        w.msgs.some((m) => m.id === msgId && m.mediaUnread)
          ? w.msgs.map((m) => (m.id === msgId ? { ...m, mediaUnread: false } : m))
          : null,
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
