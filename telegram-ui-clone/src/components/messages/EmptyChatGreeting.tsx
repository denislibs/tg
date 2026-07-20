// Плейсхолдер пустого приватного чата (tweb .empty-bubble-placeholder-greeting):
// карточка по центру ленты — «No messages here yet...» + подсказка + стикер-
// приветствие. Тап по стикеру шлёт приветствие (👋), как в tweb.
import { motion } from 'framer-motion'
import Emoji from '../emoji/Emoji'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import s from './EmptyChatGreeting.module.scss'

export default function EmptyChatGreeting({ onGreet }: { onGreet: () => void }) {
  const t = useT()
  return (
    <motion.div
      className={s.wrap}
      // x/y -50% в самой анимации: иначе inline transform: scale() от framer
      // перекрыл бы CSS translate(-50%,-50%) и карточка ушла бы из центра.
      initial={{ opacity: 0, scale: 0.9, x: '-50%', y: '-50%' }}
      animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    >
      <div className={s.card} onClick={onGreet}>
        <Text size={16} weight={600} color="#fff" className={s.title}>
          {t('No messages here yet...')}
        </Text>
        <Text size={14} color="rgba(255,255,255,0.8)" className={s.subtitle}>
          {t('Send a message or tap the greeting below.')}
        </Text>
        <div className={s.sticker}>
          <Emoji e="👋" size={160} />
        </div>
      </div>
    </motion.div>
  )
}
