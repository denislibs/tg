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

export interface SecretDeps {
  rest: { get: <T>(url: string) => Promise<T>; post: <T>(url: string, body: unknown) => Promise<T> }
  conn: { sendMessage: (args: { chatId: number; text: string; clientMsgId: string; type?: string; encBody?: string; mediaId?: number; ttlSeconds?: number | null }) => void }
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
  // initiatorPub полученных запросов (по chatId), чтобы accept не тащил ключ с main-thread.
  const incomingPub = new Map<number, string>()

  async function establish(chatId: number, priv: CryptoKey, peerPubB64: string): Promise<string[]> {
    const secret = await deriveSecret(priv, b64ToBytes(peerPubB64))
    await saveKey(chatId, { key: secret.key, fingerprint: secret.fingerprint })
    return fingerprintEmoji(secret.fingerprint)
  }

  // Инициатор доводит ключ, приняв кадр secret_chat_accept (responder_pub).
  // Вынесено из return-объекта, чтобы sync() мог переиспользовать при восстановлении.
  async function complete(chatId: number, responderPubB64: string): Promise<void> {
    const priv = await loadPending(chatId)
    if (!priv) return // не инициатор или уже завершено
    const fingerprint = await establish(chatId, priv, responderPubB64)
    await clearPending(chatId)
    deps.broadcast(RT.secretAccept, { chat_id: chatId, state: 'established', fingerprint })
  }

  return {
    // Инициатор: генерит пару, создаёт чат на бэке, публичный ключ уходит серверу.
    async start(peerId: number): Promise<{ chatId: number }> {
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      const { chat_id } = await deps.rest.post<{ chat_id: number; state: string }>('/secret_chats', { peer_id: peerId, pub: b64FromBytes(pub) })
      await savePending(chat_id, kp.privateKey)
      return { chatId: chat_id }
    },

    // Воркер зовёт это, приняв кадр secret_chat_request (запоминаем pub инициатора).
    stashRequest(chatId: number, initiatorPubB64: string) {
      incomingPub.set(chatId, initiatorPubB64)
    },

    // Получатель принимает: генерит пару, выводит общий ключ из pub инициатора, шлёт свой pub.
    async accept(chatId: number): Promise<{ fingerprint: string[] }> {
      const initiatorPub = incomingPub.get(chatId)
      if (!initiatorPub) throw new Error('secret: initiator pub missing')
      const kp = await generateKeyPair()
      const pub = await exportPublicKey(kp.publicKey)
      const fingerprint = await establish(chatId, kp.privateKey, initiatorPub)
      await deps.rest.post(`/secret_chats/${chatId}/accept`, { pub: b64FromBytes(pub) })
      incomingPub.delete(chatId)
      return { fingerprint }
    },

    // Инициатор доводит ключ, приняв кадр secret_chat_accept (responder_pub).
    complete,

    async reject(chatId: number): Promise<void> {
      await deps.rest.post(`/secret_chats/${chatId}/reject`, {})
    },

    // Восстановление handshake после перезагрузки/первого открытия чата: тянем
    // серверное состояние и синхронизируем локальный ключ + secretChatStore.
    // Ключи device-local (IndexedDB) переживают reload; in-memory incomingPub — нет,
    // поэтому pub инициатора перезапоминаем здесь. Ошибки (404/нет доступа/сеть)
    // глотаем — это не должно всплыть в UI.
    async sync(chatId: number, meId: number): Promise<void> {
      try {
        const hs = await deps.rest.get<{
          chat_id: number
          initiator_id: number
          responder_id: number
          state: 'requested' | 'accepted' | 'rejected' | 'discarded'
          initiator_pub?: string
          responder_pub?: string
        }>(`/secret_chats/${chatId}`)
        if (hs.state === 'accepted') {
          const stored = await loadKey(chatId)
          if (meId === hs.initiator_id && !stored && hs.responder_pub) {
            // Инициатор перезагрузился до завершения ключа → доводим из responder_pub
            // (complete сам броадкастит established+fingerprint).
            await complete(chatId, hs.responder_pub)
          } else if (stored) {
            // Ключ уже есть (в т.ч. получатель, выведший его на accept) → показать established.
            deps.broadcast(RT.secretAccept, { chat_id: chatId, state: 'established', fingerprint: fingerprintEmoji(stored.fingerprint) })
          }
        } else if (hs.state === 'requested') {
          if (meId === hs.responder_id && hs.initiator_pub) {
            incomingPub.set(chatId, hs.initiator_pub)
            deps.broadcast(RT.secretRequest, { chat_id: chatId, initiator_id: hs.initiator_id, responder_id: hs.responder_id })
          } else if (meId === hs.initiator_id) {
            // Инициатор ждёт: bridge смапит RT.secretRequest по роли в 'awaiting'.
            deps.broadcast(RT.secretRequest, { chat_id: chatId, initiator_id: hs.initiator_id, responder_id: hs.responder_id })
          }
        } else if (hs.state === 'rejected') {
          deps.broadcast(RT.secretReject, { chat_id: chatId })
        }
        // 'discarded' — no-op.
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
    async sendText(args: { chatId: number; text: string; entities?: unknown[]; ttlSeconds?: number | null; clientMsgId: string; optimistic?: SecretOptimistic }): Promise<{ ok: boolean }> {
      if (args.optimistic) {
        deps.beforeSending({
          chat_id: args.chatId, client_msg_id: args.clientMsgId, sender_id: args.optimistic.senderId,
          text: args.text, type: args.optimistic.type, entities: args.entities as PendingNewEvt['entities'], secret: true,
        })
      }
      try {
        const stored = await loadKey(args.chatId)
        if (!stored) throw new Error('secret: chat key missing')
        const encBody = await encryptPayload(stored.key, { text: args.text, entities: args.entities ?? [] })
        deps.conn.sendMessage({ chatId: args.chatId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, ttlSeconds: args.ttlSeconds ?? null })
      } catch (e) {
        if (args.optimistic) deps.failSending(args.clientMsgId)
        throw e
      }
      return { ok: true }
    },

    // Шифрует файл (свой AES-ключ на файл), грузит ciphertext как непрозрачный blob,
    // а key+iv+метаданные кладёт в зашифрованный payload сообщения (type:'encrypted').
    // media_id указывает на blob; расшифровка — на просмотре у получателя.
    async sendMedia(args: { chatId: number; bytes: ArrayBuffer; name: string; mime: string; size: number; mediaType: string; ttlSeconds?: number | null; clientMsgId: string; text?: string; optimistic?: SecretOptimistic }): Promise<{ ok: boolean }> {
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
          chat_id: args.chatId, client_msg_id: args.clientMsgId, sender_id: args.optimistic.senderId,
          text: args.text ?? '', type: args.optimistic.type, media: args.optimistic.media, secret: true,
          local_url: visual ? URL.createObjectURL(new Blob([args.bytes], { type: args.mime })) : undefined,
        })
      }
      try {
        const stored = await loadKey(args.chatId)
        if (!stored) throw new Error('secret: chat key missing')
        const { cipher, keyB64, ivB64 } = await encryptMedia(new Uint8Array(args.bytes))
        const mediaId = await deps.upload(cipher, 'application/octet-stream', cipher.byteLength, args.name)
        const encBody = await encryptPayload(stored.key, { media: { mediaId, keyB64, ivB64, name: args.name, mime: args.mime, size: args.size, mediaType: args.mediaType } })
        deps.conn.sendMessage({ chatId: args.chatId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, mediaId, ttlSeconds: args.ttlSeconds ?? null })
      } catch (e) {
        if (args.optimistic) deps.failSending(args.clientMsgId)
        throw e
      }
      return { ok: true }
    },

    // Дешифрует enc_body сообщения → {text, entities} и/или {media}. Воркер и
    // history-путь зовут до кэша/broadcast. media присутствует у медиа-сообщений.
    async decryptMessage(chatId: number, encBody: string): Promise<{ text: string; entities: unknown[]; media?: SecretMedia } | null> {
      const stored = await loadKey(chatId)
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
