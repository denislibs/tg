// src/client/realtimeBridge.ts
import { startClient } from './bootstrap'
import { loadChats, useChatsStore } from '../stores/chatsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { usePinsStore } from '../stores/pinsStore'
import { useDiscussionStore, threadKey } from '../stores/discussionStore'
import { mapMessage } from '../core/models'
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt, type ReadEvt, type MediaReadEvt, type PresenceEvt, type TypingEvt, type AckEvt, type MessageErrorEvt, type EditMessageEvt, type DeleteMessageEvt, type PinMessageEvt, type CallFrameEvt } from '../core/realtime/events'
import { playMessageSent, playIncoming } from '../core/audio/sounds'
import * as callEngine from '../core/calls/callEngine'

let started = false

// A typing indicator with no follow-up clears itself after this long (the server
// emits no "stopped typing" frame; the client re-sends every ~3s while active).
const TYPING_TTL = 6000
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Subscribe to worker realtime events exactly once per page.
export function startRealtime(): void {
  if (started) return
  started = true
  const { smp, managers } = startClient()
  const store = useChatsStore.getState()

  smp.on(RT.newMessage, (m) => {
    const evt = m as NewMessageEvt
    store.applyNewMessage(evt) // dialog-list preview (chatsStore)
    // Append to the chat's message window (single source of truth). Resolve the
    // reply preview from the already-loaded window so a reply shows its quote
    // immediately (applyIncoming no-ops if the window isn't loaded). markRead /
    // unread-below is decided in ConversationView (it needs scroll/focus state).
    const ms = useMessagesStore.getState()
    const rt = evt.reply_to_id != null ? ms.byChat[evt.chat_id]?.msgs.find((x) => x.id === evt.reply_to_id) : undefined
    const replyTo = rt ? { msg_id: rt.id, seq: rt.seq, sender_id: rt.senderId, text: rt.text, type: rt.type } : null
    ms.applyIncoming(evt.chat_id, mapMessage({ id: evt.msg_id, chat_id: evt.chat_id, seq: evt.seq, sender_id: evt.sender_id, type: evt.type, text: evt.text, entities: evt.entities ?? null, reply_to_id: evt.reply_to_id ?? null, media_id: evt.media_id, created_at: evt.created_at, fwd_from_user_id: evt.fwd_from_user_id ?? null, fwd_from_chat_id: evt.fwd_from_chat_id ?? null, fwd_from_msg_id: evt.fwd_from_msg_id ?? null, fwd_date: evt.fwd_date ?? null, reply_to: replyTo, media_unread: evt.media_unread }))
    // Discussion-thread comment: route into the discussion store (no-op unless
    // that thread is currently open). The View reads its slice via a selector.
    if (evt.thread_root_id != null) {
      useDiscussionStore.getState().appendLive(threadKey(evt.chat_id, evt.thread_root_id), {
        id: evt.msg_id, senderId: evt.sender_id, text: evt.text, createdAt: evt.created_at,
      })
    }
    uiEvents.emit(RT.newMessage, m)
    // Incoming-notification sound, gated like tweb: someone else's message that
    // isn't in the currently-open chat and isn't from a muted dialog.
    const s = useChatsStore.getState()
    const incoming = evt.sender_id !== s.meId
    const muted = s.dialogs.find((d) => d.chatId === evt.chat_id)?.muted
    if (incoming && s.activeChatId !== evt.chat_id && !muted) playIncoming()
  })
  smp.on(RT.read, (r) => { store.applyRead(r as ReadEvt); uiEvents.emit(RT.read, r) })
  smp.on(RT.mediaRead, (raw) => {
    const e = raw as MediaReadEvt
    useMessagesStore.getState().applyMediaRead(e.chat_id, e.msg_id)
  })
  smp.on(RT.presence, (p) => { store.setPresence(p as PresenceEvt); uiEvents.emit(RT.presence, p) })
  smp.on(RT.typing, (raw) => {
    const t = raw as TypingEvt
    const action = t.action ?? 'typing'
    store.setTyping(t.chat_id, t.user_id, action, Date.now())
    const key = `${t.chat_id}:${t.user_id}`
    const prev = typingTimers.get(key)
    if (prev) clearTimeout(prev)
    typingTimers.set(
      key,
      setTimeout(() => {
        typingTimers.delete(key)
        store.clearTyping(t.chat_id, t.user_id)
      }, TYPING_TTL),
    )
    uiEvents.emit(RT.typing, t)
  })
  // Edit/delete carry chat_id → apply straight to that chat's message window.
  smp.on(RT.editMessage, (raw) => {
    const e = raw as EditMessageEvt
    useMessagesStore.getState().applyEdit(e.chat_id, e.msg_id, e.text, e.edited_at, e.entities ?? undefined)
  })
  smp.on(RT.deleteMessage, (raw) => {
    const e = raw as DeleteMessageEvt
    useMessagesStore.getState().applyDelete(e.chat_id, e.msg_id)
  })
  // Pin/unpin: refetch the chat's pins and write them to the store (the only
  // socket subscription for pins — usePinnedBar just reads the store).
  smp.on(RT.pinMessage, (raw) => {
    const e = raw as PinMessageEvt
    void managers.messages.listPins(e.chat_id).then((p) => usePinsStore.getState().setPins(e.chat_id, p))
  })
  smp.on(RT.reaction, (r) => uiEvents.emit(RT.reaction, r))
  // Ack/error carry only client_msg_id → reconcile by clientMsgId (store maps it to the chat).
  smp.on(RT.ack, (raw) => {
    const a = raw as AckEvt
    useMessagesStore.getState().reconcileAckByClient(a.client_msg_id, { msgId: a.msg_id, seq: a.seq, createdAt: a.created_at })
    // Server confirmed one of our sends → the "pak" (tweb's message_sent).
    playMessageSent()
  })
  smp.on(RT.messageError, (raw) => {
    useMessagesStore.getState().failOptimisticByClient((raw as MessageErrorEvt).client_msg_id)
  })
  // 1:1 call signaling → движок звонка (стейт живёт в callStore)
  smp.on(RT.call, (raw) => { callEngine.handleFrame(raw as CallFrameEvt) })
  smp.on('rt:resync', () => { void loadChats(managers) })

  void managers.realtime.start()
}
