// «Запланированные сообщения» (tweb ChatType.Scheduled): оверлей со списком
// своих запланированных в чате; сервисная подпись «Отправится …», действия
// «Отправить сейчас» / «Удалить» (tweb MessageScheduleSend / delete).
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import { SentTime, Time } from '../shared/ui/dateNodes'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useScheduledMessages } from '../core/hooks/useScheduledMessages'
import { getMessageText, type MyMessage } from '../core/models'
import { useT } from '../i18n'
import s from './ScheduledView.module.scss'

/**
 * Подпись «Отправится …» — три ветки оригинала (`bubbles.ts::createDateBubble`,
 * :4786-4798): «когда онлайн», «сегодня» и обычная дата.
 *
 * Дата и время — УЗЕЛ `formatFullSentTime` («Сегодня в 14:30» / «5 сент. в
 * 14:30»), а не склейка `toLocaleDateString(lang)` с руками собранным «ЧЧ:ММ»:
 * прежняя склейка не уважала ни настройку 12/24 часа, ни язык пакета (`lang`
 * стора мог разойтись с языком ядра, если пакет не доехал).
 */
function ScheduledLabel({ message }: { message: MyMessage }) {
  const t = useT()
  // `send_at`/`when_online` — НАШИ параметры вне схемы у конструктора `message`.
  if (message._ !== 'message') return null
  if (message.when_online) return <>{t('MessageScheduledUntilOnline')}</>
  const sendAt = message.send_at ?? 0
  const isToday = new Date(sendAt * 1000).toDateString() === new Date().toDateString()
  return isToday
    ? <>{t('Chat.Date.ScheduledForToday')}, <Time timestamp={sendAt} /></>
    : <>{t('Schedule.ScheduledFor')} <SentTime timestamp={sendAt} /></>
}

export default function ScheduledView({ chatId, onClose, onChanged }: {
  chatId: number
  onClose: () => void
  /** список изменился (удаление/отправка) — родитель обновит счётчик-календарик */
  onChanged: (count: number) => void
}) {
  const t = useT()
  const { list, reschedule, setReschedule, doReschedule, sendNow, remove } = useScheduledMessages(chatId, onChanged)

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
            {t('ScheduledMessages')}
          </Text>
          <IconButton onClick={onClose} color="var(--secondary-text-color)" aria-label={t('Close')}>
            <TgIcon name="close" size={22} />
          </IconButton>
        </div>
        <div className={s.list}>
          {list != null && list.length === 0 && (
            <Text size={14.5} color="var(--secondary-text-color)" style={{ padding: '2rem 1rem', textAlign: 'center', display: 'block' }}>
              {t('NoScheduledMessages')}
            </Text>
          )}
          {(list ?? []).map((m) => (
            <div key={m.id} className={s.row}>
              <div className={s.bubble}>
                <Text size={12.5} color="var(--primary-color)" weight={600}>
                  <ScheduledLabel message={m} />
                </Text>
                <Text size={15} color="var(--primary-text-color)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={getMessageText(m)} entities={m._ === 'message' ? m.entities : undefined} linkColor="var(--link-color)" />
                </Text>
              </div>
              <div className={s.actions}>
                <IconButton size="small" onClick={() => sendNow(m.id)} title={t('MessageScheduleSend')} aria-label={t('MessageScheduleSend')}>
                  <TgIcon name="send" size={18} color="var(--primary-color)" />
                </IconButton>
                <IconButton size="small" onClick={() => setReschedule({ id: m.id, sendAt: m._ === 'message' ? (m.send_at ?? 0) : 0 })} title={t('MessageScheduleEditTime')} aria-label={t('MessageScheduleEditTime')}>
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
