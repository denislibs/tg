import IconButton from '../shared/ui/IconButton'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import { motion } from 'framer-motion'
import { useT } from '../i18n'
import s from './NotificationBanner.module.scss'

interface Props {
  onClose: () => void
}

export default function NotificationBanner({ onClose }: Props) {
  const t = useT()
  return (
    <motion.div
      initial={{ opacity: 0, height: 0, marginBottom: 0 }}
      animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <div className={s.banner}>
        <div className={s.body}>
          <Text weight={600} size={15} color="var(--tg-textPrimary)">
            {t('Never miss a message! 🔔')}
          </Text>
          <Text size={14} color="var(--tg-textSecondary)" style={{ marginTop: '2px' }}>
            {t('Enable notifications to stay updated.')}
          </Text>
        </div>
        <IconButton size="small" onClick={onClose} color="var(--tg-textFaint)" className={s.close}>
          <TgIcon name="close" size={20} />
        </IconButton>
      </div>
    </motion.div>
  )
}
