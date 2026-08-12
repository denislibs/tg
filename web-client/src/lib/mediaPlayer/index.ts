// Порт tweb `src/lib/mediaPlayer/index.ts` (класс VideoPlayer поверх
// ControlsHover) в объёме медиавьювера. Дерево и классы 1:1 (buildControls
// tweb :603-628):
//
//   div.ckin__player.default[.played .is-playing .is-seeking .is-buffering
//                            .show-controls .show-time .disable-hover
//                            .ckin__fullscreen]
//     video.ckin__video                       ← оборачивается конструктором
//     button.default__button--big.toggle      ← большая play-кнопка (без
//       обработчика и в tweb: на десктопе pointer-events: none — клик
//       проваливается на <video>, который и переключает play)
//     div.default__gradient-bottom.ckin__controls
//     div.default__controls.ckin__controls
//       div.progress-line.media-progress-line ← MediaProgressLine (prepend)
//       div.bottom-controls.night
//         div.left-controls  > toggle + player-volume (VolumeSelector)
//                            + div.ckin__time > elapsed / duration
//         div.right-controls > скорость (btn-menu) + PiP + фуллскрин
//
// Стили целиком — портированные партиалы `styles/tweb/_ckin.scss` и
// `_mediaViewer.scss`; своих у плеера нет.
//
// Адаптации (поведение не менялось, каждая помечена и на месте):
//   • скорость персистится в settings-сторе (videoRate) — контракт унаследован
//     от снесённого (Task 16) React-плеера; appMediaPlaybackController tweb у нас
//     обслуживает только голос/музыку (core/audio/mediaPlaybackController.ts),
//     потому его подписки (playbackParams, muted, seekForward/Backward) не
//     портированы — громкость/мьют идут на сам <video>;
//   • меню скоростей — vanilla btn-menu по образцу setBtnMenuToggle
//     (appMediaViewer.ts, тот же порт классов contextMenuController tweb);
//     solid-createPlaybackRateButton не портируется (React/solid в ядре нет);
//   • PiP — наш core/pip.ts::enterPip; emptyPipVideo/createCanvasStream tweb
//     (:575-596, PiP до готовности метаданных) не портированы — до duration
//     кнопка no-op, как и первый гейт tweb;
//   • не портированы за отсутствием фич: live/RTMP, quality-меню (HLS нет),
//     storyboard-превью кадра, speedDragHandler (long-press 2x — вместе с ним
//     contextmenu-глушилка :431-433), toggleActivity (:687-692, категории
//     «непрерываемой активности» воркера нет), isClientPipOpen-тост (:663-666,
//     Document-PiP приложения живёт иначе — core/pip.ts), Alt+± смена
//     скорости (:402-404, ходила в playbackRateButton.changeRateByAmount).
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import { IS_APPLE_MOBILE, IS_MOBILE } from '@environment/userAgent'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import ControlsHover from '@helpers/dom/controlsHover'
import findUpClassName from '@helpers/dom/findUpClassName'
import {
  addFullScreenListener, cancelFullScreen, getFullScreenElement, isFullScreen, requestFullScreen,
} from '@helpers/dom/fullScreen'
import safePlay from '@helpers/dom/safePlay'
import ListenerSetter, { type Listener } from '@helpers/listenerSetter'
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import debounce from '@helpers/schedulers/debounce'
import type { IconName } from '@core/tgico-icons'
import { enterPip } from '@core/pip'
import MediaProgressLine from '@components/mediaProgressLine'
import VolumeSelector from '@components/volumeSelector'
import { iconSpan, replaceButtonIcon } from '@components/mediaViewer/base'
import { formatVideoTime, rateToString, VIDEO_RATES } from '@components/messages/videoPlayback'
import { useSettingsStore } from '../../settings'
import { useI18nStore } from '../../i18n'

// tweb playbackRateButton geometricFontMap: подпись скорости — по глифу на
// символ моноширинной «геометрической» гарнитуры (как в React-плеере).
const GEOMETRIC: Record<string, { char: string, icon: IconName }> = {
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

export default class VideoPlayer extends ControlsHover {
  public video: HTMLVideoElement
  public wrapper: HTMLElement
  public volumeSelector!: VolumeSelector
  protected progress!: MediaProgressLine
  protected skin = 'default' as const

  protected listenerSetter: ListenerSetter

  protected rateButton!: HTMLElement
  protected closeRateMenu?: () => void
  protected pipButton?: HTMLElement
  protected toggles: HTMLElement[] = []
  protected mainToggle!: HTMLElement
  protected controls!: HTMLElement
  protected gradient!: HTMLElement

  protected onMenuToggle?: (open: boolean) => void
  // Показ/скрытие превью-времени сикбара (`__current-time-info`) — хост прячет
  // хром, который бы с ним стакался (caption вьювера); комментарий tweb :66-68
  protected onTimePreviewToggle?: (visible: boolean) => void
  protected onPip?: (pip: boolean) => void
  protected onPipClose?: () => void

  protected _inPip = false
  protected debouncedPip!: (pip: boolean) => void
  protected debouncePipTime = 20

  protected listenKeyboardEvents?: 'always' | 'fullscreen'
  protected hadContainer: boolean
  protected isPlaying = false

  constructor({
    video,
    container,
    play = false,
    streamable = false,
    duration,
    onMenuToggle,
    onTimePreviewToggle,
    onPip,
    onPipClose,
    listenKeyboardEvents,
  }: {
    video: HTMLVideoElement,
    container?: HTMLElement,
    play?: boolean,
    streamable?: boolean,
    duration?: number,
    onMenuToggle?: VideoPlayer['onMenuToggle'],
    onTimePreviewToggle?: VideoPlayer['onTimePreviewToggle'],
    onPip?: VideoPlayer['onPip'],
    onPipClose?: VideoPlayer['onPipClose'],
    listenKeyboardEvents?: VideoPlayer['listenKeyboardEvents'],
  }) {
    super()

    this.video = video
    this.video.classList.add('ckin__video')
    this.wrapper = container ?? document.createElement('div')
    this.wrapper.classList.add('ckin__player')

    this.onMenuToggle = onMenuToggle
    this.onTimePreviewToggle = onTimePreviewToggle
    this.onPip = onPip
    this.onPipClose = onPipClose

    this.listenKeyboardEvents = listenKeyboardEvents
    this.hadContainer = !!container

    // tweb :179 (appMediaPlaybackController.playbackRate) → наш персист
    // settings.videoRate — см. шапку
    this.video.playbackRate = useSettingsStore.getState().videoRate

    this.listenerSetter = new ListenerSetter()

    this.setup({
      element: this.wrapper,
      listenerSetter: this.listenerSetter,
      canHideControls: () => {
        if (this.video.paused) return false
        if (this.isRateMenuOpen()) return false

        return true
      },
      // canShowControls tweb гейтился только speedDragHandler'ом (не портирован)
      showOnLeaveToClassName: ['media-viewer-caption', 'media-viewer-topbar'],
      ignoreClickClassName: 'ckin__controls',
    })

    if (!this.hadContainer) {
      video.parentNode!.insertBefore(this.wrapper, video)
      this.wrapper.appendChild(video)
    }

    this.stylePlayer(duration)

    // tweb :210-254 (ветка default-скина без live)
    const controls = this.controls = this.wrapper.querySelector('.default__controls.ckin__controls') as HTMLDivElement
    this.gradient = this.controls.previousElementSibling as HTMLElement

    const debouncedToggleControls = debounce((show: boolean) => {
      this.wrapper.classList.toggle('show-time', show)
    }, 200, false, true)

    this.addEventListener('toggleControls', debouncedToggleControls)

    this.progress = new MediaProgressLine({
      withTime: true,
      onSeekStart: () => {
        this.wrapper.classList.add('is-seeking')
      },
      onSeekEnd: () => {
        this.wrapper.classList.remove('is-seeking')
      },
      onHover: () => {
        this.onTimePreviewToggle?.(true)
      },
      onPointerOut: () => {
        this.onTimePreviewToggle?.(false)
      },
    })
    this.progress.setMedia({
      media: video,
      streamable,
      duration,
    })
    controls.prepend(this.progress.container)

    if (play) {
      video.play().catch((err: Error) => {
        if (err.name === 'NotAllowedError') {
          video.muted = true
          video.autoplay = true
          safePlay(video)
        }
      }).finally(() => { // из-за autoplay play может не вызваться (комментарий tweb)
        this.setIsPlaying(!this.video.paused)
      })
    } else {
      this.setIsPlaying(!this.video.paused)
    }
  }

  private setIsPlaying(isPlaying: boolean) {
    if (this.isPlaying === isPlaying) {
      return
    }

    this.isPlaying = isPlaying

    // toggleActivity tweb :286 — не портирован (см. шапку)

    this.wrapper.classList.toggle('is-playing', isPlaying)
    this.toggles.forEach((toggle) => {
      // tweb :294 `Icon(...)` — голый span.tgico без класса button-icon
      toggle.replaceChildren(iconSpan(isPlaying ? 'pause' : 'play'))
    })
  }

  private stylePlayer(initDuration?: number) {
    const { wrapper, video, skin, listenerSetter } = this

    wrapper.classList.add(skin)

    wrapper.insertAdjacentHTML('beforeend', this.buildControls())

    const onPlayCallbacks: (() => void)[] = []
    const onPauseCallbacks: (() => void)[] = []

    // tweb Button(`${skin}__button--big toggle`, {noRipple: true, icon: 'play'})
    const mainToggle = this.mainToggle = document.createElement('button')
    mainToggle.className = `${skin}__button--big toggle`
    mainToggle.append(iconSpan('play', 'button-icon'))
    wrapper.firstElementChild!.after(mainToggle)

    const leftControls = wrapper.querySelector('.left-controls') as HTMLElement
    // tweb ButtonIcon(` ${skin}__button toggle`, {noRipple: true})
    const leftToggle = document.createElement('button')
    leftToggle.className = `btn-icon ${skin}__button toggle`
    leftControls.prepend(leftToggle)
    this.toggles = [leftToggle]

    const rightControls = wrapper.querySelector('.right-controls') as HTMLElement
    this.rateButton = this.createPlaybackRateButton()
    // Гейт tweb :328 — кнопка PiP только на десктопе и при поддержке браузером
    // именно видео-PiP (pictureInPictureEnabled — его же проверяет enterPip)
    if (!IS_MOBILE && document.pictureInPictureEnabled) {
      const pipButton = this.pipButton = document.createElement('button')
      pipButton.className = `btn-icon pip ${skin}__button`
      pipButton.append(iconSpan('pip', 'button-icon'))
    }
    const fullScreenButton = document.createElement('button')
    fullScreenButton.className = `btn-icon ${skin}__button`

    rightControls.append(...[
      this.rateButton,
      this.pipButton,
      fullScreenButton,
    ].filter(Boolean) as HTMLElement[])

    const timeElapsed = wrapper.querySelector('.ckin__time-elapsed') as HTMLElement
    const timeDuration = wrapper.querySelector('.ckin__time-duration') as HTMLElement

    const volumeSelector = this.volumeSelector = new VolumeSelector({
      listenerSetter,
      vertical: false,
      media: video,
    })

    volumeSelector.btn.classList.remove('btn-icon')
    timeElapsed.parentElement!.before(volumeSelector.btn)

    this.toggles.forEach((button) => {
      attachClickEvent(button, () => {
        this.togglePlay()
      }, { listenerSetter })
    })

    if (this.pipButton) {
      attachClickEvent(this.pipButton, this.requestPictureInPicture, { listenerSetter })

      this.debouncedPip = debounce(this._onPip, this.debouncePipTime, false, true)

      this.addPipListeners(video)
    }

    if (!IS_TOUCH_SUPPORTED) {
      // checkInteraction/wasChangingSpeed tweb :376 — звук историй и
      // speed-drag, не портированы (см. шапку)
      attachClickEvent(video, () => {
        this.togglePlay()
      }, { listenerSetter })

      if (this.listenKeyboardEvents) {
        listenerSetter.add(document)('keydown', this.onKeyDown)
      }
    }

    listenerSetter.add(video)('dblclick', () => {
      if (!IS_TOUCH_SUPPORTED) {
        this.toggleFullScreen()
      }
    })

    attachClickEvent(fullScreenButton, () => {
      this.toggleFullScreen()
    }, { listenerSetter })

    addFullScreenListener(wrapper, () => this._onFullScreen(fullScreenButton), listenerSetter)
    this._onFullScreen(fullScreenButton)

    listenerSetter.add(video)('timeupdate', () => {
      if (!video.paused && !this.isPlaying) {
        // tweb :451-454 simulateEvent: чиним потерянное play-событие
        console.warn('video: fixing missing play event')
        video.dispatchEvent(new Event('play'))
      }

      timeElapsed.textContent = formatVideoTime(video.currentTime | 0)
    })

    const onPlay = () => {
      wrapper.classList.add('played')

      if (!IS_TOUCH_SUPPORTED) {
        onPlayCallbacks.push(() => {
          this.hideControls(true)
        })
      }

      indexOfAndSplice(onPlayCallbacks, onPlay)
    }

    if (this.hadContainer) {
      onPlay()
    }

    onPlayCallbacks.push(onPlay)
    onPauseCallbacks.push(() => {
      this.showControls(false)
    })

    listenerSetter.add(video)('play', () => {
      this.setIsPlaying(true)
      onPlayCallbacks.forEach((cb) => cb())
    })

    listenerSetter.add(video)('pause', () => {
      this.setIsPlaying(false)
      onPauseCallbacks.forEach((cb) => cb())
    })

    if (video.duration || initDuration) {
      timeDuration.textContent = formatVideoTime(Math.round(video.duration || initDuration!))
    } else {
      // tweb onMediaLoad(video) — хелпер не портирован (тянет rootScope/фиксы
      // crbug); durationchange даёт тот же момент (как в React-плеере)
      listenerSetter.add(video)('durationchange', () => {
        timeDuration.textContent = formatVideoTime(Math.round(video.duration))
      })
    }
  }

  // Порт tweb listenKeyboardEvents (:384-416). Гейт «поверх плеера другой
  // оверлей» (overlayCounter.overlaysActive > 1) заменён проверкой фокуса в
  // поле ввода — оверлей-счётчика нет до Task 16 (как в React-плеере).
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (
      document.pictureInPictureElement === this.video ||
      (this.listenKeyboardEvents === 'fullscreen' && !this.isFullScreen())
    ) {
      return
    }

    const { key, code } = e

    let good = true
    if (code === 'KeyF') {
      this.toggleFullScreen()
    } else if (code === 'KeyM') {
      // tweb — mute глобального контроллера; у нас mute самого видео через
      // VolumeSelector (иконка/слайдер обновляются им же), как в React-плеере
      this.volumeSelector.onMuteClick()
    } else if (code === 'Space') {
      this.togglePlay()
    } else if (this.wrapper.classList.contains('ckin__fullscreen') && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      // tweb — seekBackward/seekForward контроллера (дефолтный offset 10 c)
      const v = this.video
      v.currentTime = key === 'ArrowLeft' ?
        Math.max(0, v.currentTime - 10) :
        Math.min(v.duration || Infinity, v.currentTime + 10)
    } else {
      good = false
    }

    if (good) {
      cancelEvent(e)
      return false
    }
  }

  // Вместо solid-createPlaybackRateButton tweb — vanilla btn-menu по образцу
  // setBtnMenuToggle (appMediaViewer.ts): классы кнопки — как у tweb
  // ButtonMenuToggle(`mediaspeed_empty ${skin}__button`) + пост-классы
  // checkable-button-menu/playback-rate-button-menu (playbackRateButton.tsx:113),
  // меню живёт внутри кнопки (`.btn-menu.top-left`, direction tweb).
  private createPlaybackRateButton(): HTMLElement {
    const { skin } = this
    const toggle = document.createElement('button')
    toggle.className = `btn-icon ${skin}__button btn-menu-toggle checkable-button-menu playback-rate-button-menu`
    toggle.append(iconSpan('mediaspeed_empty', 'button-icon'))

    const floating = document.createElement('span')
    floating.classList.add('playback-speed-icon-floating')
    toggle.append(floating)

    const menu = document.createElement('div')
    menu.classList.add('btn-menu', 'top-left')

    // i18n вне React — как connectionStatus.ts/appMediaViewer.ts
    const t = useI18nStore.getState().t
    const items = VIDEO_RATES.map((rate) => {
      const el = document.createElement('div')
      el.className = 'btn-menu-item rp-overflow'
      const iconEl = iconSpan('check', 'btn-menu-item-icon')
      el.append(iconEl)
      const textEl = document.createElement('span')
      textEl.classList.add('btn-menu-item-text')
      textEl.textContent = rate === 1 ? t('Normal') : `${rate}x`
      el.append(textEl)
      attachClickEvent(el, () => {
        closeMenu()
        this.setPlaybackRate(rate)
      }, { listenerSetter: this.listenerSetter })
      return { rate, el, iconEl }
    })
    menu.append(...items.map(({ el }) => el))
    toggle.append(menu)

    // Отрисовка выбранной скорости: галочка пункта (скрытая у остальных — как
    // в React-плеере) + плавающие геометрические глифы на кнопке.
    this.syncRate = (rate: number) => {
      items.forEach((it) => {
        it.iconEl.style.visibility = it.rate === rate ? '' : 'hidden'
      })
      floating.replaceChildren(...rateToString(rate).split('').map((char) => {
        const g = GEOMETRIC[char]
        return iconSpan(g.icon, 'geometric-font-icon', `geometric-font-icon--${g.char}`)
      }))
    }
    this.syncRate(this.video.playbackRate)

    const onOutsideClick = (e: Event) => {
      if (findUpClassName(e.target as HTMLElement, 'btn-menu-toggle') === toggle) return
      closeMenu()
    }
    const closeMenu = () => {
      if (!toggle.classList.contains('menu-open')) return
      menu.classList.remove('active')
      toggle.classList.remove('menu-open')
      document.removeEventListener('click', onOutsideClick, true)
      this.onMenuToggle?.(false)
    }
    this.closeRateMenu = closeMenu
    attachClickEvent(toggle, (e) => {
      cancelEvent(e)
      // клики по пунктам обрабатывают сами пункты
      if (findUpClassName(e.target as HTMLElement, 'btn-menu')) return
      if (toggle.classList.contains('menu-open')) {
        closeMenu()
      } else {
        menu.classList.add('active', 'was-open')
        toggle.classList.add('menu-open')
        document.addEventListener('click', onOutsideClick, true)
        this.onMenuToggle?.(true)
      }
    }, { listenerSetter: this.listenerSetter })

    return toggle
  }

  private syncRate!: (rate: number) => void

  private setPlaybackRate(rate: number) {
    this.video.playbackRate = rate
    // персист — settings-стор (контракт onRateChange бывшего React-плеера)
    useSettingsStore.getState().update({ videoRate: rate })
    this.syncRate(rate)
  }

  private isRateMenuOpen() {
    return this.rateButton?.classList.contains('menu-open') ?? false
  }

  protected _onPip = (pip: boolean) => {
    this._inPip = pip
    this.wrapper.style.visibility = pip ? 'hidden' : ''
    this.onPip?.(pip)
  }

  // Порт tweb :539-548: закрытие PiP крестиком даёт leavepictureinpicture,
  // а СРАЗУ следом (в пределах debouncePipTime) pause — это «закрыл и не
  // вернулся», хост закрывает вьювер (onPipClose); leave без pause — возврат.
  protected onEnterPictureInPictureLeave = (e: Event) => {
    const onPause = () => {
      clearTimeout(timeout)
      this.onPipClose?.()
    }
    const listener = this.listenerSetter.add(e.target!)('pause', onPause, { once: true }) as unknown as Listener
    const timeout = window.setTimeout(() => {
      this.listenerSetter.remove(listener)
    }, this.debouncePipTime)
  }

  protected onEnterPictureInPicture = (e: Event) => {
    this.debouncedPip(true)
    this.listenerSetter.add(e.target!)('leavepictureinpicture', this.onEnterPictureInPictureLeave, { once: true })
  }

  protected onLeavePictureInPicture = () => {
    this.debouncedPip(false)
  }

  protected addPipListeners(video: HTMLVideoElement) {
    this.listenerSetter.add(video)('enterpictureinpicture', this.onEnterPictureInPicture)
    this.listenerSetter.add(video)('leavepictureinpicture', this.onLeavePictureInPicture)
  }

  public requestPictureInPicture = () => {
    // emptyPipVideo-ветка tweb (:575-596, PiP до метаданных через canvas-стрим)
    // не портирована — см. шапку; enterPip (core/pip.ts) сам гейтится
    // pictureInPictureEnabled/disablePictureInPicture
    if (!this.video.duration) return
    if (this.isFullScreen()) {
      // tweb :566-568 (onFullScreenToPip): PiP из фуллскрина — сперва выйти
      this.cancelFullScreen()
    }
    void enterPip(this.video)
  }

  protected togglePlay(isPaused = this.video.paused) {
    // tweb :600 зовёт video.play() голым — у нас через safePlay (реджект
    // autoplay-политики вне жеста не должен ронять unhandled rejection)
    if (isPaused) safePlay(this.video)
    else this.video.pause()
  }

  private buildControls() {
    const skin = this.skin

    // innerHTML — статическая разметка tweb :615-626, пользовательских данных
    // нет (норма безопасности про user content не нарушается)
    return `
    <div class="${skin}__gradient-bottom ckin__controls"></div>
    <div class="${skin}__controls ckin__controls">
      <div class="bottom-controls night">
        <div class="left-controls">
          <div class="ckin__time">
            <time class="ckin__time-elapsed">0:00</time>
            <span> / </span>
            <time class="ckin__time-duration">0:00</time>
          </div>
        </div>
        <div class="right-controls"></div>
      </div>
    </div>`
  }

  public cancelFullScreen() {
    if (getFullScreenElement() === this.wrapper) {
      this.toggleFullScreen()
    }
  }

  protected toggleFullScreen() {
    const player = this.wrapper

    // * https://caniuse.com/#feat=fullscreen (комментарий tweb :639)
    if (IS_APPLE_MOBILE) {
      const video = this.video as HTMLVideoElement & {
        webkitEnterFullscreen?: () => void
        enterFullscreen?: () => void
      }
      video.webkitEnterFullscreen?.()
      video.enterFullscreen?.()
      return
    }

    if (!isFullScreen()) {
      requestFullScreen(player)
    } else {
      cancelFullScreen()
    }
  }

  public isFullScreen() {
    return isFullScreen()
  }

  protected _onFullScreen(fullScreenButton: HTMLElement) {
    const isFull = isFullScreen()
    this.wrapper.classList.toggle('ckin__fullscreen', isFull)
    replaceButtonIcon(fullScreenButton, isFull ? 'smallscreen' : 'fullscreen')
    fullScreenButton.setAttribute('title', isFull ? 'Exit Full Screen' : 'Full Screen')
  }

  public cleanup() {
    super.cleanup()
    this.listenerSetter.removeAll()
    this.progress?.cleanup()
    this.volumeSelector?.removeListeners()
    this.closeRateMenu?.()
    this.onMenuToggle =
      this.onTimePreviewToggle =
      this.onPip =
      this.onPipClose =
      undefined
  }

  get inPip() {
    return this._inPip
  }
}
