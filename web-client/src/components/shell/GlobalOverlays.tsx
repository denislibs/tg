// Глобальные оверлеи мессенджера поверх колонок: групповой звонок, RTMP-эфир,
// тост, подтверждение QR-входа, приглашение в папку, экран звонка, mini-app бота,
// жалобы, блокировка код-паролем. Вынесено из App ради читаемости Shell.
import { AnimatePresence, motion } from 'framer-motion'
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
  const groupCallChatId = useGroupCallStore((st) => st.chatId)
  const livestreamChatId = useLivestreamStore((st) => st.watchingChatId)
  const locked = useLockStore((st) => st.locked)

  return (
    <>
      <AnimatePresence>
        {/* Групповой звонок — глобальное окно (живёт поверх любого чата) */}
        {groupCallChatId != null && (
          <GroupCallScreen chatName={chatList.find((c) => c.id === String(groupCallChatId))?.name ?? ''} />
        )}
        {/* RTMP-трансляция — глобальное окно просмотра (поверх любого чата) */}
        {livestreamChatId != null && (
          <LivestreamScreen chatName={chatList.find((c) => c.id === String(livestreamChatId))?.name ?? ''} />
        )}
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className={s.joinToast}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* /qr/:token confirm overlay — approve a desktop QR login */}
      {qrConfirmToken && (
        <>
          <div onClick={cancelQr} className={s.qrScrim} />
          <motion.div
            role="dialog"
            aria-label={t('Войти на новом устройстве?')}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className={s.qrCard}
          >
            <Text size={17} weight={600} color="var(--primary-text-color)" style={{ marginBottom: '8px' }}>
              {t('Войти на новом устройстве?')}
            </Text>
            <Text size={14.5} color="var(--secondary-text-color)" style={{ lineHeight: 1.5 }}>
              {t('Подтвердите вход для нового устройства')}
            </Text>
            <div className={s.qrActions}>
              <div role="button" tabIndex={0} onClick={cancelQr} className={classNames(s.qrBtn, s.qrCancel)}>
                {t('Отмена')}
              </div>
              <div role="button" tabIndex={0} onClick={confirmQr} className={classNames(s.qrBtn, s.qrConfirm)}>
                {t('Подтвердить')}
              </div>
            </div>
          </motion.div>
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
