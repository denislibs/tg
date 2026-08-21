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
 * события (`addAudioListener`). Здесь так же: `addMedia({track})` отдаёт узлу
 * СВОЙ элемент этого сообщения, а весь UI (кнопка, время, волна, полоса) висит
 * на его событиях. Никакого чтения zustand-стора и никаких вопросов
 * контроллеру «мой ли сейчас трек»: на это отвечает `this.media.paused`.
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
 *   • обложка трека (`doc.thumbs` → `wrapPhoto`, `audio-with-thumb`) — ступени
 *     аудиофайла наш бэкенд не производит (`domain/mtmedia.go::thumbs` строит их
 *     из stripped-превью, которого у аудио нет), так что ветка была бы мёртвой;
 *   • `appMediaPlaybackController.setSearchContext/setTargets/isSafariBuffering`
 *     и `willBePlayed`-механика Safari — у нашего контроллера другой контракт
 *     (очередь передаётся значением, см. `findMediaTargets` ниже);
 *   • ветка аплоада (`uploadingFileName`) — прогресс отдачи живёт в
 *     `stores/uploadsStore` и приезжает в бабл отдельно; это отдельный этап.
 */
import { mediaPlayback } from '@core/audio/mediaPlaybackController'
import type { DocumentAttributeAudio, MyDocument } from '@core/media/messageMedia'
import type { AudioTrack } from '@stores/audioStore'
import { decodeTransmittedPeaks, buildWaveformBars, WAVEFORM_BAR_WIDTH, WAVEFORM_BAR_MARGIN, WAVEFORM_HEIGHT } from '@core/audio/waveform'
import { markMediaPlayed } from '@core/mediaRead'
import { RT } from '@core/realtime/events'
import rootScope from '@lib/rootScope'
import ProgressivePreloader from '@components/preloader'
import MediaProgressLine from '@components/mediaProgressLine'
import { MiddleEllipsisElement } from '@components/middleEllipsis'
import { formatVideoTime } from '@components/messages/videoPlayback'
import { animateSingle } from '@helpers/animation'
import throttleWithRaf from '@helpers/schedulers/throttleWithRaf'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import makeError from '@helpers/makeError'
import noop from '@helpers/noop'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import ListenerSetter, { type Listener } from '@helpers/listenerSetter'
import type { Middleware } from '@helpers/middleware'
import { formatBytes } from '@core/mediaCache'
import { useI18nStore } from '../i18n'

const UNMOUNT_PRELOADER = true

/**
 * Строка проводки (порт tweb audio.ts:47-54): прочтение медиа снимает точку
 * «не прослушано» со ВСЕХ живых узлов этого сообщения. Ссылки на элемент ни у
 * кого нет — поэтому поиск по DOM, и поэтому же тег обязан быть настоящим.
 * Держит `components/audio.test.ts`.
 */
rootScope.addEventListener(RT.mediaRead, (evt) => {
  const selector = `audio-element.is-unread[data-mid="${evt.id}"][data-peer-id="${evt.peer_id}"]`
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    element.classList.remove('is-unread')
  })
})

/** tweb audio.ts:159/352 — ID3-теги и пики живут в атрибуте, а не в самом файле. */
function getAudioAttribute(doc: MyDocument): DocumentAttributeAudio | undefined {
  return doc.attributes?.find((attribute) => attribute._ === 'documentAttributeAudio')
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

  // tweb audio.ts:159-162 — пики берутся из атрибута документа и идут прямо в
  // `createWaveformBars`. Ни запроса меты, ни перерисовки на месте: волна готова
  // к первому кадру. Пиков нет — волны нет и файл ради неё не качается.
  const waveform = getAudioAttribute(doc)?.waveform
  const { svg, container: svgContainer, availW } = createWaveformBars(
    waveform ? decodeTransmittedPeaks(waveform) : [],
    doc.duration || 0,
  )

  let fakeSvgContainer: HTMLElement | undefined
  if(svgContainer) {
    fakeSvgContainer = svgContainer.cloneNode(true) as HTMLElement
    fakeSvgContainer.classList.add('audio-waveform-fake')
    svgContainer.classList.add('audio-waveform-background')
  }

  const waveformContainer = document.createElement('div')
  waveformContainer.classList.add('audio-waveform-container')
  if(svgContainer && fakeSvgContainer) {
    waveformContainer.append(svgContainer, fakeSvgContainer)
  }

  const timeDiv = document.createElement('div')
  timeDiv.classList.add('audio-time')
  audioEl.append(waveformContainer, timeDiv)

  // tweb вешает скраб на сам `<svg>` фоновой волны (audio.ts:275-324; клон
  // `.audio-waveform-fake` — `pointer-events: none`, `_audio.scss:390-399`).
  // Драг-версия (mousedown/mousemove с паузой на время перетаскивания) не
  // портирована — остался клик, как и в React-версии. Двигается СВОЁ медиа
  // (tweb `scrub`: `setCurrentTime(audio, offsetX / availW * audio.duration)`).
  const onScrub = (e: Event) => {
    cancelEvent(e)
    const media = audioEl.media
    if(!media.duration) return
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    const fraction = ((e as MouseEvent).clientX - rect.left) / (rect.width || availW)
    let scrubTime = Math.max(0, Math.min(1, fraction)) * media.duration
    // tweb audio.ts:318-320: ровно `duration` — это конец, браузер тут же шлёт
    // `ended` и узел сбрасывается в «не проигрывалось» вместо перемотки в хвост.
    if(media.duration && scrubTime >= media.duration) {
      scrubTime = media.duration - 0.01
    }
    media.currentTime = scrubTime
  }

  if(svg) {
    audioEl.listenerSetter.add(svg)('click', onScrub as EventListener)
  }

  // tweb audio.ts:239-244 — ПИКОВ НЕТ (голосовое из старого клиента, запись без
  // волны): вместо волны рисуется обычная полоса прогресса прямо в контейнере
  // волны. Без этой ветки узел оставался с пустым контейнером — ни волны, ни
  // полосы, и по голосовому нечем было ни следить, ни перематывать.
  let progressLine: MediaProgressLine | undefined
  if(!svg) {
    progressLine = new MediaProgressLine()
    waveformContainer.append(progressLine.container)
  }

  const onLoad = () => {
    const media = audioEl.media

    const onTimeUpdate = () => {
      if(fakeSvgContainer && media.duration) {
        fakeSvgContainer.style.width = (media.currentTime / media.duration * 100) + '%'
      }
    }

    // rAF-цикл гаснет по `!media.paused` СВОЕГО медиа (tweb audio.ts:252-258):
    // чужой трек играет на своём элементе и этот цикл не кормит.
    const setAnimation = () => {
      void animateSingle(() => {
        onTimeUpdate()
        return !media.paused
      }, audioEl)
    }

    if(!media.paused || (media.currentTime > 0 && media.currentTime !== media.duration)) {
      onTimeUpdate()
    }

    // tweb audio.ts:270-272 — `timeupdate` прилетает чаще кадра, и каждый его
    // приход двигает ширину клона волны, то есть заставляет браузер считать
    // раскладку. Дросселем служит сам кадр (`throttleWithRaf`), а не таймер.
    const throttledTimeUpdate = throttleWithRaf(onTimeUpdate)
    audioEl.addAudioListener('timeupdate', throttledTimeUpdate)
    audioEl.addAudioListener('ended', throttledTimeUpdate)
    audioEl.addAudioListener('play', setAnimation)

    // tweb audio.ts:325-329 — полоса-заменитель волны узнаёт своё медиа только
    // здесь: до `addMedia` элемента ещё нет. `streamable` — см. `wireStreamPreloader`.
    progressLine?.setMedia({ media, streamable: true, duration: doc.duration })

    // tweb audio.ts:332-336 — отключение бывает ровно один раз, при смерти узла.
    return () => {
      progressLine?.removeListeners()
      waveformContainer.textContent = ''
      fakeSvgContainer = undefined
    }
  }

  return onLoad
}

/** tweb audio.ts:342-444 — музыкальный трек: название, подпись, полоса прогресса. */
function wrapAudio(audioEl: AudioElement): () => (() => void) {
  const doc = audioEl.doc
  const t = useI18nStore.getState().t

  const descriptionEl = document.createElement('div')
  descriptionEl.classList.add('audio-description')

  const audioAttribute = getAudioAttribute(doc)

  // tweb audio.ts:354-371: части описания — [performer]; размер файла идёт
  // ТОЛЬКО когда частей нет. Строка всегда начинается с ' • '.
  const parts: string[] = []
  if(audioAttribute?.performer) parts.push(audioAttribute.performer)
  if(!parts.length) parts.push(formatBytes(doc.size, t))
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
  middleEllipsisEl.textContent = audioAttribute?.title ?? doc.file_name ?? ''
  titleEl.append(middleEllipsisEl)

  subtitleDiv.append(descriptionEl)

  const onLoad = () => {
    const media = audioEl.media

    let launched = false
    const progressLine = new MediaProgressLine()
    // tweb audio.ts:405-409 `streamable: doc.supportsStreaming` — под полосой
    // прогресса рисуется вторая, «сколько уже буферизовано», и она же вешает
    // слушатель `progress`. У нас стримится ЛЮБОЕ медиа (медиа-эндпоинт отдаёт
    // файл через `http.ServeContent`, разбор — в шапке `wrappers/video.ts`),
    // поэтому терм вырождается в константу, а не пропадает.
    progressLine.setMedia({ media, streamable: true, duration: doc.duration })

    // tweb audio.ts:412-434: описание и полоса меняются местами через
    // `subtitleDiv.lastChild` — на конце трека (в т.ч. на симулированном
    // контроллером `ended`, которым он останавливает предыдущий) подпись
    // возвращается, и следующий запуск снова подменяет ОПИСАНИЕ, а не время.
    audioEl.addAudioListener('ended', () => {
      // Конец трека приходит дважды: настоящий и досланный контроллером в `stop`
      // (tweb там тоже дважды — у него второй обмен вырождается в замену узла
      // самим собой). Меняем местами по флагу запуска, а не по узлу подписи.
      if(!launched) return
      audioEl.classList.remove('audio-show-progress')
      subtitleDiv.lastChild?.replaceWith(descriptionEl)
      launched = false
    })

    const onPlay = () => {
      if(launched) return
      audioEl.classList.add('audio-show-progress')
      launched = true
      subtitleDiv.lastChild?.replaceWith(progressLine.container)
    }

    audioEl.addAudioListener('play', onPlay)

    if(!media.paused || media.currentTime > 0) {
      onPlay()
    }

    // tweb audio.ts:436-440 — отключение бывает один раз, при смерти узла.
    return () => {
      progressLine.removeListeners()
      progressLine.container.remove()
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

/** Узел ленты, который умеет отдать свой трек плееру: `audio-element` и кружок
 *  (`.media-round`, его заводит `wrappers/video.ts`). В tweb очередь — это пары
 *  `{peerId, mid}`, и трек по ним догружает сам контроллер; наш контроллер
 *  принимает очередь ЗНАЧЕНИЕМ, поэтому трек несёт узел. */
export interface MediaTargetElement extends HTMLElement {
  track: AudioTrack
}

/**
 * Плейлист соседей — порт tweb `findMediaTargets` (audio.ts:458-498): «следующее
 * голосовое» определяется ПОРЯДКОМ УЗЛОВ в ленте, а не заранее собранным
 * массивом.
 *
 * Селектор — дословный (tweb :464-478), с двумя термами, которых у нас не было:
 *   • `.media-round` — КРУЖКИ идут в ту же очередь, что голосовые
 *     (`inputMessagesFilterRoundVoice`): после голосового автоматически играет
 *     следующий кружок и наоборот. Без него очередь обрывалась на первом же
 *     кружке;
 *   • префикс `.bubble:not(.webpage)` — узел внутри превью ссылки в очередь не
 *     идёт (голосовое/кружок из карточки чужого поста не «следующий трек»).
 * `:not([data-is-outgoing="1"])` — тоже из оригинала: у ещё не отправленного
 * сообщения нет серверного `mid`, ему в очереди делать нечего (наш кружок этот
 * атрибут ставит, `wrappers/video.ts::wrapRound`).
 *
 * Отличия от оригинала: нет ветки `search-super-item` (панели shared media,
 * играющей звук, у нас нет — контейнер всегда `bubbles-inner`), нет фильтра
 * `data-to-be-skipped` (его ставит транскрибация, не портированная) и нет
 * разворота пары `prev/next` для ленты, идущей в обратном порядке: очередь у
 * нас — один массив в порядке узлов плюс индекс якоря, а не две половины.
 */
export function findMediaTargets(anchor: MediaTargetElement): { queue: AudioTrack[], index: number } {
  const container = findUpClassName(anchor, 'bubbles-inner')
  if(!container) {
    return { queue: [anchor.track], index: 0 }
  }

  const attr = ':not([data-is-outgoing="1"])'
  const justAudioSelector = `audio-element.audio:not(.is-voice)${attr}`
  // Голосовые и кружки — одна очередь; музыка — своя (tweb :467-471).
  const selectors = anchor.matches(justAudioSelector) ?
    [justAudioSelector] :
    [`audio-element.audio.is-voice${attr}`, `.media-round${attr}`]

  const prefix = '.bubble:not(.webpage) '
  const selector = selectors.map((s) => prefix + s).join(', ')

  const elements = Array.from(container.querySelectorAll<MediaTargetElement>(selector))
  const index = elements.indexOf(anchor)
  if(index === -1) {
    return { queue: [anchor.track], index: 0 }
  }

  return { queue: elements.map((element) => element.track), index }
}

export default class AudioElement extends HTMLElement {
  public doc!: MyDocument
  public message: AudioElementMessage = {}
  public middleware!: Middleware
  /** трек для плеера — этот же узел отдаёт его в плейлист (`findMediaTargets`) */
  public track!: AudioTrack
  /** СВОЙ медиа-элемент этого сообщения (tweb `this.audio` = результат `addMedia`) */
  public media!: HTMLMediaElement

  /** слушатели узла и его медиа — живут всё время жизни элемента (tweb 1:1) */
  public listenerSetter = new ListenerSetter()
  private onTypeDisconnect: (() => void) | null = null
  private toggle!: HTMLElement
  private downloadDiv!: HTMLElement
  private audioTimeDiv!: HTMLElement
  private readyPromise: CancellablePromise<void> | null = null
  private preloader: ProgressivePreloader | null = null

  /** tweb `addAudioListener` (audio.ts:847-849) */
  public get addAudioListener() {
    return this.listenerSetter.add(this.media)
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

    const onTypeLoad = isVoice ? wrapVoiceMessage(this) : wrapAudio(this)

    const audioTimeDiv = this.audioTimeDiv = this.querySelector('.audio-time') as HTMLElement
    audioTimeDiv.textContent = this.getDurationStr()

    this.middleware.onDestroy(() => this.destroy())

    // tweb `onLoad` (audio.ts:588-639): узел берёт у контроллера СВОЙ элемент и
    // дальше слушает только его. `autoload` — как в оригинале (audio.ts:664):
    // голосовое грузится сразу, музыка — по первому запуску.
    const media = this.media = mediaPlayback.addMedia({ track: this.track, autoload: doc.type !== 'audio' })

    const readyPromise = this.readyPromise = deferredPromise<void>()
    if(media.readyState >= media.HAVE_CURRENT_DATA) {
      readyPromise.resolve?.()
    } else {
      this.addAudioListener('canplay', () => readyPromise.resolve?.(), { once: true })
    }

    this.onTypeDisconnect = onTypeLoad()

    const onPlay = () => {
      this.audioTimeDiv.textContent = this.getTimeStr()
      this.toggle.classList.toggle('playing', !media.paused)
    }

    if(!media.paused || (media.currentTime > 0 && media.currentTime !== media.duration)) {
      onPlay()
    }

    this.addAudioListener('play', onPlay)
    this.addAudioListener('pause', () => this.toggle.classList.remove('playing'))
    this.addAudioListener('ended', () => {
      this.toggle.classList.remove('playing')
      this.audioTimeDiv.textContent = this.getDurationStr()
    })
    this.addAudioListener('timeupdate', () => {
      // tweb audio.ts:630: перемотка в начало на остановке — не «прослушивание».
      if(!media.currentTime && media.paused) return
      this.audioTimeDiv.textContent = this.getTimeStr()
      this.markPlayed()
    })

    attachClickEvent(toggle, (e) => this.togglePlay(e), { listenerSetter: this.listenerSetter })
    this.wireStreamPreloader()
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

  /**
   * Чужое непрослушанное голосовое: точка снимается по первому реальному
   * движению времени — tweb вешает ровно такой `timeupdate`-once в `addMedia`
   * (appMediaPlaybackController.ts:452-456), но зовёт `readMessages` менеджера;
   * у нас тот же смысл несёт `markMediaPlayed`.
   */
  private played = false
  private markPlayed() {
    if(this.played) return
    const { mid, peerId, out, mediaUnread } = this.message
    if(this.doc.type === 'audio' || !mediaUnread || out || mid === undefined || peerId === undefined) return
    this.played = true
    markMediaPlayed(peerId, mid)
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
    if(!readyPromise || media.readyState >= media.HAVE_CURRENT_DATA) {
      return
    }

    // tweb вешает кольцо на первый `play` (audio.ts:683-708), а не на монтирование:
    // в ленте десятки голосовых, крутиться должно у того, что запустили.
    const attach = () => {
      this.listenerSetter.remove(playListener)
      if(media.readyState >= media.HAVE_CURRENT_DATA) return

      this.classList.add('corner-download', 'downloading')
      this.toggle.append(this.downloadDiv)

      const preloader = this.preloader ??= constructDownloadPreloader(false)
      const deferred = deferredPromise<void>()
      deferred.notifyAll?.({ done: 75, total: 100 })
      // tweb audio.ts:688-698. Крестик кольца зовёт `promise.cancel()`
      // (`components/preloader.ts`), а у `deferredPromise` этого метода НЕТ —
      // его определяет тот, кто кольцо завёл. Без определения крестик был
      // пустышкой: нажатие не делало ничего. Отмена = реджект дефера, а его
      // `catch` останавливает само воспроизведение (ждать больше нечего).
      void deferred.catch(() => {
        this.media.pause()
      })
      deferred.cancel = () => {
        deferred.cancel = noop
        deferred.reject?.(makeError('CANCELED'))
      }
      preloader.attach(this.downloadDiv, false, deferred)

      // tweb audio.ts:700-702 — пауза во время ожидания потока тоже снимает
      // кольцо: пользователь передумал ждать.
      pauseListener = this.addAudioListener('pause', () => {
        deferred.cancel?.()
      }, { once: true }) as unknown as Listener

      void readyPromise.then(() => {
        deferred.resolve?.()

        if(UNMOUNT_PRELOADER) {
          this.classList.remove('downloading')
          this.downloadDiv.classList.add('downloaded')
          setTimeout(() => this.downloadDiv.remove(), 200)
        }
      }, () => {})
    }

    // tweb audio.ts:708 — `const playListener: any = this.addAudioListener(...)`:
    // тип-хелпер объявлен как `addEventListener` (void), сам сеттер возвращает Listener.
    let pauseListener: Listener | undefined
    const playListener = this.addAudioListener('play', attach) as unknown as Listener
    void readyPromise.then(() => {
      this.listenerSetter.remove(playListener)
      if(pauseListener) this.listenerSetter.remove(pauseListener)
    }, () => {})
  }

  /** tweb audio.ts:804-813 */
  public togglePlay(e?: Event, paused = this.media.paused) {
    if(e) cancelEvent(e)

    if(paused) {
      this.setTargets()
      // tweb: `safePlay(this.audio)` — байты к этому моменту уже добыты
      // download-менеджером. У нас src резолвит контроллер (`playMedia`), он же
      // держит «этот элемент попросили сыграть» на время резолва.
      mediaPlayback.playMedia(this.media)
    } else {
      this.media.pause()
    }
  }

  /**
   * tweb `setTargetsIfNeeded` (audio.ts:815-828): перед запуском узел объявляет
   * контроллеру плейлист вокруг себя. У tweb он передаёт пары `{peerId, mid}` и
   * сверяется с searchContext'ом, у нас очередь идёт значением — сверять нечего.
   */
  private setTargets() {
    const { queue, index } = findMediaTargets(this)
    mediaPlayback.setTargets(queue, index)
  }

  /** tweb audio.ts:851-869 */
  private destroy() {
    this.onTypeDisconnect?.()
    this.onTypeDisconnect = null
    this.readyPromise?.reject?.()
    this.readyPromise = null
    this.listenerSetter.removeAll()
    this.preloader = null
  }
}

// Строка проводки: без регистрации тег остаётся пустым — ровно тем «визуальным
// слепком», которым он был у нас до этого порта. Держит `components/audio.test.ts`.
if(!customElements.get('audio-element')) {
  customElements.define('audio-element', AudioElement)
}
