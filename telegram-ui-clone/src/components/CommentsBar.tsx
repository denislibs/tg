import TgIcon from './TgIcon'
import { motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import { useT } from '../i18n'
import s from './CommentsBar.module.scss'

const commenters = [
  { bg: 'linear-gradient(135deg,#ff5f6d,#ffc371)', label: 'ДЧ' },
  { bg: 'linear-gradient(135deg,#43e97b,#38f9d7)', label: '' },
  { bg: 'linear-gradient(135deg,#5b5b5b,#1a1a1a)', label: '' },
]

export default function CommentsBar({ onOpen, count }: { onOpen?: () => void; count?: number }) {
  const t = useT()

  return (
    <div className={s.bar}>
      <div className={s.main} onClick={onOpen}>
        <div className={s.avatars}>
          {commenters.map((c, i) => (
            <div key={i} className={s.avatar} style={{ background: c.bg }}>
              {c.label}
            </div>
          ))}
        </div>
        <Text size={14.5} weight={600} color="var(--tg-accent)" className={s.label}>
          {t('Comments')}{count != null ? ` (${count})` : ''}
        </Text>
        <TgIcon name="next" color="var(--tg-textFaint)" />
      </div>

      <motion.div className={s.roundBtn} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}>
        <TgIcon name="reactions_filled" size={20} color="#ff3b5c" />
      </motion.div>
      <motion.div className={s.roundBtn} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}>
        <TgIcon name="reply" size={20} color="var(--tg-textSecondary)" style={{ transform: 'scaleX(-1)' }} />
      </motion.div>
    </div>
  )
}
