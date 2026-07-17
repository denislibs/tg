// Confirm-диалог настроек (tweb confirmationPopup): заголовок, текст,
// «Отмена» + кнопка действия. Общий для «Данных и памяти», черновиков и т.п.
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { EASE } from '../../motion'
import s from './ConfirmDialog.module.scss'

export default function ConfirmDialog({ title, text, action, danger, onConfirm, onClose }: {
  title: string
  text: string
  action: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useT()
  return createPortal(
    <div className={s.overlay} onClick={onClose}>
      <motion.div
        className={s.card}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE }}
      >
        <Text size={17} weight={600} color="var(--tg-textPrimary)" style={{ marginBottom: 8 }}>{title}</Text>
        <Text size={14.5} color="var(--tg-textSecondary)">{text}</Text>
        <div className={s.actions}>
          <div className={s.action} onClick={onClose}>{t('Cancel')}</div>
          <div className={s.action} style={danger ? { color: '#ff595a' } : undefined} onClick={() => { onConfirm(); onClose() }}>
            {action}
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
