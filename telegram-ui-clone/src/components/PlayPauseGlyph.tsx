// Морф play↔pause (tweb кросс-фейдит и поворачивает глиф) — один и тот же
// в бабле голосового, глобальном плеере и строках шаред-медиа профиля.
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon from './TgIcon'

export default function PlayPauseGlyph({
  playing,
  size,
  className,
}: {
  playing: boolean
  size?: number
  className?: string
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={playing ? 'pause' : 'play'}
        className={className}
        initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.4, rotate: 45 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
      >
        {playing ? <TgIcon name="pause" size={size} /> : <TgIcon name="play" size={size} />}
      </motion.span>
    </AnimatePresence>
  )
}
