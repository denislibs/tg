// Порт tweb hooks/useAutoDownloadSettings: свод настроек автозагрузки для
// открытого чата к трём числам {photo, video, file} — 0 значит «не грузить
// автоматически», иначе максимальный размер в байтах. Тип чата: канал/группа
// по chatType, личка делится на контакт/не контакт (tweb peer.pFlags.contact —
// у нас Set контактов из foldersStore).
import { useMemo } from 'react'
import { useSettingsStore } from '../../settings'
import { useFoldersStore } from '../../stores/foldersStore'

export interface ChatAutoDownload {
  photo: number
  video: number
  file: number
}

const PHOTO_SIZE_MAX = 1048576 // tweb autoDownloadNew.photo_size_max
const VIDEO_SIZE_MAX = 15728640 // tweb autoDownloadNew.video_size_max

export function useChatAutoDownload(chatType: string, peerId: number | null | undefined): ChatAutoDownload {
  const enabled = useSettingsStore((s) => s.autoDownloadEnabled)
  const photo = useSettingsStore((s) => s.autoDownloadPhoto)
  const video = useSettingsStore((s) => s.autoDownloadVideo)
  const file = useSettingsStore((s) => s.autoDownloadFile)
  const fileSizeMax = useSettingsStore((s) => s.autoDownloadFileSizeMax)
  const isContact = useFoldersStore((st) => (peerId != null ? st.contactIds.has(peerId) : false))

  return useMemo(() => {
    const kind = chatType === 'channel' ? 'channels'
      : chatType === 'group' ? 'groups'
        : isContact ? 'contacts' : 'private'
    return {
      photo: enabled && photo[kind] ? PHOTO_SIZE_MAX : 0,
      video: enabled && video[kind] ? VIDEO_SIZE_MAX : 0,
      file: enabled && file[kind] ? fileSizeMax : 0,
    }
  }, [chatType, isContact, enabled, photo, video, file, fileSizeMax])
}
