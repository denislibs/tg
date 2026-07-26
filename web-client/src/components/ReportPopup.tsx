// src/components/ReportPopup.tsx
// Попап «Пожаловаться» (tweb popups/reportMessages): список причин (radio) +
// необязательный комментарий + отправка. Цель (чат или сообщение) берётся из
// reportStore, поэтому попап смонтирован один раз глобально (App) и открывается
// из контекстного меню сообщения и из ⋮-меню чата без проброса пропсов.
import { useState } from 'react'
import Popup from '../shared/ui/Popup'
import Text from '../shared/ui/Text'
import Input from '../shared/ui/Input'
import TgIcon from './TgIcon'
import { useManagers } from '../core/hooks/useManagers'
import { useReportStore } from '../stores/reportStore'
import { uiEvents } from '../core/hooks/uiEvents'
import { useT } from '../i18n'
import type { ReportReason } from '../core/managers/reportManager'
import s from './ReportPopup.module.scss'

// Причины из белого списка бэкенда (domain.ReportReason). Порядок — как в tweb
// reportMessages (спам, насилие, порнография, детская безопасность, другое).
export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'violence', label: 'Violence' },
  { value: 'porn', label: 'Pornography' },
  { value: 'child_abuse', label: 'Child Abuse' },
  { value: 'other', label: 'Other' },
]

export default function ReportPopup() {
  const t = useT()
  const managers = useManagers()
  const target = useReportStore((st) => st.target)
  const clear = useReportStore((st) => st.close)
  const [reason, setReason] = useState<ReportReason>('spam')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  // open выводится напрямую из наличия цели — закрытие обнуляет цель в сторе, а
  // сброс выбора делаем по завершении exit-анимации (onExitComplete).
  const open = target != null
  const reset = () => { setReason('spam'); setComment(''); setBusy(false) }

  const submit = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      await managers.report.report({
        chatId: target.chatId,
        msgId: target.msgId,
        reason,
        comment: comment.trim() || undefined,
      })
      uiEvents.emit('ui:toast', t('Report sent'))
      clear()
    } catch {
      setBusy(false)
      uiEvents.emit('ui:toast', t('Could not send report'))
    }
  }

  return (
    <Popup
      open={open}
      title={t('Report')}
      onClose={clear}
      onExitComplete={reset}
      width={400}
      action={{ label: busy ? t('Sending…') : t('Report'), onClick: submit }}
    >
      <div className={s.list}>
        {REPORT_REASONS.map((r) => (
          <div
            key={r.value}
            className={s.row}
            data-selected={reason === r.value || undefined}
            onClick={() => setReason(r.value)}
          >
            <Text size={15} color="var(--tg-textPrimary)">{t(r.label)}</Text>
            {reason === r.value && <TgIcon name="check" size={20} color="var(--tg-accent)" />}
          </div>
        ))}
      </div>
      <Input
        label={t('Additional details (optional)')}
        value={comment}
        onChange={setComment}
        wrapClassName={s.comment}
      />
    </Popup>
  )
}
