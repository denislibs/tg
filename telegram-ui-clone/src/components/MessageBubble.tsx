import TgIcon from './TgIcon'
import Text from '../shared/ui/Text'
import { motion } from 'framer-motion'
import PostImage from './PostImage'
import Reaction from './Reaction'
import s from './MessageBubble.module.scss'

export default function MessageBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className={s.root}
    >
      <div className={s.card}>
        {/* Photo */}
        <div className={s.photo}>
          <PostImage />
        </div>

        {/* Body */}
        <div className={s.body}>
          <Text weight={700} size={15} color="var(--tg-textPrimary)" style={{ marginBottom: '10px' }}>
            ОЧЕНЬ ВАЖНО!!!
          </Text>

          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            🧧 <span className={s.link}>Наш основной канал</span> заблокировали у большинства
            подписчиков
          </Text>

          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            Причина? Алгоритмы решили, что у нас тут порнография. Очень суровый комплемент нашей
            индустрии 🤝
          </Text>

          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            Но мы не из тех, кто сдается после первого раунда. <span className={s.link}>Новый канал</span>{' '}
            уже создан, весь контент перенесён, работа продолжается в штатном режиме.
          </Text>

          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5, marginBottom: '12px' }}>
            ГОСПОДА, <span className={s.link}>подписывайтесь на наш новый канал</span>. Тут мы
            будем продолжать делать всё ровно то же самое, что делали и до этого.
          </Text>

          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5, marginBottom: '4px' }}>
            Так что жмем по ссылке и продолжаем
          </Text>
          <Text size={15} color="var(--tg-textPrimary)" style={{ lineHeight: 1.5 }}>
            👉<span className={s.link}>https://t.me/+Y4yhqW7nAQcxNDdi</span>
          </Text>

          {/* Reactions */}
          <div className={s.reactions}>
            <Reaction emoji="⭐" highlighted />
            <Reaction emoji="👍" count={5} />
            <Reaction emoji="❤️" count={1} />
            <div className={s.spacer} />
            <div className={s.meta}>
              <Text size={13.5}>1.5K</Text>
              <TgIcon name="eye" size={17} />
              <Text size={13.5} style={{ marginLeft: '4px' }}>22:09</Text>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
