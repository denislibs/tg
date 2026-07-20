// secretManager (worker-side): E2E-handshake + шифрование секретного чата.
// Ключи и приватный ключ инициатора — device-local в IndexedDB (keyStore),
// на сервер уходят только публичные ключи. Живёт в SharedWorker: имеет доступ
// к rest, conn (WS) и broadcast (→ main-thread realtimeBridge → secretChatStore).
import { generateKeyPair, exportPublicKey, deriveSecret, encryptPayload, decryptPayload, encryptMedia, b64FromBytes, b64ToBytes } from '../secret/crypto'
import { fingerprintEmoji } from '../secret/fingerprint'
import { saveKey, loadKey, savePending, loadPending, clearPending } from '../secret/keyStore'
import { RT } from '../realtime/events'
import type { SecretMedia } from '../models'

export interface SecretDeps {
  rest: { post: <T>(url: string, body: unknown) => Promise<T> }
  conn: { sendMessage: (args: { chatId: number; text: string; clientMsgId: string; type?: string; encBody?: string; mediaId?: number; ttlSeconds?: number | null }) => void }
  broadcast: (event: string, payload: unknown) => void
  /** Аплоад непрозрачного ciphertext-блоба (media.upload воркера) → media_id. */
  upload: (bytes: ArrayBuffer, mime: string, size: number, fileName?: string) => Promise<number>
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
    async complete(chatId: number, responderPubB64: string): Promise<void> {
      const priv = await loadPending(chatId)
      if (!priv) return // не инициатор или уже завершено
      const fingerprint = await establish(chatId, priv, responderPubB64)
      await clearPending(chatId)
      deps.broadcast(RT.secretAccept, { chat_id: chatId, state: 'established', fingerprint })
    },

    async reject(chatId: number): Promise<void> {
      await deps.rest.post(`/secret_chats/${chatId}/reject`, {})
    },

    // Шифрует текст ключом чата и отправляет как type:'encrypted' по WS.
    async sendText(args: { chatId: number; text: string; entities?: unknown[]; ttlSeconds?: number | null; clientMsgId: string }): Promise<{ ok: boolean }> {
      const stored = await loadKey(args.chatId)
      if (!stored) throw new Error('secret: chat key missing')
      const encBody = await encryptPayload(stored.key, { text: args.text, entities: args.entities ?? [] })
      deps.conn.sendMessage({ chatId: args.chatId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, ttlSeconds: args.ttlSeconds ?? null })
      return { ok: true }
    },

    // Шифрует файл (свой AES-ключ на файл), грузит ciphertext как непрозрачный blob,
    // а key+iv+метаданные кладёт в зашифрованный payload сообщения (type:'encrypted').
    // media_id указывает на blob; расшифровка — на просмотре у получателя.
    async sendMedia(args: { chatId: number; bytes: ArrayBuffer; name: string; mime: string; size: number; mediaType: string; ttlSeconds?: number | null; clientMsgId: string }): Promise<{ ok: boolean }> {
      const stored = await loadKey(args.chatId)
      if (!stored) throw new Error('secret: chat key missing')
      const { cipher, keyB64, ivB64 } = await encryptMedia(new Uint8Array(args.bytes))
      const mediaId = await deps.upload(cipher, 'application/octet-stream', cipher.byteLength, args.name)
      const encBody = await encryptPayload(stored.key, { media: { mediaId, keyB64, ivB64, name: args.name, mime: args.mime, size: args.size, mediaType: args.mediaType } })
      deps.conn.sendMessage({ chatId: args.chatId, text: '', clientMsgId: args.clientMsgId, type: 'encrypted', encBody, mediaId, ttlSeconds: args.ttlSeconds ?? null })
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
