import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { SavedDialog } from '../managers/chatsManager'
import type { PeerProfile } from '../managers/authManager'
import type { SavedStarGift } from '../managers/starsManager'

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

// Чужой профиль с применённой конфиденциальностью (GET /users/{id}):
// телефон/bio/день рождения приходят пустыми, если скрыты правилами.
export function useUserProfile(peerId: PeerId | null | undefined, isSaved: boolean): PeerProfile | null {
  const managers = useManagers()
  const [profile, setProfile] = useState<PeerProfile | null>(null)
  useEffect(() => {
    if (isSaved || peerId == null) return
    let alive = true
    void managers.privacy.profile(peerId).then((p) => {
      if (alive) setProfile(p)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [isSaved, peerId, managers])
  return profile
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

