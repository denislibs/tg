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

export type HeaderPhoto = { src: string; isVideo: boolean; videoSrc?: string }

// Галерея фото профиля в шапке (tweb peerProfileAvatars). Тянем список СРАЗУ
// при разворачивании шапки (нужен для сегментной полоски-пейджера и
// перелистывания). Пусто/ошибка → одиночный текущий аватар. Кэшируется до смены
// собеседника (сброс на новый peerId). Возвращает сырой загруженный список
// (null пока не загружен); пейджинг-индекс живёт во View.
export function useProfilePhotos(args: {
  peerId: number | null | undefined
  isSaved: boolean
  expanded: boolean
  headerAvatarSrc: string
}): HeaderPhoto[] | null {
  const { peerId, isSaved, expanded, headerAvatarSrc } = args
  const managers = useManagers()
  const [photos, setPhotos] = useState<HeaderPhoto[] | null>(null)

  // Смена собеседника — сбрасываем кэш галереи.
  useEffect(() => { setPhotos(null) }, [peerId])

  useEffect(() => {
    if (!expanded || peerId == null || isSaved || photos !== null) return
    let alive = true
    void managers.profile.listPhotos(peerId).then(async (list) => {
      const items = await Promise.all(list.map(async (p): Promise<HeaderPhoto> => {
        // id медиа приезжает ГОТОВЫМ. Регулярка `/media/(\d+)/content` по нашей
        // же строке ушла вместе с самой строкой: сервер больше не собирает путь,
        // из которого этот же номер приходилось выпарсивать обратно.
        //
        // Still-фото профиля — картинка: воркерным конвейером (Task 7), URL
        // оседает в кэш-контексте воркера — повторное разворачивание шапки без сети.
        const src = await managers.media.downloadMediaURL(p.mediaId)
        // Видео-аватар (tweb photo_video) — видео, не картинка: остаётся на
        // токен-URL до перевода видео-путей (вьювер/стадия E). Список чатов/
        // сжатая шапка остаются на still — playback только в развёрнутой
        // шапке-пейджере и просмотрщике.
        if (p.videoMediaId) {
          const videoSrc = await managers.media.contentUrl(p.videoMediaId)
          return { src, isVideo: true, videoSrc }
        }
        return { src, isVideo: false }
      }))
      if (!alive) return
      setPhotos(items.length ? items : headerAvatarSrc ? [{ src: headerAvatarSrc, isVideo: false }] : [])
    }).catch(() => {
      if (alive && headerAvatarSrc) setPhotos([{ src: headerAvatarSrc, isVideo: false }])
    })
    return () => { alive = false }
  }, [expanded, peerId, isSaved, photos, managers, headerAvatarSrc])

  return photos
}
