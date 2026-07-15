// src/core/hooks/useGroupCandidates.ts
// Кандидаты в участники группы (экран «Добавить участников», tweb берёт
// контакты): пиры существующих приватных диалогов ∪ адресная книга /contacts,
// без дублей и сервисного аккаунта, по алфавиту.
import { useEffect, useMemo, useState } from 'react'
import { useChatsStore } from '../../stores/chatsStore'
import { SERVICE_USER_ID } from '../dialogToChat'

export interface GroupCandidate {
  id: number
  name: string
  avatarUrl?: string
}

interface Deps {
  contacts: { list(): Promise<{ userId: number; displayName: string; avatarUrl: string }[]> }
}

export function useGroupCandidates(managers: Deps): GroupCandidate[] {
  const dialogs = useChatsStore((s) => s.dialogs)
  const [contacts, setContacts] = useState<GroupCandidate[]>([])

  useEffect(() => {
    let alive = true
    managers.contacts
      .list()
      .then((cs) => {
        if (alive) setContacts(cs.map((c) => ({ id: c.userId, name: c.displayName, avatarUrl: c.avatarUrl || undefined })))
      })
      .catch(() => {}) // адресная книга недоступна — остаются пиры диалогов
    return () => {
      alive = false
    }
  }, [managers])

  return useMemo(() => {
    const map = new Map<number, GroupCandidate>()
    for (const d of dialogs) {
      if (d.type === 'private' && d.peer && d.peer.id !== SERVICE_USER_ID) {
        map.set(d.peer.id, { id: d.peer.id, name: d.peer.displayName, avatarUrl: d.peer.avatarUrl || undefined })
      }
    }
    for (const c of contacts) if (!map.has(c.id)) map.set(c.id, c)
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [dialogs, contacts])
}
