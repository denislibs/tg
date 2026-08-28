// src/core/audio/mediaPlaybackController.ts
//
// Порт tweb `components/appMediaPlaybackController.ts` — менеджер КОЛЛЕКЦИИ
// медиа-элементов. Модель оригинала: у каждого сообщения СВОЙ <audio>/<video>
// (`addMedia` заводит его и возвращает владельцу-витрине), контроллер держит
// реестр (`media`/`mediaDetails`), знает, какой элемент сейчас играет
// (`playingMedia`), и ведёт очередь. Вопрос «играю ли я» узел задаёт СВОЕМУ
// элементу (`media.paused`), а не контроллеру, — поэтому ни гейтов «мой ли это
// трек», ни подписок на смену трека здесь нет и быть не должно.
//
// Реактивное состояние (track/queue/playing/currentTime/…) живёт отдельно в
// audioStore — это витрина для React-ленты и плашки плеера: контроллер пишет
// туда из обработчиков СВОИХ событий (play/pause/ended/timeupdate + rAF), UI
// читает. Ванильная лента (`components/audio.ts`) в стор не ходит вовсе.
//
// mediaContentUrl/resolveStreamUrl здесь — байты аудио (fetch ciphertext) и
// стрим <audio>, не картинки: Task 7 (перевод картинок на downloadMediaURL) их
// сознательно не трогает.
import { decryptMedia } from '../secret/crypto'
import { mediaContentUrl, primeMediaToken, resolveStreamUrl } from '../mediaUrl'
import IS_OPUS_SUPPORTED from '@environment/opusSupport'
import { isOggContainer, oggBytesToWavUrl, resetVoiceOpusCache, voicePlaybackUrl } from '../media/voiceOpus'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { useSettingsStore } from '../../settings'
import safePlay from '@helpers/dom/safePlay'
import animationIntersector from '@components/animationIntersector'

const RATES = [0.5, 1, 1.5, 2]

// Тип медиа для очереди/скорости — tweb PlaybackMediaType
// (appMediaPlaybackController.ts:80). У tweb их три ('voice' | 'video' | 'audio'),
// но 'video' там про медиа-вьюер, а наш вьювер держит свою скорость отдельно
// (settings.videoRate, @lib/mediaPlayer) — контроллер играет только голос и музыку.
export type PlaybackMediaType = 'voice' | 'audio'

// tweb getPlaybackMediaTypeFromMessage (appMediaPlaybackController.ts:1098-1109):
// голосовое и кружок — ОДИН тип 'voice' (одна очередь: doc.type 'voice'|'round' →
// фильтр inputMessagesFilterRoundVoice, chat/bubbles.ts:8564,8601), музыка — 'audio'.
export function playbackMediaType(track: AudioTrack | null | undefined): PlaybackMediaType {
  return track && (track.type === 'voice' || track.type === 'round') ? 'voice' : 'audio'
}

// Скорость запоминается ОТДЕЛЬНО на тип (tweb playbackRates: Record<PlaybackMediaType,
// number>, appMediaPlaybackController.ts:152-156; запись — в сеттере playbackRate,
// :256-257) и переживает перезагрузку (tweb appSettings.playbackParams,
// appDialogsManager.ts:691-698). У нас персист — settings-стор (localStorage).
function storedRate(type: PlaybackMediaType): number {
  return useSettingsStore.getState().playbackRates[type] ?? 1
}
function persistRate(type: PlaybackMediaType, rate: number): void {
  const { playbackRates, update } = useSettingsStore.getState()
  update({ playbackRates: { ...playbackRates, [type]: rate } })
}

// ── Коллекция медиа-элементов (tweb this.media / this.mediaDetails) ──────────

/** Скрытый контейнер элементов — tweb `construct()`: `display: none` в body. */
let container: HTMLElement | null = null
function mediaContainer(): HTMLElement {
  if (container) return container
  container = document.createElement('div')
  container.style.cssText = 'display: none;'
  document.body.append(container)
  return container
}

interface MediaEntry {
  media: HTMLMediaElement
  track: AudioTrack
  /**
   * Элемент ОДОЛЖЕН снаружи: видео-кружок React-ленты рисует свой <video> сам
   * (превью крутится muted в цикле, звук включает клик), поэтому контроллер
   * своего элемента для кружка не заводит, а берёт его на учёт. Аналог tweb
   * `MediaDetails.clean` (appMediaPlaybackController.ts:63, снятие с учёта —
   * в `stop`, :929-947): такой элемент уходит из коллекции, как только
   * контроллер перестал им играть, и возвращается баблу.
   * У tweb элемент кружка заводит сам контроллер (wrappers/video.ts:265), так
   * что одалживать нечего; у нас это уйдёт вместе с React-лентой (этап 7).
   */
  clean: boolean
  /** src уже проставлен (у нас URL резолвится асинхронно, у tweb — download-менеджером) */
  loaded: boolean
  /** промис проставления src — им же ждёт `playMedia` (tweb: `willBePlayed` + readyPromise) */
  src: Promise<void> | null
  unwire: () => void
}

const collection = new Map<number, MediaEntry>()
const entryOf = new WeakMap<HTMLMediaElement, MediaEntry>()

/** tweb `playingMedia` — элемент, который ведёт воспроизведение прямо сейчас. */
let playingMedia: HTMLMediaElement | null = null
/** tweb `willBePlayedMedia` (:126) — элемент, который попросили сыграть, пока грузится src. */
let willBePlayedMedia: HTMLMediaElement | null = null

function mediaDuration(media: HTMLMediaElement): number {
  return Number.isFinite(media.duration) ? media.duration || 0 : 0
}

// rAF-прогресс (порт tweb MediaProgressLine: onPlay — components/mediaProgressLine.ts:348-368,
// onTimeUpdate — :370-378, снятие кадра — :497-500). Событие timeupdate стреляет ~4 Гц,
// поэтому волна голосового и кольцо кружка дёргались; пока медиа играет, прогресс
// тикает каждый кадр, а timeupdate обновляет его только на паузе (сик/остановка).
let progressRAF: number | undefined

function syncProgress(media: HTMLMediaElement): void {
  useAudioStore.getState()._sync({
    currentTime: media.currentTime,
    duration: mediaDuration(media),
  })
}

function stopProgress(): void {
  if (progressRAF === undefined) return
  cancelAnimationFrame(progressRAF)
  progressRAF = undefined
}

// tweb r(): первый кадр — синхронно, дальше сам себя перепланирует, пока !paused
// (последний кадр после паузы дорисовывает финальную позицию и цикл гаснет).
function startProgress(media: HTMLMediaElement): void {
  stopProgress()
  const r = () => {
    syncProgress(media)
    progressRAF = media.paused ? undefined : requestAnimationFrame(r)
  }
  r()
}

// Кэш blob-URL расшифрованных секретных треков по mediaId. Нужен, чтобы к моменту
// клика URL был готов синхронно и .play() вызывался в рамках user-gesture (иначе
// await перед play() теряет активацию и play() тихо отклоняется — «нет звука»).
const secretUrlCache = new Map<number, string>()
const secretInflight = new Map<number, Promise<string>>()

// Скачать ciphertext, расшифровать → blob-URL с верным mime; кэшируется по mediaId.
export function prefetchSecretAudio(mediaId: number, secret: { keyB64: string; ivB64: string; mime: string }): Promise<string> {
  const cached = secretUrlCache.get(mediaId)
  if (cached) return Promise.resolve(cached)
  const running = secretInflight.get(mediaId)
  if (running) return running
  const job = (async () => {
    await primeMediaToken()
    const res = await fetch(mediaContentUrl(mediaId))
    if (!res.ok) throw new Error(`secret audio ${res.status}`)
    const cipher = await res.arrayBuffer()
    const buf = await decryptMedia(cipher, secret.keyB64, secret.ivB64)
    // Секретное голосовое — тот же ogg, и на платформе без ogg он так же нем.
    // Байты уже расшифрованы, скачивать нечего — сразу в декодер.
    const objectUrl = !IS_OPUS_SUPPORTED && isOggContainer(secret.mime)
      ? await oggBytesToWavUrl(new Uint8Array(buf))
      : URL.createObjectURL(new Blob([buf], { type: secret.mime }))
    secretUrlCache.set(mediaId, objectUrl)
    return objectUrl
  })()
  secretInflight.set(mediaId, job)
  void job.catch(() => {}).finally(() => secretInflight.delete(mediaId))
  return job
}

/**
 * Проставить src элементу. У tweb байты добывает download-менеджер, а
 * контроллер лишь ставит готовый `cacheContext.url` (`onMediaDocumentLoad`,
 * :510-538); у нас URL резолвится здесь — СИНХРОННО, где можем (обычный трек
 * при DNP-OFF, секретный из кэша префетча), чтобы play() остался в рамках
 * user-gesture, и промисом на редком промахе.
 *
 * ПЛАТФОРМЕННАЯ половина гейта конвертации (`!IS_OPUS_SUPPORTED` из
 * `apiFileManager.ts:670`) — здесь и только здесь. Там, где ogg играется сам
 * (Chrome, Firefox, Safari от 18.4 — это ~97% трафика), ветка ниже не
 * исполняется вовсе и подача src остаётся синхронной; форматная половина
 * (`=== 'audio/ogg'`) живёт в `core/media/voiceOpus.ts`, потому что mime знает
 * воркер и спрашивать его есть смысл только на второй половине пути.
 */
function ensureSrc(entry: MediaEntry): Promise<void> {
  if (entry.src) return entry.src
  const { track, media } = entry
  // На платформе без ogg решение зависит от mime, а mime знает воркер — синхронно
  // подать src нельзя даже при готовом токене.
  const ready = !IS_OPUS_SUPPORTED ? undefined
    : track.secret ? secretUrlCache.get(track.mediaId)
      : resolveStreamUrl(track.mediaId)
  if (typeof ready === 'string') {
    media.src = ready
    entry.loaded = true
    return (entry.src = Promise.resolve())
  }

  const job = (async () => {
    if (track.secret) {
      media.src = await prefetchSecretAudio(track.mediaId, track.secret)
      entry.loaded = true
      return
    }
    // Файл может оказаться ogg — тогда играть надо не его, а wav из декодера.
    const wav = IS_OPUS_SUPPORTED ? undefined : await voicePlaybackUrl(track.mediaId)
    media.src = wav ?? await (ready ?? resolveStreamUrl(track.mediaId))
    entry.loaded = true
  })()
  entry.src = job
  // Промах не должен залипать: следующий запуск попробует снова.
  void job.catch(() => { entry.src = null })
  return job
}

export interface AddMediaArgs {
  track: AudioTrack
  /** tweb `AddMediaArgs.autoload` (:82-105): грузить сразу или ждать первого запуска */
  autoload?: boolean
  /** одолженный элемент (видео-кружок бабла) — см. `MediaEntry.clean` */
  element?: HTMLMediaElement
}

/**
 * tweb `addMedia` (:402-503) — элемент сообщения: заводится один раз, живёт в
 * коллекции и возвращается всем, кто спросит про этот же трек.
 */
export function addMedia({ track, autoload = true, element }: AddMediaArgs): HTMLMediaElement {
  const existing = collection.get(track.mediaId)
  if (existing) {
    // Бабл пересоздал свой <video> (перемонтирование React-ленты) — переучитываем.
    if (!element || existing.media === element) return existing.media
    unregister(existing)
  }

  const media = element ?? document.createElement(track.type === 'round' ? 'video' : 'audio')
  const entry: MediaEntry = {
    media,
    track,
    clean: !!element,
    loaded: !!element,
    src: element ? Promise.resolve() : null,
    unwire: () => {},
  }
  collection.set(track.mediaId, entry)
  entryOf.set(media, entry)

  const onPlay = () => handlePlay(media)
  const onPause = () => handlePause(media)
  const onEnded = () => handleEnded(media)
  const onTimeUpdate = () => handleTimeUpdate(media)
  const onLoadedMetadata = () => {
    if (media === playingMedia) useAudioStore.getState()._sync({ duration: mediaDuration(media) })
  }
  // Ошибку загрузки/декодирования src (напр. неподдерживаемый кодек) иначе не
  // видно — .play() к тому моменту уже зарезолвился. Логируем явно для диагностики.
  const onError = () => console.error('[audio] element error', media.error?.code, media.error?.message)

  media.addEventListener('play', onPlay)
  media.addEventListener('pause', onPause)
  media.addEventListener('ended', onEnded)
  media.addEventListener('timeupdate', onTimeUpdate)
  media.addEventListener('loadedmetadata', onLoadedMetadata)
  media.addEventListener('error', onError)
  entry.unwire = () => {
    media.removeEventListener('play', onPlay)
    media.removeEventListener('pause', onPause)
    media.removeEventListener('ended', onEnded)
    media.removeEventListener('timeupdate', onTimeUpdate)
    media.removeEventListener('loadedmetadata', onLoadedMetadata)
    media.removeEventListener('error', onError)
  }

  if (!element) {
    media.volume = 1
    mediaContainer().append(media)
    if (autoload) void ensureSrc(entry)
  }

  return media
}

/** tweb `getMedia` (:505-508). */
export function getMedia(mediaId: number): HTMLMediaElement | undefined {
  return collection.get(mediaId)?.media
}

/**
 * Смена сессии (`rt:logging_out` → `client/realtime/storeProjection.ts`): элементы
 * коллекции держат URL'ы прошлой сессии — токен-стрим и blob расшифрованного
 * секретного голоса, — поэтому переход обязан снести и коллекцию, и кэш блобов.
 * У tweb отдельного сброса нет: там логаут пересобирает приложение целиком.
 */
export function resetPlayback(): void {
  mediaPlayback.close()
  // удаление текущего ключа по ходу обхода Map безопасно — он уже пройден
  for (const entry of collection.values()) unregister(entry)
  secretUrlCache.forEach((url) => URL.revokeObjectURL(url))
  secretUrlCache.clear()
  resetVoiceOpusCache()
}

/** Снять элемент с учёта (tweb `stop`, ветка `details.clean`, :930-947). */
function unregister(entry: MediaEntry): void {
  entry.unwire()
  entryOf.delete(entry.media)
  if (collection.get(entry.track.mediaId) === entry) collection.delete(entry.track.mediaId)
  if (!entry.clean) {
    entry.media.src = ''
    entry.media.remove()
  }
}

/**
 * Элемент трека для очереди. Кружок — единственный, кому контроллер элемента не
 * заводит (его рисует бабл, см. `MediaEntry.clean`): не зарегистрирован — трек
 * пропускается, как tweb пропускает элемент, которого нет.
 */
function mediaFor(track: AudioTrack): HTMLMediaElement | undefined {
  const entry = collection.get(track.mediaId)
  if (entry) return entry.media
  if (track.type === 'round') return undefined
  return addMedia({ track })
}

/**
 * Запуск конкретного элемента — tweb `playItem` (:960-974) + механика
 * `willBePlayed` (:1028-1030): пока src не проставлен, «этот элемент попросили
 * сыграть» — отдельный факт, иначе доехавшая загрузка запустила бы трек,
 * который пользователь успел переключить.
 */
function playMedia(media: HTMLMediaElement): void {
  const entry = entryOf.get(media)
  if (!entry) return
  if (entry.loaded) {
    willBePlayedMedia = null
    safePlay(media)
    return
  }

  willBePlayedMedia = media
  void ensureSrc(entry).then(() => {
    if (willBePlayedMedia !== media) return
    willBePlayedMedia = null
    safePlay(media)
  }, () => {})
}

/** tweb `setMedia` (:1112-1130) — сделать элемент текущим. */
function setMedia(entry: MediaEntry): void {
  const { media, track } = entry
  playingMedia = media

  const state = useAudioStore.getState()
  const rate = storedRate(playbackMediaType(track))
  media.playbackRate = rate
  media.muted = state.muted
  media.volume = state.volume

  // tweb ищет трек в listLoader'е и подвигает его курсор (onPlay, :770-801);
  // у нас очередь — значение в сторе, поэтому это findIndex, а трека вне
  // очереди достаточно самого себя (tweb: `setTargets({peerId, mid})`).
  let queue = state.queue
  let index = queue.findIndex((t) => t.mediaId === track.mediaId)
  if (index === -1) {
    queue = [track]
    index = 0
  }

  useAudioStore.setState({
    queue,
    index,
    track,
    rate,
    currentTime: media.currentTime,
    duration: mediaDuration(media),
  })
}

/**
 * tweb `stop` (:917-958): пауза, перемотка в начало и СИМУЛИРОВАННЫЙ `ended` —
 * им узел сообщения прячет свои контролы (комментарий «! important» у
 * оригинала).
 */
function stop(media = playingMedia): boolean {
  if (!media) return false

  const entry = entryOf.get(media)
  // Одолженный элемент снимаем с учёта ДО симуляции `ended` (у tweb это тоже
  // `stop`, но порядок неважен — элемент его собственный): наш бабл на `ended`
  // возвращает кружок в muted-превью и снова зовёт play(), и этот play не
  // должен вернуться к нам как «кружок опять текущий».
  if (entry?.clean) unregister(entry)

  if (!media.paused) media.pause()
  media.currentTime = 0
  simulateEnded(media)

  if (media === playingMedia) playingMedia = null
  if (willBePlayedMedia === media) willBePlayedMedia = null
  return true
}

/**
 * tweb отличает свой `ended` от настоящего по `e.isTrusted` (:830-833). В тестах
 * ЛЮБОЕ событие нетрастовое, поэтому тот же факт («этот ended дослали мы»)
 * держит флаг — семантика и место проверки те же.
 */
let simulatedEnded = false
function simulateEnded(media: HTMLMediaElement): void {
  simulatedEnded = true
  media.dispatchEvent(new Event('ended'))
  simulatedEnded = false
}

// ── Обработчики событий элементов коллекции (tweb onPlay/onPause/onEnded) ────

/** tweb `onPlay` (:752-813). */
function handlePlay(media: HTMLMediaElement): void {
  const entry = entryOf.get(media)
  if (!entry) return

  if (willBePlayedMedia === media) willBePlayedMedia = null

  // tweb appMediaPlaybackController.ts:265-269 — поехал КРУЖОК: на это время
  // все зарегистрированные видео (видео-стикеры, гифки ленты) встают, чтобы
  // рядом с говорящей головой ничего не дёргалось.
  if (entry.track.type === 'round') {
    animationIntersector.toggleMediaPause(false)
  }

  if (playingMedia !== media) {
    stop() // предыдущий трек останавливается ровно здесь
    setMedia(entry)
  }

  useAudioStore.getState()._sync({
    playing: true,
    currentTime: media.currentTime,
    duration: mediaDuration(media),
  })
  startProgress(media)
}

/** tweb `onPause` (:815-828). */
function handlePause(media: HTMLMediaElement): void {
  // tweb :271-273 — снятие запрета безусловно (не только для кружка): оригинал
  // вешает это на событие 'pause' контроллера, а `toggleMediaPause(true)` сам
  // ничего не делает, если запрета не было.
  animationIntersector.toggleMediaPause(true)

  if (media !== playingMedia) return
  stopProgress()
  useAudioStore.getState()._sync({ playing: false, currentTime: media.currentTime })
}

/** tweb `onEnded` (:830-849): доиграли — едем по очереди, кончилась — стоп. */
function handleEnded(media: HTMLMediaElement): void {
  if (simulatedEnded) return
  if (media !== playingMedia) return

  handlePause(media)

  const entry = entryOf.get(media)
  if (entry?.clean) unregister(entry)

  if (!go(1)) mediaPlayback.close()
}

function handleTimeUpdate(media: HTMLMediaElement): void {
  if (media !== playingMedia) return
  // Пока играет, прогресс тикает по rAF; timeupdate нужен на паузе (сик).
  if (media.paused) syncProgress(media)
}

/** tweb `go` (:976-987) — шаг по очереди; вернёт false, если идти некуда. */
function go(delta: 1 | -1): boolean {
  const { queue, index } = useAudioStore.getState()
  for (let j = index + delta; j >= 0 && j < queue.length; j += delta) {
    const media = mediaFor(queue[j])
    if (!media) continue
    playMedia(media)
    return true
  }
  return false
}

// Императивный контроллер: методы вызывают делегаты audioStore (публичный API
// плеера не меняется), а витрину обновляют через set/_sync.
export const mediaPlayback = {
  addMedia,
  getMedia,
  /** tweb `setTargets` (:1051-1096) — объявить плейлист, не начиная играть. */
  setTargets(queue: AudioTrack[], index: number): void {
    useAudioStore.setState({ queue, index })
  },
  /** Запустить элемент (tweb: `safePlay(this.audio)` из узла сообщения). */
  playMedia(media: HTMLMediaElement): void {
    playMedia(media)
  },
  playQueue(queue: AudioTrack[], index: number): void {
    const track = queue[index]
    if (!track) return
    useAudioStore.setState({ queue, index })
    const media = mediaFor(track)
    if (media) playMedia(media)
  },
  playExternal(queue: AudioTrack[], index: number, media: HTMLMediaElement): void {
    const track = queue[index]
    if (!track) return
    useAudioStore.setState({ queue, index })
    addMedia({ track, element: media })
    // Бабл уже начал играть — событие 'play' прошло до регистрации, поэтому
    // обработчик зовём руками (tweb делает так же в `setSingleMedia`, :1156-1158).
    if (!media.paused) handlePlay(media)
    else playMedia(media)
  },
  /** tweb `toggle` (:860-880). */
  toggle(): void {
    const media = playingMedia
    if (!media) return
    if (media.paused) playMedia(media)
    else media.pause()
  },
  seekFraction(f: number): void {
    const media = playingMedia
    if (!media) return
    const d = mediaDuration(media) || useAudioStore.getState().duration
    if (d > 0) {
      media.currentTime = Math.max(0, Math.min(1, f)) * d
      useAudioStore.setState({ currentTime: media.currentTime })
    }
  },
  cycleRate(): void {
    mediaPlayback.setRate(RATES[(RATES.indexOf(useAudioStore.getState().rate) + 1) % RATES.length])
  },
  setRate(r: number): void {
    if (playingMedia) playingMedia.playbackRate = r
    useAudioStore.setState({ rate: r })
    persistRate(playbackMediaType(useAudioStore.getState().track), r)
  },
  toggleMute(): void {
    const m = !useAudioStore.getState().muted
    if (playingMedia) playingMedia.muted = m
    useAudioStore.setState({ muted: m })
  },
  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v))
    if (playingMedia) {
      playingMedia.volume = vol
      playingMedia.muted = vol === 0
    }
    useAudioStore.setState({ volume: vol, muted: vol === 0 })
  },
  /** tweb `next` (:1006-1008). */
  next(): void {
    go(1)
  },
  /** tweb `previous`/`seekToStart` (:1010-1026): дальше 5-й секунды — в начало трека. */
  prev(): void {
    const media = playingMedia
    if (media && media.currentTime > 5) {
      media.currentTime = 0
      useAudioStore.setState({ currentTime: 0 })
      if (media.paused) playMedia(media)
      return
    }
    go(-1)
  },
  close(): void {
    stop()
    stopProgress()
    useAudioStore.setState({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
  },
}
