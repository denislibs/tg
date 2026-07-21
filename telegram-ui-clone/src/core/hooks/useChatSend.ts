// src/core/hooks/useChatSend.ts
//
// View-model hook for everything "outgoing" in a conversation: text sends, media
// picking + upload, voice recording, the optimistic bubble, draft-chat creation on
// first send, and the throttled typing frame. It also owns the reply / editing
// composer state (set here on send, by the context menu via the returned setters,
// and read by the Composer).
//
// It does NOT own scroll intent — `atBottomRef`/`userScrolledUpRef` are passed in
// (they belong to the scroll state machine); sending just pins them to the bottom.
import { useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useEvent } from './useEvent'
import { useVoiceRecorder } from './useVoiceRecorder'
import { splitRich } from '../markdown'
import { playEmojiEffect, sendEffectForText } from '../effects/emojiEffects'
import type { MessageEntity } from '../models'
import type { GifItem } from '../gifs'
import type { Chat } from '../../data'
import type { MessageWindow } from './useMessageWindow'
import type { Managers } from '../../client/bootstrap'
import { useMessagesStore , winKey } from '../../stores/messagesStore'
import { useLiveShareStore } from '../../stores/liveShareStore'
import { useUploadsStore } from '../../stores/uploadsStore'

// Max characters per message (matches the backend's maxMessageRunes / Telegram 4096).
// Longer drafts are split into several messages on send.
const MAX_MESSAGE_LEN = 4096

// quote — ответ с цитатой выделенного фрагмента (Telegram reply quote): текст
// куска оригинала + его offset (UTF-16) в плоском тексте отвечаемого сообщения.
export type ReplyState = { msgId?: number; name: string; text: string; color: string; quote?: { text: string; offset: number } } | null
export type EditState = { msgId: number; text: string; entities?: MessageEntity[] } | null

interface UseChatSendArgs {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  isChannel: boolean
  draftPeerId: number | null
  canType: boolean
  /** Секретный чат ещё не установлен (handshake не завершён) → отправка запрещена. */
  secretLocked?: boolean
  meId: number | null
  win: MessageWindow
  managers: Managers
  /** тред (форум-топик/комментарии): отправка идёт с thread_root_id */
  threadRootId?: number
  // Scroll intent (owned elsewhere): sending pins to the bottom.
  atBottomRef: MutableRefObject<boolean>
  userScrolledUpRef: MutableRefObject<boolean>
  onChatCreated?: (chatId: number) => void
}

export function useChatSend({
  chat,
  numericChatId,
  isRealChat,
  isChannel,
  draftPeerId,
  canType,
  secretLocked = false,
  meId,
  win,
  managers,
  threadRootId,
  atBottomRef,
  userScrolledUpRef,
  onChatCreated,
}: UseChatSendArgs) {
  // Reply / editing composer state (set on send, by the context menu via the
  // returned setters, and read by the Composer).
  const [reply, setReply] = useState<ReplyState>(null)
  const [editing, setEditing] = useState<EditState>(null)

  // Voice-recording mechanics live in useVoiceRecorder; here we only decide what to
  // do with a finished clip: upload + send (creating the private chat first on a draft).
  const pingVoiceTyping = () => { if (isRealChat) void managers.realtime.sendTyping({ chatId: numericChatId, action: 'voice' }) }
  const rec = useVoiceRecorder({
    onStart: pingVoiceTyping,
    onSecond: pingVoiceTyping,
    onComplete: async (r) => {
      if (!r) return
      const { secs, blob, mime, mode } = r
      if (!blob) return
      const type = mode === 'round' ? 'roundVideo' : 'voice' // кружок → круглое видеосообщение
      const mediaId = await managers.media.upload({ blob, mime, size: blob.size, duration: secs })
      const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
      let cid = numericChatId
      if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
      atBottomRef.current = true; userScrolledUpRef.current = false
      if (isRealChat) win.appendOptimistic('', meId ?? -1, clientMsgId, mediaId, type)
      void managers.realtime.sendMessage({ chatId: cid, text: '', clientMsgId, mediaId, type, threadRootId })
      window.dispatchEvent(new Event('tg-send'))
      if (draftPeerId != null) onChatCreated?.(cid)
    },
  })

  const replyToId = reply?.msgId ?? null
  const mkClientMsgId = (k = 0) => `c-${chat.id}-${performance.now()}-${k}-${Math.random().toString(36).slice(2)}`
  const sendReal = (text: string, entities?: MessageEntity[], replyTo: number | null = replyToId, ttlSeconds: number | null = null, silent = false) => {
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false // sending pins to bottom
    // Ровно один эффект-эмодзи (❤️/🎉/👍/…) → полноэкранный canvas-эффект сразу
    // после отправки; у получателя эффект играет только по клику на бабл.
    const fx = sendEffectForText(text)
    if (fx) playEmojiEffect(fx)
    if (chat.type === 'secret') {
      // Секретный чат: оптимистичный бабл с ПЛЕЙНТЕКСТОМ (тем же путём, что обычная
      // отправка — reconcile по clientMsgId работает как всегда), затем E2E-шифрование
      // и отправка type:'encrypted' по WS. Реальный бабл приедет расшифрованным echo
      // new_message с тем же clientMsgId. reply/thread здесь пока не поддержаны.
      win.appendOptimistic(text, meId ?? -1, clientMsgId, undefined, 'text', entities, undefined, undefined, { secret: true })
      void managers.secret.sendText({ chatId: numericChatId, text, entities, clientMsgId, ttlSeconds })
      return
    }
    // reply quote прикреплён к первому сообщению (там же, где и сам reply).
    const quote = replyTo != null ? reply?.quote : undefined
    win.appendOptimistic(text, meId ?? -1, clientMsgId, undefined, 'text', entities)
    void managers.realtime.sendMessage({ chatId: numericChatId, text, entities, clientMsgId, replyToId: replyTo, replyQuoteText: quote?.text ?? null, replyQuoteOffset: quote?.offset ?? null, threadRootId, silent })
  }

  // Гео-точка из attach-меню: оптимистичный бабл сразу (координаты локальные),
  // на бэк — WS-полями geo_lat/geo_lng (type 'geo').
  const sendGeo = (lat: number, lng: number, opts?: { title?: string; address?: string; livePeriod?: number; heading?: number }) => {
    atBottomRef.current = true; userScrolledUpRef.current = false
    // Live location: шлём по REST (нужен msgId для последующих обновлений) и
    // запускаем трансляцию; бабл появится WS-эхом. Обычная точка/venue — как было,
    // оптимистичным WS-путём.
    if (opts?.livePeriod) {
      void managers.messages.sendGeoLive(numericChatId, lat, lng, opts.livePeriod, opts.heading).then((m) => {
        useLiveShareStore.getState().start(managers, numericChatId, m.id, Date.now() + opts.livePeriod! * 1000)
      })
      window.dispatchEvent(new Event('tg-send'))
      return
    }
    const clientMsgId = mkClientMsgId()
    const geo = { lat, lng, ...opts }
    win.appendOptimistic('', meId ?? -1, clientMsgId, undefined, 'geo', undefined, undefined, undefined, { geo })
    void managers.realtime.sendMessage({ chatId: numericChatId, text: '', clientMsgId, type: 'geo', geo, threadRootId })
    window.dispatchEvent(new Event('tg-send'))
  }

  // Стикер (пикер/саджесты): оптимистичный бабл type 'sticker' с mediaId, по WS —
  // обычный send_message {type:'sticker', mediaId}; POST /use ведёт recent на бэке.
  // В черновике сначала создаётся приватный чат (как voice/файлы).
  const sendSticker = (st: { id: number; mediaId: number; emoji: string }) => {
    if (!canType || secretLocked || chat.type === 'secret') return
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false
    void (async () => {
      let cid = numericChatId
      if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
      if (isRealChat) win.appendOptimistic('', meId ?? -1, clientMsgId, st.mediaId, 'sticker')
      void managers.realtime.sendMessage({ chatId: cid, text: '', clientMsgId, mediaId: st.mediaId, type: 'sticker', threadRootId })
      void managers.stickers.use(st.id).catch(() => {})
      window.dispatchEvent(new Event('tg-send'))
      if (draftPeerId != null) onChatCreated?.(cid)
    })()
  }

  // GIF из вкладки пикера. Сохранённый (media наше) — оптимистичный бабл type
  // 'video' с mediaId сразу + send_message, как стикер. Tenor — скачиваем mp4 в
  // блоб (main-thread, как file picker), оптимистичный бабл с localUrl и кольцом
  // прогресса (паттерн isVisual из onPickFile), аплоад → send_message type
  // 'video'; отправленный Tenor-гиф автосохраняется в /gifs/saved (Telegram:
  // «отправил → появился в сохранённых»).
  const sendGif = (g: GifItem) => {
    if (!canType || secretLocked || chat.type === 'secret') return
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false
    if (g.mediaId != null) {
      const mediaId = g.mediaId
      void (async () => {
        let cid = numericChatId
        if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
        if (isRealChat) {
          win.appendOptimistic('', meId ?? -1, clientMsgId, mediaId, 'video', undefined, undefined, {
            width: g.width, height: g.height, mime: g.mime, size: g.size, name: g.fileName,
          })
        }
        void managers.realtime.sendMessage({ chatId: cid, text: '', clientMsgId, mediaId, type: 'video', threadRootId })
        window.dispatchEvent(new Event('tg-send'))
        if (draftPeerId != null) onChatCreated?.(cid)
      })()
      return
    }
    if (!g.mp4Url || !isRealChat) return
    void (async () => {
      let blob: Blob
      try {
        const res = await fetch(g.mp4Url!)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        blob = await res.blob()
      } catch {
        return // CDN не отдал mp4 — отправлять нечего
      }
      const localUrl = URL.createObjectURL(blob)
      win.appendOptimistic('', meId ?? -1, clientMsgId, undefined, 'video', undefined, undefined, {
        localUrl, width: g.width, height: g.height, mime: 'video/mp4', size: blob.size, name: 'tenor.mp4',
      })
      useUploadsStore.getState().setProgress(clientMsgId, 0)
      window.dispatchEvent(new Event('tg-send'))
      try {
        const mediaId = await managers.media.upload({ blob, mime: 'video/mp4', size: blob.size, width: g.width, height: g.height, fileName: 'tenor.mp4', progressId: clientMsgId })
        useMessagesStore.getState().setOptimisticMedia(winKey(numericChatId, threadRootId), clientMsgId, mediaId)
        void managers.realtime.sendMessage({ chatId: numericChatId, text: '', clientMsgId, mediaId, type: 'video', threadRootId })
        void managers.stickers.saveGif(mediaId).catch(() => {})
      } catch {
        useMessagesStore.getState().failOptimisticByClient(clientMsgId)
      } finally {
        useUploadsStore.getState().clear(clientMsgId)
      }
    })()
  }

  // Контакт: в оптимистичный бабл идёт локальный снимок имени (телефон сервер
  // гидрирует по аккаунту — приедет с echo-фреймом new_message).
  const sendContact = (userId: number, name: string) => {
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false
    win.appendOptimistic('', meId ?? -1, clientMsgId, undefined, 'contact', undefined, undefined, undefined, { contact: { userId, name, phone: '' } })
    void managers.realtime.sendMessage({ chatId: numericChatId, text: '', clientMsgId, type: 'contact', contactUserId: userId, threadRootId })
    window.dispatchEvent(new Event('tg-send'))
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Set by the attach menu before opening the picker: send the chosen files as
  // raw documents (true) or with media treatment (false). The accept filter is
  // applied imperatively right before .click().
  const pickAsFileRef = useRef(false)
  const openPicker = (accept: string, asFile: boolean) => {
    pickAsFileRef.current = asFile
    const el = fileInputRef.current
    if (el) { el.accept = accept; el.click() }
  }

  const readImageSize = (file: File): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve({ width: 0, height: 0 })
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url) }
      img.onerror = () => { resolve({ width: 0, height: 0 }); URL.revokeObjectURL(url) }
      img.src = url
    })

  // asFile=true sends without "media" treatment (a photo/video becomes a
  // downloadable document). Otherwise the type is inferred from the mime.
  // caption (optional) is attached as the message text.
  const onPickFile = async (file: File, asFile = false, caption = '', groupedId?: string) => {
    if (!isRealChat || secretLocked) return
    const mime = file.type || 'application/octet-stream'
    const type = asFile
      ? 'document'
      : mime.startsWith('image/') ? 'photo'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : 'document'
    const { width, height } = type === 'photo' ? await readImageSize(file) : { width: 0, height: 0 }
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    // «Отправляет файл/фото/видео/аудио» у собеседника на время аплоада
    // (tweb sendMessageUpload*Action): пинг сразу и каждые 3с (TTL приёмника 6с).
    const uploadAction = type === 'photo' ? 'upload_photo' as const
      : type === 'video' ? 'upload_video' as const
      : type === 'audio' ? 'upload_audio' as const
      : 'upload_file' as const
    const pingUpload = () => { if (isRealChat && chat.type !== 'secret') void managers.realtime.sendTyping({ chatId: numericChatId, action: uploadAction }) }
    const startUploadTyping = () => { pingUpload(); return window.setInterval(pingUpload, 3000) }
    // Фото/видео как медиа: бабл появляется СРАЗУ с локальным превью и кольцом
    // прогресса (tweb is_outgoing + ProgressivePreloader); отправка по WS —
    // после завершения аплоада. Документы/аудио грузятся до появления бабла.
    const isVisual = (type === 'photo' || type === 'video') && !asFile
    atBottomRef.current = true; userScrolledUpRef.current = false
    // Секретный чат (E2E): шифруем байты своим ключом файла, грузим ciphertext как
    // непрозрачный blob, key/iv кладём в зашифрованный payload (secret.sendMedia).
    // Отправитель видит локальное превью (localUrl) сразу для фото/видео; реальный
    // бабл приедет расшифрованным echo new_message с тем же clientMsgId. Документы —
    // без оптимистичного бабла (приезжают echo). reply/thread здесь не поддержаны.
    if (chat.type === 'secret') {
      const bytes = await file.arrayBuffer()
      if (isVisual) {
        const localUrl = URL.createObjectURL(file)
        win.appendOptimistic(caption, meId ?? -1, clientMsgId, undefined, type, undefined, undefined,
          { localUrl, width, height, mime, size: file.size, name: file.name }, { secret: true })
      }
      try {
        await managers.secret.sendMedia({ chatId: numericChatId, bytes, name: file.name, mime, size: file.size, mediaType: type, ttlSeconds: null, clientMsgId })
      } catch {
        if (isVisual) useMessagesStore.getState().failOptimisticByClient(clientMsgId)
      }
      window.dispatchEvent(new Event('tg-send'))
      return
    }
    if (isVisual) {
      const localUrl = URL.createObjectURL(file)
      win.appendOptimistic(caption, meId ?? -1, clientMsgId, undefined, type, undefined, groupedId, {
        localUrl, width, height, mime, size: file.size, name: file.name,
      })
      useUploadsStore.getState().setProgress(clientMsgId, 0)
      const typingTimer = startUploadTyping()
      try {
        const mediaId = await managers.media.upload({ blob: file, mime, size: file.size, width, height, fileName: file.name, progressId: clientMsgId })
        useMessagesStore.getState().setOptimisticMedia(winKey(numericChatId, threadRootId), clientMsgId, mediaId)
        void managers.realtime.sendMessage({ chatId: numericChatId, text: caption, clientMsgId, mediaId, type, groupedId, threadRootId })
      } catch {
        useMessagesStore.getState().failOptimisticByClient(clientMsgId)
      } finally {
        window.clearInterval(typingTimer)
        useUploadsStore.getState().clear(clientMsgId)
      }
      return
    }
    // Документ/аудио: бабл появляется СРАЗУ с метой файла (имя/размер/mime) и
    // кольцом прогресса аплоада с отменой (tweb ProgressivePreloader) — раньше
    // бабл ждал конца аплоада, и было непонятно, грузится ли файл вообще.
    // Большие файлы идут чанковым/резюмируемым путём (blob → uploadChunked).
    win.appendOptimistic(caption, meId ?? -1, clientMsgId, undefined, type, undefined, groupedId, {
      mime, size: file.size, name: file.name,
    })
    useUploadsStore.getState().setProgress(clientMsgId, 0)
    const typingTimer = startUploadTyping()
    try {
      const mediaId = await managers.media.upload({ blob: file, mime, size: file.size, width, height, fileName: file.name, progressId: clientMsgId })
      useMessagesStore.getState().setOptimisticMedia(winKey(numericChatId, threadRootId), clientMsgId, mediaId)
      void managers.realtime.sendMessage({ chatId: numericChatId, text: caption, clientMsgId, mediaId, type, groupedId, threadRootId })
    } catch {
      // Отменённый аплоад бабл уже удалил (removeOptimisticByClient) — fail будет no-op.
      useMessagesStore.getState().failOptimisticByClient(clientMsgId)
    } finally {
      window.clearInterval(typingTimer)
      useUploadsStore.getState().clear(clientMsgId)
    }
  }

  // Picked files awaiting the compose popup (caption + as-media/as-file choice).
  const [pendingMedia, setPendingMedia] = useState<{ files: File[]; asFile: boolean } | null>(null)
  const sendPendingMedia = async (caption: string, asFile: boolean) => {
    const pm = pendingMedia
    setPendingMedia(null)
    if (!pm) return
    // Несколько фото/видео «как медиа» → один альбом (Telegram grouped_id):
    // общий id на все сообщения группы, подпись — на первом (tweb).
    const asAlbum = !asFile
      && pm.files.length > 1
      && pm.files.every((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    const groupedId = asAlbum ? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : undefined
    for (let i = 0; i < pm.files.length; i++) {
      await onPickFile(pm.files[i], asFile, i === 0 ? caption : '', groupedId)
    }
  }

  // Called by the Composer with the trimmed draft text (the Composer owns the
  // text state + clears itself afterwards); we route by chat kind / edit / reply.
  const send = (text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent = false) => {
    if (!text || !canType || secretLocked) return
    // Edit mode: PATCH the existing message instead of sending a new one.
    if (editing && isRealChat) {
      const { msgId } = editing
      setEditing(null)
      void managers.messages.editMessage(numericChatId, msgId, text, entities)
      return
    }
    // Over the message limit → split into multiple messages (tweb splitStringByLength).
    // A span crossing a boundary (e.g. a long code block) becomes one per chunk.
    const parts = splitRich(text, entities ?? [], MAX_MESSAGE_LEN)
    const entOf = (p: { entities: MessageEntity[] }) => (p.entities.length ? p.entities : undefined)
    if (draftPeerId != null) {
      // First message in a draft: create the private chat, send all parts, then let
      // the shell switch to the now-real chat (and surface it in the sidebar).
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      void (async () => {
        const id = await managers.chats.createPrivate(draftPeerId)
        for (let k = 0; k < parts.length; k++) {
          await managers.realtime.sendMessage({ chatId: id, text: parts[k].text, entities: entOf(parts[k]), clientMsgId: mkClientMsgId(k) })
        }
        onChatCreated?.(id)
      })()
      return
    }
    if (isRealChat && isChannel) {
      // Channels post through the REST channel endpoint (not the group WS send);
      // optimistic append (sender is the posting admin = me), reusing the existing
      // optimistic + scroll-to-bottom pattern. Live echo arrives via rt:new_message.
      // (Channel posts are plain text — no entities on this path yet.)
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      atBottomRef.current = true; userScrolledUpRef.current = false
      for (let k = 0; k < parts.length; k++) {
        const clientMsgId = mkClientMsgId(k)
        win.appendOptimistic(parts[k].text, meId ?? -1, clientMsgId)
        void managers.channels.post(numericChatId, parts[k].text, clientMsgId)
      }
      return
    }
    // Plain real chat (private/group).
    setReply(null)
    window.dispatchEvent(new Event('tg-send'))
    // reply attaches to the first message only (Telegram behaviour)
    parts.forEach((p, k) => sendReal(p.text, entOf(p), k === 0 ? replyToId : null, ttlSeconds ?? null, silent))
  }

  // Throttled outgoing typing frame (real chats); called by the Composer on each
  // keystroke. Kept here so the Composer needs no chat/managers knowledge.
  const lastTypingRef = useRef(0)
  const onComposerTyping = useEvent(() => {
    if (!isRealChat) return
    const now = performance.now()
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now
      void managers.realtime.sendTyping({ chatId: numericChatId })
    }
  })

  return {
    reply, setReply, editing, setEditing,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
    sendGeo, sendContact, sendSticker, sendGif,
  }
}
