// «Запланированные сообщения» (tweb ChatType.Scheduled): оверлей со списком
// своих запланированных в чате; сервисная подпись «Отправится …», действия
// «Отправить сейчас» / «Удалить» (tweb MessageScheduleSend / delete).
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useScheduledMessages } from '../core/hooks/useScheduledMessages'
import type { Scheduled } from '../core/models'
import { useLang, useT } from '../i18n'
import { EASE } from '../motion'
import s from './ScheduledView.module.scss'

export default function ScheduledView({ chatId, onClose, onChanged }: {
  chatId: number
  onClose: () => void
  /** список изменился (удаление/отправка) — родитель обновит счётчик-календарик */
  onChanged: (count: number) => void
}) {
  const t = useT()
  const [lang] = useLang()
  const { list, reschedule, setReschedule, doReschedule, sendNow, remove } = useScheduledMessages(chatId, onChanged)

  const fmtWhen = (m: Scheduled) => {
    // «Отправить, когда онлайн» (tweb MessageScheduledUntilOnline): вместо даты.
    if (m.whenOnline) return t('Scheduled until online')
    const d = new Date(m.sendAt)
    const today = d.toDateString() === new Date().toDateString()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (today) return `${t('Scheduled for today')}, ${hm}`
    return `${t('Scheduled for')} ${d.toLocaleDateString(lang)}, ${hm}`
  }

  return <>
    {reschedule && (
      <SchedulePopup
        initUnix={Math.floor(new Date(reschedule.sendAt).getTime() / 1000)}
        onPick={doReschedule}
        onClose={() => setReschedule(null)}
      />
    )}
    {createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.card}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <div className={s.header}>
          <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ flex: 1 }}>
            {t('Scheduled Messages')}
          </Text>
          <IconButton onClick={onClose} color="var(--tg-textSecondary)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {list != null && list.length === 0 && (
            <Text size={14.5} color="var(--tg-textSecondary)" style={{ padding: '2rem 1rem', textAlign: 'center', display: 'block' }}>
              {t('No scheduled messages here yet…')}
            </Text>
          )}
          {(list ?? []).map((m) => (
            <div key={m.id} className={s.row}>
              <div className={s.bubble}>
                <Text size={12.5} color="var(--tg-accent)" weight={600}>
                  {fmtWhen(m)}
                </Text>
                <Text size={15} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={m.text} entities={m.entities} linkColor="var(--tg-link)" />
                </Text>
              </div>
              <div className={s.actions}>
                <IconButton size="small" onClick={() => sendNow(m.id)} title={t('Send Now')} aria-label={t('Send Now')}>
                  <TgIcon name="send" size={18} color="var(--tg-accent)" />
                </IconButton>
                <IconButton size="small" onClick={() => setReschedule({ id: m.id, sendAt: m.sendAt })} title={t('Reschedule')} aria-label={t('Reschedule')}>
                  <TgIcon name="schedule" size={18} color="var(--tg-accent)" />
                </IconButton>
                <IconButton size="small" onClick={() => remove(m.id)} title={t('Delete')} aria-label={t('Delete')}>
                  <TgIcon name="delete" size={18} color="#ff595a" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body,
    )}
  </>
}
