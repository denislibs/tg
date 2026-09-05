import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useManagers } from './useManagers'
import type { SavedDialog } from '../managers/chatsManager'
import type { UserFull, UserReal } from '../peers/peer'
import type { SavedStarGift } from '../managers/starsManager'
import { cachedPeer, peerMirrorVersion, subscribePeerMirror } from '../peerCache'
import { cachedPeerFull, chatFullMirrorVersion, subscribeChatFullMirror } from '../chatFullCache'
import { cachedProfilePhone, profilePhoneMirrorVersion, subscribeProfilePhoneMirror } from '../profilePhoneCache'
import { ensureFullPeer } from '../../stores/fullPeers.solid'

// Read-хуки данных панели профиля (UserInfoPanel). Все — эфемерные серверные
// данные экрана (не realtime-сущности стора), поэтому живут в ViewModel-хуках,
// а не в самом View.

// «Избранное»: сохранённые диалоги (группировка по источнику пересылки).
export function useSavedDialogs(isSaved: boolean): SavedDialog[] | null {
  const managers = useManagers()
  const [savedDialogs, setSavedDialogs] = useState<SavedDialog[] | null>(null)
  useEffect(() => {
    if (!isSaved) return
    void managers.chats.savedDialogs().then(setSavedDialogs).catch(() => setSavedDialogs([]))
  }, [isSaved, managers])
  return savedDialogs
}

/**
 * Чужой профиль пользователя — то, что показывает `UserInfoPanel.tsx`
 * (телефон/username/verified/premium/emoji-статус из краткой карточки, bio/
 * день рождения из полной). Уже НЕ отдельная витрина `PeerProfile` и НЕ
 * собственный сетевой поход (было — «пятый писатель», находка ревью задачи
 * 1.5 профиля на Solid, докблок `stores/fullPeers.solid.ts` § «Task 2»):
 *
 *  • username/pFlags.verified/pFlags.premium/emoji_status_emoticon — из
 *    ОБЩЕГО зеркала пиров (`core/peerCache.ts`), тем же путём, что и `usePeers`
 *    (см. её докблок): эти поля одинаковы на любом эндпоинте, дублировать их
 *    хождением в `/users/{id}` незачем (разбор — докблок `core/profilePhoneCache.ts`).
 *  • about/birthday — из общей ПОЛНОЙ карточки (`core/chatFullCache.ts`),
 *    догружает её `ensureFullPeer` — ТА ЖЕ функция и ТОТ ЖЕ TTL-гейт, каким
 *    пользуется Solid-профиль (`stores/fullPeers.solid.ts`) и `Chat.tsx`: если
 *    карточка уже свежая (кто-то из них её только что принёс), второй поход
 *    в сеть не открывается.
 *  • phone — единственное поле, которого нет НИГДЕ, кроме ответа
 *    `privacy.profile()` (см. докблок `core/profilePhoneCache.ts`); эта
 *    функция его больше НЕ запрашивает сама — только читает то, что положил
 *    `requestFullPeer` (`stores/fullPeers.solid.ts`) в СВОЁ зеркало.
 *
 * Возвращаемая форма — не переиспользованный `PeerProfile` (`canMessage`
 * оттуда никто не читал и здесь взять неоткуда без похода в сеть, который мы
 * как раз убираем — придумывать значение вместо него значило бы врать).
 */
export type PeerProfileView = { user: UserReal; fullUser: UserFull }

export function useUserProfile(peerId: PeerId | null | undefined, isSaved: boolean): PeerProfileView | null {
  const managers = useManagers()
  const peerVersion = useSyncExternalStore(subscribePeerMirror, peerMirrorVersion)
  const fullVersion = useSyncExternalStore(subscribeChatFullMirror, chatFullMirrorVersion)
  const phoneVersion = useSyncExternalStore(subscribeProfilePhoneMirror, profilePhoneMirrorVersion)

  useEffect(() => {
    if (isSaved || peerId == null) return
    // Пробел ОБЩЕГО зеркала объявляет тот, кто его увидел первым (см. докблок
    // `usePeers.ts`) — панель профиля вполне может открыться раньше, чем
    // список диалогов принёс эту карточку.
    if (cachedPeer(peerId) === undefined) void managers.peers.fillMirror([peerId])
    ensureFullPeer(managers, peerId)
  }, [isSaved, peerId, managers])

  return useMemo(() => {
    if (isSaved || peerId == null) return null
    const user = cachedPeer(peerId)
    if (!user || user._ !== 'user') return null
    const phone = cachedProfilePhone(peerId)
    return {
      user: phone !== undefined ? { ...user, phone } : user,
      fullUser: (cachedPeerFull(peerId) as UserFull | undefined) ?? { _: 'userFull', id: user.id },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSaved, peerId, peerVersion, fullVersion, phoneVersion])
}

// Подарки в профиле (tweb Gifts tab) — только для пользователя (private).
// reload переиспользуется как onChanged попапа подарка.
export function useProfileGifts(isUser: boolean, peerId: number | null | undefined): {
  gifts: SavedStarGift[]
  reload: () => void
} {
  const managers = useManagers()
  const [gifts, setGifts] = useState<SavedStarGift[]>([])
  const reload = () => {
    if (!isUser || peerId == null) return
    void managers.stars.profileGifts(peerId).then(setGifts).catch(() => setGifts([]))
  }
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUser, peerId])
  return { gifts, reload }
}

