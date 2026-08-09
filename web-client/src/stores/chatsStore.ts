// src/stores/chatsStore.ts
import { create } from 'zustand'
import type { Dialog } from '../core/models'
import type { User } from '../core/managers/authManager'
import type { ChatUpdateEvt, NewMessageEvt, ReadEvt, PresenceEvt, TypingAction } from '../core/realtime/events'
import { reconcileById } from '../core/store/reconcile'

// Per-chat typing state: chatId -> userId -> {action, at}. `at` is the event
// timestamp (ms) so stale entries can be ignored; entries are also actively
// cleared on a timer / when the user sends a message.
export interface TypingEntry { action: TypingAction; at: number }
export type ChatTyping = Record<number, TypingEntry>

interface ChatsState {
  dialogs: Dialog[]
  me: User | null
  meId: number | null
  loaded: boolean
  activeChatId: number | null
  presence: Record<number, { online: boolean; lastSeen: number }>
  typing: Record<number, ChatTyping>
  setDialogs: (d: Dialog[]) => void
  /** meId выводится из me (единый писатель) — отдельного setMeId нет, чтобы id и
   * профиль не расходились. */
  setMe: (u: User | null) => void
  upsertDialog: (d: Dialog) => void
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

export const useChatsStore = create<ChatsState>((set) => ({
  dialogs: [],
  me: null,
  meId: null,
  loaded: false,
  activeChatId: null,
  presence: {},
  typing: {},
  setDialogs: (dialogs) => set({ dialogs, loaded: true }),
  setMe: (me) => set({ me, meId: me?.id ?? null }),
  upsertDialog: (d) =>
    set((s) => {
      const idx = s.dialogs.findIndex((x) => x.chatId === d.chatId)
      if (idx === -1) return { dialogs: [d, ...s.dialogs] }
      const next = s.dialogs.slice()
      next[idx] = d
      return { dialogs: next }
    }),
  setActiveChat: (activeChatId) => set({ activeChatId }),
  setDialogMuted: (chatId, muted) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      next[idx] = { ...next[idx], muted }
      return { dialogs: next }
    }),
  setDialogTheme: (chatId, themeId) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      next[idx] = { ...next[idx], themeId: themeId || undefined }
      return { dialogs: next }
    }),
  // Закрепить/открепить: пин ставит диалог первым (свежий пин — выше, tweb),
  // анпин возвращает на место по дате последнего сообщения среди незакреплённых.
  setDialogPinned: (chatId, pinned) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const d = { ...s.dialogs[idx], pinned }
      const rest = s.dialogs.filter((_, i) => i !== idx)
      if (pinned) return { dialogs: [d, ...rest] }
      const at = d.lastMessage?.at ?? ''
      let insert = rest.length
      for (let i = 0; i < rest.length; i++) {
        if (!rest[i].pinned && (rest[i].lastMessage?.at ?? '') <= at) {
          insert = i
          break
        }
      }
      return { dialogs: [...rest.slice(0, insert), d, ...rest.slice(insert)] }
    }),
  // В архив / из архива; пин при переносе сбрасывается (как на бэке).
  setDialogArchived: (chatId, archived) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      next[idx] = { ...next[idx], archived, pinned: false }
      return { dialogs: next }
    }),
  // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
  removeDialog: (chatId) =>
    set((s) => ({
      dialogs: s.dialogs.filter((d) => d.chatId !== chatId),
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
      const idx = s.dialogs.findIndex((d) => d.chatId === m.chat_id)
      if (idx === -1) return {} // чата нет в списке — приедет со следующей загрузкой
      const next = s.dialogs.slice()
      // Пишем только те поля, что реально пришли в снимке: '' и null — это
      // «сброшено» (снимок абсолютный), отсутствие ключа — «не про это событие».
      next[idx] = {
        ...s.dialogs[idx],
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
      // Через реконсайл (Task 1): совпавший с памятью снимок вернёт ИСХОДНЫЙ массив,
      // ссылки соседних диалогов не меняются — перерисуется только эта строка.
      // Порядок берётся из `next`, а метаданные на сортировку не влияют, поэтому он
      // сохраняется; когда появится общий `applyDialogs`, переключить сюда его.
      return { dialogs: reconcileById(s.dialogs, next, (d) => d.chatId).list }
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
      const idx = s.dialogs.findIndex((d) => d.chatId === m.chat_id)
      if (idx === -1) return {} // unknown chat (will surface on next dialog reload)
      const d = s.dialogs[idx]
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
      const rest = s.dialogs.filter((_, i) => i !== idx)
      // A message from a user clears their typing indicator in that chat.
      let typing = s.typing
      const chatTyping = typing[m.chat_id]
      if (chatTyping && m.sender_id in chatTyping) {
        const next = { ...chatTyping }
        delete next[m.sender_id]
        typing = { ...typing, [m.chat_id]: next }
      }
      // Закреплённые не двигаются: свой пин-порядок держит их сверху; обычный
      // диалог с новым сообщением встаёт сразу после блока закреплённых.
      if (updated.pinned) {
        const inPlace = s.dialogs.slice()
        inPlace[idx] = updated
        return { dialogs: inPlace, typing }
      }
      let firstUnpinned = rest.length
      for (let i = 0; i < rest.length; i++) {
        if (!rest[i].pinned) {
          firstUnpinned = i
          break
        }
      }
      return { dialogs: [...rest.slice(0, firstUnpinned), updated, ...rest.slice(firstUnpinned)], typing }
    }),
  applyRead: (r) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === r.chat_id)
      if (idx === -1) return {}
      const cur = s.dialogs[idx]
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
      const next = s.dialogs.slice()
      next[idx] = updated
      return { dialogs: next }
    }),
  bumpUnreadReactions: (chatId, count) =>
    set((s) => {
      const idx = s.dialogs.findIndex((d) => d.chatId === chatId)
      if (idx === -1) return {}
      const next = s.dialogs.slice()
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : (next[idx].unreadReactions ?? 0) + 1
      next[idx] = { ...next[idx], unreadReactions: value }
      return { dialogs: next }
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
