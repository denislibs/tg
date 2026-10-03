// Порт tweb `hooks/useAutoDownloadSettings.ts` (812502980): свод настроек
// автозагрузки для открытого чата к трём числам {photo, video, file} — 0 значит
// «не грузить автоматически», иначе максимальный размер в байтах.
//
// Зовёт `Chat` (`components/chat/chat.ts`, поле `autoDownload`, tweb `chat.ts:1053-1057`).
// Расхождения:
//  1. У tweb это Solid-хук над `usePeer` и `appSettings` внутри `createEffect`; у нас
//     настройки — zustand (`useSettingsStore`), поэтому функция читает снимок, а `Chat`
//     спрашивает её на каждое чтение поля (свежесть та же, что у эффекта tweb).
//  2. Признак контакта — `foldersStore.contactIds`, а не `peer.pFlags.contact`.
import { isBroadcast } from '@core/peers/predicates'
import { cachedChat } from '@core/peerCache'
import { isUser } from '@core/peers/peerId'
import { useSettingsStore } from '../../settings'
import { useFoldersStore } from '../../stores/foldersStore'

export interface ChatAutoDownload {
  photo: number
  video: number
  file: number
}

const PHOTO_SIZE_MAX = 1048576 // tweb autoDownloadNew.photo_size_max
const VIDEO_SIZE_MAX = 15728640 // tweb autoDownloadNew.video_size_max

export default function getAutoDownloadSettings(peerId: PeerId): ChatAutoDownload {
  const s = useSettingsStore.getState()
  let photo = 0, video = 0, file = 0
  if(s.autoDownloadEnabled && peerId) {
    const type = isUser(peerId) ?
      (useFoldersStore.getState().contactIds.has(peerId) ? 'contacts' : 'private') :
      isBroadcast(cachedChat(peerId)) ? 'channels' : 'groups'

    if(s.autoDownloadPhoto[type]) photo = PHOTO_SIZE_MAX
    if(s.autoDownloadVideo[type]) video = VIDEO_SIZE_MAX
    if(s.autoDownloadFile[type]) file = s.autoDownloadFileSizeMax
  }

  return { photo, video, file }
}
