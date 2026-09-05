import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { SavedDialog } from '../managers/chatsManager'
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

// `useUserProfile`/`PeerProfileView` (чужой профиль пользователя: телефон/
// username/bio/день рождения) сняты задачей 6 плана «карточка профиля на
// Solid» (`docs/superpowers/plans/2026-09-05-profile-card-solid.md`) —
// потребителя не осталось: `UserInfoPanel.tsx` больше не рисует эти поля
// сам (Task 4 перенесла их в `peerProfile.solid.tsx::MainSection`, которая
// читает те же зеркала (`usePeer`/`useFullPeer`/`cachedProfilePhone`)
// НАПРЯМУЮ, а не через этот React-хук). Пин единственности сетевого пути
// («пятый писатель», находка ревью 1.5) снят вместе с хуком —
// `stores/fullPeers.solid.ts::requestFullPeer` остаётся единственным
// вызывающим `managers.privacy.profile()` для чужого пира и без этого теста
// (сам факт — в докблоке `requestFullPeer`).

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
