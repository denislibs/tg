// Кастомная панель управления видео для медиа-вьюера — порт tweb VideoPlayer
// (lib/mediaPlayer/index.ts) + MediaProgressLine: прогресс-бар с двумя слоями
// (буфер + воспроизведение), play/pause, время, громкость, скорость, фуллскрин.
// Панель прячется при бездействии мыши ~2.5с во время play (tweb ControlsHover).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import classNames from '../../shared/lib/classNames'
import { formatVideoTime, bufferedPercent, VIDEO_RATES } from './videoPlayback'
import s from './VideoControls.module.scss'

const HIDE_MS = 2500 // tweb ControlsHover скрывает при бездействии

interface Props {
  videoRef: RefObject<HTMLVideoElement>
  /** элемент, который уходит в фуллскрин (мовер) */
  fullscreenRef: RefObject<HTMLElement>
  rate: number
  onRateChange: (rate: number) => void
}

export default function VideoControls({ videoRef, fullscreenRef, rate, onRateChange }: Props) {
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [visible, setVisible] = useState(true)
  const [rateMenu, setRateMenu] = useState<{ right: number; bottom: number } | null>(null)

  const rafRef = useRef(0)
  const hideTimer = useRef(0)
  const seekingRef = useRef(false)
  const rateBtnRef = useRef<HTMLButtonElement>(null)
  // rateMenu держим в ref, чтобы автоскрытие не гасило панель при открытом меню
  const rateMenuOpenRef = useRef(false)
  rateMenuOpenRef.current = rateMenu !== null

  // ── подписка на события видео ──
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const syncMeta = () => setDuration(v.duration || 0)
    const syncPlay = () => setPlaying(true)
    const syncPause = () => setPlaying(false)
    const syncVolume = () => { setVolume(v.volume); setMuted(v.muted) }
    const syncProgress = () => setBuffered(bufferedPercent(v.buffered, v.currentTime, v.duration))
    const syncTime = () => { setCurrent(v.currentTime); syncProgress() }
    v.addEventListener('loadedmetadata', syncMeta)
    v.addEventListener('durationchange', syncMeta)
    v.addEventListener('play', syncPlay)
    v.addEventListener('pause', syncPause)
    v.addEventListener('volumechange', syncVolume)
    v.addEventListener('progress', syncProgress)
    v.addEventListener('timeupdate', syncTime)
    // начальная синхронизация (видео могло уже загрузиться/играть)
    syncMeta(); syncVolume(); setPlaying(!v.paused)
    return () => {
      v.removeEventListener('loadedmetadata', syncMeta)
      v.removeEventListener('durationchange', syncMeta)
      v.removeEventListener('play', syncPlay)
      v.removeEventListener('pause', syncPause)
      v.removeEventListener('volumechange', syncVolume)
      v.removeEventListener('progress', syncProgress)
      v.removeEventListener('timeupdate', syncTime)
    }
  }, [videoRef])

  // Плавный прогресс во время play — RAF-цикл (tweb MediaProgressLine.onPlay),
  // timeupdate стреляет ~4/с, для гладкой полоски мало.
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return }
    const tick = () => {
      const v = videoRef.current
      if (v && !seekingRef.current) setCurrent(v.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, videoRef])

  // ── автоскрытие панели: показать по mousemove, спрятать через HIDE_MS при play ──
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    const v = videoRef.current
    if (!v || v.paused || rateMenuOpenRef.current) return
    hideTimer.current = window.setTimeout(() => setVisible(false), HIDE_MS)
  }, [videoRef])

  useEffect(() => {
    const onMove = () => { setVisible(true); scheduleHide() }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove); window.clearTimeout(hideTimer.current) }
  }, [scheduleHide])

  // На паузе всегда показываем; при возобновлении — запускаем таймер скрытия.
  useEffect(() => {
    if (!playing) { window.clearTimeout(hideTimer.current); setVisible(true) }
    else scheduleHide()
  }, [playing, scheduleHide])

  // ── фуллскрин ──
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === fullscreenRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [fullscreenRef])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
  }

  const onVolumeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current
    if (!v) return
    const val = Number(e.target.value)
    v.volume = val
    v.muted = val === 0
  }

  const toggleFullscreen = () => {
    const el = fullscreenRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }

  const pickRate = (r: number) => {
    const v = videoRef.current
    if (v) v.playbackRate = r
    onRateChange(r)
    setRateMenu(null)
  }

  const openRateMenu = () => {
    const btn = rateBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    // якорим правый нижний угол меню над кнопкой (меню раскрывается вверх-влево);
    // framer управляет transform панели, поэтому позиционируем через right/bottom
    setRateMenu({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 6 })
  }

  // ── seek по прогресс-бару (клик + drag), tweb: пауза на время seek ──
  const seekWasPlaying = useRef(false)
  const seekTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v || !v.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const t = ratio * v.duration
    v.currentTime = t
    setCurrent(t)
  }
  const onSeekDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v) return
    seekingRef.current = true
    seekWasPlaying.current = !v.paused
    if (seekWasPlaying.current) v.pause()
    e.currentTarget.setPointerCapture(e.pointerId)
    seekTo(e)
  }
  const onSeekMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (seekingRef.current) seekTo(e)
  }
  const onSeekUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return
    seekingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    const v = videoRef.current
    if (v && seekWasPlaying.current) void v.play().catch(() => {})
  }

  const playedPct = duration ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0
  const rateLabel = `${rate}x`
  const volIcon = muted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'

  return (
    <div className={classNames(s.controls, visible ? s.visible : '')} onClick={(e) => e.stopPropagation()}>
      <div className={s.gradient} />
      <div className={s.bar}>
        {/* прогресс: буфер + воспроизведение (tweb progress-line __loaded / __filled) */}
        <div
          className={s.progress}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
        >
          <div className={s.progressTrack}>
            <div className={s.progressBuffer} style={{ width: `${buffered}%` }} />
            <div className={s.progressFilled} style={{ width: `${playedPct}%` }}>
              <span className={s.progressThumb} />
            </div>
          </div>
        </div>

        <div className={s.buttons}>
          <div className={s.left}>
            <IconButton title={playing ? 'Пауза (Space)' : 'Играть (Space)'} onClick={togglePlay} color="#fff">
              <TgIcon name={playing ? 'pause' : 'play'} />
            </IconButton>

            <div className={s.volume}>
              <IconButton title="Звук (M)" onClick={toggleMute} color="#fff">
                <TgIcon name={volIcon} />
              </IconButton>
              <input
                className={s.volumeSlider}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={onVolumeInput}
                aria-label="Громкость"
              />
            </div>

            <span className={s.time}>
              {formatVideoTime(current)} / {formatVideoTime(duration)}
            </span>
          </div>

          <div className={s.right}>
            <IconButton ref={rateBtnRef} title="Скорость" onClick={openRateMenu} color="#fff">
              <span className={s.rate}>{rateLabel}</span>
            </IconButton>
            <IconButton title={fullscreen ? 'Свернуть (F)' : 'Во весь экран (F)'} onClick={toggleFullscreen} color="#fff">
              <TgIcon name={fullscreen ? 'smallscreen' : 'fullscreen'} />
            </IconButton>
          </div>
        </div>
      </div>

      {rateMenu && (
        <Menu
          open
          onClose={() => setRateMenu(null)}
          zIndex={3100}
          style={{ right: rateMenu.right, bottom: rateMenu.bottom, transformOrigin: 'bottom right' }}
        >
          {VIDEO_RATES.map((r) => (
            <MenuItem
              key={r}
              label={r === 1 ? 'Обычная' : `${r}x`}
              right={r === rate ? <TgIcon name="check" size={20} /> : undefined}
              onClick={() => pickRate(r)}
            />
          ))}
        </Menu>
      )}
    </div>
  )
}
