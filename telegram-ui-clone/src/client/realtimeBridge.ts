// src/client/realtimeBridge.ts
import { startClient } from './bootstrap'
import { loadChats, useChatsStore } from '../stores/chatsStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { RT, type NewMessageEvt, type ReadEvt, type PresenceEvt, type TypingEvt } from '../core/realtime/events'
import { playMessageSent, playIncoming } from '../core/audio/sounds'

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
    store.applyNewMessage(evt)
    uiEvents.emit(RT.newMessage, m)
    // Incoming-notification sound, gated like tweb: someone else's message that
    // isn't in the currently-open chat and isn't from a muted dialog.
    const s = useChatsStore.getState()
    const incoming = evt.sender_id !== s.meId
    const muted = s.dialogs.find((d) => d.chatId === evt.chat_id)?.muted
    if (incoming && s.activeChatId !== evt.chat_id && !muted) playIncoming()
  })
  smp.on(RT.read, (r) => { store.applyRead(r as ReadEvt); uiEvents.emit(RT.read, r) })
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
  smp.on(RT.editMessage, (e) => uiEvents.emit(RT.editMessage, e))
  smp.on(RT.deleteMessage, (e) => uiEvents.emit(RT.deleteMessage, e))
  smp.on(RT.pinMessage, (e) => uiEvents.emit(RT.pinMessage, e))
  smp.on(RT.reaction, (r) => uiEvents.emit(RT.reaction, r))
  smp.on(RT.ack, (a) => {
    uiEvents.emit(RT.ack, a)
    // Server confirmed one of our sends → the "pak" (tweb's message_sent).
    playMessageSent()
  })
  smp.on(RT.messageError, (e) => uiEvents.emit(RT.messageError, e))
  smp.on('rt:resync', () => { void loadChats(managers) })

  void managers.realtime.start()
}
