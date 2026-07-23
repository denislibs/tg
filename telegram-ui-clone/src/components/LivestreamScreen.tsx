// Экран просмотра RTMP-трансляции — порт визуала tweb appMediaViewerRtmp
// (плавающее окно как у группового звонка): LIVE-бейдж (градиент), счётчик
// зрителей, кнопка выйти. Реального видео-ingest в проекте нет, поэтому вместо
// потока — честный плейсхолдер «Трансляция идёт» с LIVE-бейджем.
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { useLivestreamStore } from '../stores/livestreamStore'
import { useGroupCallStore } from '../stores/groupCallStore'
import { leaveLivestream } from '../core/calls/livestreamEngine'
import { useT } from '../i18n'
import { EASE } from '../motion'
import s from './LivestreamScreen.module.scss'

export default function LivestreamScreen({ chatName }: { chatName: string }) {
  const t = useT()
  const chatId = useLivestreamStore((st) => st.watchingChatId)
  // зрители = участники группового звонка чата (зритель регистрируется как участник)
  const viewers = useGroupCallStore((st) => (chatId != null ? st.activeByChat[chatId]?.length ?? 0 : 0))

  if (chatId == null) return null

  return createPortal(
    <motion.div
      className={s.window}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <div className={s.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.titleRow}>
            <span className={s.live}>{t('LIVE')}</span>
            <Text noWrap size={16} weight={600} color="#fff">{chatName}</Text>
          </div>
          <Text size={13} color="#aaa" style={{ display: 'block' }}>
            {viewers > 0 ? t('{n} watching').replace('{n}', String(viewers)) : t('No viewers')}
          </Text>
        </div>
      </div>

      <div className={s.stage}>
        <div className={s.placeholder}>
          <TgIcon name="livestream" size={44} color="#fff" />
          <Text size={16} weight={600} color="#fff">{t('The stream is live')}</Text>
        </div>
      </div>

      <div className={s.buttons}>
        <button className={s.btnLeave} onClick={leaveLivestream} title={t('Leave')}>
          <TgIcon name="close" size={24} color="#fff" />
        </button>
      </div>
    </motion.div>,
    document.body,
  )
}
