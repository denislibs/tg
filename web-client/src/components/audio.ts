/**
 * Порт tweb `src/components/audio.ts` (`AudioElement`) — голосовое и музыкальный
 * трек в ленте.
 *
 * ФОРМА. В оригинале это НАСТОЯЩИЙ web-component (`class AudioElement extends
 * HTMLElement` + `customElements.define('audio-element', …)`), и это не
 * стилистика: тег там — АДРЕСУЕМОЕ ПОВЕДЕНИЕ. По нему ходят из двух мест,
 * которым доступен только DOM:
 *   • глобальный слушатель прочтения медиа снимает точку «не прослушано»
 *     запросом `document.querySelectorAll('audio-element.is-unread[data-mid]…')`
 *     (tweb audio.ts:47-54) — ни у кого нет ссылки на конкретный элемент;
 *   • плейлист собирается сканом соседей в ленте (`findMediaTargets`,
 *     tweb audio.ts:458-498) — «следующее голосовое» определяется порядком
 *     узлов, а не заранее собранным массивом.
 * У нас тег `audio-element` до сих пор был ПУСТЫМ (объявлен в
 * `src/customElements.d.ts` только как JSX-имя) — визуальный слепок ради
 * совпадения селекторов `styles/tweb/_audio.scss`, а всё поведение висело на
 * React-компонентах. Для императивной ленты React'а нет, и поведение обязано
 * жить в самом узле — то есть ровно там, где оно живёт в оригинале.
 *
 * ВОСПРОИЗВЕДЕНИЕ. tweb берёт медиа-элемент у контроллера
 * (`appMediaPlaybackController.addMedia({message})`) и дальше слушает ЕГО
 * события (`addAudioListener`). Здесь так же — через
 * `getPlaybackMedia()`/`subscribeCurrentTrack()` (`core/audio/mediaPlaybackController`,
 * см. докблок этих функций): никакого чтения zustand-стора, поведение целиком на
 * событиях медиа-элемента. Отличие ровно одно и оно вынужденное: у tweb <audio>
 * свой на каждое сообщение, у нас один на приложение, поэтому «мой ли он сейчас»
 * — отдельный гейт (подписка на смену текущего трека).
 *
 * ЧТО НЕ ПОРТИРОВАНО (и почему):
 *   • ТРАНСКРИБАЦИЯ (`audio-to-text-button`, tweb audio.ts:182-240). В tweb сам
 *     блок текста `.audio-transcribed-text` создаёт НЕ audio.ts, а бабл
 *     (`chat/bubbles.ts`), а кнопка ищет его подъёмом до `.document-wrapper`.
 *     Бабл — следующий этап и вне периметра этой задачи, поэтому кнопка здесь
 *     была бы мёртвой ручкой. У React-ленты транскрибация работает как работала
 *     (`components/messages/Transcription.tsx`);
 *   • `voiceAsMusic`, `showSender`, `withTime`-подпись отправителя
 *     (`wrapSenderToPeer`/`wrapSentTime`) — это режимы поиска/shared-media
 *     (tweb `searchContext`), а не ленты; враппера `senderToPeer` у нас нет;
 *   • обложка трека (`doc.thumbs` → `wrapPhoto`, `audio-with-thumb`) — `wrapPhoto`
 *     портирует параллельная задача, а в нашей модели у аудиофайла нет обложки;
 *   • `appMediaPlaybackController.setSearchContext/setTargets/isSafariBuffering`
 *     и `willBePlayed`-механика Safari — у нашего контроллера другой контракт
 *     (очередь передаётся значением, см. `findMediaTargets` ниже);
 *   • ветка аплоада (`uploadingFileName`) — прогресс отдачи живёт в
 *     `stores/uploadsStore` и приезжает в бабл отдельно; это отдельный этап.
 */
import { mediaPlayback, getPlaybackMedia, getCurrentTrack, subscribeCurrentTrack } from '@core/audio/mediaPlaybackController'
import type { AudioTrack } from '@stores/audioStore'
import { decodeTransmittedPeaks, buildWaveformBars, WAVEFORM_BAR_WIDTH, WAVEFORM_BAR_MARGIN, WAVEFORM_HEIGHT } from '@core/audio/waveform'
import { markMediaPlayed } from '@core/mediaRead'
import { RT } from '@core/realtime/events'
import rootScope from '@lib/rootScope'
import ProgressivePreloader from '@components/preloader'
import MediaProgressLine from '@components/mediaProgressLine'
import { MiddleEllipsisElement } from '@components/middleEllipsis'
import { formatVideoTime } from '@components/messages/videoPlayback'
import { animateSingle, cancelAnimationByKey } from '@helpers/animation'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import safePlay from '@helpers/dom/safePlay'
import ListenerSetter from '@helpers/listenerSetter'
import type { Middleware } from '@helpers/middleware'
import { formatBytes } from '@core/mediaCache'
import { startClient } from '../client/bootstrap'
import { useI18nStore } from '../i18n'

const UNMOUNT_PRELOADER = true

/**
 * Строка проводки (порт tweb audio.ts:47-54): прочтение медиа снимает точку
 * «не прослушано» со ВСЕХ живых узлов этого сообщения. Ссылки на элемент ни у
 * кого нет — поэтому поиск по DOM, и поэтому же тег обязан быть настоящим.
 * Держит `components/audio.test.ts`.
 */
rootScope.addEventListener(RT.mediaRead, (evt) => {
  const selector = `audio-element.is-unread[data-mid="${evt.msg_id}"][data-peer-id="${evt.chat_id}"]`
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    element.classList.remove('is-unread')
  })
})

/** Документ в терминах враппера — плоский аналог tweb `MyDocument`. */
export interface AudioElementDoc {
  /** файл на медиа-эндпоинте (у tweb — `doc.id`) */
  id: number
  /** tweb `doc.type` */
  type: 'voice' | 'round' | 'audio'
  /** длительность в секундах (tweb `doc.duration`) */
  duration?: number
  /** размер файла (tweb `doc.size`) */
  size?: number
  /** имя файла (tweb `doc.file_name`) */
  fileName?: string
  /** ID3-теги (tweb `documentAttributeAudio.title`/`.performer`) */
  title?: string
  performer?: string
  /**
   * Пики волны голосового, base64 (наш аналог `documentAttributeAudio.waveform`).
   *
   * ПРОБЕЛ МОДЕЛИ, а не оригинала: на бэке пики есть (`media.waveform`,
   * миграция 0086) и отдаются в `GET /media/{id}`, но в read-model истории
   * (`chat_handler.go::messageJSON`) их нет — в отличие от tweb, где waveform
   * приезжает прямо в документе сообщения. Пока поля нет, враппер добирает его
   * одним запросом меты и ПЕРЕРИСОВЫВАЕТ волну на месте (см. `wrapVoiceMessage`).
   * Правильное закрытие — `media_waveform` в read-model истории.
   */
  waveform?: string
}

/** То, что врапперу нужно от сообщения (tweb передаёт весь `Message.message`). */
export interface AudioElementMessage {
  /** id сообщения (tweb `message.mid`) */
  mid?: number
  /** чат сообщения (tweb `message.peerId`); им же адресуется `RT.mediaRead` */
  peerId?: number
  /** исходящее (tweb `message.pFlags.out`) */
  out?: boolean
  /** не прослушано (tweb `message.pFlags.media_unread`) */
  mediaUnread?: boolean
}

/**
 * Волна голосового — порт tweb `createWaveformBars` (audio.ts:83-147) в части
 * DOM; сама геометрия (ширина волны от длительности, агрегация пиков максимумом,
 * нормировка) уже портирована в `core/audio/waveform.ts::buildWaveformBars` и
 * покрыта тестами — здесь она не дублируется.
 */
export function createWaveformBars(peaks: number[], duration: number): {
  svg: SVGSVGElement | undefined,
  container: HTMLElement | undefined,
  availW: number
} {
  const { bars, width: availW } = buildWaveformBars(peaks, duration)

  if(!bars.length) {
    return { svg: undefined, container: undefined, availW }
  }

  const container = document.createElement('div')
  container.classList.add('audio-waveform')

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.classList.add('audio-waveform-bars')
  svg.setAttributeNS(null, 'width', '' + availW)
  svg.setAttributeNS(null, 'height', '' + WAVEFORM_HEIGHT)
  svg.setAttributeNS(null, 'viewBox', `0 0 ${availW} ${WAVEFORM_HEIGHT}`)

  bars.forEach((height, i) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.classList.add('audio-waveform-bar')
    rect.setAttributeNS(null, 'x', '' + i * (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_MARGIN))
    rect.setAttributeNS(null, 'y', '' + (WAVEFORM_HEIGHT - height))
    rect.setAttributeNS(null, 'width', '' + WAVEFORM_BAR_WIDTH)
    rect.setAttributeNS(null, 'height', '' + height)
    rect.setAttributeNS(null, 'rx', '1')
    rect.setAttributeNS(null, 'ry', '1')
    svg.append(rect)
  })

  container.append(svg)

  return { svg, container, availW }
}

/** tweb audio.ts:149-340 — голосовое: волна + время + скраб по волне. */
function wrapVoiceMessage(audioEl: AudioElement): () => (() => void) {
  audioEl.classList.add('is-voice')

  const doc = audioEl.doc
  if(audioEl.message.out) {
    audioEl.classList.add('is-out')
  }

  const waveformContainer = document.createElement('div')
  waveformContainer.classList.add('audio-waveform-container')

  const timeDiv = document.createElement('div')
  timeDiv.classList.add('audio-time')
  audioEl.append(waveformContainer, timeDiv)

  // Ширина волны нужна скрабу, а волна может перерисоваться, когда доедут пики
  // (см. `AudioElementDoc.waveform`) — поэтому это переменная, а не константа
  // замыкания, как в tweb.
  let availW = 0
  let fakeSvgContainer: HTMLElement | undefined

  // tweb вешает скраб на сам `<svg>` фоновой волны (audio.ts:275-324; клон
  // `.audio-waveform-fake` — `pointer-events: none`, `_audio.scss:390-399`).
  // Драг-версия (mousedown/mousemove с паузой на время перетаскивания) не
  // портирована — остался клик, как и в React-версии.
  //
  // Отличие от оригинала: у tweb элемент владеет СВОИМ <audio>, поэтому скраб
  // всегда двигает именно его. У нас плеер общий, и перемотка из узла, чей трек
  // сейчас не играет, увела бы чужой, — отсюда гейт по `audioEl.media`.
  const onScrub = (e: Event) => {
    cancelEvent(e)
    const media = audioEl.media
    if(!media || !media.duration) return
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    mediaPlayback.seekFraction(((e as MouseEvent).clientX - rect.left) / (rect.width || availW))
  }

  const renderWaveform = (peaks: number[]) => {
    const built = createWaveformBars(peaks, doc.duration || 0)
    availW = built.availW
    waveformContainer.textContent = ''
    fakeSvgContainer = undefined

    if(!built.container || !built.svg) {
      return
    }

    fakeSvgContainer = built.container.cloneNode(true) as HTMLElement
    fakeSvgContainer.classList.add('audio-waveform-fake')
    built.container.classList.add('audio-waveform-background')
    waveformContainer.append(built.container, fakeSvgContainer)
    // слушатель ставится на КАЖДУЮ отрисовку волны (их максимум две: сразу и
    // после добора пиков), а не на каждое воспроизведение
    audioEl.listenerSetter.add(built.svg)('click', onScrub as EventListener)
  }

  renderWaveform(doc.waveform ? decodeTransmittedPeaks(doc.waveform) : [])

  const onLoad = () => {
    const media = audioEl.media
    if(!media) {
      return () => {}
    }

    const onTimeUpdate = () => {
      if(fakeSvgContainer && media.duration) {
        fakeSvgContainer.style.width = (media.currentTime / media.duration * 100) + '%'
      }
    }

    const setAnimation = () => {
      void animateSingle(() => {
        onTimeUpdate()
        return !media.paused
      }, audioEl)
    }

    if(!media.paused || (media.currentTime > 0 && media.currentTime !== media.duration)) {
      onTimeUpdate()
    }

    audioEl.addAudioListener('timeupdate', onTimeUpdate)
    audioEl.addAudioListener('ended', onTimeUpdate)
    audioEl.addAudioListener('play', setAnimation)

    // tweb здесь удаляет `<svg>` волны (audio.ts:332-336) — у него отключение
    // бывает ровно один раз, при смерти элемента. У нас узел отцепляется от
    // медиа каждый раз, когда играть начали что-то другое, и волну надо не
    // сносить, а вернуть в исходный вид.
    return () => {
      // rAF-цикл прогресса гаснет по `!media.paused` (tweb audio.ts:252-258) —
      // у tweb это ВСЕГДА своё медиа, а у нас общее: после переключения оно
      // продолжает играть чужой трек и дорисовывало бы чужой прогресс в нашу
      // волну. Поэтому цикл снимается явно.
      cancelAnimationByKey(audioEl)
      if(fakeSvgContainer) fakeSvgContainer.style.width = ''
    }
  }

  // Пики не приехали в сообщении — добрать метой и перерисовать волну на месте
  // (см. докблок `AudioElementDoc.waveform`).
  if(!doc.waveform) {
    void audioEl.fetchWaveform().then((peaks) => {
      if(!peaks.length || !audioEl.middleware()) return
      renderWaveform(peaks)
    }, () => {})
  }

  return onLoad
}

/** tweb audio.ts:342-444 — музыкальный трек: название, подпись, полоса прогресса. */
function wrapAudio(audioEl: AudioElement): () => (() => void) {
  const doc = audioEl.doc
  const t = useI18nStore.getState().t

  const descriptionEl = document.createElement('div')
  descriptionEl.classList.add('audio-description')

  // tweb audio.ts:354-371: части описания — [performer]; размер файла идёт
  // ТОЛЬКО когда частей нет. Строка всегда начинается с ' • '.
  const parts: string[] = []
  if(doc.performer) parts.push(doc.performer)
  if(!parts.length && doc.size) parts.push(formatBytes(doc.size, t))
  if(parts.length) descriptionEl.append(' • ' + parts.join(' • '))

  const details = document.createElement('div')
  details.classList.add('audio-details')
  const titleEl = document.createElement('div')
  titleEl.classList.add('audio-title')
  const subtitleDiv = document.createElement('div')
  subtitleDiv.classList.add('audio-subtitle')
  const audioTimeDiv = document.createElement('div')
  audioTimeDiv.classList.add('audio-time')
  subtitleDiv.append(audioTimeDiv)
  details.append(titleEl, subtitleDiv)
  audioEl.append(details)

  const middleEllipsisEl = new MiddleEllipsisElement()
  middleEllipsisEl.dataset.fontWeight = audioEl.dataset.fontWeight
  middleEllipsisEl.dataset.fontSize = audioEl.dataset.fontSize
  if(audioEl.dataset.sizeType) middleEllipsisEl.dataset.sizeType = audioEl.dataset.sizeType
  // tweb audio.ts:390 — `audioAttribute?.title ?? doc.file_name`
  middleEllipsisEl.textContent = doc.title ?? doc.fileName ?? ''
  titleEl.append(middleEllipsisEl)

  subtitleDiv.append(descriptionEl)

  const onLoad = () => {
    const media = audioEl.media
    if(!media) {
      return () => {}
    }

    let launched = false
    const progressLine = new MediaProgressLine()
    progressLine.setMedia({ media, duration: doc.duration })

    // tweb меняет местами описание и полосу через `subtitleDiv.lastChild`
    // (audio.ts:415,425) — там у подписи один владелец на всю жизнь узла. У нас
    // тот же узел проходит через отцепление от медиа и обратно, поэтому обмен
    // идёт по ЯВНЫМ ссылкам: иначе повторный запуск подменил бы полосой уже не
    // описание, а `.audio-time`.
    const showDescription = () => {
      if(progressLine.container.parentElement === subtitleDiv) {
        progressLine.container.replaceWith(descriptionEl)
      }
    }

    audioEl.addAudioListener('ended', () => {
      audioEl.classList.remove('audio-show-progress')
      showDescription()
      launched = false
    })

    const onPlay = () => {
      if(launched) return
      audioEl.classList.add('audio-show-progress')
      launched = true
      if(descriptionEl.parentElement === subtitleDiv) {
        descriptionEl.replaceWith(progressLine.container)
      }
    }

    audioEl.addAudioListener('play', onPlay)

    if(!media.paused || media.currentTime > 0) {
      onPlay()
    }

    // tweb здесь только снимает слушатели и выкидывает полосу (audio.ts:436-440):
    // отключение у него бывает один раз, при смерти элемента. У нас узел
    // отцепляется от медиа при каждом переключении трека, поэтому подпись надо
    // ВЕРНУТЬ на место — иначе следующий запуск заменил бы полосой уже не
    // описание, а `.audio-time`, и длительность из строки пропала бы.
    return () => {
      progressLine.removeListeners()
      showDescription()
      audioEl.classList.remove('audio-show-progress')
      launched = false
    }
  }

  return onLoad
}

/** tweb audio.ts:446-456 */
function constructDownloadPreloader(tryAgainOnFail = true) {
  const preloader = new ProgressivePreloader({ cancelable: true, tryAgainOnFail })
  preloader.construct?.()

  if(!tryAgainOnFail) {
    preloader.circle.setAttributeNS(null, 'r', '23')
    preloader.totalLength = 143.58203125
  }

  return preloader
}

/**
 * Плейлист соседей — порт tweb `findMediaTargets` (audio.ts:458-498): «следующее
 * голосовое» определяется ПОРЯДКОМ УЗЛОВ в ленте, а не заранее собранным
 * массивом. Отличие от оригинала: tweb отдаёт контроллеру пары `{peerId, mid}` и
 * тот сам догружает документы, а наш контроллер принимает очередь значением —
 * поэтому каждый узел несёт свой трек, и очередь собирается из них.
 */
export function findMediaTargets(anchor: AudioElement): { queue: AudioTrack[], index: number } {
  const container = findUpClassName(anchor, 'bubbles-inner')
  if(!container) {
    return { queue: [anchor.track], index: 0 }
  }

  const isVoice = anchor.classList.contains('is-voice')
  // Голосовые и кружки — одна очередь (tweb inputMessagesFilterRoundVoice),
  // музыка — своя (inputMessagesFilterMusic).
  const selector = isVoice ? 'audio-element.audio.is-voice' : 'audio-element.audio:not(.is-voice)'
  const elements = Array.from(container.querySelectorAll<AudioElement>(selector))
  const index = elements.indexOf(anchor)
  if(index === -1) {
    return { queue: [anchor.track], index: 0 }
  }

  return { queue: elements.map((element) => element.track), index }
}

export default class AudioElement extends HTMLElement {
  public doc!: AudioElementDoc
  public message: AudioElementMessage = {}
  public middleware!: Middleware
  /** трек для плеера — этот же узел отдаёт его в плейлист (`findMediaTargets`) */
  public track!: AudioTrack
  /** медиа-элемент воспроизведения, пока трек этого узла текущий (tweb `this.audio`) */
  public media: HTMLMediaElement | null = null

  /** слушатели самого узла — живут всё время жизни элемента */
  public listenerSetter = new ListenerSetter()
  /** слушатели медиа-элемента — снимаются, как только трек перестал быть текущим */
  private mediaListeners = new ListenerSetter()
  private onTypeDisconnect: (() => void) | null = null
  private onTypeLoad!: () => (() => void)
  private unsubscribeTrack: (() => void) | null = null
  private toggle!: HTMLElement
  private downloadDiv!: HTMLElement
  private audioTimeDiv!: HTMLElement
  private readyPromise: CancellablePromise<void> | null = null
  private preloader: ProgressivePreloader | null = null

  /** tweb `addAudioListener` (audio.ts:847-849) */
  public get addAudioListener() {
    return this.mediaListeners.add(this.media!)
  }

  public render() {
    this.classList.add('audio')

    if(this.message.mid !== undefined) this.dataset.mid = '' + this.message.mid
    if(this.message.peerId !== undefined) this.dataset.peerId = '' + this.message.peerId

    const doc = this.doc
    const isVoice = doc.type === 'voice' || doc.type === 'round'

    // tweb audio.ts:558-564
    this.innerHTML = `
    <div class="audio-toggle audio-ico">
      <div class="audio-play-icon">
        <div class="part one" x="0" y="0" fill="#fff"></div>
        <div class="part two" x="0" y="0" fill="#fff"></div>
      </div>
    </div>`

    const toggle = this.toggle = this.firstElementChild as HTMLElement

    const downloadDiv = this.downloadDiv = document.createElement('div')
    downloadDiv.classList.add('audio-download')

    // tweb audio.ts:571-574 — точка «не прослушано» есть у голосового и кружка,
    // но не у музыки.
    if(doc.type !== 'audio' && this.message.mediaUnread) {
      this.classList.add('is-unread')
    }

    this.onTypeLoad = isVoice ? wrapVoiceMessage(this) : wrapAudio(this)

    const audioTimeDiv = this.audioTimeDiv = this.querySelector('.audio-time') as HTMLElement
    audioTimeDiv.textContent = this.getDurationStr()

    this.middleware.onDestroy(() => this.destroy())

    // tweb: элемент слушает СВОЙ <audio>. У нас элемент один на приложение,
    // поэтому слушатели ставятся, пока трек этого узла текущий, и снимаются,
    // когда играть начали другое (см. докблок файла).
    this.unsubscribeTrack = subscribeCurrentTrack(() => this.syncCurrent())
    this.syncCurrent()

    attachClickEvent(toggle, (e) => this.onToggleClick(e), { listenerSetter: this.listenerSetter })
  }

  private isCurrent(): boolean {
    return getCurrentTrack()?.mediaId === this.doc.id
  }

  private getDurationStr(): string {
    const media = this.media
    const duration = media && media.readyState >= media.HAVE_CURRENT_DATA ? media.duration : (this.doc.duration || 0)
    return formatVideoTime(duration | 0)
  }

  private getTimeStr(): string {
    const isVoice = this.doc.type !== 'audio'
    const current = formatVideoTime(this.media ? this.media.currentTime | 0 : 0)
    return isVoice ? current + ' / ' + this.getDurationStr() : current
  }

  /** Появление/снятие подписки на медиа-элемент — аналог tweb `onLoad` (audio.ts:588). */
  private syncCurrent() {
    const current = this.isCurrent()
    if(current === !!this.media) {
      return
    }

    if(!current) {
      this.detachMedia()
      return
    }

    const media = this.media = getPlaybackMedia()

    const readyPromise = this.readyPromise = deferredPromise<void>()
    if(media.readyState >= media.HAVE_CURRENT_DATA) {
      readyPromise.resolve?.()
    } else {
      this.addAudioListener('canplay', () => readyPromise.resolve?.(), { once: true })
    }

    this.onTypeDisconnect = this.onTypeLoad()

    const onPlay = () => {
      this.audioTimeDiv.textContent = this.getTimeStr()
      this.toggle.classList.toggle('playing', !media.paused)
    }

    this.addAudioListener('play', onPlay)
    this.addAudioListener('pause', () => this.toggle.classList.remove('playing'))
    this.addAudioListener('ended', () => {
      this.toggle.classList.remove('playing')
      this.audioTimeDiv.textContent = this.getDurationStr()
    })
    this.addAudioListener('timeupdate', () => {
      this.audioTimeDiv.textContent = this.getTimeStr()
    })

    if(!media.paused || (media.currentTime > 0 && media.currentTime !== media.duration)) {
      onPlay()
    }

    this.wireStreamPreloader()
  }

  private detachMedia() {
    this.mediaListeners.removeAll()
    this.onTypeDisconnect?.()
    this.onTypeDisconnect = null
    this.readyPromise?.reject?.()
    this.readyPromise = null
    this.preloader = null
    this.media = null
    this.toggle.classList.remove('playing')
    this.classList.remove('downloading', 'corner-download')
    this.downloadDiv.remove()
    this.audioTimeDiv.textContent = this.getDurationStr()
  }

  /**
   * Кольцо ожидания потока — порт tweb-ветки `doc.supportsStreaming`
   * (audio.ts:679-712 + :748-764): пока первый кадр не готов, в `.audio-download`
   * крутится некликабельное кольцо, а по `canplay` оно снимается, узел получает
   * `downloaded` и через 200 мс (время перехода) уходит из DOM.
   * Прогресс байтов у стрима неизвестен, поэтому дуга стоит на 75%, как в tweb.
   */
  private wireStreamPreloader() {
    const media = this.media
    const readyPromise = this.readyPromise
    if(!media || !readyPromise || media.readyState >= media.HAVE_CURRENT_DATA) {
      return
    }

    this.classList.add('corner-download', 'downloading')
    this.toggle.append(this.downloadDiv)

    const preloader = this.preloader ??= constructDownloadPreloader(false)
    const deferred = deferredPromise<void>()
    deferred.notifyAll?.({ done: 75, total: 100 })
    preloader.attach(this.downloadDiv, false, deferred)

    void readyPromise.then(() => {
      deferred.resolve?.()

      if(UNMOUNT_PRELOADER) {
        this.classList.remove('downloading')
        this.downloadDiv.classList.add('downloaded')
        setTimeout(() => this.downloadDiv.remove(), 200)
      }
    }, () => {})
  }

  private onToggleClick(e: Event) {
    cancelEvent(e)

    if(this.isCurrent()) {
      this.togglePlay()
      return
    }

    // Чужое непрослушанное голосовое → снять media_unread (tweb делает это
    // отдельно, `readMessagesContents` в бабле; у нас точка снимается по факту
    // прослушивания, как и в React-ленте — `useVoiceQueue.playVoice`).
    const { mid, peerId, out, mediaUnread } = this.message
    if(mediaUnread && !out && mid !== undefined && peerId !== undefined) {
      markMediaPlayed(peerId, mid)
    }

    const { queue, index } = findMediaTargets(this)
    mediaPlayback.playQueue(queue, index)
  }

  /** tweb audio.ts:804-813 */
  public togglePlay(e?: Event, paused = this.media ? this.media.paused : true) {
    if(e) cancelEvent(e)

    if(!this.media) {
      return
    }

    if(paused) {
      safePlay(this.media)
    } else {
      this.media.pause()
    }
  }

  /**
   * Добор пиков волны метой — см. докблок `AudioElementDoc.waveform`. Байты
   * тут не качаются: это метаданные файла (`GET /media/{id}`), REST через
   * менеджер, как и любой read-путь.
   */
  public async fetchWaveform(): Promise<number[]> {
    const meta = await startClient().managers.media.meta(this.doc.id)
    return meta.waveform ? decodeTransmittedPeaks(meta.waveform) : []
  }

  /** tweb audio.ts:851-869 */
  private destroy() {
    this.unsubscribeTrack?.()
    this.unsubscribeTrack = null
    this.onTypeDisconnect?.()
    this.onTypeDisconnect = null
    this.readyPromise?.reject?.()
    this.readyPromise = null
    this.mediaListeners.removeAll()
    this.listenerSetter.removeAll()
    this.preloader = null
    this.media = null
  }
}

// Строка проводки: без регистрации тег остаётся пустым — ровно тем «визуальным
// слепком», которым он был у нас до этого порта. Держит `components/audio.test.ts`.
if(!customElements.get('audio-element')) {
  customElements.define('audio-element', AudioElement)
}
