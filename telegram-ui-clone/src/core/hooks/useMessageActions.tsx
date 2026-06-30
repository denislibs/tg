// src/core/hooks/useMessageActions.tsx
//
// The message context menu + everything it triggers: reply / edit / copy / pin /
// delete / forward / select / download / "seen by". Owns the menu anchor plus the
// delete-confirm, forward-picker and viewers-popup state, and builds the menu item
// list (gated by chat kind and the target message). The View renders the menu /
// dialogs from the returned state and wires the feed's context-menu open to
// `openMsgMenu`.
import { useState } from 'react'
import type { ReactNode } from 'react'
import TgIcon from '../../components/TgIcon'
import { peerColor } from '../../components/peerColor'
import { useEvent } from './useEvent'
import type { Chat, ConvMsg } from '../../data'
import type { Managers } from '../../client/bootstrap'
import type { MessageWindow } from './useMessageWindow'
import type { ReplyState, EditState } from './useChatSend'

type MsgMenu = { x: number; y: number; idx: number; originX: 'left' | 'right'; originY: 'top' | 'bottom' }
type DelState = { ids: number[]; canRevoke: boolean }
type ViewersState = { x: number; y: number; names: string[] }
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
  const [delIds, setDelIds] = useState<DelState | null>(null)
  const [forwardIds, setForwardIds] = useState<number[] | null>(null)
  const [viewers, setViewers] = useState<ViewersState | null>(null)

  // Takes the message itself (not its index) so MessageRow needs no `index` prop —
  // that prop shifts on every loadOlder prepend and would re-render every row. We
  // resolve the index here, at click time, against the current msgs.
  const openMsgMenu = useEvent((e: React.MouseEvent, m: ConvMsg) => {
    e.preventDefault()
    const idx = msgs.indexOf(m)
    if (idx < 0) return
    // Anchor a corner of the menu at the click point and grow from there (tweb):
    // flip to the left/upward when near the right/bottom edge so it stays on-screen.
    const MW = 256, MH = 440
    const openLeft = e.clientX + MW > window.innerWidth
    const openUp = e.clientY + MH > window.innerHeight
    setMsgMenu({ x: e.clientX, y: e.clientY, idx, originX: openLeft ? 'right' : 'left', originY: openUp ? 'bottom' : 'top' })
  })

  // The selected message's raw window entry (real id/seq) for actions.
  const menuRawMsg = () => (msgMenu && isRealChat ? win.msgs[msgMenu.idx] : undefined)

  const startReply = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m && m.type !== 'date') {
      const name = m.out ? 'Дн' : m.sender ?? chat.name
      const color = m.out ? accent : m.senderColor ?? peerColor(name)
      setReply({ msgId: menuRawMsg()?.id, name, text: m.text ?? m.emoji ?? '', color })
      setEditing(null)
      // Composer focuses itself when `reply` becomes set.
    }
    setMsgMenu(null)
  }

  const startEdit = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    const raw = menuRawMsg()
    if (m && raw?.id != null) {
      setEditing({ msgId: raw.id, text: m.text ?? '', entities: raw.entities })
      setReply(null)
      // Composer prefills its draft + focuses when `editing` becomes set.
    }
    setMsgMenu(null)
  }

  const copyMsg = () => {
    const m = msgMenu && msgs[msgMenu.idx]
    if (m?.text) void navigator.clipboard?.writeText(m.text).catch(() => {})
    setMsgMenu(null)
  }

  // "Delete for everyone" is offered when every target is the author's own or the
  // chat is private (Telegram). Backend re-checks; group admins handled server-side.
  const canRevokeAll = (ids: number[]) =>
    chat.type === 'private' || ids.every((id) => win.msgs.find((m) => m.id === id)?.senderId === meId)
  const openDelete = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setDelIds({ ids: [raw.id], canRevoke: canRevokeAll([raw.id]) })
    setMsgMenu(null)
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

  const openForward = () => {
    const raw = menuRawMsg()
    if (raw?.id != null) setForwardIds([raw.id])
    setMsgMenu(null)
  }
  // Open the forward picker for an arbitrary id set (the selection bar's bulk forward).
  const openForwardFor = (ids: number[]) => setForwardIds(ids)
  const doForward = (toChatId: number) => {
    if (!forwardIds?.length || !isRealChat) return setForwardIds(null)
    void managers.messages.forwardMessages(toChatId, numericChatId, forwardIds)
    setForwardIds(null)
    clearSelection()
    onChatCreated?.(toChatId) // switch to the target chat (Telegram behavior)
  }

  // Enter selection mode from the context menu, pre-selecting that message.
  const startSelect = () => {
    const raw = menuRawMsg()
    setSelectionMode(true)
    if (raw?.id != null) setSelected(new Set([raw.id]))
    setMsgMenu(null)
  }

  const togglePin = () => {
    const raw = menuRawMsg()
    if (raw?.id != null && isRealChat) {
      const pinned = pins.some((p) => p.id === raw.id)
      void (pinned ? managers.messages.unpin(numericChatId, raw.id) : managers.messages.pin(numericChatId, raw.id))
    }
    setMsgMenu(null)
  }

  // Download the original media bytes (the context-menu "Загрузить" action). The
  // content endpoint is same-origin, so the <a download> forces a save.
  const downloadMsg = async () => {
    const raw = menuRawMsg()
    setMsgMenu(null)
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
    setMsgMenu(null)
    if (raw?.id == null || !isRealChat) return
    const ids = await managers.messages.viewers(numericChatId, raw.id)
    const users = ids.length ? await managers.peers.getUsers(ids) : []
    const byId = new Map(users.map((u) => [u.id, u.displayName]))
    const names = ids.map((id) => byId.get(id) ?? `ID ${id}`)
    setViewers({ x: Math.min(x, window.innerWidth - 240), y: Math.min(y, window.innerHeight - 320), names })
  }

  const msgMenuItems: MsgMenuItem[] = [
    { icon: <TgIcon name="reply" size={20} />, label: 'Reply', onClick: startReply },
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="edit" size={20} />, label: 'Edit', onClick: startEdit }]
      : []),
    { icon: <TgIcon name="copy" size={20} />, label: 'Copy', onClick: copyMsg },
    { icon: <TgIcon name="language" size={20} />, label: 'Translate' },
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
    ...(isRealChat ? [{ icon: <TgIcon name="reply" size={20} style={{ transform: 'scaleX(-1)' }} />, label: 'Forward', onClick: openForward }] : []),
    ...(isRealChat ? [{ icon: <TgIcon name="checkround" size={20} />, label: 'Select', onClick: startSelect }] : []),
    ...(isRealChat && (msgs[msgMenu?.idx ?? -1]?.out ?? false)
      ? [{ icon: <TgIcon name="checks" size={20} />, label: 'Viewers', onClick: showViewers }]
      : []),
    ...(isRealChat ? [{ icon: <TgIcon name="delete" size={20} />, label: 'Delete', danger: true, onClick: openDelete }] : []),
  ]

  return {
    msgMenu, openMsgMenu, closeMsgMenu: () => setMsgMenu(null), msgMenuItems,
    delIds, doDelete, closeDelete: () => setDelIds(null), openDeleteFor, canRevokeAll,
    forwardIds, doForward, closeForward: () => setForwardIds(null), openForwardFor,
    viewers, closeViewers: () => setViewers(null),
  }
}
