// src/core/realtime/connectionManager.ts
import type { WsClient } from '../net/wsClient'
import type { ConnState } from './events'
import type { MessageEntity } from '../models'

export interface SendArgs { chatId: number; text: string; entities?: MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; mediaId?: number | null; type?: string }

export interface CMDeps {
  ws: WsClient
  getToken: () => string | null
  onReady: () => void
  onState: (s: ConnState) => void
  onFrame: (type: string, payload: unknown) => void // new_message/read/typing/presence/reaction/message_ack
  /** Durable outbox storage (IndexedDB in the worker): unacked sends survive a
   * page reload and are resent on the next connect. */
  outboxStore?: { load: () => Promise<SendArgs[] | undefined>; save: (list: SendArgs[]) => void }
  now?: () => number
}

const HEARTBEAT_MS = 20_000
const PONG_GRACE = 2 // missed pongs before force-reconnect
const MAX_BACKOFF = 30_000
const FRAME_TYPES = ['new_message', 'edit_message', 'delete_message', 'pin_message', 'read', 'typing', 'presence', 'reaction', 'message_ack', 'message_error', 'pong']

export function newConnectionManager({ ws, getToken, onReady, onState, onFrame, outboxStore }: CMDeps) {
  const outbox = new Map<string, SendArgs>()
  const persistOutbox = () => { outboxStore?.save([...outbox.values()]) }
  // Restore unacked sends from the previous session; entries queued this session
  // win (restored ones never overwrite fresh ones with the same clientMsgId).
  let outboxRestored = !outboxStore
  const outboxRestoredP = outboxStore
    ? outboxStore.load().then((list) => {
        for (const m of list ?? []) if (!outbox.has(m.clientMsgId)) outbox.set(m.clientMsgId, m)
      }).catch(() => {}).finally(() => { outboxRestored = true })
    : null
  let state: ConnState = 'offline'
  let attempt = 0
  let hbTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let missedPongs = 0
  let wired = false

  const setState = (s: ConnState) => { state = s; onState(s) }

  function wireOnce() {
    if (wired) return
    wired = true
    ws.onOpen(() => {
      attempt = 0; missedPongs = 0
      setState('ready')
      startHeartbeat()
      // resend unacked (incl. entries restored from the durable store); sync when
      // the restore already finished (or there is no store) — first connect only
      // waits for the async IndexedDB load.
      const resend = () => { for (const m of outbox.values()) sendFrame(m) }
      if (outboxRestored) resend()
      else void outboxRestoredP?.then(() => { if (ws.isOpen()) resend() })
      onReady()
    })
    ws.onClose(() => { stopHeartbeat(); if (state !== 'offline') scheduleReconnect() })
    ws.onError(() => { /* onClose will follow */ })
    for (const t of FRAME_TYPES) {
      ws.on(t, (d) => {
        if (t === 'pong') { missedPongs = 0; return }
        if (t === 'message_ack') { const id = (d as { client_msg_id?: string })?.client_msg_id; if (id) { outbox.delete(id); persistOutbox() } }
        // A rejected send (e.g. too long): drop it from the outbox so it isn't
        // resent forever on every reconnect; the UI marks the bubble failed.
        if (t === 'message_error') { const id = (d as { client_msg_id?: string })?.client_msg_id; if (id) { outbox.delete(id); persistOutbox() } }
        onFrame(t, d)
      })
    }
  }

  function startHeartbeat() {
    stopHeartbeat()
    hbTimer = setInterval(() => {
      if (++missedPongs > PONG_GRACE) { ws.close(); return } // triggers onClose→reconnect
      ws.send('ping')
    }, HEARTBEAT_MS)
  }
  function stopHeartbeat() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null } }

  function scheduleReconnect() {
    setState('reconnecting')
    const base = Math.min(MAX_BACKOFF, 500 * 2 ** attempt++)
    const delay = base / 2 + Math.floor(Math.random() * (base / 2 + 1)) // jitter
    reconnectTimer = setTimeout(connect, delay)
  }

  function connect() {
    const token = getToken()
    if (!token) { setState('offline'); return }
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting')
    wireOnce()
    ws.connect(token)
  }

  function sendFrame(m: SendArgs) {
    ws.send('send_message', { chat_id: m.chatId, type: m.type ?? 'text', text: m.text, entities: m.entities ?? null, client_msg_id: m.clientMsgId, reply_to_id: m.replyToId ?? null, media_id: m.mediaId ?? null })
  }

  return {
    start() { if (state === 'offline') connect() },
    stop() { if (reconnectTimer) clearTimeout(reconnectTimer); stopHeartbeat(); state = 'offline'; ws.close() },
    state: () => state,
    outboxSize: () => outbox.size,
    sendMessage(m: SendArgs) { outbox.set(m.clientMsgId, m); persistOutbox(); if (ws.isOpen()) sendFrame(m) },
    markRead(chatId: number, upToSeq: number) { if (ws.isOpen()) ws.send('read', { chat_id: chatId, up_to_seq: upToSeq }) },
    sendTyping(chatId: number, action: 'typing' | 'voice' | 'video' = 'typing') { if (ws.isOpen()) ws.send('typing', { chat_id: chatId, action }) },
    subscribeChannel(chatId: number) { if (ws.isOpen()) ws.send('subscribe_channel', { chat_id: chatId }) },
    unsubscribeChannel(chatId: number) { if (ws.isOpen()) ws.send('unsubscribe_channel', { chat_id: chatId }) },
  }
}

export type ConnectionManager = ReturnType<typeof newConnectionManager>
