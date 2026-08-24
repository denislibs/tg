// secretManager (worker-side): E2E-handshake + шифрование секретного чата.
// Ключи и приватный ключ инициатора — device-local в IndexedDB (keyStore),
// на сервер уходят только публичные ключи. Живёт в SharedWorker: имеет доступ
// к rest, conn (WS) и broadcast (→ main-thread realtimeBridge → secretChatStore).
import { generateKeyPair, exportPublicKey, deriveSecret, encryptPayload, decryptPayload, encryptMedia, b64FromBytes, b64ToBytes } from '../secret/crypto'
import { fingerprintEmoji } from '../secret/fingerprint'
import { saveKey, loadKey, savePending, loadPending, clearPending } from '../secret/keyStore'
import { RT } from '../realtime/events'
import type { PendingMedia, PendingNewEvt } from '../realtime/events'
import type { SecretMedia } from '../models'
import { sendingParamsToWire, type MessageSendingParams, type SendingParamsWireFields } from './messages/sendingParams'
import { getPeerId } from '../peers/peerId'

/**
 * `EncryptedChat` — стадия handshake КОНСТРУКТОРОМ, а не строкой рядом с
 * ключом. Вместе со стадией меняется и НАБОР полей: у запрошенного есть ключ
 * инициатора (`g_a`), у установленного — ключ второй стороны (`g_a_or_b`), у
 * отменённого нет ни того ни другого. Прежде ехала пара `{peer_id, state}` с
 * нашим перечислением из четырёх строк.
 *
 * `id` — ключ чата; наружу секретный чат адресуется тем же знаковым ключом
 * пира, что и любая группа.
 */
export type EncryptedChat =
  | { _: 'encryptedChatRequested'; id: number; date: number; admin_id: number; participant_id: number; g_a: string }
  | { _: 'encryptedChat'; id: number; date: number; admin_id: number; participant_id: number; g_a_or_b: string }
  | { _: 'encryptedChatDiscarded'; id: number }

/** Ключ пира секретного чата из его конструктора. */
const secretPeerId = (c: EncryptedChat): number => getPeerId({ _: 'peerChannel', channel_id: c.id })

/**
 * Какая часть пакета параметров отправки уезжает в секретный чат — и почему не
 * весь пакет.
 *
 * ЕДЕТ: `reply_to_id`, `thread_root_id`, `silent`. Это МЕТАДАННЫЕ маршрутизации:
 * id сообщения, id корня треда, флаг «без пуша». Сервер их и так знает (граф
 * сообщений — его собственные первичные ключи, пуш шлёт он же), поэтому в
 * открытом кадре они ничего нового о СОДЕРЖИМОМ не сообщают. Раньше не ехало
 * ничего — только из-за узкого типа `conn.sendMessage` в SecretDeps и того, что
 * `useChatSend` эти поля не передавал; это была проводка, не формат.
 *
 * НЕ ЕДЕТ: `reply_quote_text`/`reply_quote_offset` — это ТЕКСТ оригинального
 * сообщения. Положить его в открытый кадр = отдать серверу кусок плейнтекста
 * E2E-переписки, то есть сломать саму гарантию секретного чата. Правильное место
 * цитаты — ВНУТРИ шифруемого payload (`encryptPayload({text, entities})`), рядом
 * с текстом; это меняет формат E2E-payload и требует его версионирования на обе
 * стороны (см. отчёт задачи). `sendAsPeerId`/`effect` в секретных чатах предмета
 * не имеют вовсе: постинга от имени канала в них нет, а бэкенд снимает эффект с
 * типа 'encrypted' по whitelist (sanitizeEffect).
 */
function secretWireFields(w: SendingParamsWireFields): { replyToId: number | null; threadRootId: number | null; silent: boolean } {
  return { replyToId: w.replyToId, threadRootId: w.threadRootId, silent: w.silent }
}

export interface SecretDeps {
  rest: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T> }
  conn: { sendMessage: (args: { peerId: number; text: string; clientMsgId: string; type?: string; encBody?: string; mediaId?: number; ttlSeconds?: number | null; replyToId?: number | null; threadRootId?: number | null; silent?: boolean }) => void }
  broadcast: (event: string, payload: unknown) => void
  /** Аплоад непрозрачного ciphertext-блоба (media.upload воркера) → media_id. */
  upload: (bytes: ArrayBuffer, mime: string, size: number, fileName?: string) => Promise<number>
  /** Временный («неотправленный») бабл — та же механика, что у обычной отправки
   *  (messages.beforeMessageSending + веер операций), см. workerCore.ts. */
  beforeSending: (p: PendingNewEvt) => void
  /** Красная пометка на бабле, если шифрование/аплоад/отправка сорвались —
   *  тот же владелец (messages.failPendingMessage). Ошибка случается ЗДЕСЬ, в
   *  воркере, поэтому и помечает бабл он, а не вкладка вторым RPC. */
  failSending: (clientMsgId: string) => void
}

/** Что отрисовать в бабле секретной отправки, пока летит шифрование/аплоад.
 *  Отсутствует — бабла нет вовсе (голосовое и документ приезжают уже
 *  расшифрованным эхом new_message, как и раньше). */
export interface SecretOptimistic {
  senderId: number
  /** тип бабла (text/photo/video) — у шифртекста на проводе его не видно */
  type: string
  /** локальная мета файла: размеры/mime/имя до аплоада */
  media?: PendingMedia
}

// Расшифрованный payload секретного сообщения: текст+сущности и/или медиа.
interface DecryptedPayload { text?: string; entities?: unknown[]; media?: SecretMedia }

export function createSecretManager(deps: SecretDeps) {
  // initiatorPub полученных запросов (по peerId), чтобы accept не тащил ключ с main-thread.
  const incomingPub = new Map<number, string>()

  async function establish(peerId: number, priv: CryptoKey, peerPubB64: string): Promise<string[]> {
    const secret = await deriveSecret(priv, b64ToBytes(peerPubB64))
    await saveKey(peerId, { key: secret.key, fingerprint: secret.fingerprint })
    return fingerprintEmoji(secret.fingerprint)
  }

  // Инициатор доводит ключ, приняв кадр secret_chat_accept (responder_pub).
  // Вынесено из return-объекта, чтобы sync() мог переиспользовать при восстановлении.
  async function complete(peerId: number, responderPubB64: string): Promise<void> {
    const priv = await loadPending(peerId)
    if (!priv) return // не инициатор или уже завершено
    const fingerprint = await establish(peerId, priv, responderPubB64)
    await clearPending(peerId)
    deps.broadcast(RT.secretAccept, { peer_id: peerId, state: 'established', fingerprint })
  }

  return {
    // Инициатор: генерит пару, создаёт чат на бэке, публичный ключ уходит серверу.
    async start(peerId: number): Promise<{ peerId: number }> {
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      // Стадия handshake — КОНСТРУКТОР объединения `EncryptedChat`, а не
      // строка рядом с ключом: вместе со стадией меняется и набор полей.
      const chat = await deps.rest.post<EncryptedChat>('/secret_chats', { peer_id: peerId, pub: b64FromBytes(pub) })
      const created = secretPeerId(chat)
      await savePending(created, kp.privateKey)
      return { peerId: created }
    },

    // Воркер зовёт это, приняв кадр secret_chat_request (запоминаем pub инициатора).
    stashRequest(peerId: number, initiatorPubB64: string) {
      incomingPub.set(peerId, initiatorPubB64)
    },

    // Получатель принимает: генерит пару, выводит общий ключ из pub инициатора, шлёт свой pub.
    async accept(peerId: number): Promise<{ fingerprint: string[] }> {
      const initiatorPub = incomingPub.get(peerId)
      if (!initiatorPub) throw new Error('secret: initiator pub missing')
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      const fingerprint = await establish(peerId, kp.privateKey, initiatorPub)
      await deps.rest.post(`/secret_chats/${peerId}/accept`, { pub: b64FromBytes(pub) })
      incomingPub.delete(peerId)
      return { fingerprint }
    },

    // Инициатор доводит ключ, приняв кадр secret_chat_accept (responder_pub).
    complete,

    async reject(peerId: number): Promise<void> {
      await deps.rest.post(`/secret_chats/${peerId}/reject`, {})
    },

    // Восстановление handshake после перезагрузки/первого открытия чата: тянем
    // серверное состояние и синхронизируем локальный ключ + secretChatStore.
    // Ключи device-local (IndexedDB) переживают reload; in-memory incomingPub — нет,
    // поэтому pub инициатора перезапоминаем здесь. Ошибки (404/нет доступа/сеть)
    // глотаем — это не должно всплыть в UI.
    async sync(peerId: number, meId: number): Promise<void> {
      try {
        const hs = await deps.rest.get<EncryptedChat>(`/secret_chats/${peerId}`)
        if (hs._ === 'encryptedChat') {
          const stored = await loadKey(peerId)
          if (meId === hs.admin_id && !stored && hs.g_a_or_b) {
            // Инициатор перезагрузился до завершения ключа → доводим из responder_pub
            // (complete сам броадкастит established+fingerprint).
            await complete(peerId, hs.g_a_or_b)
          } else if (stored) {
            // Ключ уже есть (в т.ч. получатель, выведший его на accept) → показать established.
            deps.broadcast(RT.secretAccept, { peer_id: peerId, state: 'established', fingerprint: fingerprintEmoji(stored.fingerprint) })
          }
        } else if (hs._ === 'encryptedChatRequested') {
          if (meId === hs.participant_id && hs.g_a) {
            incomingPub.set(peerId, hs.g_a)
            deps.broadcast(RT.secretRequest, { peer_id: peerId, initiator_id: hs.admin_id, responder_id: hs.participant_id })
          } else if (meId === hs.admin_id) {
            // Инициатор ждёт: bridge смапит RT.secretRequest по роли в 'awaiting'.
            deps.broadcast(RT.secretRequest, { peer_id: peerId, initiator_id: hs.admin_id, responder_id: hs.participant_id })
          }
        } else if (hs._ === 'encryptedChatDiscarded') {
          // Отказ и разрыв сошлись в ОДИН конструктор: разница между ними была
          // только в том, кто нажал, а состояние чата одно.
          deps.broadcast(RT.secretReject, { peer_id: peerId })
        }
      } catch {
        // 404 / нет доступа / сеть — no-op, не бросаем в UI.
      }
    },

    // Шифрует текст ключом чата и отправляет как type:'encrypted' по WS.
    // Бабл (плейнтекст локально) заводится ДО криптографии — иначе он появлялся бы
    // только после её конца; реальный бабл приедет расшифрованным эхом
    // new_message с тем же clientMsgId и сольётся с ним по нему же.
    //
    // `sequential` в заявке НЕ ставится (и здесь, и в sendMedia ниже) — по тому
    // же правилу, по которому его не ставит tweb у `sendFile`: между появлением
    // бабла и уходом кадра стоит ожидание (чтение ключа из IDB + шифрование), за
    // которое вперёд успевает уйти другое сообщение. См. докблок
    // `PendingNewEvt.sequential` (core/realtime/events.ts).
    async sendText(args: { peerId: number; text: string; entities?: unknown[]; ttlSeconds?: number | null; clientMsgId: string; optimistic?: SecretOptimistic } & MessageSendingParams): Promise<{ ok: boolean }> {
      const wire = sendingParamsToWire(args)
      if (args.optimistic) {
        deps.beforeSending({
          peer_id: args.peerId, client_msg_id: args.clientMsgId, sender_id: args.optimistic.senderId,
          text: args.text, type: args.optimistic.type, entities: args.entities as PendingNewEvt['entities'], secret: true,
          thread_root_id: wire.threadRootId, reply_to_id: wire.replyToId,
        })
      }
      try {
        const stored = await loadKey(args.peerId)
        if (!stored) throw new Error('secret: chat key missing')
        const encBody = await encryptPayload(stored.key, { text: args.text, entities: args.entities ?? [] })
        deps.conn.sendMessage({ peerId: args.peerId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, ttlSeconds: args.ttlSeconds ?? null, ...secretWireFields(wire) })
      } catch (e) {
        if (args.optimistic) deps.failSending(args.clientMsgId)
        throw e
      }
      return { ok: true }
    },

    // Шифрует файл (свой AES-ключ на файл), грузит ciphertext как непрозрачный blob,
    // а key+iv+метаданные кладёт в зашифрованный payload сообщения (type:'encrypted').
    // media_id указывает на blob; расшифровка — на просмотре у получателя.
    async sendMedia(args: { peerId: number; bytes: ArrayBuffer; name: string; mime: string; size: number; mediaType: string; ttlSeconds?: number | null; clientMsgId: string; text?: string; optimistic?: SecretOptimistic } & MessageSendingParams): Promise<{ ok: boolean }> {
      const wire = sendingParamsToWire(args)
      // Бабл — до шифрования и аплоада (см. sendText); без optimistic его нет
      // вовсе (голос/документ приходят эхом).
      if (args.optimistic) {
        // Локальное превью минтит ВОРКЕР — из того же плейнтекста, который он и
        // так держит до шифрования (тот же приём, что в messages.sendFile:
        // воркерный blob-URL валиден во всех вкладках, вкладочный — только в
        // одной). Шифрование при этом остаётся здесь, в воркере, вместе с
        // ключами; секретных чатов у tweb нет вовсе, сверять этот путь с
        // оригиналом не с чем — это наша фича, а не расхождение.
        const visual = args.optimistic.type === 'photo' || args.optimistic.type === 'video'
        deps.beforeSending({
          peer_id: args.peerId, client_msg_id: args.clientMsgId, sender_id: args.optimistic.senderId,
          text: args.text ?? '', type: args.optimistic.type, media: args.optimistic.media, secret: true,
          local_url: visual ? URL.createObjectURL(new Blob([args.bytes], { type: args.mime })) : undefined,
          thread_root_id: wire.threadRootId, reply_to_id: wire.replyToId,
        })
      }
      try {
        const stored = await loadKey(args.peerId)
        if (!stored) throw new Error('secret: chat key missing')
        const { cipher, keyB64, ivB64 } = await encryptMedia(new Uint8Array(args.bytes))
        const mediaId = await deps.upload(cipher, 'application/octet-stream', cipher.byteLength, args.name)
        const encBody = await encryptPayload(stored.key, { media: { mediaId, keyB64, ivB64, name: args.name, mime: args.mime, size: args.size, mediaType: args.mediaType } })
        deps.conn.sendMessage({ peerId: args.peerId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, mediaId, ttlSeconds: args.ttlSeconds ?? null, ...secretWireFields(wire) })
      } catch (e) {
        if (args.optimistic) deps.failSending(args.clientMsgId)
        throw e
      }
      return { ok: true }
    },

    // Дешифрует enc_body сообщения → {text, entities} и/или {media}. Воркер и
    // history-путь зовут до кэша/broadcast. media присутствует у медиа-сообщений.
    async decryptMessage(peerId: number, encBody: string): Promise<{ text: string; entities: unknown[]; media?: SecretMedia } | null> {
      const stored = await loadKey(peerId)
      if (!stored) return null
      try {
        const p = await decryptPayload<DecryptedPayload>(stored.key, encBody)
        return { text: p.text ?? '', entities: p.entities ?? [], media: p.media }
      } catch {
        return null
      }
    },
  }
}
