// src/core/hooks/useChatInfoCard.ts
// View-model hook for a real group/channel's header card (extracted from
// Chat): fetches type + member count + my rights, and for groups the
// member snapshot (seeding their presence into the store as the single source of
// truth). Derives the post/type permissions, discussion wiring, and the live online
// count. Behaviour is unchanged.
import { useEffect, useRef, useState } from 'react'
import { useManagers } from './useManagers'
import { NULL_PEER_ID } from '../peers/peerId'
import { useChatsStore } from '../../stores/chatsStore'
import type { ChatMember, GroupCard } from '../managers/groupsManager'
import { isUserStatusOnline } from '../peers/peer'

interface Card {
  type: string
  memberCount: number
  myRole: string
  myRights: number
  /** ЗНАКОВЫЙ ключ группы обсуждения (`-id`), `0` — обсуждения нет.
   *  Сравнивать с нулём, а не «> 0»: у группы ключ ОТРИЦАТЕЛЬНЫЙ. */
  discussionPeerId: PeerId
  slowmodeSeconds: number
  chargeStars: number
  defaultPermissions: number
}

// Биты дефолтных прав группы (domain.MemberPerms): 1 — писать, 2 — медиа.
const PERM_SEND_MESSAGES = 1
const PERM_SEND_MEDIA = 2

// Карточки уже открывавшихся чатов. Повторный вход отдаёт права СИНХРОННО, на
// первом же рендере: без этого футер канала успевал показать плашку «нельзя
// писать» (карточки нет → прав нет) и вернуть строку ввода, когда карточка
// приезжала, — то самое дёрганье композера при переходе в канал из сайдбара.
// Сеть при этом ходит как раньше (memberCount/права меняются), но её ответ уже
// ничего не двигает — он совпадает с показанным.
const cardCache = new Map<PeerId, Card>()

/**
 * Сброс кэша при смене аккаунта — зовёт `resetAccountStateInMemory`
 * (useAuthGate, обработчик rt:logging_out): права прошлого аккаунта в этих
 * карточках чужие, а cache-first-показ выше отдал бы их следующему.
 */
export function resetChatCardCache(): void {
  cardCache.clear()
}

interface InfoManagers {
  groups: {
    card(peerId: PeerId): Promise<GroupCard>
    members(peerId: PeerId): Promise<ChatMember[]>
  }
}

export interface ChatInfoCard {
  card: Card | null
  /**
   * Известны ли права на запись. Для канала до приезда карточки это третье
   * состояние — «неизвестно», а не «нельзя»: вывести из него плашку значит
   * показать её всем, включая владельца канала (см. `canType` ниже).
   */
  permissionsKnown: boolean
  /** Channels: only posters (creator / POST_MESSAGES) may type; groups & private always can. */
  canType: boolean
  /** Групповые дефолт-права: может ли участник вообще писать (иначе — плашка вместо композера). */
  canSendText: boolean
  /** Групповые дефолт-права: может ли участник отправлять медиа/голосовые/вложения. */
  canSendMedia: boolean
  discussionPeerId: PeerId
  discussionsEnabled: boolean
  /** Live count of online group members (derived from chatsStore.presence). */
  onlineCount: number
}

export function useChatInfoCard(args: {
  isRealChat: boolean
  isChannel: boolean
  numericChatId: number
}): ChatInfoCard {
  const { isRealChat, isChannel, numericChatId } = args
  const managers: InfoManagers = useManagers()
  // Загруженная карточка хранится ВМЕСТЕ с чатом, которому принадлежит. Сброс
  // эффектом (`setCard(null)`) для этого не годится: на первом рендере после
  // смены чата состояние ещё от прошлого — футер успевал вывести права чужого
  // чата, и первая же раскладка _center уходила в плашку.
  const [loaded, setLoaded] = useState<{ peerId: PeerId; card: Card } | null>(null)
  const memberIds = useRef<Set<number>>(new Set())
  // Online status is single-sourced from chatsStore.presence (fed by realtimeBridge);
  // we seed members' presence on load and derive the count below — no local listener.
  const setPresence = useChatsStore((s) => s.setPresence)

  // Карточка текущего чата: свежезагруженная, иначе снимок прошлого входа, иначе
  // неизвестна. Проверка ключа — то самое отсечение чужого состояния.
  const card = loaded?.peerId === numericChatId ? loaded.card : cardCache.get(numericChatId) ?? null

  // Fetch the card (type + memberCount) and, for groups, the member snapshot (seeds
  // memberIds + initial online state). Reset on chat change so no stale count leaks.
  useEffect(() => {
    memberIds.current = new Set()
    if (!isRealChat) return
    let alive = true
    void managers.groups.card(numericChatId).then((c) => {
      if (!alive) return
      const next: Card = { type: c.type, memberCount: c.memberCount, myRole: c.myRole, myRights: c.myRights, discussionPeerId: c.discussionPeerId, slowmodeSeconds: c.slowmodeSeconds, chargeStars: c.chargeStars, defaultPermissions: c.defaultPermissions }
      cardCache.set(numericChatId, next)
      setLoaded({ peerId: numericChatId, card: next })
      if (c.type === 'group') {
        void managers.groups.members(numericChatId).then((mem) => {
          if (!alive) return
          memberIds.current = new Set(mem.map((m) => m.userId))
          // Сид присутствия участников в стор (единственный источник). Статус —
          // ЦЕЛЫЙ конструктор `UserStatus`, а не пара «онлайн + время»: склеивать
          // его с уже лежащим («сохранить прежний lastSeen») теперь не нужно и
          // нечем — вариант приходит целиком. Статуса нет в ответе (правило
          // приватности не пустило) — не трогаем лежащее вовсе.
          for (const m of mem) if (m.status) setPresence({ user_id: m.userId, status: m.status })
        })
      }
    })
    return () => { alive = false }
  }, [isRealChat, numericChatId, managers, setPresence])

  const discussionPeerId = card?.discussionPeerId ?? NULL_PEER_ID
  // `!== NULL_PEER_ID`, а не «> 0»: ключ группы обсуждения ОТРИЦАТЕЛЬНЫЙ, и
  // прежнее сравнение после перехода на знаковый ключ выключило бы обсуждения
  // у всех каналов разом, ничего не покрасив.
  const discussionsEnabled = isRealChat && isChannel && discussionPeerId !== NULL_PEER_ID
  const canPostChannel = card?.myRole === 'creator' || ((card?.myRights ?? 0) & 1) === 1
  const canType = !isChannel || canPostChannel
  // Карточка не грузится вовсе (не «настоящий» чат — тред/черновик) — там прав
  // и не будет, поведение прежнее; ждать надо только канал с карточкой в полёте.
  const permissionsKnown = !isChannel || !isRealChat || card !== null

  // Групповые дефолт-права (admin/creator — без ограничений). До загрузки карточки
  // считаем, что можно (оптимистично), чтобы композер не мигал заблокированным.
  const isAdmin = card?.myRole === 'creator' || card?.myRole === 'admin'
  const perms = card?.defaultPermissions ?? 31
  const isGroup = card?.type === 'group'
  const canSendText = isChannel ? canPostChannel : !isGroup || isAdmin || (perms & PERM_SEND_MESSAGES) !== 0
  const canSendMedia = isChannel ? canPostChannel : !isGroup || isAdmin || (perms & PERM_SEND_MEDIA) !== 0

  // Count members currently online. Re-renders only when the number changes
  // (presence frames for non-members don't touch it).
  const onlineCount = useChatsStore((s) => {
    let n = 0
    // «Онлайн» — это `userStatusOnline`, У КОТОРОГО ЕЩЁ НЕ ИСТЁК `expires`
    // (порт `appUsersManager.isUserOnline`). Прежний булев `online` срока
    // годности не имел, и потерянный кадр держал человека в счётчике вечно.
    const now = Math.floor(Date.now() / 1000)
    for (const id of memberIds.current) if (isUserStatusOnline(s.presence[id], now)) n++
    return n
  })

  return { card, permissionsKnown, canType, canSendText, canSendMedia, discussionPeerId, discussionsEnabled, onlineCount }
}
