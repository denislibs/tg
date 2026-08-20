// src/core/realtime/connectionManager.ts
import type { Transport } from '../net/transport'
import type { ConnState, TypingAction } from './events'
import type { MessageEntity } from '../models'
import { FRAME_TYPES } from './eventCatalog'

export interface SendArgs { peerId: number; text: string; entities?: MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; replyToPeerId?: number | null; replyQuoteText?: string | null; replyQuoteOffset?: number | null; mediaId?: number | null; type?: string; groupedId?: number; geo?: { lat: number; lng: number; title?: string; address?: string; livePeriod?: number; heading?: number }; contactUserId?: number; threadRootId?: number | null; encBody?: string; ttlSeconds?: number | null; silent?: boolean; effect?: string | null; paidMediaPrice?: number | null; sendAsPeerId?: number | null; /** медиа скрыто спойлером — tweb sendFile({spoiler}) → inputMedia.pFlags.spoiler */ mediaSpoiler?: boolean }

export interface CMDeps {
  ws: Transport
  getToken: () => string | null
  onReady: () => void
  // retryAt — момент следующей попытки, читает витрина tweb connectionStatus.ts:114
  // (обратный отсчёт :150-158); производитель по таймеру — networker.ts:835-838
  // (checkConnectionRetryAt = Date.now() + delay → setConnectionStatus(Closed, …));
  // networker.ts:976 — сигнатура ПРИЁМНИКА setConnectionStatus(status, retryAt?, …),
  // не таймер. onClose тоже производит его — tcpObfuscated.ts:111-123
  // (setConnectionStatus(Closed, retryAt)).
  // Передаётся вторым аргументом ТОЛЬКО когда есть (scheduleReconnect); остальные
  // переходы состояния зовут onState одним аргументом — так же, как раньше.
  onState: (s: ConnState, retryAt?: number) => void
  onFrame: (type: string, payload: unknown) => void // new_message/read/typing/presence/reaction/message_ack
  /** Durable outbox storage (IndexedDB in the worker): unacked sends survive a
   * page reload and are resent on the next connect. */
  outboxStore?: { load: () => Promise<SendArgs[] | undefined>; save: (list: SendArgs[]) => void }
  /** Часы, из которых считается retryAt (Date.now() по умолчанию) — подменяются в
   * тесте ради детерминированного значения вместо `toBeGreaterThan(before)`. */
  now?: () => number
}

const HEARTBEAT_MS = 20_000
const PONG_GRACE = 2 // missed pongs before force-reconnect
const MAX_BACKOFF = 30_000

export function newConnectionManager({ ws, getToken, onReady, onState, onFrame, outboxStore, now = Date.now }: CMDeps) {
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
  // Снимок последнего опубликованного retryAt — НЕ источник новой информации, а
  // ровно то, что видел бы подписчик onState на последнем push. Нужен для
  // getStatus() (Задача 1, ревью): вкладка/сама виджет-разметка, подключившаяся
  // ПОСЛЕ перехода в 'reconnecting', иначе не узнаёт retryAt вплоть до следующего
  // события (до 30с backoff'а) — в tweb этой дыры нет, там канал pull-овый для
  // самого статуса соединения (connectionStatus.ts:87-91 тянет getConnectionStatus()
  // на connection_status_change; подробности и граница расширения — realtime.ts).
  let lastRetryAt: number | undefined
  let attempt = 0
  let hbTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let missedPongs = 0
  let wired = false
  // Дедуп markRead по чату: раньше единственным источником был троттленный
  // скролл, теперь пересчёт идёт после КАЖДОЙ тихой записи scrollTop (Task 4),
  // включая резайз контента, — на медиа-тяжёлом открытии чата это десятки
  // одинаковых кадров подряд для одного и того же upToSeq.
  const lastReadSeq = new Map<number, number>()

  // Арность вызова onState сохраняется как раньше (один аргумент), когда retryAt не
  // задан — это держит совместимость с существующими проверками
  // `toHaveBeenCalledWith('ready')` (connectionManager.test.ts) без их правки.
  const setState = (s: ConnState, retryAt?: number) => {
    state = s
    // Зеркалит арность onState 1:1: retryAt сбрасывается на ЛЮБОМ переходе, который
    // его не несёт — снимок не должен знать больше, чем узнал бы push-подписчик.
    lastRetryAt = retryAt
    if (retryAt !== undefined) onState(s, retryAt)
    else onState(s)
  }

  function wireOnce() {
    if (wired) return
    wired = true
    ws.onOpen(() => {
      attempt = 0; missedPongs = 0
      // Сброс на реконнект — тот же повод, что двигает resend outbox'а чуть
      // ниже: 'read' не подтверждается (нет ack/outbox для этого кадра), так
      // что попытка, оборвавшаяся посреди отправки, могла не дойти до сервера.
      // Без сброса дедуп молча похоронил бы повторную отправку ТОГО ЖЕ upToSeq
      // после реконнекта — чат остался бы непрочитанным на сервере, хотя
      // клиент уверен, что уже отправил. Отдельного хука на смену аккаунта в
      // этом файле нет ни у одного метода (outbox переживает её нарочно, через
      // IDB, см. его комментарий выше) — единственная точка, где стоит
      // полагаться на пересоздание состояния, это реконнект WS.
      lastReadSeq.clear()
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
    const base = Math.min(MAX_BACKOFF, 500 * 2 ** attempt++)
    const delay = base / 2 + Math.floor(Math.random() * (base / 2 + 1)) // jitter
    // Витрина tweb рисует по retryAt обратный отсчёт «Переподключение через N»
    // (connectionStatus.ts:114 читает, :150-158 отсчёт) — раньше delay считался и
    // терялся (см. план задачи).
    setState('reconnecting', now() + delay)
    reconnectTimer = setTimeout(connect, delay)
  }

  function connect() {
    const token = getToken()
    if (!token) { setState('offline'); return }
    // Промежуточный 'reconnecting' здесь сознательно БЕЗ retryAt — это буквальный
    // tweb, не недосмотр: tcpObfuscated.ts:175 на попытке соединения зовёт
    // setConnectionStatus(Connecting) без retryAt, rootScope.ts:277 кладёт статус
    // целиком → старое значение стирается в undefined. НЕ делать retryAt липким на
    // этом переходе — это как раз сломало бы 1:1 (реальная последовательность:
    // connecting(—) → ready(—) → reconnecting(+274мс) → reconnecting(—) →
    // reconnecting(+552мс) → reconnecting(—); автомат витрины (Задача 3) обязан
    // отработать именно её — отсчёт → «Переподключение» → новый отсчёт).
    setState(state === 'reconnecting' ? 'reconnecting' : 'connecting')
    wireOnce()
    ws.connect(token)
  }

  function sendFrame(m: SendArgs) {
    ws.send('send_message', { peer_id: m.peerId, type: m.type ?? 'text', text: m.text, entities: m.entities ?? null, client_msg_id: m.clientMsgId, reply_to_id: m.replyToId ?? null, reply_to_peer_id: m.replyToPeerId ?? null, reply_quote_text: m.replyQuoteText ?? null, reply_quote_offset: m.replyQuoteOffset ?? null, media_id: m.mediaId ?? null, grouped_id: m.groupedId ?? 0, geo_lat: m.geo?.lat ?? null, geo_lng: m.geo?.lng ?? null, geo_title: m.geo?.title ?? null, geo_address: m.geo?.address ?? null, geo_live_period: m.geo?.livePeriod ?? null, geo_heading: m.geo?.heading ?? null, contact_user_id: m.contactUserId ?? null, thread_root_id: m.threadRootId ?? null, enc_body: m.encBody ?? null, ttl_seconds: m.ttlSeconds ?? null, silent: m.silent ?? false, effect: m.effect ?? '', paid_media_price: m.paidMediaPrice ?? null, send_as_peer_id: m.sendAsPeerId ?? null, media_spoiler: m.mediaSpoiler ?? false })
  }

  return {
    start() { if (state === 'offline') connect() },
    // Через setState (не прямым `state = 'offline'`) — иначе lastRetryAt протухал
    // бы: ws.onClose → reconnecting(+delay) → stop() без setState оставил бы
    // старый будущий retryAt висеть на снимке при уже снятом таймере, и
    // getStatus() вернул бы {state:'offline', retryAt:<в будущем>} — ревью нашло
    // это несоответствие инварианту «lastRetryAt зеркалит push 1:1». Сегодня
    // недостижимо в проде (нет продакшен-вызовов stop() — только тест), но раз
    // уж инвариант заявлен, код обязан его держать, а не только комментарий.
    stop() { if (reconnectTimer) clearTimeout(reconnectTimer); stopHeartbeat(); setState('offline'); ws.close() },
    state: () => state,
    // Снимок последнего опубликованного retryAt (см. lastRetryAt выше) — питает
    // realtime.getStatus() для позднего подписчика (новая вкладка/перезагрузка).
    retryAt: () => lastRetryAt,
    outboxSize: () => outbox.size,
    sendMessage(m: SendArgs) { outbox.set(m.clientMsgId, m); persistOutbox(); if (ws.isOpen()) sendFrame(m) },
    markRead(peerId: number, upToSeq: number) {
      if (!ws.isOpen()) return
      // Не шлём, если для этого чата уже отправлен такой же или больший upToSeq —
      // повторный кадр на тот же прочитанный рубеж серверу не нужен. Растущий
      // upToSeq (реально прочитали дальше) дедуп не гасит: last=5 не блокирует 7.
      const last = lastReadSeq.get(peerId)
      if (last != null && upToSeq <= last) return
      lastReadSeq.set(peerId, upToSeq)
      ws.send('read', { peer_id: peerId, up_to_seq: upToSeq })
    },
    // «Прослушано/просмотрено» для голосового/кружка (tweb readMessageContents).
    markMediaRead(peerId: number, msgId: number) { if (ws.isOpen()) ws.send('read_media', { peer_id: peerId, msg_id: msgId }) },
    sendTyping(peerId: number, action: TypingAction = 'typing') { if (ws.isOpen()) ws.send('typing', { peer_id: peerId, action }) },
    // Call signaling is ephemeral (no outbox): a frame lost while offline is
    // meaningless seconds later — WebRTC re-negotiates on its own timers.
    sendCallFrame(type: string, data: Record<string, unknown>) { if (ws.isOpen()) ws.send(type, data) },
    subscribeChannel(peerId: number) { if (ws.isOpen()) ws.send('subscribe_channel', { peer_id: peerId }) },
    unsubscribeChannel(peerId: number) { if (ws.isOpen()) ws.send('unsubscribe_channel', { peer_id: peerId }) },
  }
}

export type ConnectionManager = ReturnType<typeof newConnectionManager>
