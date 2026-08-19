// src/core/hooks/useConvMessages.ts
//
// Read-model for the message feed: maps the windowed Message[] (from
// useMessageWindow) into the ConvMsg[] the bubbles render, resolving sender /
// forward-origin / reply-author display names via usePeers and caching each
// converted row by value so unchanged rows keep a stable identity (the memoized
// <MessageRow> bails out; appending re-renders only the new/last row).
import { useMemo, useRef } from 'react'
import type { ConvMsg } from '../../data'
import type { Message } from '../models'
import { messageToConvMsg } from '../messageToConvMsg'
import { usePeers, peersKey } from './usePeers'
import type { Chat as PeerChat, User } from '../peers/peer'
import { getPeerTitle } from '../peers/getPeerTitle'
import { getPeerId, NULL_PEER_ID } from '../peers/peerId'
import { useChatsStore } from '../../stores/chatsStore'
import { usePinsStore } from '../../stores/pinsStore'
import type { MessageWindow } from './useMessageWindow'

const NO_PINS: never[] = []

/**
 * Ключ АВТОРА оригинала пересылки. `messageFwdHeader.from_id` — конструктор
 * `Peer`, поэтому источником может быть и канал (`peerChannel`), а не только
 * человек; прежнее `fwd_from_user_id` такой источник выразить не могло.
 * `NULL_PEER_ID` — пересылки нет либо атрибуция скрыта правилом приватности
 * (`from_name` без `from_id`), и тогда имя берётся из самого заголовка.
 */
function fwdFromPeerId(m: Message): PeerId {
  return m.fwdFrom?.from_id ? getPeerId(m.fwdFrom.from_id) : NULL_PEER_ID
}

interface UseConvMessagesArgs {
  numericChatId: number
  isRealChat: boolean
  isGroup: boolean
  win: MessageWindow
  meId: number | null
  /** имя канала для корневого поста треда комментариев (сообщение из ДРУГОГО
   * чата, подшитое бэком с seq=0): рендерится входящим от имени канала (tweb —
   * автофорвард поста, from_id = канал, isOut=false) */
  foreignRootName?: string
}

export function useConvMessages({ numericChatId, isRealChat, isGroup, win, meId, foreignRootName }: UseConvMessagesArgs): {
  msgs: ConvMsg[]
  peers: Map<PeerId, User | PeerChat>
} {
  // Peer's read horizon (real chats): out messages with seq<=peerReadSeq render the
  // double-check (read). Read straight from the store dialog — it's seeded from
  // GET /chats (peer_read_seq) on load and advanced by applyRead on live rt:read,
  // so ticks are correct immediately on open and after switching chats.
  const peerReadSeq = useChatsStore((s) =>
    isRealChat ? s.dialogs.find((d) => d.peerId === numericChatId)?.peerReadSeq ?? 0 : 0,
  )

  // Закреплённые сообщения чата уже лежат в сторе (usePinnedBar грузит listPins,
  // realtimeBridge обновляет по rt:pin_message) — берём оттуда флаг для кластера
  // времени (tweb message.pFlags.pinned → иконка pinnedchat_filled).
  const pins = usePinsStore((s) => s.byChat[numericChatId]) ?? NO_PINS
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.id)), [pins])

  // For real group chats, resolve incoming sender ids -> display names so bubbles
  // can show the author. Private chats never pass a senderName (unchanged).
  const resolveSenders = isRealChat && isGroup
  const senderIds = useMemo(
    () => {
      if (!isRealChat) return []
      const ids = resolveSenders ? win.msgs.filter((m) => m.senderId !== meId).map((m) => m.senderId) : []
      // Атрибуция пересылки («Переслано от X») в ЛЮБОМ чате: автор оригинала —
      // `fwdFrom.from_id`, конструктор `Peer` схемы. Ключ выводит `getPeerId`,
      // и это может быть КАНАЛ (`peerChannel`), а не только человек — прежнее
      // `fwd_from_user_id` такого источника выразить не могло. Скрытая
      // атрибуция (`from_name` без `from_id`) ключа не даёт вовсе.
      for (const m of win.msgs) {
        const id = fwdFromPeerId(m)
        if (id !== NULL_PEER_ID) ids.push(id)
      }
      // Reply previews need the replied-to author's name (any chat).
      for (const m of win.msgs) if (m.replyTo && m.replyTo.senderId !== meId) ids.push(m.replyTo.senderId)
      return ids
    },
    // peersKey gives a stable dep that ignores ordering/duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveSenders, isRealChat, meId, peersKey(win.msgs.map((m) => m.senderId)), peersKey(win.msgs.map((m) => fwdFromPeerId(m))), peersKey(win.msgs.map((m) => m.replyTo?.senderId ?? 0))],
  )
  const peers = usePeers(senderIds)

  // Per-message conversion cache: returns the SAME ConvMsg reference when the
  // converted value is unchanged (compared by its JSON), so unchanged rows keep a
  // stable identity → the memoized <MessageRow> bails out. Appending/sending then
  // re-renders only the new row (and the previous-last, whose group tail flips).
  const convCacheRef = useRef<Map<string | number, { json: string; conv: ConvMsg }>>(new Map())
  const msgs: ConvMsg[] = useMemo(() => {
    if (!isRealChat) return []
    const cache = convCacheRef.current
    const seen = new Set<string | number>()
    // Имя собирает клиент (`display_name` с провода убран). Фолбэки оригинала
    // — «Удалённый аккаунт» у человека, пустая строка у чата — внутри
    // `getPeerTitle`, поэтому карточка, которая ещё не доехала, не даёт
    // пустого узла.
    // `|| undefined`, а не голая строка: у ЧАТА фолбэк `getPeerTitle` — пустая
    // строка (в оригинале там нет «Deleted Account»), а пустая строка не
    // нулевая и затёрла бы фолбэки ниже по стеку («Скрытое имя» у пересылки,
    // «Сообщение» у превью ответа). Карточка чата в зеркало теперь попадает —
    // `peers.saveApiPeers` из карточки чата и кадра `chat_update` (шаг D2.5), —
    // но фолбэк всё равно нужен: до её приезда имени нет.
    const title = (peerId: PeerId): string | undefined =>
      getPeerTitle({ peerId, peer: peers.get(peerId) }) || undefined
    const next = win.msgs.map((m) => {
      let conv = messageToConvMsg(m, meId, {
        senderName: resolveSenders ? title(m.senderId) : undefined,
        readUpToSeq: peerReadSeq,
        forwardFromName: fwdFromPeerId(m) !== NULL_PEER_ID ? title(fwdFromPeerId(m)) : undefined,
        replyToName: m.replyTo ? title(m.replyTo.senderId) : undefined,
      })
      // Корневой пост канала в треде комментариев: всегда входящий, от имени
      // канала (даже если автор поста — я), без тиков.
      //
      // ЭТО ОСОЗНАННОЕ ВИТРИННОЕ ПЕРЕОПРЕДЕЛЕНИЕ, а не забытый код. `out` —
      // поле владельца (Message.out, порт tweb pFlags.out), и здесь витрина его
      // ЗАТИРАЕТ: в ветке комментариев корневой пост принадлежит ДРУГОМУ чату
      // (каналу) и рисуется входящим независимо от авторства — в tweb это
      // автофорвард поста (from_id = канал, isOut=false), у нас же бэк подшивает
      // сам пост с seq=0. Правило зависит от того, ЧТО СЕЙЧАС ОТКРЫТО
      // (numericChatId), — знание витрины, не владельца; переносить его к
      // владельцу до этапа рендера тредов не надо.
      if (m.seq === 0 && m.peerId !== numericChatId) {
        conv = { ...conv, out: false, status: undefined, sender: foreignRootName || conv.sender, senderId: undefined }
      }
      if (m.id != null && pinnedIds.has(m.id)) conv = { ...conv, pinned: true }
      const key = m.clientId ?? m.id ?? m.seq
      seen.add(key)
      const json = JSON.stringify(conv)
      const hit = cache.get(key)
      if (hit && hit.json === json) return hit.conv // value-identical → reuse stable ref
      cache.set(key, { json, conv })
      return conv
    })
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key)
    return next
  }, [isRealChat, win.msgs, meId, resolveSenders, peers, peerReadSeq, foreignRootName, numericChatId, pinnedIds])

  return { msgs, peers }
}
