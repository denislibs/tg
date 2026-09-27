// Контакты зрителя — АДРЕСНАЯ КНИГА, а не собеседники из списка чатов.
//
// Порт чтения `ContactsList` (tweb `sidebarLeft/contactsList.tsx`:
// `appUsersManager.getContactsPeerIds(query, false, …)`) и
// `showContactPickerPopup` (`popups/pickUser.tsx:843` — `peerType:
// ['contacts']`): у оригинала экран «Контакты», «Новое сообщение» и выбор
// контакта для отправки читают книгу `contacts.getContacts` с индексом поиска
// по ней, без себя (`includeSaved = false`). Прежде наши экраны собирали
// «контакты» из личных диалогов — туда попадали «Избранное», служебный
// «Telegram» (777000) и любой, с кем была переписка.
//
// Книгу держит воркер (`core/managers/contactsManager.ts`: список, индекс,
// сортировка по имени), здесь — только запрос с актуальностью по запросу.
// Карточки берёт вызывающий из зеркала пиров (`usePeers`): книга кладёт свои
// `users` во владельца карточек.
import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import { loadPresence, useChatsStore } from '../../stores/chatsStore'

/** `undefined` — книга ещё не прочитана (рисовать «ничего не найдено» рано). */
export function useContactPeerIds(query: string): PeerId[] | undefined {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const [peerIds, setPeerIds] = useState<PeerId[] | undefined>(undefined)

  useEffect(() => {
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.contacts.getContactsPeerIds(query.trim(), false).then((ids) => {
      if (!middleware()) return
      setPeerIds(ids)
      // Статус «в сети» у оригинала едет на самой карточке из
      // `contacts.getContacts`; наша книга карточки отдаёт без `status`, а
      // присутствие старт сеет только собеседникам диалогов
      // (`useAppBootstrap` → `loadPresence(managers)`). Контакту без диалога
      // его досеваем здесь — тем же путём, что черновик `openPeer`.
      const { presence } = useChatsStore.getState()
      const missing = ids.filter((id) => !(id in presence))
      if (missing.length) void loadPresence(managers, missing).catch(() => {})
    }).catch(() => {
      if (middleware()) setPeerIds([])
    })
    return () => { scope.destroy() }
  }, [managers, middlewareHelper, query])

  return peerIds
}
