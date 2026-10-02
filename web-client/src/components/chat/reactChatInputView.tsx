// ВРЕМЕННО до К-4: React-дерево острова композера (`reactChatInput.ts`) —
// композерная часть прежнего `Chat.tsx`: `Composer`, плашка вместо ввода
// (`ChatInputControl`), кнопка «вниз», меню вложений и превью медиа. Узел-хост —
// `chatInput` класса (`.chat-input.chat-input-main`), дерево рисует его детей
// в порядке tweb `input.ts` (`construct` :471-490, `constructGoDownButton`
// :615): `.chat-input-container` > `.rows-wrapper-wrapper` (композер) · два
// `.fake-wrapper` · «вниз» · `.chat-input-control`.
//
// Что сюда НЕ переехало из `Chat.tsx` — разбор в контракте К-3 и строки
// бэклога плана: отложенные и расписание (Б-25, Б-32), медленный режим и
// платные сообщения (Б-37), клавиатура бота (Б-36), панель выделения (Б-23),
// угловые кнопки упоминаний/реакций (Б-27), «переслать в другой чат» и
// пересылка в один чат (Б-28).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useManagers } from '@core/hooks/useManagers'
import { useChatList } from '@core/hooks/useChatList'
import { usePeers } from '@core/hooks/usePeers'
import { useEvent } from '@core/hooks/useEvent'
import { useMirrorWindow } from '@core/hooks/useMirrorWindow'
import { useChatSend } from '@core/hooks/useChatSend'
import { useComposerDraft } from '@core/hooks/useComposerDraft'
import { useMentionPeers } from '@core/hooks/useMentionPeers'
import { useSendAs } from '@core/hooks/useSendAs'
import { chatPeerId, isDialogChat, resolveChatEntity } from '@core/chatEntity'
import { cachedChat, cachedUser } from '@core/peerCache'
import { hasRights } from '@core/peers/rights'
import { isUser, NULL_PEER_ID } from '@core/peers/peerId'
import { isPeerMuted } from '@core/dialogs/notifySettings'
import { draftReplyToId as draftReplyOf } from '@core/dialogs/draft'
import { windowReplyState } from '@core/draftReply'
import { winKey } from '@core/history/messagesMirror'
import { messageToConvMsg } from '@core/messageToConvMsg'
import { getMessageText, type MessageEntity } from '@core/models'
import type { InlineResult } from '@core/managers/botsManager'
import type { Sticker } from '@core/managers/stickersManager'
import type { GifItem } from '@core/gifs'
import type { EmojiEffectKind } from '@core/effects/emojiEffects'
import { openWebApp } from '@core/webapp'
import appImManager from '@lib/appImManager'
import { useChatsStore } from '@stores/chatsStore'
import { useSecretChatStore } from '@stores/secretChatStore'
import { openPopup } from '@stores/popupStore'
import Composer from '@components/Composer'
import ChatInputControl, { isControlNeeded, type ControlFlags } from '@components/conversation/ChatInputControl'
import { computeControlPlates } from '@components/conversation/controlPlates'
import { useChatInputCenter } from '@components/conversation/useChatInputCenter'
import ScrollDownFab from '@components/conversation/ScrollDownFab'
import { goDownUnreadCount } from '@components/conversation/goDownUnreadCount'
import SendMediaPopup from '@components/messages/SendMediaPopup'
import AttachMenu from '@components/AttachMenu'
import CreatePollPopup from '@components/CreatePollPopup'
import CreateChecklistPopup from '@components/CreateChecklistPopup'
import LocationPicker from '@components/LocationPicker'
import { ContactPicker } from '@components/messages/ChatDialogs'
import SendGiftPopup from '@components/stars/SendGiftPopup'
import SuggestPostPopup from '@components/SuggestPostPopup'
import type ReactChatInput from './reactChatInput'

export type ReactChatInputViewProps = {
  input: ReactChatInput
  peerId: PeerId
  threadId?: number
  thread?: { title: string, closed?: boolean }
}

export default function ReactChatInputView({ input, peerId, threadId, thread }: ReactChatInputViewProps) {
  const managers = useManagers()
  const chatList = useChatList()
  // пир без диалога: карточку в зеркало приносит объявленный пробел (`usePeers`)
  usePeers(useMemo(() => [peerId], [peerId]))
  const chat = resolveChatEntity({ peerId, thread }, chatList)
  const numericChatId = chatPeerId(chat)
  const isRealChat = isDialogChat(chat)
  const isChannel = chat.type === 'channel'
  const isGroup = chat.type === 'group'
  const isSecret = chat.type === 'secret'
  const meId = useChatsStore((st) => st.meId)

  // Права на запись — правило прежнего `useChatInfoCard` по краткому
  // конструктору `channel` из зеркала пиров (у tweb — `chat.canSend`,
  // `chat.ts:1340`). Канал: пишут только постящие; группа — дефолт-права.
  const chatPeer = isRealChat ? cachedChat(numericChatId) : undefined
  const canPostChannel = hasRights(chatPeer, 'post_messages')
  const canType = !isChannel || canPostChannel
  const permissionsKnown = !isChannel || !isRealChat || chatPeer !== undefined
  const canSendToUser = isUser(numericChatId)
  const canSendText = isChannel ? canPostChannel : canSendToUser || chatPeer === undefined || hasRights(chatPeer, 'send_messages')
  const canSendMedia = isChannel ? canPostChannel : canSendToUser || chatPeer === undefined || hasRights(chatPeer, 'send_media')
  const composerUsable = canType && canSendText

  // Цвет плашки ответа — акцент темы чата (`applyContainerTheme` пишет его на `.chat`).
  const accentColor = getComputedStyle(input.chat.container).getPropertyValue('--primary-color').trim() || '#3390ec'

  const mentionPeers = useMentionPeers(isRealChat ? numericChatId : null, isRealChat && isGroup)

  // Секретный чат: статус E2E-handshake (secretChatStore ← realtimeBridge). Пока
  // ключа нет — отправка запрещена, вместо ввода — плашка accept/await/rejected.
  const secretStatus = useSecretChatStore((st) => st.byChat[numericChatId]?.status)
  useEffect(() => {
    if (!isSecret || !isRealChat) return
    void managers.secret.sync(numericChatId, useChatsStore.getState().meId ?? -1)
  }, [isSecret, isRealChat, numericChatId, managers])
  const secretLocked = isSecret && secretStatus !== 'established'
  const [secretBusy, setSecretBusy] = useState(false)
  const onSecretAccept = useEvent(async () => {
    if (secretBusy) return
    setSecretBusy(true)
    try {
      const res = await managers.secret.accept(numericChatId)
      useSecretChatStore.getState().setStatus(numericChatId, 'established')
      useSecretChatStore.getState().setFingerprint(numericChatId, res.fingerprint)
    } finally {
      setSecretBusy(false)
    }
  })
  const onSecretReject = useEvent(async () => {
    if (secretBusy) return
    setSecretBusy(true)
    try {
      await managers.secret.reject(numericChatId)
      useSecretChatStore.getState().setStatus(numericChatId, 'rejected')
    } finally {
      setSecretBusy(false)
    }
  })

  // Окно из ЗЕРКАЛА — то же, что рисует лента: плашка ответа по номеру,
  // правка последнего своего, «Начать» у бота без истории.
  const mirrorMsgs = useMirrorWindow(isRealChat ? winKey(numericChatId, threadId) : null)
  const replyStateFor = useEvent((mid: number) =>
    windowReplyState(mirrorMsgs, mid, chat.name, accentColor, {
      meId: meId ?? undefined, peerId: numericChatId, isGroup,
    }))

  // Первое сообщение пиру без диалога заводит диалог; чат открывается тем же
  // `setInnerPeer` (тот же пир — тот же инстанс), список догоняет `refresh()`.
  const onChatCreated = useEvent((createdPeerId: PeerId) => {
    void appImManager.setInnerPeer({ peerId: createdPeerId })
    void managers.dialogs.refresh().catch(() => {})
  })

  const sendAs = useSendAs(numericChatId, isRealChat && isGroup && !threadId, meId)
  const sendAsPeerId = sendAs.currentId !== NULL_PEER_ID && sendAs.currentId !== meId ? sendAs.currentId : null

  const {
    reply, setReply, editing, setEditing,
    forward, setForward,
    rec,
    send,
    onComposerTyping,
    pendingMedia, setPendingMedia, sendPendingMedia,
    openPicker, fileInputRef, pickAsFileRef,
    sendGeo, sendContact, sendSticker, sendGif,
    getMessageSendingParams, onMessageSent,
  } = useChatSend({
    chat, numericChatId, isRealChat, isChannel,
    draftPeerId: chat.noDialog ? numericChatId : null,
    canType, secretLocked, meId, threadRootId: threadId, sendAsPeerId,
    onChatCreated,
  })

  // Облачный черновик и ответ из него (`draft.reply_to`): ответ ставится один раз,
  // когда окно уже есть; вне окна — пропуск.
  const { initialDraft, onDraftChange } = useComposerDraft(isRealChat && !threadId ? numericChatId : null, reply?.msgId ?? null)
  const draftReplyToId = useChatsStore((st) => (isRealChat && !threadId
    ? draftReplyOf(st.dialogs.find((d) => d.peerId === numericChatId)?.draft)
    : null))
  const replyRestoredRef = useRef(false)
  useEffect(() => {
    if (replyRestoredRef.current || draftReplyToId == null || mirrorMsgs.length === 0) return
    replyRestoredRef.current = true
    if (reply) return
    const rs = replyStateFor(draftReplyToId)
    if (rs) setReply(rs)
  }, [draftReplyToId, mirrorMsgs, reply, replyStateFor, setReply])

  // Мьют — срок (`notify_settings.mute_until`), тот же предикат, что у списка.
  const dialogNotify = useChatsStore((st) =>
    isRealChat ? st.dialogs.find((d) => d.peerId === numericChatId)?.notify_settings : undefined,
  )
  const muted = dialogNotify ? isPeerMuted(dialogNotify, Math.floor(Date.now() / 1000)) : !!chat.muted
  const applyMute = (next: boolean) => {
    if (!isRealChat) return
    void managers.groups.setMute(numericChatId, next).catch(() => {})
  }

  // Бот-собеседник: кнопка «Начать» и кнопка-меню mini-app.
  const privatePeer = chat.type === 'private' && isRealChat ? cachedUser(numericChatId) : undefined
  const isBotChat = privatePeer?._ === 'user' && !!privatePeer.pFlags?.bot
  const [botMenu, setBotMenu] = useState<{ text: string, url: string } | null>(null)
  useEffect(() => {
    setBotMenu(null)
    if (!isBotChat) return
    let alive = true
    void managers.bots.menuButton(numericChatId).then((mb) => { if (alive && mb.text && mb.url) setBotMenu(mb) }).catch(() => {})
    return () => { alive = false }
  }, [isBotChat, numericChatId, managers])
  const botStart = isBotChat && isRealChat && mirrorMsgs.length === 0

  // Значок кнопки «вниз» — `dialog.unread_count` (tweb `input.ts::setUnreadCount`).
  const unreadBelow = useChatsStore((st) => goDownUnreadCount(st.dialogs.find((x) => x.peerId === numericChatId)))

  const onComposerSend = useEvent((text: string, entities?: MessageEntity[], ttlSeconds?: number | null, silent?: boolean, effect?: EmojiEffectKind | null) => {
    send(text, entities, ttlSeconds, silent ?? false, effect ?? null)
  })

  // Плашка вместо строки ввода — цепочка `haveSomethingInControl` (`computeControlPlates`).
  const threadClosed = !!thread?.closed
  const { botStartPlate, secretPlate, groupRestricted, channelMutePlate } = computeControlPlates({
    composerUsable, permissionsKnown, isGroup, canSendText, botStart, secretLocked, threadClosed,
  })
  const controlFlags = useMemo<ControlFlags>(() => ({
    canUnblock: chat.type === 'private' && !isBotChat,
    botStart: botStartPlate,
    channelMute: channelMutePlate,
    gift: channelMutePlate,
    groupRestricted,
    threadClosed,
    secret: secretPlate
      ? { status: secretStatus === 'requested' ? 'requested' : secretStatus === 'rejected' ? 'rejected' : 'awaiting',
          busy: secretBusy, onAccept: onSecretAccept, onReject: onSecretReject }
      : null,
  }), [chat.type, isBotChat, botStartPlate, channelMutePlate, groupRestricted, threadClosed, secretPlate, secretStatus, secretBusy, onSecretAccept, onSecretReject])
  const onBotStartClick = useEvent(() => onComposerSend('/start'))
  const onControlMuteClick = useEvent(() => applyMute(!muted))
  const onControlGiftClick = useEvent(() => {
    if (chat.type !== 'private') return
    const toUserId = Number(chat.id)
    openPopup((p) => (
      <SendGiftPopup open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} toUserId={toUserId} toName={chat.name} />
    ))
  })
  const onSuggestPostClick = useEvent(() => openPopup((p) => (
    <SuggestPostPopup chatId={numericChatId} onClose={p.destroy} />
  )))

  // Порт `_center()` (tweb `input.ts:1963`): морф `.rows-wrapper` в плашку.
  const inputContainerRef = useRef<HTMLDivElement | null>(null)
  useChatInputCenter(inputContainerRef, isControlNeeded(controlFlags) ? 'control' : null)

  // Инлайн-режим: «@username» → id бота (кэш), затем выдача бэком.
  const inlineBotCache = useRef<Map<string, number | null>>(new Map())
  const onComposerInlineQuery = useEvent(async (username: string, query: string): Promise<InlineResult[] | null> => {
    const uname = username.toLowerCase()
    let botId = inlineBotCache.current.get(uname)
    if (botId === undefined) {
      try {
        const res = await managers.channels.search(uname)
        const u = res.users.find((x) => x.username?.toLowerCase() === uname)
        botId = u ? u.id : null
      } catch { botId = null }
      inlineBotCache.current.set(uname, botId)
    }
    if (botId == null) return null
    try { return (await managers.bots.inline(botId, query)).results } catch { return null }
  })
  const onComposerPickInline = useEvent((r: InlineResult) => { send(r.messageText) })

  // Стикеры и GIF: каналы постят через REST (стикеров нет), секретные — E2E-путь.
  const canSendStickers = canType && canSendMedia && !isChannel && !isSecret
  const onComposerPickSticker = useEvent((st: Sticker) => { sendSticker(st) })
  const onComposerPickGif = useEvent((g: GifItem) => { sendGif(g) })

  // Ручки классу (расхождение 1 `reactChatInput.ts`).
  const onReplyTo = useEvent((mid: number) => {
    const rs = replyStateFor(mid)
    if (rs) { setReply(rs); setEditing(null) }
  })
  const onEditMid = useEvent((mid: number) => {
    const raw = mirrorMsgs.find((m) => m.id === mid)
    if (!raw) return
    setEditing({ msgId: raw.id, text: getMessageText(raw), entities: raw._ === 'message' ? raw.entities : undefined })
    setReply(null)
  })
  const onSendDocument = useEvent((document: Sticker | GifItem) => {
    if (!canSendStickers) return false
    if ('_' in document) onComposerPickSticker(document)
    else onComposerPickGif(document)
    return true
  })
  const onClearHelper = useEvent(() => {
    setReply(null)
    setEditing(null)
    setForward(null)
  })
  const canSendPlainNow = useEvent(() => composerUsable && !secretLocked)
  useLayoutEffect(() => {
    const handle = {
      canSendPlain: canSendPlainNow,
      initMessageReply: ({ replyToMsgId }: { replyToMsgId: number }) => onReplyTo(replyToMsgId),
      initMessageEditing: onEditMid,
      sendDocument: onSendDocument,
      clearHelper: onClearHelper,
    }
    input.handle = handle
    return () => {
      if (input.handle === handle) input.handle = undefined
    }
  }, [input, canSendPlainNow, onReplyTo, onEditMid, onSendDocument, onClearHelper])

  const onComposerCancelReply = useEvent(() => setReply(null))
  const onComposerCancelEdit = useEvent(() => setEditing(null))
  const onComposerCancelForward = useEvent(() => setForward(null))
  const onComposerForwardOption = useEvent((opt: { dropAuthor?: boolean, dropCaption?: boolean }) =>
    setForward((f) => (f ? { ...f, ...opt } : f)))
  // Плашку пересылки ставил только пикер пересылки (`useMessageActions.doForward`
  // → `pendingForward`), а он ушёл в бэклог (Б-28): до его возврата плашки нет,
  // и пункт «переслать в другой чат» недостижим. Закрывает плашку, если она
  // всё же есть.
  const onComposerForwardAnother = useEvent(() => setForward(null))

  // Меню вложений (tweb `input.ts:1115-1352`): фото/видео, файл, опрос,
  // чек-лист, геопозиция, контакт.
  const openPoll = () => openPopup((p) => (
    <CreatePollPopup
      onClose={p.destroy}
      onCreate={(poll) => {
        p.destroy()
        const sendingParams = getMessageSendingParams()
        onMessageSent()
        void managers.messages
          .sendPoll(numericChatId, { ...poll, clientMsgId: crypto.randomUUID(), ...sendingParams })
          .then(() => {})
      }}
    />
  ))
  const openChecklist = () => openPopup((p) => (
    <CreateChecklistPopup
      onClose={p.destroy}
      onCreate={(c) => {
        p.destroy()
        void managers.messages
          .sendChecklist(numericChatId, { ...c, clientMsgId: crypto.randomUUID() })
          .then(() => {})
      }}
    />
  ))
  const openLocation = () => openPopup((p) => (
    <LocationPicker open={p.open} onClose={p.requestClose} onExitComplete={p.onExitComplete} onSend={(lat, lng, opts) => sendGeo(lat, lng, opts)} />
  ))
  const openContactPicker = () => openPopup((p) => (
    <ContactPicker
      onPick={(userId, name) => { p.destroy(); sendContact(userId, name) }}
      onClose={p.destroy}
    />
  ))
  const onComposerOpenAttach = useEvent((r: DOMRect) => openPopup((p) => (
    <AttachMenu
      anchor={{ left: r.left, bottom: window.innerHeight - r.top + 8 }}
      onClose={p.destroy}
      onPhotoVideo={isRealChat ? () => openPicker('image/*,video/*', false) : undefined}
      onFile={isRealChat ? () => openPicker('*/*', true) : undefined}
      onPoll={isRealChat && (isGroup || isChannel) ? openPoll : undefined}
      onChecklist={isRealChat ? openChecklist : undefined}
      onLocation={isRealChat ? openLocation : undefined}
      onContact={isRealChat ? openContactPicker : undefined}
    />
  )))
  const onComposerPasteFiles = useEvent((files: File[]) => setPendingMedia({ files, asFile: false }))

  // ↑ на пустом поле — правка своего последнего (tweb `editLastMessage`).
  const onComposerEditLast = useEvent(() => {
    for (let i = mirrorMsgs.length - 1; i >= 0; i--) {
      const raw = mirrorMsgs[i]
      if (raw._ !== 'message') continue
      // «Своё» — правило стороны бабла ленты (`isOutMessage`).
      const conv = messageToConvMsg(raw, meId, { isMegagroup: isGroup })
      if (!conv.out) continue
      setEditing({ msgId: raw.id, text: conv.text ?? '', entities: raw.entities })
      setReply(null)
      return
    }
  })
  // Ctrl/Cmd+↑ — ответ на последнее подходящее сообщение окна.
  const onComposerReplyPrev = useEvent(() => {
    for (let i = mirrorMsgs.length - 1; i >= 0; i--) {
      const raw = mirrorMsgs[i]
      if (raw._ !== 'message') continue
      const rs = replyStateFor(raw.id)
      if (rs) { setReply(rs); setEditing(null); return }
    }
  })

  return (
    <>
      <div ref={inputContainerRef} className="chat-input-container chat-input-main-container">
        <Composer
          key={chat.id}
          peerId={numericChatId}
          reply={reply}
          editing={editing}
          forward={forward}
          rec={rec}
          onSend={onComposerSend}
          onTyping={onComposerTyping}
          onPickSticker={canSendStickers ? onComposerPickSticker : undefined}
          onPickGif={canSendStickers ? onComposerPickGif : undefined}
          onCancelReply={onComposerCancelReply}
          onCancelEdit={onComposerCancelEdit}
          onCancelForward={onComposerCancelForward}
          onForwardOption={onComposerForwardOption}
          onForwardAnother={onComposerForwardAnother}
          onOpenAttach={onComposerOpenAttach}
          onPasteFiles={isRealChat && canSendMedia ? onComposerPasteFiles : undefined}
          initialDraft={initialDraft}
          onDraftChange={isRealChat ? onDraftChange : undefined}
          mentions={isGroup && mentionPeers.length > 0 ? mentionPeers : undefined}
          onInlineQuery={isRealChat ? onComposerInlineQuery : undefined}
          onPickInline={onComposerPickInline}
          botMenuButton={botMenu ? { text: botMenu.text, onClick: () => openWebApp({ url: botMenu.url, botName: chat.name }) } : undefined}
          secret={isSecret}
          canSendMedia={canSendMedia}
          sendAs={sendAs.peers.length > 1 ? { peers: sendAs.peers, currentId: sendAs.currentId, onSelect: sendAs.select } : undefined}
          onEditLast={onComposerEditLast}
          onReplyPrev={onComposerReplyPrev}
        />

        {/* Невидимые эталоны геометрии для _center() — input.ts:484-490. */}
        <div className="fake-wrapper fake-rows-wrapper" />
        <div className="fake-wrapper fake-selection-wrapper" />

        {/* tweb input.ts:638-650 — кнопка «вниз» в .chat-input-container */}
        <ScrollDownFab unreadBelow={unreadBelow} onClick={() => input.chat.bubbles?.onGoDownClick()} />

        <ChatInputControl
          peerId={numericChatId}
          muted={muted}
          onBotStart={onBotStartClick}
          onToggleMute={onControlMuteClick}
          onGift={onControlGiftClick}
          onSuggestPost={isChannel && isRealChat ? onSuggestPostClick : undefined}
          {...controlFlags}
        />
      </div>

      {/* Скрытый файловый пикер меню вложений (`openPicker`) — вне
          `.chat-input-container`: свой `input[file]` у строки ввода tweb один, и
          он уже есть в композере. */}
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.currentTarget.value = ''
          if (files.length) setPendingMedia({ files, asFile: pickAsFileRef.current })
        }}
      />

      {pendingMedia && (
        <SendMediaPopup
          files={pendingMedia.files}
          initialAsFile={pendingMedia.asFile}
          onClose={() => setPendingMedia(null)}
          onSend={(caption, asFile, paidPrice, spoilers) => { void sendPendingMedia(caption, asFile, paidPrice, spoilers) }}
        />
      )}
    </>
  )
}
