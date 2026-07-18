// «Запланированные сообщения» (tweb ChatType.Scheduled): оверлей со списком
// своих запланированных в чате; сервисная подпись «Отправится …», действия
// «Отправить сейчас» / «Удалить» (tweb MessageScheduleSend / delete).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import IconButton from '../shared/ui/IconButton'
import RichText from './RichText'
import { useManagers } from '../core/hooks/useManagers'
import { useMessagesStore } from '../stores/messagesStore'
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
  const managers = useManagers()
  const [list, setList] = useState<Scheduled[] | null>(null)

  const reload = () => {
    void managers.messages.listScheduled(chatId).then((l) => {
      setList(l)
      onChanged(l.length)
    })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [chatId])

  const fmtWhen = (iso: string) => {
    const d = new Date(iso)
    const today = d.toDateString() === new Date().toDateString()
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    if (today) return `${t('Scheduled for today')}, ${hm}`
    return `${t('Scheduled for')} ${d.toLocaleDateString(lang)}, ${hm}`
  }

  const sendNow = (id: number) => {
    void managers.messages.sendScheduledNow(chatId, id).then((msg) => {
      useMessagesStore.getState().applyIncoming(chatId, msg)
      reload()
    })
  }
  const remove = (id: number) => {
    void managers.messages.deleteScheduled(chatId, id).then(reload)
  }

  return createPortal(
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
                  {fmtWhen(m.sendAt)}
                </Text>
                <Text size={15} color="var(--tg-textPrimary)" style={{ wordBreak: 'break-word' }}>
                  <RichText text={m.text} entities={m.entities} linkColor="var(--tg-link)" />
                </Text>
              </div>
              <div className={s.actions}>
                <IconButton size="small" onClick={() => sendNow(m.id)} title={t('Send Now')} aria-label={t('Send Now')}>
                  <TgIcon name="send" size={18} color="var(--tg-accent)" />
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
  )
}
