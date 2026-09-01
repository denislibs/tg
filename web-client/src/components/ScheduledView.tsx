// «Запланированные сообщения» (tweb ChatType.Scheduled): оверлей со списком
// своих запланированных в чате; сервисная подпись «Отправится …», действия
// «Отправить сейчас» / «Удалить» (tweb MessageScheduleSend / delete).
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import DomNode from '../shared/ui/DomNode'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import SchedulePopup from './SchedulePopup'
import { useScheduledMessages } from '../core/hooks/useScheduledMessages'
import { getMessageText, type MyMessage } from '../core/models'
import { formatDate } from '@helpers/date'
import { i18n } from '@lib/langPack'
import { useT } from '../i18n'
import s from './ScheduledView.module.scss'

/**
 * Подпись «Отправится …» — ДОСЛОВНЫЙ порт `createDateBubble`
 * (tweb `chat/bubbles.ts:4780-4798`), три его ветки в том же порядке:
 *
 *   сегодня            → `i18n('Chat.Date.ScheduledForToday')`
 *   «когда онлайн»     → `i18n('MessageScheduledUntilOnline')`
 *   любая другая дата  → `i18n('Chat.Date.ScheduledFor', [formatDate(date, {today})])`
 *
 * Ключевое здесь — что дата едет АРГУМЕНТОМ ключа, а не приклеивается к
 * переведённому куску фразы. До этого мы складывали подпись сами — переведённый
 * обрезок «Отправится», пробел, дата, — и этот обрезок жил отдельным ключом. Половину фразы нельзя перевести: в языках с другим
 * порядком слов дата стоит не там, а падеж у неё свой. Ключ оригинала несёт
 * `%@` внутри, и подстановку делает `superFormatter` ядра — поэтому наш
 * обрезок-префикс снесён из английского источника и всех пяти словарей, а на
 * его месте ключ оригинала `Chat.Date.ScheduledFor` = 'Scheduled for %@'.
 *
 * Время в подписи не показывается — его нет и у оригинала: `formatDate(date,
 * {today})` даёт только день и месяц. Расхождение, которое из этого следует,
 * названо в отчёте задачи #121: у tweb точную минуту несёт САМ БАБЛ
 * (`messageRender.setTime`), а у нашего оверлея строка бабла времени не имеет
 * вовсе — это предмет отдельной работы по экрану, а не повод держать здесь
 * свою композицию.
 *
 * Экспортируется РАДИ ПИНА (`components/dateLabels.form.test.tsx`), тем же
 * приёмом, что `TopbarSearch::EmptyResults`: поднимать весь оверлей со списком
 * и менеджерами ради трёх веток подписи дороже самой подписи.
 */
export function ScheduledLabel({ message }: { message: MyMessage }) {
  const node = useMemo(() => {
    // `send_at`/`when_online` — НАШИ параметры вне схемы у конструктора `message`.
    if (message._ !== 'message') return null
    if (message.when_online) return i18n('MessageScheduledUntilOnline')

    const sendAt = message.send_at ?? 0
    const date = new Date(sendAt * 1000)
    if (Number.isNaN(date.getTime())) return null

    // Оригинал сравнивает НАЧАЛА СУТОК (`today.setHours(0,0,0,0)`), потому что
    // ему приходит дата-разделитель; у нас в руках полное время отправки,
    // поэтому к началу суток приводятся обе стороны.
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const day = new Date(date)
    day.setHours(0, 0, 0, 0)

    if (day.getTime() === today.getTime()) return i18n('Chat.Date.ScheduledForToday')

    return i18n('Chat.Date.ScheduledFor', [formatDate(date, { today })])
  }, [message])

  return node ? <DomNode node={node} /> : null
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
