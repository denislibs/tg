// Плейсхолдер пустого приватного чата (tweb .empty-bubble-placeholder-greeting):
// карточка по центру ленты — «No messages here yet...» + подсказка + стикер-
// приветствие. Тап по стикеру шлёт приветствие (👋), как в tweb.
import { useLayoutEffect, useRef } from 'react'
import Emoji from '../emoji/Emoji'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import { animateLadder } from '../../core/dom/ladder'
import classNames from '../../shared/lib/classNames'
import s from './EmptyChatGreeting.module.scss'

export default function EmptyChatGreeting({ onGreet }: { onGreet: () => void }) {
  const t = useT()
  const innerRef = useRef<HTMLDivElement>(null)
  // Вход карточки в tweb — не своя анимация, а тот же переход, что у баблов:
  // `.empty-bubble-placeholder .bubble-content-wrapper { transition:
  // var(--bubble-transition-in) }` (_chatBubble.scss:4066-4072), а стартовое
  // состояние — `translateX(0) scale3d(.8,.8,1); opacity: 0`. Ровно это и делает
  // пара классов `zoom-fade`/`can-zoom-fade` (_chatBubble.scss:3210-3222), поэтому
  // вход ведёт та же `animateLadder`, что и лестница при открытии чата.
  // Задержки нет — шаг в лестнице один (tweb `middleIds`, offsetIndex 0).
  useLayoutEffect(() => {
    const inner = innerRef.current
    const wrap = inner?.parentElement
    if (!inner || !wrap) return
    void animateLadder(wrap, [inner], { delay: 0, offsetIndex: 0 })
  }, [])
  return (
    <div className={classNames('empty-bubble-placeholder', s.wrap)}>
      <div ref={innerRef}>
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
      </div>
    </div>
  )
}
