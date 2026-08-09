import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import Menu, { MenuItem } from '../shared/ui/Menu'
import TgIcon, { type IconName } from './TgIcon'
import PlayPauseGlyph from './PlayPauseGlyph'
import { useAudioStore } from '../stores/audioStore'
import classNames from '../shared/lib/classNames'
import s from './NowPlayingBar.module.scss'

// Круглая управляющая кнопка. Press-scale снят: tweb не масштабирует кнопки по
// нажатию — отклик там даёт ripple и фон (_button.scss:75-77).
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
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={classNames(s.roundBtn, active ? s.roundBtnActive : '')}
      // цвет иконки и фон активного состояния — рантайм-динамика по пропу color
      style={{
        color,
        background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : undefined,
      }}
    >
      {children}
    </button>
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
// from re-rendering whenever the parent (Chat) does — only its own
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

  // tweb topbar: `body.is-pinned-audio-shown` поднимает --topbar-floating-audio-height,
  // и топбар (а с ним верх ленты) уезжает вниз под плашку плеера.
  useEffect(() => {
    document.body.classList.toggle('is-pinned-audio-shown', !!track)
    return () => document.body.classList.remove('is-pinned-audio-shown')
  }, [track])

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
  // Меню скорости — общий shared <Menu> (портал+бэкдроп). Позицию якорим под
  // кнопкой, растём влево-вниз (кнопка у правого края плашки).
  const rateBtnRef = useRef<HTMLButtonElement>(null)
  const [rateStyle, setRateStyle] = useState<CSSProperties | undefined>(undefined)
  const openRate = () => {
    const r = rateBtnRef.current?.getBoundingClientRect()
    if (r) setRateStyle({ top: r.bottom + 4, right: window.innerWidth - r.right, transformOrigin: 'top right' })
    setRateOpen(true)
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
    {/* tweb .pinned-container.pinned-audio (_chatPinned.scss:492): абсолютная
        плашка у верха #column-center; спрятанная — уведена трансформом за верх,
        показанная — на месте, а топбар уезжает вниз на --topbar-floating-audio-height
        (его поднимает body.is-pinned-audio-shown, _chatTopbar.scss:7-9). */}
    <div className={classNames('pinned-container', 'pinned-audio', track ? 'is-visible' : '')}>
          {/* Ряд управления — tweb .pinned-container-wrapper.pinned-audio-wrapper:
              именно он несёт z-index 1 и потому лежит ПОВЕРХ полосы прогресса
              (её обёртка растянута на всю плашку и иначе съедала бы клики). */}
          <div className={classNames('pinned-container-wrapper', 'pinned-audio-wrapper', s.bar)}>
            <RoundBtn onClick={prev} color="var(--primary-color)" label="prev">
              <TgIcon name="fast_rewind" />
            </RoundBtn>
            <RoundBtn onClick={toggle} color="var(--primary-color)" label="play/pause">
              <div className={s.playIconWrap}>
                <PlayPauseGlyph playing={playing} className={s.playIcon} />
              </div>
            </RoundBtn>
            <RoundBtn onClick={next} color="var(--primary-color)" label="next">
              <TgIcon name="fast_forward" />
            </RoundBtn>

            <div className={s.meta}>
              <Text noWrap size={15} weight={600} color="var(--primary-text-color)" style={{ lineHeight: 1.25 }}>
                {track?.title}
              </Text>
              <Text noWrap size={13} color="var(--secondary-text-color)" style={{ lineHeight: 1.25 }}>
                {fmt(currentTime)}
                {track?.subtitle ? ` • ${track.subtitle}` : ''}
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
                color={volOpen ? 'var(--primary-color)' : 'var(--secondary-text-color)'}
                active={volOpen}
                label="volume"
              >
                <TgIcon name={volIconName} />
              </RoundBtn>
            </div>

            <div className={s.rateWrap}>
              <button
                ref={rateBtnRef}
                type="button"
                onClick={() => (rateOpen ? setRateOpen(false) : openRate())}
                className={classNames(s.rateBtn, rateOpen ? s.rateBtnActive : '')}
                style={rateOpen ? { color: 'var(--primary-color)', background: 'color-mix(in srgb, var(--primary-color) 16%, transparent)' } : undefined}
              >
                {rateLabel}
              </button>
              <Menu open={rateOpen} onClose={() => setRateOpen(false)} style={rateStyle}>
                {[0.5, 1, 1.5, 2].map((r) => (
                  <MenuItem
                    key={r}
                    label={`${r}x`}
                    right={rate === r ? <TgIcon name="check" size={18} color="var(--primary-color)" /> : undefined}
                    onClick={() => { setRate(r); setRateOpen(false) }}
                  />
                ))}
              </Menu>
            </div>
            <RoundBtn onClick={closePlayer} color="var(--secondary-text-color)" label="close">
              <TgIcon name="close" />
            </RoundBtn>

          </div>
          {/* Полоса прогресса — разметка tweb (RangeSelector + _chatPinned.scss):
              .pinned-audio-progress-wrapper (absolute inset 0, radius плашки,
              overflow hidden — иначе полоса торчала бы за скруглённые углы)
              > .progress-line.use-transform.pinned-audio-progress[--progress]
                > .progress-line__filled (scaleX по прогрессу) + input[type=range].
              В покое полоса приспущена на --translateY, по ховеру всплывает и
              проявляется трек. */}
          <div className="pinned-audio-progress-wrapper">
            <div
              className={classNames('progress-line', 'use-transform', 'pinned-audio-progress')}
              style={{ ['--progress' as string]: String(frac) }}
            >
              <div className="progress-line__filled" style={{ transform: `scaleX(${frac})` }} />
              <input
                className="progress-line__seek"
                type="range"
                min={0}
                max={duration || 0}
                step={0.001}
                value={currentTime}
                aria-label="seek"
                onChange={(e) => { if (duration > 0) seekFraction(Number(e.target.value) / duration) }}
              />
            </div>
          </div>
    </div>
    {/* Слайдер громкости — портал в document.body (вне overflow:hidden плашки),
        позиция fixed под кнопкой. Hover на попапе продлевает открытие. */}
    {createPortal(
      track && volOpen && volRect ? (
        <div
          className={s.volPortal}
          style={{ left: volRect.left + volRect.width / 2, top: volRect.bottom - 6 }}
          onMouseEnter={openVol}
          onMouseLeave={scheduleCloseVol}
        >
          <div className={s.volPop}>
            <VolumeSlider value={effVol} onChange={setVolume} />
          </div>
        </div>
      ) : null,
      document.body,
    )}
    </>
  )
}

export default memo(NowPlayingBar)
