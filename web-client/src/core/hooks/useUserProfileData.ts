import { useEffect, useState } from 'react'
import { useManagers } from './useManagers'
import type { SavedDialog } from '../managers/chatsManager'
import type { UserProfile } from '../managers/privacyManager'
import type { GiftInfo } from '../managers/starsManager'

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
export function useUserProfile(peerId: number | null | undefined, isSaved: boolean): UserProfile | null {
  const managers = useManagers()
  const [profile, setProfile] = useState<UserProfile | null>(null)
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
  gifts: GiftInfo[]
  reload: () => void
} {
  const managers = useManagers()
  const [gifts, setGifts] = useState<GiftInfo[]>([])
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
        const m = p.url.match(/\/media\/(\d+)\/content/)
        const src = m ? await managers.media.contentUrl(Number(m[1])) : p.url
        // Видео-аватар (tweb photo_video): резолвим video_url в токен-URL так же,
        // как still. Список чатов/сжатая шапка остаются на still — playback
        // только в развёрнутой шапке-пейджере и просмотрщике.
        if (p.videoUrl) {
          const vm = p.videoUrl.match(/\/media\/(\d+)\/content/)
          const videoSrc = vm ? await managers.media.contentUrl(Number(vm[1])) : p.videoUrl
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
