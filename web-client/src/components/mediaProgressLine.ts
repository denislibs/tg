// Порт tweb `src/components/mediaProgressLine.ts` (MediaProgressLine —
// наследник RangeSelector) в объёме vanilla-плеера вьювера (Task 15):
// буферизованная полоса (`progress-line__loaded`), обёртка
// `media-progress-line__filled-container` + thumb + превью-время над треком
// (`__current-time-info`, класс `show-time` вешает плеер), скраб с паузой
// на время драга, RAF-цикл прогресса на play, `--progress`-переменная
// (thumb позиционируется ею из партиала).
//
// Не портированы (помечено):
//   • videoTimestamps/сегменты + SVG-clipPath + observeResize (пересчёт клипа
//     сегментов) — таймкодов сообщений у нас нет (Task 14 их не собирает);
//     вместе с ними ушли snapScrubValue и `__current-segment`-элемент;
//   • storyboard-превью кадра (appendToTimeElement) — HLS-storyboard'ов нет;
//   • appMediaPlaybackController.isSafariBuffering — наш контроллер обслуживает
//     только голос/музыку (core/audio/mediaPlaybackController.ts);
//   • setCurrentTime-хелпер tweb (`media.isSeeking = true` — амбиент-флаг для
//     его контроллера) — прямое присваивание currentTime;
//   • toHHMMSS → наш formatVideoTime (порт того же формата, покрыт тестами).
import type { GrabEvent } from '@helpers/dom/attachGrabListeners'
import safePlay from '@helpers/dom/safePlay'
import { formatVideoTime } from './messages/videoPlayback'
import RangeSelector from './rangeSelector'

export default class MediaProgressLine extends RangeSelector {
  protected filledContainer?: HTMLDivElement
  protected filledLoad?: HTMLDivElement

  protected currentTimeInfoElement?: HTMLDivElement
  protected currentTimeElement?: HTMLDivElement

  protected progressRAF?: number

  protected media!: HTMLMediaElement
  protected streamable?: boolean

  constructor(protected options: {
    withTransition?: boolean,
    useTransform?: boolean,
    onSeekStart?: () => void,
    onSeekEnd?: () => void,
    onTimeUpdate?: (time: number) => void,
    onHover?: (progress: number) => void,
    onPointerOut?: () => void,
    withTime?: boolean
  } = {}) {
    super({
      step: 1000 / 60 / 1000,
      min: 0,
      max: 1,
      withTransition: options.withTransition,
      useTransform: options.useTransform,
    }, 0)
  }

  public setMedia({ media, streamable, duration }: {
    media: HTMLMediaElement,
    streamable?: boolean,
    duration?: number
  }) {
    if (this.media) {
      this.removeListeners()
    }

    if (streamable && !this.filledLoad) {
      this.filledLoad = document.createElement('div')
      this.filledLoad.classList.add('progress-line__filled', 'progress-line__loaded')
      this.container.prepend(this.filledLoad)
    } else if (this.filledLoad) {
      this.filledLoad.classList.toggle('hide', !streamable)
    }

    this.media = media
    this.streamable = streamable
    if (!media.paused || media.currentTime > 0) {
      this.onPlay()
    }

    // в tweb здесь setTimestampsClipPath — без сегментов от него остаётся
    // только обёртка контейнера при withTime (см. шапку)
    if (this.options.withTime) {
      this.wrapProgressLinesInContainer()
    }

    let wasPlaying = false
    this.setSeekMax(duration)
    this.setListeners()
    this.setHandlers({
      onMouseDown: () => {
        wasPlaying = !this.media.paused
        if (wasPlaying) this.media.pause()
        this.options?.onSeekStart?.()
        this.container.classList.add('media-progress-line--seeking')
      },

      onMouseUp: () => {
        if (wasPlaying) safePlay(this.media)
        this.options?.onSeekEnd?.()
        this.container.classList.remove('media-progress-line--seeking')
      },
    })
  }

  protected onHover = (e: MouseEvent) => {
    if (this.options.onHover) {
      this.rect = this.container.getBoundingClientRect()
      this.options.onHover(this.getValueByEvent({ x: e.pageX, y: e.pageY, event: e }))
    }

    if (!this.filledContainer) {
      return
    }

    const bcr = this.filledContainer.getBoundingClientRect()
    this.updateTime(e.clientX - bcr.left, bcr.width)
  }

  protected onPointerOut = () => {
    this.options.onPointerOut?.()
  }

  protected wrapProgressLinesInContainer() {
    if (this.filledContainer) {
      return
    }

    this.container.classList.add('media-progress-line')

    this.filledContainer = document.createElement('div')
    this.filledContainer.classList.add('media-progress-line__filled-container')

    const thumb = document.createElement('div')
    thumb.classList.add('media-progress-line__thumb')

    this.currentTimeInfoElement = document.createElement('div')
    this.currentTimeInfoElement.classList.add('media-progress-line__current-time-info')

    this.currentTimeElement = document.createElement('div')
    // tweb:189-190 вешает класс `__current-time` на info-элемент, а не на сам
    // элемент времени (квирк оригинала; стилей у класса нет) — повторяем 1:1
    this.currentTimeInfoElement.classList.add('media-progress-line__current-time')

    this.currentTimeInfoElement.append(this.currentTimeElement)

    // порядок детей load-bearing: input + thumb — соседний селектор партиала
    // `input:active + &` подсвечивает thumb при драге
    const loadParts = this.filledLoad ? [this.filledLoad] : []
    this.filledContainer.append(this.filled, ...loadParts)

    this.container.prepend(this.filledContainer)
    this.container.append(thumb, this.currentTimeInfoElement)
    // initResizeObserver tweb — только пересчёт clipPath сегментов, не портирован
  }

  protected updateTime(x: number, width: number) {
    if (!this.media || !this.currentTimeInfoElement) {
      return
    }

    if (x < 0 || x > width) {
      this.currentTimeElement!.textContent = ''
      return
    }

    this.currentTimeElement!.textContent = formatVideoTime(x / width * this.media.duration | 0)

    const infoBcr = this.currentTimeInfoElement.getBoundingClientRect()

    const pushFromRight = Math.min(0, width - (x + infoBcr.width / 2))
    const pushFromLeft = Math.max(0, infoBcr.width / 2 - x)

    this.currentTimeInfoElement.style.setProperty('--current-time-info-x', x + pushFromLeft + pushFromRight + 'px')
  }

  protected onLoadedData = () => {
    this.setSeekMax()
  }

  protected onEnded = () => {
    this.setProgress()
  }

  protected onPlay = () => {
    const r = () => {
      this.setProgress()

      this.progressRAF = this.media.paused ? undefined : window.requestAnimationFrame(r)
    }

    if (this.progressRAF) {
      window.cancelAnimationFrame(this.progressRAF)
      this.progressRAF = undefined
    }

    if (this.streamable) {
      this.setLoadProgress()
    }

    r()
  }

  protected onTimeUpdate = () => {
    if (this.media.paused) {
      this.setProgress()

      if (this.streamable) {
        this.setLoadProgress()
      }
    }
  }

  protected onProgress = () => {
    this.setLoadProgress()
  }

  protected override scrub(e: GrabEvent) {
    let scrubTime = super.scrub(e)
    // не давать `ended` при скрабе в самый конец (комментарий tweb)
    if (this.media.duration && scrubTime >= this.media.duration) {
      scrubTime = this.media.duration - 0.1
    }
    this.media.currentTime = scrubTime
    return scrubTime
  }

  protected setLoadProgress() {
    if (!this.filledLoad) {
      return
    }

    const buf = this.media.buffered
    const numRanges = buf.length

    const currentTime = this.media.currentTime
    let nearestStart = 0, end = 0
    for (let i = 0; i < numRanges; ++i) {
      const start = buf.start(i)
      if (currentTime >= start && start >= nearestStart) {
        nearestStart = start
        end = buf.end(i)
      }
    }

    const percents = this.max ? end / this.max : 0
    this.filledLoad.style.width = (percents * 100) + '%'
  }

  protected setSeekMax(duration?: number) {
    const realDuration = this.media.duration || 0
    if (duration === undefined || realDuration) duration = realDuration
    this.max = duration
    if (this.max) {
      this.seek.setAttribute('max', '' + this.max)
    } else {
      this.media.addEventListener('loadeddata', this.onLoadedData)
    }
  }

  public override setProgress(_value?: number) {
    // сигнатура шире базовой: внутренние вызовы идут без аргумента, значение
    // из base.scrub игнорируется — источник правды всегда media.currentTime
    // (как в tweb, где override вовсе без параметров)
    const currentTime = this.media.currentTime
    this.options.onTimeUpdate?.(currentTime)
    super.setProgress(currentTime)

    this.container.style.setProperty('--progress', currentTime / this.media.duration + '')
  }

  public override setListeners() {
    super.setListeners()
    this.media.addEventListener('ended', this.onEnded)
    this.media.addEventListener('play', this.onPlay)
    this.media.addEventListener('pause', this.onTimeUpdate)
    this.media.addEventListener('timeupdate', this.onTimeUpdate)
    if (this.streamable) this.media.addEventListener('progress', this.onProgress)

    if (this.options.onHover || this.options.withTime) {
      this.container.addEventListener('pointermove', this.onHover)
      this.container.addEventListener('pointerout', this.onPointerOut)
    }
  }

  public override removeListeners() {
    super.removeListeners()

    if (this.media) {
      this.media.removeEventListener('loadeddata', this.onLoadedData)
      this.media.removeEventListener('ended', this.onEnded)
      this.media.removeEventListener('play', this.onPlay)
      this.media.removeEventListener('pause', this.onTimeUpdate)
      this.media.removeEventListener('timeupdate', this.onTimeUpdate)
      if (this.streamable) this.media.removeEventListener('progress', this.onProgress)
    }

    this.container.removeEventListener('pointermove', this.onHover)
    this.container.removeEventListener('pointerout', this.onPointerOut)

    if (this.progressRAF) {
      window.cancelAnimationFrame(this.progressRAF)
      this.progressRAF = undefined
    }
  }

  public cleanup() {
    this.removeListeners()
  }
}
