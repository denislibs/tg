// src/components/messages/VideoPlayer.tsx
//
// УМИРАЕТ В TASK 16 (медиа-суперпорт): единственный потребитель — MediaLightbox,
// который Task 16 сносит вместе с этим файлом; замена — vanilla-порт
// `src/lib/mediaPlayer/index.ts` (Task 15), его использует vanilla-вьювер
// (components/mediaViewer/base.ts). Не развивать.
//
// Видеоплеер медиавьюера — порт tweb `lib/mediaPlayer/index.ts` (класс VideoPlayer,
// метод buildControls) + `helpers/dom/controlsHover.ts`. Дерево и классы 1:1:
//
//   div.ckin__player.default[.played .is-playing .is-seeking .is-buffering
//                            .show-controls .disable-hover .ckin__fullscreen]
//     <video class="ckin__video">                ← приходит children'ом от вьюера
//     button.default__button--big.toggle         ← большая play-кнопка (4rem)
//     div.default__gradient-bottom.ckin__controls
//     div.default__controls.ckin__controls
//       div.progress-line.media-progress-line[.is-focused]
//         div.media-progress-line__filled-container
//           div.progress-line__filled + div.progress-line__filled.progress-line__loaded
//         input.progress-line__seek
//         div.media-progress-line__thumb
//       div.bottom-controls.night
//         div.left-controls  > button.btn-icon.default__button.toggle
//                            + div.player-volume > span.tgico.player-volume__icon
//                                                + div.progress-line
//                            + div.ckin__time > time.ckin__time-elapsed / span / time.ckin__time-duration
//         div.right-controls > button.btn-icon.default__button.btn-menu-toggle (скорость)
//                            + button.btn-icon.default__button (PiP)
//                            + button.btn-icon.default__button (фуллскрин)
//
// Стили целиком приходят из портированных партиалов `styles/tweb/_ckin.scss` и
// `_mediaViewer.scss` — своего SCSS-модуля у плеера нет.
//
// Как в tweb, `<video>` живёт ВНУТРИ плеера, а плеер — внутри `.media-viewer-aspecter`
// (mediaViewer/base.ts:2580 `div.append(video)` → VideoPlayer оборачивает его в
// `.ckin__player`). Пока мовер летит, аспектер контр-масштабирован, поэтому вьюер
// держит контролы запертыми (`locked` = tweb `lockControls(false)`).
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import Menu, { MenuItem } from '../../shared/ui/Menu'
import { glyph, type IconName } from '../../core/tgico-icons'
import { enterPip } from '../../core/pip'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_MOBILE } from '@environment/userAgent'
import { formatVideoTime, bufferedPercent, rateToString, VIDEO_RATES } from './videoPlayback'

const HIDE_MS = 3000 // tweb ControlsHover: window.setTimeout(this.hideControls, 3e3)

// tweb ControlsHover.showOnLeaveToClassName — уход курсора на плавающий хром
// вьюера контролы НЕ прячет (иначе они выдёргиваются из-под курсора).
const SHOW_ON_LEAVE = ['media-viewer-caption', 'media-viewer-topbar']

// tweb playbackRateButton: подпись скорости — по глифу на символ.
const GEOMETRIC: Record<string, { char: string; icon: IconName }> = {
  0: { char: '0', icon: 'geometric_digit_0' },
  1: { char: '1', icon: 'geometric_digit_1' },
  2: { char: '2', icon: 'geometric_digit_2' },
  3: { char: '3', icon: 'geometric_digit_3' },
  4: { char: '4', icon: 'geometric_digit_4' },
  5: { char: '5', icon: 'geometric_digit_5' },
  6: { char: '6', icon: 'geometric_digit_6' },
  7: { char: '7', icon: 'geometric_digit_7' },
  8: { char: '8', icon: 'geometric_digit_8' },
  9: { char: '9', icon: 'geometric_digit_9' },
  x: { char: 'x', icon: 'geometric_letter_x' },
  '.': { char: 'dot', icon: 'geometric_dot' },
}

// tweb VolumeSelector.ICONS + его же пороги (setVolume).
const volumeIcon = (volume: number, muted: boolean): IconName => {
  if (!volume || muted) return 'volume_off'
  if (volume > 0.5) return 'volume_up'
  if (volume < 0.25) return 'volume_mute'
  return 'volume_down'
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

interface Props {
  // React 19: useRef<T>(null) → RefObject<T | null>; принимаем nullable-реф.
  videoRef: RefObject<HTMLVideoElement | null>
  /** скорость воспроизведения (у нас персистится в настройках) */
  rate: number
  onRateChange: (rate: number) => void
  /** tweb lockControls(false): держать контролы спрятанными (полёт мовера, зум/поворот) */
  locked?: boolean
  /** tweb ControlsHover 'toggleControls' — вьюер гасит подпись и топбар вместе с панелью */
  onToggleControls?: (show: boolean) => void
  /** tweb onMenuToggle — открытое меню перекрывает подпись, вьюер её прячет */
  onMenuToggle?: (open: boolean) => void
  /** сам `<video class="ckin__video">` (его владелец — вьюер) */
  children: ReactNode
}

export default function VideoPlayer({ videoRef, rate, onRateChange, locked, onToggleControls, onMenuToggle, children }: Props) {
  const [playing, setPlaying] = useState(false)
  const [played, setPlayed] = useState(false) // tweb: класс `played` после первого play
  const [seeking, setSeeking] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [show, setShow] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [menu, setMenu] = useState<{ right: number; bottom: number } | null>(null)

  const playerRef = useRef<HTMLDivElement>(null)
  const rateBtnRef = useRef<HTMLButtonElement>(null)
  const rafRef = useRef(0)
  const hideTimer = useRef(0)
  const seekingRef = useRef(false)
  const seekWasPlaying = useRef(false)
  // Читаются из обработчиков, которые не должны пересоздаваться на каждый рендер.
  const menuOpenRef = useRef(false)
  menuOpenRef.current = menu !== null
  const lockedRef = useRef(false)
  lockedRef.current = !!locked
  const showRef = useRef(true)
  showRef.current = show
  const toggleControlsRef = useRef(onToggleControls)
  toggleControlsRef.current = onToggleControls
  const menuToggleRef = useRef(onMenuToggle)
  menuToggleRef.current = onMenuToggle

  // ── ControlsHover (tweb helpers/dom/controlsHover.ts) ──
  const hideControls = useCallback((setHideTimeout = false) => {
    if (setHideTimeout) {
      if (!hideTimer.current) hideTimer.current = window.setTimeout(() => hideControls(), HIDE_MS)
      return
    }
    window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
    // canHideControls: на паузе и при открытом меню панель остаётся.
    const v = videoRef.current
    if (!v || v.paused || menuOpenRef.current) return
    setShow(false)
  }, [videoRef])

  const showControls = useCallback((setHideTimeout = true) => {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = 0
    if (lockedRef.current) return
    setShow(true)
    if (setHideTimeout) hideTimer.current = window.setTimeout(() => hideControls(), HIDE_MS)
  }, [hideControls])

  // tweb lockControls(visible): заперто-спрятанные контролы + `disable-hover`;
  // разблокировка (`lockControls(undefined)`) равна обычному showControls().
  useEffect(() => {
    if (locked) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = 0
      setShow(false)
    } else {
      showControls()
    }
  }, [locked, showControls])

  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  useEffect(() => { toggleControlsRef.current?.(show) }, [show])
  useEffect(() => { menuToggleRef.current?.(menu !== null) }, [menu])

  useEffect(() => {
    const el = playerRef.current
    if (!el) return
    if (IS_TOUCH_SUPPORTED) {
      // tweb: тап по плееру мимо `.ckin__controls` переключает панель.
      const onClick = (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.ckin__controls')) return
        if (showRef.current) hideControls()
        else showControls()
      }
      el.addEventListener('click', onClick)
      return () => el.removeEventListener('click', onClick)
    }
    const onMove = () => showControls()
    const onEnter = () => showControls(false)
    const onLeave = (e: MouseEvent) => {
      const to = e.relatedTarget as HTMLElement | null
      if (to && SHOW_ON_LEAVE.some((c) => to.closest(`.${c}`))) { showControls(false); return }
      hideControls()
    }
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [showControls, hideControls])

  // ── события медиа (tweb stylePlayer + MediaProgressLine.setListeners) ──
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const syncMeta = () => setDuration(v.duration || 0)
    const syncLoad = () => setLoaded(bufferedPercent(v.buffered, v.currentTime, v.duration))
    const syncTime = () => { setCurrent(v.currentTime); syncLoad() }
    const onPlay = () => {
      setPlaying(true)
      setPlayed(true) // tweb onPlay: wrapper.classList.add('played')
      hideControls(true) // tweb onPlayCallbacks: спрятать через 3000 ms
    }
    const onPause = () => { setPlaying(false); showControls(false) }
    const onVolume = () => { setVolume(v.volume); setMuted(v.muted) }
    // tweb base.ts:2790 — буферизация: сеть грузит, а данных на кадр вперёд нет.
    const onWaiting = () => {
      if (v.networkState === v.NETWORK_LOADING && v.readyState < v.HAVE_FUTURE_DATA) setBuffering(true)
    }
    const onCanPlay = () => setBuffering(false)
    // tweb: двойной клик по видео — фуллскрин (только не на тач-устройствах).
    const onDblClick = () => { if (!IS_TOUCH_SUPPORTED) toggleFullscreen() }

    v.addEventListener('loadedmetadata', syncMeta)
    v.addEventListener('durationchange', syncMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('volumechange', onVolume)
    v.addEventListener('progress', syncLoad)
    v.addEventListener('timeupdate', syncTime)
    v.addEventListener('waiting', onWaiting)
    v.addEventListener('canplay', onCanPlay)
    v.addEventListener('dblclick', onDblClick)
    // начальная синхронизация (видео могло уже загрузиться/играть)
    syncMeta(); onVolume(); setPlaying(!v.paused)
    return () => {
      v.removeEventListener('loadedmetadata', syncMeta)
      v.removeEventListener('durationchange', syncMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('volumechange', onVolume)
      v.removeEventListener('progress', syncLoad)
      v.removeEventListener('timeupdate', syncTime)
      v.removeEventListener('waiting', onWaiting)
      v.removeEventListener('canplay', onCanPlay)
      v.removeEventListener('dblclick', onDblClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, hideControls, showControls])

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

  // ── фуллскрин (tweb toggleFullScreen + _onFullScreen на `.ckin__player`) ──
  const toggleFullscreen = () => {
    const el = playerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === playerRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (v) v.muted = !v.muted
  }

  // tweb listenKeyboardEvents: F — фуллскрин, M — звук. Space и стрелки ловит
  // вьюер (MediaLightbox) — там же, где листание и зум.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.code === 'KeyF') { e.preventDefault(); toggleFullscreen() }
      else if (e.code === 'KeyM') { e.preventDefault(); toggleMute() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── перемотка (tweb MediaProgressLine поверх RangeSelector) ──
  // Скрабим сами: у `.progress-line__seek` бегунок скрыт (`::-webkit-slider-thumb
  // { display: none }`), нативного драга у него нет — как и в tweb, где тянут
  // контейнер через attachGrabListeners, а input оставлен ради клавиатуры.
  const seekAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v || !v.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = clamp01((e.clientX - rect.left) / rect.width) * v.duration
    v.currentTime = t
    setCurrent(t)
  }
  const onSeekDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v) return
    seekingRef.current = true
    setSeeking(true) // tweb onSeekStart: wrapper.classList.add('is-seeking')
    seekWasPlaying.current = !v.paused
    if (seekWasPlaying.current) v.pause()
    e.currentTarget.setPointerCapture(e.pointerId)
    seekAt(e)
  }
  const onSeekMove = (e: React.PointerEvent<HTMLDivElement>) => { if (seekingRef.current) seekAt(e) }
  const onSeekUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return
    seekingRef.current = false
    setSeeking(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    const v = videoRef.current
    if (v && seekWasPlaying.current) void v.play().catch(() => {})
  }
  const onSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current
    if (!v) return
    const t = Number(e.target.value)
    v.currentTime = t
    setCurrent(t)
  }

  // ── громкость (tweb VolumeSelector: тот же RangeSelector) ──
  const volumeAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v) return
    const rect = e.currentTarget.getBoundingClientRect()
    const value = clamp01((e.clientX - rect.left) / rect.width)
    v.volume = value
    v.muted = false
  }
  const volumeDragRef = useRef(false)
  const onVolumeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    volumeDragRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    volumeAt(e)
  }
  const onVolumeMove = (e: React.PointerEvent<HTMLDivElement>) => { if (volumeDragRef.current) volumeAt(e) }
  const onVolumeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!volumeDragRef.current) return
    volumeDragRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const pickRate = (r: number) => {
    const v = videoRef.current
    if (v) v.playbackRate = r
    onRateChange(r)
    setMenu(null)
  }
  const openMenu = () => {
    const btn = rateBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    // tweb ButtonMenuToggle direction 'top-left' — меню раскрывается вверх-влево
    // от кнопки; у нас панель в портале, поэтому якорим правый нижний угол.
    setMenu({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 4 })
  }

  const playedPct = duration ? clamp01(current / duration) : 0
  const volumePct = muted ? 0 : volume

  return (
    <div
      ref={playerRef}
      className={classNames(
        'ckin__player', 'default',
        played ? 'played' : '',
        playing ? 'is-playing' : '',
        seeking ? 'is-seeking' : '',
        buffering ? 'is-buffering' : '',
        show ? 'show-controls' : '',
        locked ? 'disable-hover' : '',
        fullscreen ? 'ckin__fullscreen' : '',
      )}
    >
      {children}

      {/* Большая play-кнопка: 4rem по центру, гаснет в is-playing/is-seeking/
          :not(.played) и убирается вовсе в is-buffering (_ckin.scss:44-79,169-184,
          245-249). Обработчика у неё нет и в tweb — на десктопе
          `html:not(.is-touch)` даёт ей pointer-events: none, и клик проваливается
          на `<video>`, который и переключает play. */}
      <button className="default__button--big toggle" type="button" tabIndex={-1} aria-hidden>
        <span className="tgico button-icon">{glyph('play')}</span>
      </button>

      <div className="default__gradient-bottom ckin__controls" />

      <div className="default__controls ckin__controls">
        <div
          className={classNames('progress-line', 'media-progress-line', seeking ? 'is-focused' : '')}
          style={{ ['--progress' as string]: String(playedPct) } as CSSProperties}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          onPointerCancel={onSeekUp}
        >
          <div className="media-progress-line__filled-container">
            <div className="progress-line__filled" style={{ width: `${playedPct * 100}%` }} />
            <div className="progress-line__filled progress-line__loaded" style={{ width: `${loaded}%` }} />
          </div>
          <input
            className="progress-line__seek"
            type="range"
            min={0}
            max={duration || 0}
            step={1 / 60}
            value={current}
            onChange={onSeekInput}
            aria-label="Перемотка"
          />
          <div className="media-progress-line__thumb" />
        </div>

        <div className="bottom-controls night">
          <div className="left-controls">
            {/* иконки кнопок в tweb ставит replaceButtonIcon → `Icon(name, 'button-icon')`,
                то есть `span.tgico.button-icon` (button.ts:48-53). Сами кнопки —
                ButtonIcon(` ${skin}__button …`, {noRipple: true}) (mediaPlayer/index.ts:319) */}
            <IconButton noRipple className="default__button toggle" onClick={togglePlay} title={playing ? 'Пауза (Space)' : 'Играть (Space)'}>
              <span className="tgico button-icon">{glyph(playing ? 'pause' : 'play')}</span>
            </IconButton>

            <div className="player-volume" onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('player-volume__icon')) toggleMute() }}>
              <span className="tgico button-icon player-volume__icon" title="Звук (M)">{glyph(volumeIcon(volume, muted))}</span>
              <div
                className="progress-line"
                onPointerDown={onVolumeDown}
                onPointerMove={onVolumeMove}
                onPointerUp={onVolumeUp}
                onPointerCancel={onVolumeUp}
              >
                <div className="progress-line__filled" style={{ width: `${volumePct * 100}%` }} />
                <input
                  className="progress-line__seek"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volumePct}
                  onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = false } }}
                  aria-label="Громкость"
                />
              </div>
            </div>

            <div className="ckin__time">
              <time className="ckin__time-elapsed">{formatVideoTime(current)}</time>
              <span> / </span>
              <time className="ckin__time-duration">{formatVideoTime(duration)}</time>
            </div>
          </div>

          <div className="right-controls">
            {/* tweb createPlaybackRateButton → ButtonMenuToggle({icon: `mediaspeed_empty
                ${skin}__button`}) без buttonOptions, то есть ButtonIcon БЕЗ noRipple
                (playbackRateButton.tsx:99-101, buttonMenuToggle.ts:95-97) — ripple есть */}
            <IconButton
              ref={rateBtnRef}
              className={classNames('default__button', 'btn-menu-toggle', menu ? 'menu-open' : '')}
              onClick={openMenu}
              title="Скорость"
            >
              <span className="tgico button-icon">{glyph('mediaspeed_empty')}</span>
              <span className="playback-speed-icon-floating">
                {rateToString(rate).split('').map((c, i) => {
                  const g = GEOMETRIC[c]
                  return g ? (
                    <span key={i} className={`tgico geometric-font-icon geometric-font-icon--${g.char}`}>{glyph(g.icon)}</span>
                  ) : null
                })}
              </span>
            </IconButton>

            {/* tweb: PiP-кнопка есть только на десктопе (`!IS_MOBILE`) и только
                при поддержке браузером; ButtonIcon(`pip ${skin}__button`, {noRipple: true}) */}
            {!IS_MOBILE && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
              <IconButton
                noRipple
                className="pip default__button"
                onClick={() => { const v = videoRef.current; if (v) void enterPip(v) }}
                title="Картинка в картинке"
              >
                <span className="tgico button-icon">{glyph('pip')}</span>
              </IconButton>
            )}

            <IconButton
              noRipple
              className="default__button"
              onClick={toggleFullscreen}
              title={fullscreen ? 'Свернуть (F)' : 'Во весь экран (F)'}
            >
              <span className="tgico button-icon">{glyph(fullscreen ? 'smallscreen' : 'fullscreen')}</span>
            </IconButton>
          </div>
        </div>
      </div>

      {menu && (
        <Menu
          open
          onClose={() => setMenu(null)}
          zIndex={4100}
          className="checkable-button-menu playback-rate-button-menu"
          // tweb `.playback-rate-button-menu .btn-menu { min-width: 140px }`; у нас
          // панель в портале и САМА является `.btn-menu`, вложенный селектор не
          // матчится — значение из партиала переносим инлайном.
          style={{ right: menu.right, bottom: menu.bottom, minWidth: '140px', transformOrigin: 'bottom right' }}
        >
          {VIDEO_RATES.map((r) => (
            <MenuItem
              key={r}
              icon={<span className="tgico" style={{ visibility: r === rate ? undefined : 'hidden' }}>{glyph('check')}</span>}
              label={r === 1 ? 'Обычная' : `${r}x`}
              onClick={() => pickRate(r)}
            />
          ))}
        </Menu>
      )}
    </div>
  )
}
