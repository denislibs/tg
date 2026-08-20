// «Запланированные сообщения» (tweb ChatType.Scheduled): оверлей со списком
// своих запланированных в чате; сервисная подпись «Отправится …», действия
// «Отправить сейчас» / «Удалить» (tweb MessageScheduleSend / delete).
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useScheduledMessages } from '../core/hooks/useScheduledMessages'
import { getMessageText, type MyMessage } from '../core/models'
import { useLang, useT } from '../i18n'
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

  const fmtWhen = (m: MyMessage) => {
    // «Отправить, когда онлайн» (tweb MessageScheduledUntilOnline): вместо даты.
    // `send_at`/`when_online` — НАШИ параметры вне схемы у конструктора `message`.
    if (m._ !== 'message') return ''
    if (m.when_online) return t('Scheduled until online')
    const d = new Date((m.send_at ?? 0) * 1000)
    const today = d.toDateString() === new Date().toDateString()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (today) return `${t('Scheduled for today')}, ${hm}`
    return `${t('Scheduled for')} ${d.toLocaleDateString(lang)}, ${hm}`
  }

  return <>
    {reschedule && (
      <SchedulePopup
        initUnix={reschedule.sendAt}
        onPick={doReschedule}
        onClose={() => setReschedule(null)}
      />
    )}
    {createPortal(
    <div className={s.overlay} onClick={onClose}>
      <div className={s.card} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className={s.header}>
          <Text size={17} weight={600} color="var(--primary-text-color)" style={{ flex: 1 }}>
            {t('Scheduled Messages')}
          </Text>
          <IconButton onClick={onClose} color="var(--secondary-text-color)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {list != null && list.length === 0 && (
            <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: '2rem 1rem', textAlign: 'center', display: 'block' }}>
              {t('No scheduled messages here yet…')}
            </Text>
          )}
          {(list ?? []).map((m) => (
            <div key={m.id} className={s.row}>
              <div className={s.bubble}>
                <Text size={12.5} color="var(--primary-color)" weight={600}>
                  {fmtWhen(m)}
                </Text>
                <Text size={15} color="var(--primary-text-color)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={getMessageText(m)} entities={m._ === 'message' ? m.entities : undefined} linkColor="var(--link-color)" />
                </Text>
              </div>
              <div className={s.actions}>
                <IconButton size="small" onClick={() => sendNow(m.id)} title={t('Send Now')} aria-label={t('Send Now')}>
                  <TgIcon name="send" size={18} color="var(--primary-color)" />
                </IconButton>
                <IconButton size="small" onClick={() => setReschedule({ id: m.id, sendAt: m._ === 'message' ? (m.send_at ?? 0) : 0 })} title={t('Reschedule')} aria-label={t('Reschedule')}>
                  <TgIcon name="schedule" size={18} color="var(--primary-color)" />
                </IconButton>
                <IconButton size="small" onClick={() => remove(m.id)} title={t('Delete')} aria-label={t('Delete')}>
                  <TgIcon name="delete" size={18} color="#ff595a" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
    )}
  </>
}
