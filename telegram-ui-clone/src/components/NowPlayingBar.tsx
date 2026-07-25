import { memo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import { AnimatePresence, motion } from 'framer-motion'
import TgIcon, { type IconName } from './TgIcon'
import PlayPauseGlyph from './PlayPauseGlyph'
import { useAudioStore } from '../stores/audioStore'
import classNames from '../shared/lib/classNames'
import s from './NowPlayingBar.module.scss'

// A round control button with a hover circle + press-scale feedback.
function RoundBtn({
  onClick,
  color,
  active,
  label,
  children,
}: {
  onClick: (e: React.MouseEvent<HTMLElement>) => void
  color: string
  active?: boolean
  label: string
  children: ReactNode
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={classNames(s.roundBtn, active ? s.roundBtnActive : '')}
      // цвет иконки и фон активного состояния — рантайм-динамика по пропу color
      style={{
        color,
        background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : undefined,
      }}
    >
      {children}
    </motion.button>
  )
}

// Вертикальный слайдер громкости на pointer-событиях: перетаскивание по Y (снизу
// вверх = 0..1). Нативный range, повёрнутый на 90°, тянулся по горизонтали — было
// неудобно; здесь ось перетаскивания совпадает с визуальной.
function VolumeSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const apply = (clientY: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    onChange(Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height)))
  }
  const pct = Math.round(value * 100)
  return (
    <div
      ref={ref}
      className={s.volTrack}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); apply(e.clientY) }}
      onPointerMove={(e) => { if (e.buttons === 1) apply(e.clientY) }}
    >
      <div className={s.volFill} style={{ height: `${pct}%` }} />
      <div className={s.volThumb} style={{ bottom: `${pct}%` }} />
    </div>
  )
}

// The global "now playing" bar — modelled on tweb's `.pinned-container.pinned-audio`:
// a flat surface strip (not a floating pill) with rewind/play/forward, a title +
// thin seek line, and right-side utils (volume slider, speed, close).
// Takes no props and owns its own audio-store subscriptions, so memo() keeps it
// from re-rendering whenever the parent (ConversationView) does — only its own
// store updates (play/seek/time tick) drive it.
function NowPlayingBar() {
  const track = useAudioStore((s) => s.track)
  const playing = useAudioStore((s) => s.playing)
  const currentTime = useAudioStore((s) => s.currentTime)
  const duration = useAudioStore((s) => s.duration)
  const rate = useAudioStore((s) => s.rate)
  const muted = useAudioStore((s) => s.muted)
  const volume = useAudioStore((s) => s.volume)
  const toggle = useAudioStore((s) => s.toggle)
  const next = useAudioStore((s) => s.next)
  const prev = useAudioStore((s) => s.prev)
  const seekFraction = useAudioStore((s) => s.seekFraction)
  const setRate = useAudioStore((s) => s.setRate)
  const toggleMute = useAudioStore((s) => s.toggleMute)
  const setVolume = useAudioStore((s) => s.setVolume)
  const closePlayer = useAudioStore((s) => s.close)

  const [volOpen, setVolOpen] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  // Слайдер громкости — в портале (document.body), чтобы его не резал overflow:hidden
  // плашки. Позиционируем fixed по кнопке; hover ведём и по кнопке, и по попапу, с
  // задержкой закрытия — портал рвёт DOM-вложенность (mouseleave иначе рвёт hover).
  const volBtnRef = useRef<HTMLDivElement>(null)
  const [volRect, setVolRect] = useState<DOMRect | null>(null)
  const volCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openVol = () => {
    clearTimeout(volCloseTimer.current)
    const r = volBtnRef.current?.getBoundingClientRect()
    if (r) setVolRect(r)
    setVolOpen(true)
  }
  const scheduleCloseVol = () => {
    clearTimeout(volCloseTimer.current)
    volCloseTimer.current = setTimeout(() => setVolOpen(false), 140)
  }
  const frac = duration > 0 ? currentTime / duration : 0
  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  }
  const rateLabel = `${rate}X` // 0.5x/1x/1.5x/2x — раньше 0.5x ошибочно показывал «2X»
  const effVol = muted ? 0 : volume
  const volIconName: IconName = effVol === 0 ? 'volume_off' : effVol < 0.5 ? 'volume_down' : 'volume_up'

  return (
    <>
    <AnimatePresence>
      {track && (
        <motion.div
          initial={{ y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -56, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className={s.bar}>
            <RoundBtn onClick={prev} color="var(--tg-accent)" label="prev">
              <TgIcon name="fast_rewind" />
            </RoundBtn>
            <RoundBtn onClick={toggle} color="var(--tg-accent)" label="play/pause">
              <div className={s.playIconWrap}>
                <PlayPauseGlyph playing={playing} className={s.playIcon} />
              </div>
            </RoundBtn>
            <RoundBtn onClick={next} color="var(--tg-accent)" label="next">
              <TgIcon name="fast_forward" />
            </RoundBtn>

            <div className={s.meta}>
              <Text noWrap size={15} weight={600} color="var(--tg-textPrimary)" style={{ lineHeight: 1.25 }}>
                {track.title}
              </Text>
              <Text noWrap size={13} color="var(--tg-textSecondary)" style={{ lineHeight: 1.25 }}>
                {fmt(currentTime)}
                {track.subtitle ? ` • ${track.subtitle}` : ''}
              </Text>
            </div>

            {/* Громкость (как в Telegram): слайдер по наведению, клик по иконке —
                mute/unmute. Сам слайдер рендерится в портале (см. конец файла). */}
            <div
              ref={volBtnRef}
              className={s.volWrap}
              onMouseEnter={openVol}
              onMouseLeave={scheduleCloseVol}
            >
              <RoundBtn
                onClick={toggleMute}
                color={volOpen ? 'var(--tg-accent)' : 'var(--tg-textSecondary)'}
                active={volOpen}
                label="volume"
              >
                <TgIcon name={volIconName} />
              </RoundBtn>
            </div>

            <div className={s.rateWrap}>
              <motion.button
                type="button"
                onClick={() => setRateOpen((o) => !o)}
                whileTap={{ scale: 0.9 }}
                className={classNames(s.rateBtn, rateOpen ? s.rateBtnActive : '')}
                style={rateOpen ? { color: 'var(--tg-accent)', background: 'color-mix(in srgb, var(--tg-accent) 16%, transparent)' } : undefined}
              >
                {rateLabel}
              </motion.button>
              <AnimatePresence>
                {rateOpen && (
                  <>
                    <div className={s.rateBackdrop} onClick={() => setRateOpen(false)} />
                    <motion.div
                      className={s.rateMenu}
                      initial={{ opacity: 0, scale: 0.9, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -6 }}
                      transition={{ duration: 0.15 }}
                    >
                      {[0.5, 1, 1.5, 2].map((r) => (
                        <div
                          key={r}
                          onClick={() => { setRate(r); setRateOpen(false) }}
                          className={classNames(s.rateItem, rate === r ? s.rateItemActive : '')}
                        >
                          {r}x
                        </div>
                      ))}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
            <RoundBtn onClick={closePlayer} color="var(--tg-textSecondary)" label="close">
              <TgIcon name="close" />
            </RoundBtn>

            {/* progress line along the bottom of the plate (tweb) */}
            <div
              className={s.progress}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                seekFraction((e.clientX - r.left) / r.width)
              }}
            >
              <div className={s.progressFill} style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* Слайдер громкости — портал в document.body (вне overflow:hidden плашки),
        позиция fixed под кнопкой. Hover на попапе продлевает открытие. */}
    {createPortal(
      <AnimatePresence>
        {track && volOpen && volRect && (
          <div
            className={s.volPortal}
            style={{ left: volRect.left + volRect.width / 2, top: volRect.bottom }}
            onMouseEnter={openVol}
            onMouseLeave={scheduleCloseVol}
          >
            <motion.div
              className={s.volPop}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
            >
              <VolumeSlider value={effVol} onChange={setVolume} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>,
      document.body,
    )}
    </>
  )
}

export default memo(NowPlayingBar)
