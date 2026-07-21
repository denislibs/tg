// src/core/hooks/useMessageActions.tsx
//
// The message context menu + everything it triggers: reply / edit / copy / pin /
// delete / forward / select / download / "seen by". Owns the menu anchor plus the
// delete-confirm, forward-picker and viewers-popup state, and builds the menu item
// list (gated by chat kind and the target message). The View renders the menu /
// dialogs from the returned state and wires the feed's context-menu open to
// `openMsgMenu`.
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from '../../components/TgIcon'
import { peerColor } from '../../components/peerColor'
import { useEvent } from './useEvent'
import { useMessagesStore, winKey } from '../../stores/messagesStore'
import { useReportStore } from '../../stores/reportStore'
import { useSettingsStore } from '../../settings'
import type { Chat, ConvMsg } from '../../data'
import type { Managers } from '../../client/bootstrap'
import type { MessageWindow } from './useMessageWindow'
import type { ReplyState, EditState } from './useChatSend'

// closing — меню играет exit-анимацию ui-kit Menu; из стейта убирается только
// по onExitComplete (destroyMsgMenu), иначе размонтирование срезало бы анимацию.
type MsgMenu = { x: number; y: number; idx: number; originX: 'left' | 'right'; originY: 'top' | 'bottom'; closing?: boolean }
type DelState = { ids: number[]; canRevoke: boolean }
type ViewersState = { x: number; y: number; names: string[] }
type ReactedRow = { name: string; avatarUrl: string; emoji: string }
type ReactedState = { x: number; y: number; rows: ReactedRow[] }
export type MsgMenuItem = { icon: ReactNode; label: string; danger?: boolean; onClick?: (e: React.MouseEvent) => void }

interface UseMessageActionsArgs {
  chat: Chat
  numericChatId: number
  isRealChat: boolean
  win: MessageWindow
  msgs: ConvMsg[]
  meId: number | null
  pins: { id?: number }[]
  managers: Managers
  accent: string
  setReply: (r: ReplyState) => void
  setEditing: (e: EditState) => void
  setSelectionMode: (v: boolean) => void
  setSelected: (s: Set<number>) => void
  clearSelection: () => void
  onChatCreated?: (chatId: number) => void
}

export function useMessageActions({
  chat, numericChatId, isRealChat, win, msgs, meId, pins, managers, accent,
  setReply, setEditing, setSelectionMode, setSelected, clearSelection, onChatCreated,
}: UseMessageActionsArgs) {
  const [msgMenu, setMsgMenu] = useState<MsgMenu | null>(null)
  // Ответ с цитатой: текст, выделенный внутри сообщения на момент открытия меню
  // (right-click сохраняет выделение), плюс его offset (UTF-16) в тексте сообщения.
  // Используется startReply; сбрасывается, если выделения не было.
  const pendingQuoteRef = useRef<{ text: string; offset: number } | null>(null)
  const [delIds, setDelIds] = useState<DelState | null>(null)
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  const [viewers, setViewers] = useState<ViewersState | null>(null)
  const [reacted, setReacted] = useState<ReactedState | null>(null)
  const [translateText, setTranslateText] = useState<string | null>(null)
  const showTranslate = useSettingsStore((st) => st.showTranslateButton)
  // Секретный чат: скрываем forward/copy/quote (поведение Telegram) — остаётся
  // обычный reply, удаление и реакции.
  const isSecret = chat.type === 'secret'

  // Takes the message itself (not its index) so MessageRow needs no `index` prop —
  // that prop shifts on every loadOlder prepend and would re-render every row. We
  // resolve the index here, at click time, against the current msgs.
  const openMsgMenu = useEvent((e: React.MouseEvent, m: ConvMsg) => {
    e.preventDefault()
    // Сводный ConvMsg альбома синтезируется в ChatFeed и в msgs отсутствует —
    // ищем по id (меню действует на первый элемент группы).
    let idx = msgs.indexOf(m)
    if (idx < 0 && m.id != null) idx = msgs.findIndex((x) => x.id === m.id)
    if (idx < 0) return
    // Захватываем выделенный фрагмент этого сообщения для «ответа с цитатой»
    // (best-effort: текст выделения + его offset как indexOf в тексте сообщения).
    pendingQuoteRef.current = null
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && m.text) {
      const s = sel.toString().trim()
      const at = s ? m.text.indexOf(s) : -1
      if (s && at >= 0 && s !== m.text) pendingQuoteRef.current = { text: s, offset: at }
    }
    // Anchor a corner of the menu at the click point and grow from there (tweb):
    // flip to the left/upward when near the right/bottom edge so it stays on-screen.
    const MW = 256, MH = 440
    const openLeft = e.clientX + MW > window.innerWidth
    const openUp = e.clientY + MH > window.innerHeight
    setMsgMenu({ x: e.clientX, y: e.clientY, idx, originX: openLeft ? 'right' : 'left', originY: openUp ? 'bottom' : 'top' })
  })

  // Закрытие в два шага: closing=true запускает exit-анимацию ui-kit Menu,
  // окончательное снятие стейта — по onExitComplete (destroyMsgMenu).
  const closeMsgMenu = () => setMsgMenu((m) => (m ? { ...m, closing: true } : m))
  const destroyMsgMenu = () => setMsgMenu(null)

  // The selected message's raw window entry (real id/seq) for actions.
  const menuRawMsg = () => (msgMenu && isRealChat ? win.msgs[msgMenu.idx] : undefined)

  const startReply = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m && m.type !== 'date') {
      const name = m.out ? 'Дн' : m.sender ?? chat.name
      const color = m.out ? accent : m.senderColor ?? peerColor(name)
      setReply({ msgId: menuRawMsg()?.id, name, text: m.text ?? m.emoji ?? '', color, quote: pendingQuoteRef.current ?? undefined })
      setEditing(null)
      // Composer focuses itself when `reply` becomes set.
    }
    closeMsgMenu()
  }

  const startEdit = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const raw = menuRawMsg()
    if (m && raw?.id != null) {
      setEditing({ msgId: raw.id, text: m.text ?? '', entities: raw.entities })
      setReply(null)
      // Composer prefills its draft + focuses when `editing` becomes set.
    }
    closeMsgMenu()
  }

  const copyMsg = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) void navigator.clipboard?.writeText(m.text).catch(() => {})
    closeMsgMenu()
  }

  const startTranslate = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) setTranslateText(m.text)
    closeMsgMenu()
  }

  // "Delete for everyone" is offered when every target is the author's own or the
  // chat is private (Telegram). Backend re-checks; group admins handled server-side.
  const canRevokeAll = (ids: number[]) =>
    chat.type === 'private' || ids.every((id) => win.msgs.find((m) => m.id === id)?.senderId === meId)
  const openDelete = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setDelIds({ ids: [raw.id], canRevoke: canRevokeAll([raw.id]) })
    closeMsgMenu()
  }
  // Open the delete-confirm for an arbitrary id set (the selection bar's bulk delete).
  const openDeleteFor = (ids: number[]) => setDelIds({ ids, canRevoke: canRevokeAll(ids) })
  const doDelete = (revoke: boolean) => {
    if (!delIds || !isRealChat) return setDelIds(null)
    for (const id of delIds.ids) {
      win.applyDelete(id, !revoke) // optimistic — gone immediately
      void managers.messages.deleteMessage(numericChatId, id, revoke)
    }
    setDelIds(null)
    clearSelection()
  }

  // «Пожаловаться» на сообщение (tweb reportMessages): открывает глобальный
  // ReportPopup через reportStore (цель — чат + id сообщения).
  const openReport = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null && isRealChat) useReportStore.getState().open({ chatId: numericChatId, msgId: raw.id })
  }

  const openForward = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setForwardIds([raw.id])
    closeMsgMenu()
  }
  // Open the forward picker for an arbitrary id set (the selection bar's bulk forward).
  const openForwardFor = (ids: number[]) => setForwardIds(ids)
  // Пересылаем выбранные сообщения во все выбранные чаты (по одному REST-запросу
  // на чат — бэкенд принимает один toChatID). Последовательно и с изоляцией:
  // падение одного адресата не должно рвать остальные. По завершении переключаемся
  // на последний успешный чат (как открывает диалог Telegram после форварда).
  const doForward = async (chatIds: number[]) => {
    const ids = forwardIds
    setForwardIds(null)
    if (!ids?.length || !isRealChat || !chatIds.length) return
    let lastOk: number | null = null
    for (const toChatId of chatIds) {
      try {
        await managers.messages.forwardMessages(toChatId, numericChatId, ids)
        lastOk = toChatId
      } catch (err) {
        console.error('forward failed', { toChatId }, err)
      }
    }
    clearSelection()
    if (lastOk != null) onChatCreated?.(lastOk)
  }

  // Enter selection mode from the context menu, pre-selecting that message.
  const startSelect = () => {
    const raw = menuRawMsg()
    setSelectionMode(true)
    if (raw?.id != null) setSelected(new Set([raw.id]))
    closeMsgMenu()
  }

  const togglePin = () => {
    const raw = menuRawMsg()
    if (raw?.id != null && isRealChat) {
      const pinned = pins.some((p) => p.id === raw.id)
      void (pinned ? managers.messages.unpin(numericChatId, raw.id) : managers.messages.pin(numericChatId, raw.id))
    }
    closeMsgMenu()
  }

  // Download the original media bytes (the context-menu "Загрузить" action). The
  // content endpoint is same-origin, so the <a download> forces a save.
  const downloadMsg = async () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.mediaId == null) return
    const [meta, url] = await Promise.all([
      managers.media.meta(raw.mediaId),
      managers.media.contentUrl(raw.mediaId),
    ])
    const a = document.createElement('a')
    a.href = url
    a.download = meta.fileName || `media-${raw.mediaId}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const showViewers = async (e: React.MouseEvent) => {
    const raw = menuRawMsg()
    const x = e.clientX, y = e.clientY
    closeMsgMenu()
    if (raw?.id == null || !isRealChat) return
    const ids = await managers.messages.viewers(numericChatId, raw.id)
    const users = ids.length ? await managers.peers.getUsers(ids) : []
    const byId = new Map(users.map((u) => [u.id, u.displayName]))
    const names = ids.map((id) => byId.get(id) ?? `ID ${id}`)
    setViewers({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), names })
  }

  // Тоггл реакции (клик по чипу / полоске эмодзи в меню). Оптимистично правим
  // агрегаты в сторе (applyReaction идемпотентен к серверному эху), REST — следом.
  // Несколько разных реакций на одно сообщение разрешены (как premium tweb):
  // тап по эмодзи снимает/ставит ТОЛЬКО его, остальные не трогаем.
  const toggleReaction = useEvent((msgId: number, emoji: string) => {
    if (!isRealChat) return
    const raw = win.msgs.find((m) => m.id === msgId)
    if (!raw || raw.id < 0) return // оптимистичный бабл ещё без серверного id
    const store = useMessagesStore.getState()
    const mine = raw.reactions?.find((r) => r.emoji === emoji)?.mine
    if (mine) {
      store.applyReaction(numericChatId, msgId, emoji, 'remove', true)
      void managers.messages.unreact(numericChatId, msgId, emoji)
    } else {
      store.applyReaction(numericChatId, msgId, emoji, 'add', true)
      void managers.messages.react(numericChatId, msgId, emoji)
    }
  })

  // Кто отреагировал (long-press / правый клик по чипу реакции): попап со списком
  // «аватар + имя + его эмодзи». Тап по чипу остаётся тогглом своей реакции.
  const showReactedUsers = useEvent(async (msgId: number, x: number, y: number) => {
    if (!isRealChat) return
    const raw = win.msgs.find((m) => m.id === msgId)
    if (!raw || raw.id < 0) return
    const users = await managers.messages.reactionUsers(numericChatId, msgId)
    const rows = users.map((u) => ({ name: u.name, avatarUrl: u.avatarUrl, emoji: u.emoji }))
    setReacted({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), rows })
  })

  // Полоска эмодзи над контекстным меню: реакция на сообщение меню.
  const reactToMenuMsg = (emoji: string) => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.id != null) toggleReaction(raw.id, emoji)
  }

  // Неотправленное сообщение (message_error): вместо обычного меню — только
  // «Переотправить» / «Удалить» (tweb: контекст-меню error-бабла).
  const resendFailed = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (!raw?.failed || !raw.clientId) return
    useMessagesStore.getState().retryOptimistic(winKey(numericChatId, raw.threadRootId), raw.clientId)
    void managers.realtime.sendMessage({
      chatId: numericChatId, text: raw.text, entities: raw.entities,
      clientMsgId: raw.clientId, replyToId: raw.replyToId, mediaId: raw.mediaId,
      type: raw.type !== 'text' ? raw.type : undefined, threadRootId: raw.threadRootId,
    })
  }
  const removeFailed = () => {
    const raw = menuRawMsg()
    closeMsgMenu()
    if (raw?.clientId) useMessagesStore.getState().removeOptimistic(winKey(numericChatId, raw.threadRootId), raw.clientId)
  }
  const failedMenuItems: MsgMenuItem[] = [
    { icon: <TgIcon name="send" size={20} />, label: 'Resend', onClick: resendFailed },
    { icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg },
    { icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: removeFailed },
  ]

  const regularMenuItems: MsgMenuItem[] = [
    { icon: <TgIcon name="reply" size={20} />, label: 'Reply', onClick: startReply },
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="edit" size={20} />, label: 'Edit', onClick: startEdit }]
      : []),
    ...(!isSecret ? [{ icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg }] : []),
    ...(showTranslate && (msgs[msgMenu?.idx ?? -1]?.text)
      ? [{ icon: <TgIcon name="language" size={20} />, label: 'Translate', onClick: startTranslate }]
      : []),
    ...(isRealChat
      ? [{
          icon: <TgIcon name="pin" size={20} />,
          label: pins.some((p) => p.id === menuRawMsg()?.id) ? 'Unpin' : 'Pin',
          onClick: togglePin,
        }]
      : []),
    ...(isRealChat && menuRawMsg()?.mediaId != null
      ? [{ icon: <TgIcon name="download" size={20} />, label: 'Download', onClick: downloadMsg }]
      : []),
    // Опрос: «Отменить голос» (не викторина, не закрыт, голосовал) и
    // «Остановить опрос» (своё сообщение, не закрыт) — tweb contextMenu
    ...(() => {
      const raw = menuRawMsg()
      const poll = raw?.poll
      if (!isRealChat || !poll) return []
      const items: MsgMenuItem[] = []
      if (!poll.closed && !poll.quiz && poll.myVotes.length > 0) {
        items.push({
          icon: <TgIcon name="checkretract" size={20} />,
          label: 'Retract Vote',
          onClick: () => {
            void managers.messages.votePoll(poll.id, [])
              .then((p) => useMessagesStore.getState().setPoll(numericChatId, p))
          },
        })
      }
      if (!poll.closed && raw!.senderId === meId) {
        items.push({
          icon: <TgIcon name="stop" size={20} />,
          label: 'Stop Poll',
          onClick: () => { void managers.messages.closePoll(poll.id) },
        })
      }
      return items
    })(),
    ...(isRealChat && !isSecret ? [{ icon: <TgIcon name="reply" size={20} style={{ transform: 'scaleX(-1)' }} />, label: 'Forward', onClick: openForward }] : []),
    ...(isRealChat ? [{ icon: <TgIcon name="checkround" size={20} />, label: 'Select', onClick: startSelect }] : []),
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="checks" size={20} />, label: 'Viewers', onClick: showViewers }]
      : []),
    // «Пожаловаться» — на чужие сообщения в реальном чате (своё не жалуют).
    ...(isRealChat && !(msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="hand" size={20} />, label: 'Report', danger: true, onClick: openReport }]
      : []),
    ...(isRealChat ? [{ icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: openDelete }] : []),
  ]

  const msgMenuItems: MsgMenuItem[] = menuRawMsg()?.failed ? failedMenuItems : regularMenuItems

  return {
    msgMenu, openMsgMenu, closeMsgMenu, destroyMsgMenu, msgMenuItems,
    toggleReaction, reactToMenuMsg, showReactedUsers,
    delIds, doDelete, closeDelete: () => setDelIds(null), openDeleteFor, canRevokeAll,
    forwardIds, doForward, closeForward: () => setForwardIds(null), openForwardFor,
    viewers, closeViewers: () => setViewers(null),
    reacted, closeReacted: () => setReacted(null),
    translateText, closeTranslate: () => setTranslateText(null),
  }
}
