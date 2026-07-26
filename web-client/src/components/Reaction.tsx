import Text from '../shared/ui/Text'
import classNames from '../shared/lib/classNames'
import { motion } from 'framer-motion'
import s from './Reaction.module.scss'

interface Props {
  emoji: string
  count?: number
  highlighted?: boolean
}

export default function Reaction({ emoji, count, highlighted }: Props) {
  return (
    <motion.div
      className={classNames(s.reaction, count != null ? s.hasCount : '', highlighted ? s.highlighted : '')}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 22 }}
    >
      <span className={s.emoji}>{emoji}</span>
      {count != null && (
        <Text size={13.5} weight={600} color="var(--tg-accent)">{count}</Text>
      )}
    </motion.div>
  )
}
