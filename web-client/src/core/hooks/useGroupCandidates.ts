// src/core/hooks/useGroupCandidates.ts
// Кандидаты в участники группы (экран «Добавить участников», tweb берёт
// контакты): пиры существующих приватных диалогов ∪ адресная книга /contacts,
// без дублей и сервисного аккаунта, по алфавиту.
import { useEffect, useMemo, useState } from 'react'
import { useManagers } from './useManagers'
import { useChatsStore } from '../../stores/chatsStore'
import { SERVICE_USER_ID } from '../dialogToChat'
import { cachedUser } from '../peerCache'
import { isUser } from '../peers/peerId'
import { getPeerPhotoId } from '../peers/peer'
import { getUserTitle } from '../peers/getPeerTitle'

export interface GroupCandidate {
  id: PeerId
  name: string
  /** id медиа аватарки (`user.photo.photo_id`); 0/undefined — фото нет */
  photoId?: number
}

export function useGroupCandidates(): GroupCandidate[] {
  const managers = useManagers()
  const dialogs = useChatsStore((s) => s.dialogs)
  const [contacts, setContacts] = useState<GroupCandidate[]>([])

  useEffect(() => {
    let alive = true
    managers.contacts
      .list()
      .then((cs) => {
        // Имя и аватарка живут в КАРТОЧКЕ контакта (`c.user`), а не плоскими
        // полями рядом с ней: имя собирает клиент, аватарка это `photo.photo_id`.
        if (alive) setContacts(cs.map((c) => ({ id: c.userId, name: getUserTitle(c.user), photoId: getPeerPhotoId(c.user.photo) || undefined })))
      })
      .catch(() => {}) // адресная книга недоступна — остаются пиры диалогов
    return () => {
      alive = false
    }
  }, [managers])

  return useMemo(() => {
    const map = new Map<PeerId, GroupCandidate>()
    for (const d of dialogs) {
      // Ботов нельзя добавить в группу как участника (Telegram) — исключаем.
      // «Бот» — флаг конструктора (`pFlags.bot`), а не поле витрины рядом.
      // «Приватный» — это ключ ПОЛЬЗОВАТЕЛЯ (`core/peers/peerId.ts`), а не
      // снятая с провода строка `type`; сам собеседник живёт в зеркале пиров,
      // а не внутри строки диалога.
      if (!isUser(d.peerId) || d.peerId === SERVICE_USER_ID) continue
      const user = cachedUser(d.peerId)
      if (user && user._ === 'user' && !user.pFlags?.bot) {
        map.set(d.peerId, { id: d.peerId, name: getUserTitle(user), photoId: getPeerPhotoId(user.photo) || undefined })
      }
    }
    for (const c of contacts) if (!map.has(c.id)) map.set(c.id, c)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [dialogs, contacts])
}
