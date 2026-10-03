// ВРЕМЕННО до порта своих пачек: React-остров глобальных оверлеев поверх колонок
// (`#react-overlays` в `index.html`, монтирует `mountGlobalOverlays` из
// `bootstrapIm`). У tweb React нет — каждый из оверлеев у оригинала свой класс
// или попап: групповой звонок и эфир (`groupCall`/`liveStream`, П-4), экран
// звонка (`callSubscriber`, 5-5), mini-app бота (`webApp`, 5-6), жалобы
// (`popups/report`) и стек React-попапов `popupStore` (`PopupHost`, П-6/Р-2).
//
// Ушли на К-2: тост (`ui:toast` теперь `toastNew`); QR-подтверждение входа и
// приглашение в папку открывает `internalLinkProcessor` (П-4, как у оригинала).
import { useChatList } from '@core/hooks/useChatList'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import GroupCallScreen from '../GroupCallScreen'
import LivestreamScreen from '../LivestreamScreen'
import CallOverlay from '../call/CallOverlay'
import WebAppModal from '../webapp/WebAppModal'
import ReportPopup from '../ReportPopup'
import PopupHost from '../PopupHost'

export default function GlobalOverlays() {
  const chatList = useChatList()
  const groupCallChatId = useGroupCallStore((st) => st.peerId)
  const livestreamChatId = useLivestreamStore((st) => st.watchingPeerId)

  return (
    <>
      {/* Групповой звонок — глобальное окно (живёт поверх любого чата) */}
      {groupCallChatId != null && (
        <GroupCallScreen chatName={chatList.find((c) => c.id === String(groupCallChatId))?.name ?? ''} />
      )}
      {/* RTMP-трансляция — глобальное окно просмотра (поверх любого чата) */}
      {livestreamChatId != null && (
        <LivestreamScreen chatName={chatList.find((c) => c.id === String(livestreamChatId))?.name ?? ''} />
      )}

      {/* Глобальный экран звонка (входящие показываются из любого места) */}
      <CallOverlay />

      {/* Mini-app бота (iframe + мост window.Telegram.WebApp) */}
      <WebAppModal />

      {/* Жалобы (tweb reportMessages): один глобальный попап */}
      <ReportPopup />

      {/* Стек попапов (popupStore) — единая точка рендера всех императивно
          открываемых React-попапов (порт tweb PopupManager). */}
      <PopupHost />
    </>
  )
}
