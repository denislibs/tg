// ВРЕМЕННО до порта своих пачек: React-остров глобальных оверлеев поверх колонок
// (`#react-overlays` в `index.html`, монтирует `mountGlobalOverlays` из
// `bootstrapIm`). У tweb React нет — каждый из оверлеев у оригинала свой класс
// или попап: групповой звонок и эфир (`groupCall`/`liveStream`, П-4), экран
// звонка (`callSubscriber`, 5-5), mini-app бота (`webApp`, 5-6), жалобы
// (`popups/report`), стек React-попапов `popupStore` (`PopupHost`, П-6/Р-2) и
// пилюля «доступна новая сборка» (у tweb — `updateBtn` бургера, О-100).
//
// Ушли на К-2 в бэклог: тост (`ui:toast` теперь `toastNew`), QR-подтверждение
// входа и приглашение в папку (Б-8, Б-15 — у оригинала их открывает
// `internalLinkProcessor`).
import { useChatList } from '@core/hooks/useChatList'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import { useUpdateStore } from '@stores/updateStore'
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
  // Доступно ли обновление приложения (новая сборка задеплоена — см. versionCheck).
  const updateAvailable = useUpdateStore((st) => st.available)

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

      {/* Ненавязчивая пилюля «доступна новая сборка». Клик — перезагрузка на свежий бандл. */}
      {updateAvailable && (
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5000,
            padding: '9px 18px',
            borderRadius: 20,
            background: 'var(--primary-color)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          Обновить приложение
        </button>
      )}
    </>
  )
}
