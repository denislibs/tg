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
import { splitRich } from '../richtext/markdown'
import { playEmojiEffect, sendEffectForText, type EmojiEffectKind } from '../effects/emojiEffects'
import type { MessageEntity } from '../models'
import type { GifItem } from '../gifs'
import type { Chat } from '../../data'
import type { MessageWindow } from './useMessageWindow'
import { useManagers } from './useManagers'
import { startLiveShare } from '../liveShareEngine'
import { scaleImageForSend } from '../media/scaleImageForSend'
import type { MessageSendingParams } from '../managers/messages/sendingParams'

/**
 * Длительность аудио/видео файла до аплоада — порт tweb (popups/newMedia.ts:1562-1579:
 * `new Audio()` на objectURL + onMediaLoad → `params.duration`). Сервер считает
 * длительность асинхронно, поэтому без этого первый `new_message` приезжает без
 * `documentAttributeAudio.duration` и подпись трека остаётся пустой до
 * перезагрузки истории.
 * Ошибку/недоступность метаданных глотаем — длительность просто не уедет.
 */
function probeMediaDuration(file: File, kind: 'audio' | 'video'): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(kind)
    const done = (d?: number) => { URL.revokeObjectURL(url); el.src = ''; resolve(d) }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : undefined)
    el.onerror = () => done(undefined)
    el.src = url
  })
}

// Max characters per message (matches the backend's maxMessageRunes / Telegram 4096).
// Longer drafts are split into several messages on send.
const MAX_MESSAGE_LEN = 4096

// quote — ответ с цитатой выделенного фрагмента (Telegram reply quote): текст
// куска оригинала + его offset (UTF-16) в плоском тексте отвечаемого сообщения.
// sourcePeerId — кросс-чат ответ (tweb ReplyToAnotherChat): ключ ИСХОДНОГО чата
// оригинала; != текущего → уходит полем reply_to_peer_id. Прежнее имя `chatId`
// стояло рядом с `peerId` (автор оригинала, якорь `data-peer-id` плашки), и оба
// теперь ключи пиров — различает их не тип, а РОЛЬ, поэтому имена ролевые.
// snapshotName/snapshotText — готовый снимок превью оригинала (его нет в текущем
// сторе), рисуется в плашке ответа.
export type ReplyState = { msgId?: number; name: string; text: string; color: string; peerId?: PeerId; quote?: { text: string; offset: number }; sourcePeerId?: PeerId; snapshotName?: string; snapshotText?: string } | null
export type EditState = { msgId: number; text: string; entities?: MessageEntity[] } | null
// Пересылка через плашку композера (tweb initMessagesForward): исходный чат +
// id сообщений ждут финализации по «Отправить». dropAuthor/dropCaption — опции
// из меню плашки (скрыть отправителя / убрать подпись). text/count/hasCaption —
// для превью + заголовка плашки.
export type ForwardState = { sourcePeerId: PeerId; msgIds: number[]; count: number; text: string; hasCaption: boolean; dropAuthor: boolean; dropCaption: boolean } | null

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
  /** тред (форум-топик/комментарии): отправка идёт с thread_root_id */
  threadRootId?: number
  /** send-as (Telegram send_as): id канала/группы, от имени которых слать; null —
   * от себя. Прокидывается в send_message выбранной «личностью отправителя». */
  sendAsPeerId?: PeerId | null
  /** Заголовок выбранной send-as личности — чтобы оптимистичный бабл сразу
   * отрисовался от её имени (иначе показывался бы «от себя» до reconcile). */
  sendAsTitle?: string
  // Scroll intent (owned elsewhere): sending pins to the bottom.
  atBottomRef: MutableRefObject<boolean>
  userScrolledUpRef: MutableRefObject<boolean>
  onChatCreated?: (peerId: PeerId) => void
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
  threadRootId,
  sendAsPeerId = null,
  sendAsTitle,
  atBottomRef,
  userScrolledUpRef,
  onChatCreated,
}: UseChatSendArgs) {
  const managers = useManagers()
  // Reply / editing composer state (set on send, by the context menu via the
  // returned setters, and read by the Composer).
  const [reply, setReply] = useState<ReplyState>(null)
  const [editing, setEditing] = useState<EditState>(null)
  // Пересылка (tweb forwarding): плашка форварда в композере; финализируется в send().
  const [forward, setForward] = useState<ForwardState>(null)

  /**
   * ПАКЕТ ПАРАМЕТРОВ ОТПРАВКИ — порт tweb `Chat.getMessageSendingParams()`
   * (`components/chat/chat.ts:1352`). Собирается ОДИН раз в момент отправки и
   * уезжает целиком в любой метод отправки; ни один путь не дописывает
   * `replyToId`/цитату/`silent`/… руками, поэтому и «забыть» их не может.
   * Держит скан `core/sendingParams.test.ts`.
   *
   * `over` — то, что в оригинале живёт состоянием инпута (`this.input.sendSilent`,
   * `this.input.effect()`), а у нас приезжает аргументом `send()` из композера
   * (см. Composer: тихая отправка — пункт send-меню, эффект — его же пикер).
   */
  const getMessageSendingParams = (over?: Pick<MessageSendingParams, 'silent' | 'effect'>): MessageSendingParams => ({
    threadId: threadRootId ?? null,
    replyToMsgId: reply?.msgId ?? null,
    replyToQuote: reply?.quote ?? null,
    // Кросс-чат ответ (tweb ReplyToAnotherChat): reply.sourcePeerId — исходный
    // чат оригинала; отличается от текущего → уходит полем reply_to_peer_id.
    replyToPeerId: reply?.sourcePeerId != null && reply.sourcePeerId !== numericChatId ? reply.sourcePeerId : null,
    sendAsPeerId,
    ...over,
  })

  /** Снимок превью оригинала для ОПТИМИСТИЧНОГО бабла кросс-чат ответа: его нет
   *  в SSOT текущего чата, а серверный `reply_snapshot_*` приедет только с эхом. */
  const replySnapshotForBubble = () =>
    reply?.msgId != null && reply.sourcePeerId != null && reply.sourcePeerId !== numericChatId
      ? { peerId: reply.sourcePeerId, name: reply.snapshotName ?? reply.name, text: reply.snapshotText ?? reply.text }
      : undefined

  /**
   * Порт tweb `ChatInput.onMessageSent()` (`components/chat/input.ts:4067`):
   * ОТДЕЛЬНЫЙ вызов ПОСЛЕ отправки, который гасит плашку-хелпер
   * (`clearHelper()`, :4100). Оригинал зовёт его из КАЖДОЙ точки отправки —
   * текст (:4355), документ/стикер/гиф (`sendMessageWithDocument`, :4355),
   * запись голоса/кружка (`chatRecording.ts:239`), попап медиа
   * (`newMedia.ts:988` + `onHelperCancel` при активном ответе), меню сообщения
   * (`contextMenu.ts:934`), инлайн-результаты (`inlineHelper.ts:62`).
   * Именно поэтому он и здесь отдельная функция, а не строка внутри одного
   * `send()`: у нас точек отправки столько же, и до этого порта плашка гасла
   * только у текстовой — после стикера она оставалась висеть, и СЛЕДУЮЩЕЕ
   * сообщение уходило ответом, которого пользователь уже не ждёт.
   */
  const onMessageSent = () => { setReply(null) }

  // Voice-recording mechanics live in useVoiceRecorder; here we only decide what to
  // do with a finished clip: upload + send (creating the private chat first on a draft).
  const pingVoiceTyping = () => { if (isRealChat) void managers.realtime.sendTyping({ peerId: numericChatId, action: 'voice' }) }
  const rec = useVoiceRecorder({
    onStart: pingVoiceTyping,
    onSecond: pingVoiceTyping,
    onComplete: async (r) => {
      if (!r) return
      const { secs, blob, mime, mode, waveform } = r
      if (!blob) return
      const type = mode === 'round' ? 'roundVideo' : 'voice' // кружок → круглое видеосообщение
      const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
      // Пакет снимается ДО первого await (плашку гасим тут же — порт tweb
      // `chatRecording.ts:215,239`: `getMessageSendingParams()` перед отправкой,
      // `onMessageSent(false, true)` сразу после неё).
      const sendingParams = getMessageSendingParams()
      const replySnapshot = replySnapshotForBubble()
      onMessageSent()
      atBottomRef.current = true; userScrolledUpRef.current = false
      // Секретный чат (E2E): голос шифруем своим ключом файла и шлём как secret-медиа
      // (иначе он уходил ПЛЕЙНТЕКСТОМ — дыра E2E). Без оптимистичного бабла — приедет
      // расшифрованным echo new_message (как секретные документы). Кружок (round)
      // пока идёт прежним путём. Воспроизведение расшифровывает audioStore/waveform.
      if (chat.type === 'secret' && type === 'voice') {
        const bytes = await blob.arrayBuffer()
        let cid = numericChatId
        if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
        try {
          // Без optimistic — бабла у secret-голоса нет и не было (см. выше).
          await managers.secret.sendMedia({ peerId: cid, bytes, name: 'voice', mime, size: blob.size, mediaType: 'voice', ttlSeconds: null, clientMsgId, ...sendingParams })
        } catch { /* ключ чата отсутствует / оффлайн — бабл не появится */ }
        if (draftPeerId != null) onChatCreated?.(cid)
        return
      }
      let cid = numericChatId
      if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
      // Бабл, аплоад и отправку владеет sendFile (порт tweb) — здесь остаётся
      // только мета, которую посчитала вкладка. waveform (пики) шлём только для
      // голосового; для secret-голоса (выше) он остаётся на client-recompute —
      // пики в E2E-payload это отдельная работа. В черновике окна ещё нет, бабл
      // просто не родится (targetKeys пуст) — сообщение подтянется при открытии.
      await managers.messages.sendFile({
        peerId: cid, clientMsgId, senderId: meId ?? -1, file: blob, type, mime,
        duration: secs, waveform: type === 'voice' ? (waveform ?? undefined) : undefined,
        ...sendingParams, replySnapshot,
      })
      if (draftPeerId != null) onChatCreated?.(cid)
    },
  })

  const mkClientMsgId = (k = 0) => `c-${chat.id}-${performance.now()}-${k}-${Math.random().toString(36).slice(2)}`
  const sendReal = (text: string, sendingParams: MessageSendingParams, entities?: MessageEntity[], ttlSeconds: number | null = null, playFx = true) => {
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false // sending pins to bottom
    // Ровно один эффект-эмодзи (❤️/🎉/👍/…) → полноэкранный canvas-эффект сразу
    // после отправки; у получателя эффект играет только по клику на бабл.
    // Явно выбранный эффект сообщения (из send-меню) имеет приоритет и едет полем.
    // playFx=false — части разбитого драфта, кроме первой: ПОЛЕ едет со всеми
    // (пакет один на все части, как в tweb sendText:1508-1516), а локальную
    // анимацию гоняем один раз — она глобальная (canvas на весь экран), не на бабле.
    const fx = (sendingParams.effect as EmojiEffectKind | null | undefined) ?? sendEffectForText(text)
    if (fx && playFx) playEmojiEffect(fx)
    if (chat.type === 'secret') {
      // Секретный чат: оптимистичный бабл с ПЛЕЙНТЕКСТОМ (заводит тот же владелец,
      // что и у обычной отправки — см. secretManager.beforeSending), затем
      // E2E-шифрование и отправка type:'encrypted' по WS. Реальный бабл приедет
      // расшифрованным echo new_message с тем же clientMsgId. Из пакета сюда едут
      // только метаданные маршрутизации (ответ/тред/тихо) — почему не цитата,
      // разобрано в `secretManager.secretWireFields`.
      void managers.secret.sendText({ peerId: numericChatId, text, entities, clientMsgId, ttlSeconds, ...sendingParams, optimistic: { senderId: meId ?? -1, type: 'text' } })
      return
    }
    const sendAs = sendAsPeerId != null ? { peerId: sendAsPeerId, title: sendAsTitle ?? '' } : undefined
    void managers.messages.sendText({ peerId: numericChatId, text, entities, clientMsgId, ...sendingParams, optimistic: { senderId: meId ?? -1, sendAs, replySnapshot: replySnapshotForBubble() } })
  }

  // Гео-точка из attach-меню: оптимистичный бабл сразу (координаты локальные),
  // на бэк — WS-полями geo_lat/geo_lng (type 'geo').
  const sendGeo = (lat: number, lng: number, opts?: { title?: string; address?: string; livePeriod?: number; heading?: number }) => {
    const sendingParams = getMessageSendingParams()
    const replySnapshot = replySnapshotForBubble()
    onMessageSent()
    atBottomRef.current = true; userScrolledUpRef.current = false
    // Live location: шлём по REST (нужен msgId для последующих обновлений) и
    // запускаем трансляцию; бабл появится WS-эхом. Обычная точка/venue — как было,
    // оптимистичным WS-путём.
    if (opts?.livePeriod) {
      void managers.messages.sendGeoLive(numericChatId, lat, lng, opts.livePeriod, opts.heading, sendingParams).then((m) => {
        startLiveShare(managers, numericChatId, m.id, Date.now() + opts.livePeriod! * 1000)
      })
      return
    }
    const clientMsgId = mkClientMsgId()
    const geo = { lat, lng, ...opts }
    void managers.messages.sendText({ peerId: numericChatId, text: '', clientMsgId, type: 'geo', geo, ...sendingParams, optimistic: { senderId: meId ?? -1, replySnapshot } })
  }

  // Стикер (пикер/саджесты): оптимистичный бабл type 'sticker' с mediaId, по WS —
  // обычный send_message {type:'sticker', mediaId}; POST /use ведёт recent на бэке.
  // В черновике сначала создаётся приватный чат (как voice/файлы).
  const sendSticker = (st: { id: number; mediaId: number; emoji: string }) => {
    if (!canType || secretLocked || chat.type === 'secret') return
    const clientMsgId = mkClientMsgId()
    // Порт tweb `sendMessageWithDocument` (input.ts:4341-4355): пакет снимается
    // ДО отправки, `onMessageSent(clearDraft, true)` — сразу после неё.
    const sendingParams = getMessageSendingParams()
    const replySnapshot = replySnapshotForBubble()
    onMessageSent()
    atBottomRef.current = true; userScrolledUpRef.current = false
    void (async () => {
      let cid = numericChatId
      if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
      void managers.messages.sendText({ peerId: cid, text: '', clientMsgId, mediaId: st.mediaId, type: 'sticker', ...sendingParams, optimistic: isRealChat ? { senderId: meId ?? -1, replySnapshot } : undefined })
      void managers.stickers.use(st.id).catch(() => {})
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
    // Тот же порядок, что у стикера (tweb `sendMessageWithDocument`).
    const sendingParams = getMessageSendingParams()
    const replySnapshot = replySnapshotForBubble()
    onMessageSent()
    atBottomRef.current = true; userScrolledUpRef.current = false
    if (g.mediaId != null) {
      const mediaId = g.mediaId
      void (async () => {
        let cid = numericChatId
        if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
        void managers.messages.sendText({
          peerId: cid, text: '', clientMsgId, mediaId, type: 'video', ...sendingParams,
          // animated — это САМ предмет вкладки GIF (tweb sendFile({isAnimated}) для
          // гифки): без него бабл «отправляется…» описан обычным видео и рисуется
          // видео-баблом с плашкой play, а не автоплей-циклом.
          optimistic: isRealChat ? { senderId: meId ?? -1, replySnapshot, media: { width: g.width, height: g.height, mime: g.mime, size: g.size, name: g.fileName, animated: true } } : undefined,
        })
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
      // Бабл, локальное превью, аплоад и отправка — внутри sendFile (порт tweb).
      // media_id возвращается сюда только ради автосохранения отправленного
      // Tenor-гифа в /gifs/saved (Telegram: «отправил → появился в сохранённых»).
      const { mediaId } = await managers.messages.sendFile({
        peerId: numericChatId, clientMsgId, senderId: meId ?? -1, file: blob, type: 'video',
        mime: 'video/mp4', fileName: 'tenor.mp4', width: g.width, height: g.height,
        // tweb `sendFile({isAnimated: true})` для гифки — см. sendGif выше.
        isMedia: true, isAnimated: true, ...sendingParams, replySnapshot,
      })
      if (mediaId != null) void managers.stickers.saveGif(mediaId).catch(() => {})
    })()
  }

  // Контакт: в оптимистичный бабл идёт локальный снимок имени (телефон сервер
  // гидрирует по аккаунту — приедет с echo-фреймом new_message).
  const sendContact = (userId: number, name: string) => {
    const clientMsgId = mkClientMsgId()
    const sendingParams = getMessageSendingParams()
    const replySnapshot = replySnapshotForBubble()
    onMessageSent()
    atBottomRef.current = true; userScrolledUpRef.current = false
    void managers.messages.sendText({ peerId: numericChatId, text: '', clientMsgId, type: 'contact', contactUserId: userId, ...sendingParams, optimistic: { senderId: meId ?? -1, contactName: name, replySnapshot } })
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

  // asFile=true sends without "media" treatment (a photo/video becomes a
  // downloadable document). Otherwise the type is inferred from the mime.
  // caption (optional) is attached as the message text.
  // sendingParams/replySnapshot приходят СНАРУЖИ (sendPendingMedia снимает их до
  // цикла): в tweb попап медиа тоже снимает пакет один раз и раздаёт его всем
  // файлам выборки (`newMedia.ts:922` → `sendGrouped({...sendingParams, ...})`),
  // а плашку гасит после цикла (`newMedia.ts:996-998`, `input.onHelperCancel()`).
  const onPickFile = async (
    input: File, asFile = false, caption = '', groupedId?: string, paidMediaPrice?: number | null, spoiler = false,
    sendingParams: MessageSendingParams = {}, replySnapshot?: { peerId: number; name: string; text: string },
  ) => {
    if (!isRealChat || secretLocked) return
    const origMime = input.type || 'application/octet-stream'
    const type = asFile
      ? 'document'
      : origMime.startsWith('image/') ? 'photo'
      : origMime.startsWith('video/') ? 'video'
      : origMime.startsWith('audio/') ? 'audio'
      : 'document'
    // Фото «как медиа»: подготовка 1:1 с tweb (scaleImageForTelegram) ПЕРЕД
    // аплоадом — ресайз стороны >2560, пережатие тяжёлого lossless (png/bmp >2МБ)
    // и конвертация несовместимых форматов в jpeg. Отдаёт итоговые width/height и
    // файл с обновлённым mime/именем. Документы/видео/аудио не трогаем.
    const prepared = type === 'photo' ? await scaleImageForSend(input) : null
    const file = prepared?.file ?? input
    const mime = file.type || origMime
    const width = prepared?.width ?? 0
    const height = prepared?.height ?? 0
    // Длительность читаем ЗДЕСЬ (tweb newMedia.ts:1562-1579), а не ждём асинхронной
    // обработки на сервере: иначе бабл первого new_message остаётся без неё. mp3,
    // отправленный «как файл» (type='document'), тоже трек — смотрим на mime.
    const duration = origMime.startsWith('audio/')
      ? await probeMediaDuration(input, 'audio')
      : origMime.startsWith('video/')
        ? await probeMediaDuration(input, 'video')
        : undefined
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    // «Отправляет файл/фото/видео/аудио» у собеседника на время аплоада
    // (tweb sendMessageUpload*Action). Сам пинг крутит владелец аплоада —
    // messages.sendFile в воркере; здесь только выбор действия по типу.
    const uploadAction = type === 'photo' ? 'upload_photo' as const
      : type === 'video' ? 'upload_video' as const
      : type === 'audio' ? 'upload_audio' as const
      : 'upload_file' as const
    // Фото/видео как медиа (tweb isMedia): бабл появляется СРАЗУ с локальным
    // превью и кольцом прогресса (tweb is_outgoing + ProgressivePreloader).
    const isVisual = (type === 'photo' || type === 'video') && !asFile
    atBottomRef.current = true; userScrolledUpRef.current = false
    // Секретный чат (E2E): шифруем байты своим ключом файла, грузим ciphertext как
    // непрозрачный blob, key/iv кладём в зашифрованный payload (secret.sendMedia).
    // Шифрование и локальное превью — тоже в воркере (ключи живут там), см.
    // secretManager.sendMedia; сюда возвращается только плейнтекст-буфер.
    // Документы — без оптимистичного бабла (приезжают echo).
    if (chat.type === 'secret') {
      const bytes = await file.arrayBuffer()
      try {
        await managers.secret.sendMedia({
          peerId: numericChatId, bytes, name: file.name, mime, size: file.size, mediaType: type, ttlSeconds: null, clientMsgId,
          ...sendingParams,
          ...(isVisual ? { text: caption, optimistic: { senderId: meId ?? -1, type, media: { width, height, mime, size: file.size, name: file.name } } } : {}),
        })
      } catch {
        // Ключ чата отсутствует / оффлайн — красную пометку на бабле поставил
        // владелец (secretManager.sendMedia), здесь ловим только чтобы не ронять
        // unhandled rejection.
      }
      return
    }
    // Всё остальное — один вызов владельца (порт tweb sendFile): бабл, локальное
    // превью, аплоад байтов, приклейка media_id и отправка кадра живут в
    // менеджере воркера. Вкладка отдаёт только посчитанную DOM-ом мету файла
    // (width/height/duration) — ровно как поля SendFileArgs в оригинале.
    // Большие файлы идут чанковым/резюмируемым путём внутри mediaManager.
    await managers.messages.sendFile({
      peerId: numericChatId, clientMsgId, senderId: meId ?? -1, file, type, mime,
      fileName: file.name, caption, width, height, duration,
      ...sendingParams, replySnapshot, groupedId, paidMediaPrice, isMedia: isVisual, uploadAction,
      // Спойлер имеет смысл только у визуального медиа: «как файл» прятать нечего
      // (tweb гейтит пункт меню тем же условием — canToggleSpoilers).
      spoiler: spoiler && isVisual,
    })
  }

  // Picked files awaiting the compose popup (caption + as-media/as-file choice).
  const [pendingMedia, setPendingMedia] = useState<{ files: File[]; asFile: boolean } | null>(null)
  const sendPendingMedia = async (caption: string, asFile: boolean, paidMediaPrice?: number | null, spoilers?: boolean[]) => {
    const pm = pendingMedia
    setPendingMedia(null)
    if (!pm) return
    // Пакет — один на всю выборку (tweb: попап снимает `getMessageSendingParams()`
    // один раз до `iterate`), плашка гаснет здесь же: в оригинале это
    // `input.onHelperCancel()` после цикла (`newMedia.ts:996-998`).
    const sendingParams = getMessageSendingParams()
    const replySnapshot = replySnapshotForBubble()
    onMessageSent()
    // Несколько фото/видео «как медиа» → один альбом (Telegram grouped_id):
    // общий id на все сообщения группы, подпись — на первом (tweb).
    const asAlbum = !asFile
      && pm.files.length > 1
      && pm.files.every((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
    const groupedId = asAlbum ? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : undefined
    // Платное медиа — только для одиночного фото/видео «как медиа» (см. SendMediaPopup).
    const price = !asFile && !asAlbum && pm.files.length === 1 ? paidMediaPrice ?? null : null
    for (let i = 0; i < pm.files.length; i++) {
      await onPickFile(pm.files[i], asFile, i === 0 ? caption : '', groupedId, price, !!spoilers?.[i], sendingParams, replySnapshot)
    }
  }

  // Called by the Composer with the trimmed draft text (the Composer owns the
  // text state + clears itself afterwards); we route by chat kind / edit / reply.
  const send = (text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent = false, effect: EmojiEffectKind | null = null) => {
    if (!canType || secretLocked) return
    // Пакет параметров — ОДИН на весь ход отправки (порт tweb: `send()` в
    // `input.ts` снимает `getMessageSendingParams()` один раз и раздаёт всем
    // вызовам, включая части разбитого драфта, :4341/4230).
    const sendingParams = getMessageSendingParams({ silent, effect })
    // Forward finalize (tweb sendMessageWithForward): пересылаем отложенные
    // сообщения из исходного чата, затем — набранный комментарий как обычное
    // сообщение (если он есть). Комментарий шлём ПОСЛЕ форварда — как в Telegram
    // (пересланные сверху, подпись под ними). Пустой инпут → просто форвард.
    if (forward) {
      const fwd = forward
      setForward(null)
      onMessageSent()
      atBottomRef.current = true; userScrolledUpRef.current = false
      void (async () => {
        try {
          await managers.messages.forwardMessages(numericChatId, fwd.sourcePeerId, fwd.msgIds, { dropAuthor: fwd.dropAuthor, dropCaption: fwd.dropCaption })
        } catch (err) {
          console.error('forward failed', err)
          return
        }
        if (text) {
          for (const p of splitRich(text, entities ?? [], MAX_MESSAGE_LEN)) {
            void managers.messages.sendText({ peerId: numericChatId, text: p.text, entities: p.entities.length ? p.entities : undefined, clientMsgId: mkClientMsgId(), ...sendingParams })
          }
        }
      })()
      return
    }
    if (!text) return
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
      onMessageSent()
      void (async () => {
        const id = await managers.chats.createPrivate(draftPeerId)
        for (let k = 0; k < parts.length; k++) {
          await managers.messages.sendText({ peerId: id, text: parts[k].text, entities: entOf(parts[k]), clientMsgId: mkClientMsgId(k), ...sendingParams })
        }
        onChatCreated?.(id)
      })()
      return
    }
    if (isRealChat && isChannel) {
      // Channels post through the REST channel endpoint (not the group WS send);
      // optimistic append (sender is the posting admin = me), reusing the existing
      // optimistic + scroll-to-bottom pattern. Live echo arrives via rt:new_message.
      // Форматирование идёт тем же путём, что и в обычных чатах: разметка из
      // композера (entOf) — и в оптимистичный бабл, и в REST-тело поста.
      onMessageSent()
      atBottomRef.current = true; userScrolledUpRef.current = false
      for (let k = 0; k < parts.length; k++) {
        const clientMsgId = mkClientMsgId(k)
        const entities = entOf(parts[k])
        // Пост канала уходит по REST (не через WS-путь sendMessage), поэтому бабл
        // здесь заводится отдельным вызовом — sendMessage тут не участвует вовсе.
        // ПАКЕТ СЮДА НЕ ЕДЕТ, и это не забывчивость: эндпоинт
        // POST /channels/{id}/messages принимает ровно {text, entities,
        // client_msg_id} (backend/internal/adapter/delivery/http/channel_handler.go:65-71
        // → PostToChannel с позиционной сигнатурой). Довести пакет сюда = менять
        // сигнатуру usecase и её шесть тест-вызовов — отдельная работа по бэкенду,
        // см. отчёт задачи. Исключение зафиксировано в core/sendingParams.test.ts.
        void managers.channels.post(numericChatId, parts[k].text, clientMsgId, entities, { senderId: meId ?? -1, threadRootId })
      }
      return
    }
    // Plain real chat (private/group).
    onMessageSent()
    // Пакет (в т.ч. ответ и эффект) едет КАЖДОЙ части — 1:1 с tweb, где хвост
    // `sendText` рекурсивно шлёт остаток тем же `options` (:1508-1516).
    // Локальная canvas-анимация эффекта при этом одна на ход (см. sendReal).
    parts.forEach((p, k) => sendReal(p.text, sendingParams, entOf(p), ttlSeconds ?? null, k === 0))
  }

  // Throttled outgoing typing frame (real chats); called by the Composer on each
  // keystroke. Kept here so the Composer needs no chat/managers knowledge.
  const lastTypingRef = useRef(0)
  const onComposerTyping = useEvent(() => {
    if (!isRealChat) return
    const now = performance.now()
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now
      void managers.realtime.sendTyping({ peerId: numericChatId })
    }
  })

  return {
    reply, setReply, editing, setEditing,
    forward, setForward,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
    sendGeo, sendContact, sendSticker, sendGif,
    // Пути отправки, живущие ВНЕ этого хука (опрос — свой попап и свой REST),
    // получают тот же пакет и тот же сброс плашки, а не собирают поля сами.
    getMessageSendingParams, onMessageSent,
  }
}
