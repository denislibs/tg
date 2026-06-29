// src/core/hooks/useChatSend.ts
//
// View-model hook for everything "outgoing" in a conversation: text/sticker/gif
// sends, media picking + upload, voice recording, the optimistic bubble, draft-chat
// creation on first send, and the throttled typing frame. It also owns the reply /
// editing composer state (set here on send, by the context menu via the returned
// setters, and read by the Composer).
//
// It does NOT own scroll intent — `atBottomRef`/`userScrolledUpRef` are passed in
// (they belong to the scroll state machine); sending just pins them to the bottom.
// Mock (design-time) chats keep their in-memory bubble list via the passed setters.
import { useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useEvent } from './useEvent'
import { useVoiceRecorder, fmtDur } from './useVoiceRecorder'
import { splitRich } from '../markdown'
import type { MessageEntity } from '../models'
import type { Chat, ConvMsg } from '../../data'
import type { MessageWindow } from './useMessageWindow'
import type { Managers } from '../../client/bootstrap'

// Max characters per message (matches the backend's maxMessageRunes / Telegram 4096).
// Longer drafts are split into several messages on send.
const MAX_MESSAGE_LEN = 4096

const replies = [
  'ахах да', 'ну ты даёшь 😄', 'согласен', 'хахаха', 'ладно', 'ок 👌', 'и не говори',
  'позже наберу', '🔥', 'да ну? серьёзно?', 'интересно', 'понятно', 'ну такое',
  'договорились 😌', 'я уже почти сплю 😴',
]

function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export type ReplyState = { msgId?: number; name: string; text: string; color: string } | null
export type EditState = { msgId: number; text: string; entities?: MessageEntity[] } | null

interface UseChatSendArgs {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  isChannel: boolean
  isGroup: boolean
  draftPeerId: number | null
  canType: boolean
  meId: number | null
  win: MessageWindow
  managers: Managers
  // Scroll intent (owned elsewhere): sending pins to the bottom.
  atBottomRef: MutableRefObject<boolean>
  userScrolledUpRef: MutableRefObject<boolean>
  // Mock (design-time) chat bubble list + typing indicator.
  setMockMsgs: Dispatch<SetStateAction<ConvMsg[]>>
  setTyping: Dispatch<SetStateAction<boolean>>
  onChatCreated?: (chatId: number) => void
}

export function useChatSend({
  chat,
  numericChatId,
  isRealChat,
  isChannel,
  isGroup,
  draftPeerId,
  canType,
  meId,
  win,
  managers,
  atBottomRef,
  userScrolledUpRef,
  setMockMsgs,
  setTyping,
  onChatCreated,
}: UseChatSendArgs) {
  // Reply / editing composer state (set on send, by the context menu via the
  // returned setters, and read by the Composer).
  const [reply, setReply] = useState<ReplyState>(null)
  const [editing, setEditing] = useState<EditState>(null)
  const setMsgs = setMockMsgs

  const canSendVoice = isRealChat || draftPeerId != null

  // Voice-recording mechanics live in useVoiceRecorder; here we only decide what to
  // do with a finished clip: upload + send on a real/draft chat, else a mock bubble.
  const pingVoiceTyping = () => { if (isRealChat) void managers.realtime.sendTyping({ chatId: numericChatId, action: 'voice' }) }
  const rec = useVoiceRecorder({
    capture: canSendVoice,
    onStart: pingVoiceTyping,
    onSecond: pingVoiceTyping,
    onComplete: async (r) => {
      if (!r) return
      const { secs, blob, mime } = r
      if (canSendVoice && blob) {
        const bytes = await blob.arrayBuffer()
        const mediaId = await managers.media.upload({ bytes, mime, size: blob.size, duration: secs })
        const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
        let cid = numericChatId
        if (draftPeerId != null) cid = await managers.chats.createPrivate(draftPeerId)
        atBottomRef.current = true; userScrolledUpRef.current = false
        if (isRealChat) win.appendOptimistic('', meId ?? -1, clientMsgId, mediaId, 'voice')
        void managers.realtime.sendMessage({ chatId: cid, text: '', clientMsgId, mediaId, type: 'voice' })
        window.dispatchEvent(new Event('tg-send'))
        if (draftPeerId != null) onChatCreated?.(cid)
        return
      }
      // mock chat: keep the design-time bubble + canned reply
      const waveform = Array.from({ length: 28 }, () => 0.25 + Math.random() * 0.75)
      setMsgs((prev) => [
        ...prev,
        { type: 'voice', out: true, time: nowTime(), status: 'sent', duration: fmtDur(secs), waveform },
      ])
      window.dispatchEvent(new Event('tg-send'))
      setTyping(true)
      window.setTimeout(() => {
        const canned = replies[Math.floor(Math.random() * replies.length)]
        setMsgs((prev) => [...prev, { type: 'text', out: false, text: canned, time: nowTime() }])
        setTyping(false)
      }, 1100 + Math.random() * 900)
    },
  })

  const replyToId = reply?.msgId ?? null
  const mkClientMsgId = (k = 0) => `c-${chat.id}-${performance.now()}-${k}-${Math.random().toString(36).slice(2)}`
  const sendReal = (text: string, entities?: MessageEntity[], replyTo: number | null = replyToId) => {
    const clientMsgId = mkClientMsgId()
    atBottomRef.current = true; userScrolledUpRef.current = false // sending pins to bottom
    win.appendOptimistic(text, meId ?? -1, clientMsgId, undefined, 'text', entities)
    void managers.realtime.sendMessage({ chatId: numericChatId, text, entities, clientMsgId, replyToId: replyTo })
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
  const onPickFile = async (file: File, asFile = false, caption = '') => {
    if (!isRealChat) return
    const mime = file.type || 'application/octet-stream'
    const type = asFile
      ? 'document'
      : mime.startsWith('image/') ? 'photo'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : 'document'
    const bytes = await file.arrayBuffer()
    const { width, height } = type === 'photo' ? await readImageSize(file) : { width: 0, height: 0 }
    const mediaId = await managers.media.upload({ bytes, mime, size: file.size, width, height, fileName: file.name })
    const clientMsgId = `c-${chat.id}-${performance.now()}-${Math.random().toString(36).slice(2)}`
    atBottomRef.current = true; userScrolledUpRef.current = false
    win.appendOptimistic(caption, meId ?? -1, clientMsgId, mediaId, type)
    void managers.realtime.sendMessage({ chatId: numericChatId, text: caption, clientMsgId, mediaId, type })
  }

  // Picked files awaiting the compose popup (caption + as-media/as-file choice).
  const [pendingMedia, setPendingMedia] = useState<{ files: File[]; asFile: boolean } | null>(null)
  const sendPendingMedia = async (caption: string, asFile: boolean) => {
    const pm = pendingMedia
    setPendingMedia(null)
    if (!pm) return
    // The caption goes on the first item only (albums come in Phase 3).
    for (let i = 0; i < pm.files.length; i++) {
      await onPickFile(pm.files[i], asFile, i === 0 ? caption : '')
    }
  }

  // Called by the Composer with the trimmed draft text (the Composer owns the
  // text state + clears itself afterwards); we route by chat kind / edit / reply.
  const send = (text: string, entities?: MessageEntity[]) => {
    if (!text || !canType) return
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
    if (isRealChat) {
      setReply(null)
      window.dispatchEvent(new Event('tg-send'))
      // reply attaches to the first message only (Telegram behaviour)
      parts.forEach((p, k) => sendReal(p.text, entOf(p), k === 0 ? replyToId : null))
      return
    }
    setMsgs((prev) => [
      ...prev,
      ...parts.map((p, k) => ({ type: 'text' as const, out: true, text: p.text, entities: entOf(p), time: nowTime(), status: 'sent' as const, reply: k === 0 ? reply ?? undefined : undefined })),
    ])
    setReply(null)
    setTyping(true)
    window.dispatchEvent(new Event('tg-send')) // shift the wallpaper gradient
    window.setTimeout(() => {
      const r = replies[Math.floor(Math.random() * replies.length)]
      const botReply: ConvMsg = { type: 'text', out: false, text: r, time: nowTime() }
      if (isGroup) {
        const senders = [
          { n: 'Аня', c: '#ee7aae' },
          { n: 'Макс', c: '#65aadd' },
          { n: 'Лёха', c: '#7bc862' },
        ]
        const s = senders[Math.floor(Math.random() * senders.length)]
        botReply.sender = s.n
        botReply.senderColor = s.c
      }
      setMsgs((prev) => [...prev, botReply])
      setTyping(false)
    }, 1100 + Math.random() * 900)
  }

  const sendSticker = (emoji: string) => {
    if (!canType) return
    setMsgs((prev) => [...prev, { type: 'sticker', out: true, emoji, time: nowTime(), status: 'sent' }])
    window.dispatchEvent(new Event('tg-send'))
  }
  const sendGif = (gradient: string) => {
    if (!canType) return
    setMsgs((prev) => [
      ...prev,
      { type: 'video', out: true, media: { gradient, emoji: '🎬' }, videoDuration: 'GIF', time: nowTime(), status: 'sent' },
    ])
    window.dispatchEvent(new Event('tg-send'))
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
    send, sendSticker, sendGif,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
  }
}
