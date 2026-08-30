// Глобальные оверлеи мессенджера поверх колонок: групповой звонок, RTMP-эфир,
// тост, подтверждение QR-входа, приглашение в папку, экран звонка, mini-app бота,
// жалобы, блокировка код-паролем. Вынесено из App ради читаемости Shell.
import { useEffect, useState } from 'react'
import Text from '../../shared/ui/Text'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import type { Chat } from '../../data'
import { useGroupCallStore } from '../../stores/groupCallStore'
import { useLivestreamStore } from '../../stores/livestreamStore'
import { useLockStore } from '../../stores/lockStore'
import GroupCallScreen from '../GroupCallScreen'
import LivestreamScreen from '../LivestreamScreen'
import CallOverlay from '../call/CallOverlay'
import WebAppModal from '../webapp/WebAppModal'
import PasscodeLockScreen from '../PasscodeLockScreen'
import FolderInvitePopup from '../folders/FolderInvitePopup'
import ReportPopup from '../ReportPopup'
import s from '../../App.module.scss'

/** tweb `toast.ts:28` — узел снимается через 200 мс после снятия `.is-visible` */
const TOAST_HIDE_TIME = 200

export default function GlobalOverlays({
  chatList,
  toast,
  qrConfirmToken,
  confirmQr,
  cancelQr,
  addlistSlug,
  closeAddlist,
  onAddlistJoined,
}: {
  chatList: Chat[]
  toast: string | null
  qrConfirmToken: string | null
  confirmQr: () => void
  cancelQr: () => void
  addlistSlug: string | null
  closeAddlist: () => void
  onAddlistJoined: (folderTitle: string) => void
}) {
  const t = useT()
  const groupCallChatId = useGroupCallStore((st) => st.peerId)
  const livestreamChatId = useLivestreamStore((st) => st.watchingPeerId)
  const locked = useLockStore((st) => st.locked)

  // Тост — контракт tweb `components/toast.ts`: узел сперва попадает в DOM без
  // `.is-visible` (там это `toastsContainer.append(toastEl)` + reflow
  // `void toastEl.offsetLeft`, toast.ts:41-46), затем вешается класс и играет
  // ТОЛЬКО opacity; на скрытии класс снимается, а сам узел удаляется через 200 мс
  // (toast.ts:26-30). Поэтому нужен свой «удержанный» текст: `toast` из стора
  // обнуляется сразу, а бабл должен успеть погаснуть.
  const [toastText, setToastText] = useState<string | null>(null)
  const [toastShown, setToastShown] = useState(false)
  useEffect(() => {
    if (toast != null) {
      setToastText(toast)
      // класс — кадром позже монтирования, иначе анимировать не от чего
      const raf = requestAnimationFrame(() => setToastShown(true))
      return () => cancelAnimationFrame(raf)
    }
    setToastShown(false)
    const id = window.setTimeout(() => setToastText(null), TOAST_HIDE_TIME)
    return () => window.clearTimeout(id)
  }, [toast])

  // QR-подтверждение открывается сразу смонтированным, поэтому `.active`-класс
  // (tweb popups/index.ts:359 `show()`) ставится следующим кадром — та же схема,
  // что в shared/ui/Popup.
  const [qrShown, setQrShown] = useState(false)
  useEffect(() => {
    if (!qrConfirmToken) { setQrShown(false); return }
    const raf = requestAnimationFrame(() => setQrShown(true))
    return () => cancelAnimationFrame(raf)
  }, [qrConfirmToken])

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
      {toastText != null && (
        <div className={classNames(s.joinToast, toastShown ? s.joinToastVisible : '')}>{toastText}</div>
      )}

      {/* /qr/:token confirm overlay — approve a desktop QR login */}
      {qrConfirmToken && (
        <>
          <div onClick={cancelQr} className={classNames(s.qrScrim, qrShown ? s.qrShown : '')} />
          <div
            role="dialog"
            aria-label={t('QrLogin.Confirm.Title')}
            className={classNames(s.qrCard, qrShown ? s.qrShown : '')}
          >
            <Text size={17} weight={600} color="var(--primary-text-color)" style={{ marginBottom: '8px' }}>
              {t('QrLogin.Confirm.Title')}
            </Text>
            <Text size={14.5} color="var(--secondary-text-color)" style={{ lineHeight: 1.5 }}>
              {t('QrLogin.Confirm.Text')}
            </Text>
            <div className={s.qrActions}>
              <div role="button" tabIndex={0} onClick={cancelQr} className={classNames(s.qrBtn, s.qrCancel)}>
                {t('Cancel')}
              </div>
              <div role="button" tabIndex={0} onClick={confirmQr} className={classNames(s.qrBtn, s.qrConfirm)}>
                {t('QrLogin.Confirm.Action')}
              </div>
            </div>
          </div>
        </>
      )}

      {/* /addlist/:slug — вступление по ссылке-приглашению в папку */}
      {addlistSlug && (
        <FolderInvitePopup slug={addlistSlug} onClose={closeAddlist} onJoined={onAddlistJoined} />
      )}

      {/* Глобальный экран звонка (входящие показываются из любого места) */}
      <CallOverlay />

      {/* Mini-app бота (iframe + мост window.Telegram.WebApp) */}
      <WebAppModal />

      {/* Жалобы (tweb reportMessages): один глобальный попап */}
      <ReportPopup />

      {/* Блокировка код-паролем поверх всего (tweb passcodeLockScreen) */}
      {locked && <PasscodeLockScreen />}
    </>
  )
}
