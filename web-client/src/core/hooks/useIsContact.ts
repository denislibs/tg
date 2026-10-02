// src/core/hooks/useIsContact.ts
//
// Порт проверки tweb `appPeersManager.isContact` (812502980
// `appPeersManager.ts:162-164`: `peerId.isUser() && appUsersManager.isContact`)
// для React-потребителей. Ответ даёт тот же порт, что у вкладки «Изменить
// контакт», — `managers.contacts.isContact` (`appUsersManager.ts:897-899`:
// книга ИЛИ `pFlags.contact` карточки); второго ответа на этот вопрос здесь не
// заводим.
//
// Потребители — гейт пункта «Добавить в контакты» ⋮ шапки (`topbar.ts:605-610`,
// verify `!isBot && isUser && !isContact`) и карандаш профиля
// (`sharedMedia.tsx::toggleEditBtn` → `appUsersManager.canEdit`). Карандаш у
// оригинала перечитывается на `contacts_update` этого пользователя
// (`sharedMedia.tsx:705-709`); то же делаем здесь — плюс на смене карточки в
// зеркале: `pFlags.contact` приезжает с сервера в любом ответе с этим
// пользователем (контакт, добавленный с другого устройства, или удалённый).
import { useEffect, useState } from 'react'
import rootScope from '@lib/rootScope'
import { useManagers } from './useManagers'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import { usePeers } from './usePeers'

/** `undefined` — ответ ещё не пришёл (verify оригинала тоже асинхронный). */
export function useIsContact(peerId: PeerId): boolean | undefined {
  const managers = useManagers()
  const middlewareHelper = useMiddlewareHelper()
  const isUser = peerId > 0
  const card = usePeers(isUser ? [peerId] : []).get(peerId)
  const [answer, setAnswer] = useState<{ peerId: PeerId; isContact: boolean }>()
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!isUser) return
    const onUpdate = (userId: UserId) => {
      if (userId === peerId) setGeneration((g) => g + 1)
    }
    rootScope.addEventListener('contacts_update', onUpdate)
    return () => { rootScope.removeEventListener('contacts_update', onUpdate) }
  }, [isUser, peerId])

  useEffect(() => {
    if (!isUser) return
    const scope = middlewareHelper.get().create()
    const middleware = scope.get()
    void managers.contacts.isContact(peerId).then((isContact) => {
      if (middleware()) setAnswer({ peerId, isContact })
    }, () => {})
    return () => { scope.destroy() }
  }, [managers, middlewareHelper, isUser, peerId, card, generation])

  if (!isUser) return false
  return answer?.peerId === peerId ? answer.isContact : undefined
}
