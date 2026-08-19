// src/core/hooks/useSendAs.ts
//
// View-model for the composer's "send-as" identity (Telegram send_as): fetches
// the identities the user may post under in this chat (personal account, a linked
// channel they admin, the anonymous group) and remembers the chosen one per chat.
//
// Ответ — конструктор `channels.sendAsPeers`: ССЫЛКИ на пиры (`peers`) отдельно
// от их тел (`chats`/`users`). Здесь ссылки сводятся с телами в строки меню:
// ключ + собранное клиентом имя + id медиа аватарки.
//
// ВИД личности строкой (`kind: 'user'|'group'|'channel'`) больше не приезжает и
// не нужен: в оригинале (`components/chat/sendAs.ts:143-149`) подпись строки
// ветвится ровно по двум вопросам — «это Я» (`sendAsPeerId.isUser()`) и «это
// сама супергруппа, в которой пишу» (`sendAsPeerId === this.peerId` +
// `pFlags.megagroup`). Оба выводятся из КЛЮЧА и открытого чата, поэтому
// отдельного поля рядом со строкой нет.
import { useEffect, useMemo, useState } from 'react'
import { useManagers } from './useManagers'
import { getPeerPhotoId, peerKey } from '../peers/peer'
import { getChatTitleText, getUserTitle } from '../peers/getPeerTitle'
import { getPeerId, isUser, NULL_PEER_ID } from '../peers/peerId'

// Per-chat selection, remembered across remounts / chat switches (tweb keeps the
// default_send_as; we keep the last explicit pick in-session).
const selection = new Map<PeerId, PeerId>()

/** Строка меню «Отправить от имени». */
export interface SendAsRow {
  peerId: PeerId
  /** имя собирает клиент (`display_name` с провода убран) */
  title: string
  /** id медиа аватарки (`photo.photo_id`); 0/undefined — фото нет */
  photoId?: number
}

export interface SendAsVM {
  peers: SendAsRow[]
  currentId: PeerId
  select: (peerId: PeerId) => void
}

export function useSendAs(peerId: PeerId, enabled: boolean, meId: number | null): SendAsVM {
  const managers = useManagers()
  const [peers, setPeers] = useState<SendAsRow[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setPeers([])
      return
    }
    let alive = true
    void managers.chats
      .getSendAs(peerId)
      .then((r) => {
        if (!alive) return
        // Сведение ссылок с телами — та же раскладка, что у `contacts.found`:
        // карточка ищется в своём векторе по ЗНАКОВОМУ ключу, а `id` внутри
        // конструктора остаётся положительным сырым идентификатором.
        const users = new Map(r.users.map((u) => [peerKey(u), u]))
        const chats = new Map(r.chats.map((c) => [peerKey(c), c]))
        setPeers(r.peers.map((p) => {
          const id = getPeerId(p.peer)
          const user = users.get(id)
          const chat = chats.get(id)
          const chatPhoto = chat && (chat._ === 'chat' || chat._ === 'channel') ? chat.photo : undefined
          return {
            peerId: id,
            title: isUser(id) ? getUserTitle(user) : getChatTitleText(chat),
            photoId: getPeerPhotoId(user?.photo ?? chatPhoto) || undefined,
          }
        }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [peerId, enabled, managers])

  // Current identity: the remembered pick if still offered, else the first
  // (personal account); falls back to meId until the list loads.
  const currentId = useMemo(() => {
    if (!peers.length) return meId ?? NULL_PEER_ID
    const stored = selection.get(peerId)
    if (stored != null && peers.some((p) => p.peerId === stored)) return stored
    return peers[0].peerId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, peerId, meId, tick])

  const select = (asPeerId: PeerId) => {
    selection.set(peerId, asPeerId)
    setTick((n) => n + 1)
  }

  return { peers, currentId, select }
}
