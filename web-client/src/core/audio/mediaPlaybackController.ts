// src/core/audio/mediaPlaybackController.ts
//
// Императивный движок воспроизведения (порт tweb appMediaPlaybackController):
// владеет общим <audio>-элементом, подключением внешнего элемента (видео-кружок),
// кэшем расшифрованных секретных треков и логикой play/pause/seek/rate/очереди.
// Реактивное состояние (track/queue/playing/currentTime/…) живёт отдельно в
// audioStore — движок его обновляет через set/_sync, UI читает оттуда. Это
// разводит «железо» (медиа-элемент) и стейт, как в tweb.
// mediaContentUrl здесь — байты аудио (fetch ciphertext) и стрим <audio>, не
// картинки: Task 7 (перевод картинок на downloadMediaURL) их сознательно не трогает.
import { decryptMedia } from '../secret/crypto'
import { mediaContentUrl, primeMediaToken, resolveStreamUrl } from '../mediaUrl'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'
import { useSettingsStore } from '../../settings'

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

// A single shared <audio> element drives normal playback.
let el: HTMLAudioElement | null = null
function audio(): HTMLAudioElement {
  if (el) return el
  el = new Audio()
  // Ошибку загрузки/декодирования src (напр. неподдерживаемый кодек) иначе не
  // видно — .play() к тому моменту уже зарезолвился. Логируем явно для диагностики.
  el.addEventListener('error', () => console.error('[audio] element error', el?.error?.code, el?.error?.message))
  el.addEventListener('timeupdate', () => { if (!external && el!.paused) syncProgress(el!) })
  el.addEventListener('loadedmetadata', () => { if (!external) useAudioStore.getState()._sync({ duration: el!.duration || 0 }) })
  el.addEventListener('play', () => { if (!external) { useAudioStore.getState()._sync({ playing: true }); startProgress(el!) } })
  el.addEventListener('pause', () => { if (!external) { stopProgress(); useAudioStore.getState()._sync({ playing: false, currentTime: el!.currentTime }) } })
  el.addEventListener('ended', () => { if (!external) { stopProgress(); mediaPlayback.next() } })
  return el
}

// rAF-прогресс (порт tweb MediaProgressLine: onPlay — components/mediaProgressLine.ts:348-368,
// onTimeUpdate — :370-378, снятие кадра — :497-500). Событие timeupdate стреляет ~4 Гц,
// поэтому волна голосового и кольцо кружка дёргались; пока медиа играет, прогресс
// тикает каждый кадр, а timeupdate обновляет его только на паузе (сик/остановка).
let progressRAF: number | undefined

function syncProgress(media: HTMLMediaElement): void {
  useAudioStore.getState()._sync({
    currentTime: media.currentTime,
    duration: Number.isFinite(media.duration) ? media.duration || 0 : 0,
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

// Attached external element (round-video bubble) + its listener teardown.
let external: HTMLMediaElement | null = null
let unwireExternal: (() => void) | null = null

// Кружки, смонтированные в ленте: mediaId → «сыграй меня со звуком». Кружок играет
// СВОИМ <video> внутри бабла (tweb: элемент регистрируется в контроллере через
// addMedia, а очередь запускает его playItem → media.play(),
// appMediaPlaybackController.ts:959-973), поэтому очередь дёргает бабл, а тот уже
// зовёт playExternal со своим элементом.
const roundPlayers = new Map<number, () => void>()

/** Регистрация кружка в контроллере на время жизни бабла; возвращает отписку. */
export function registerRoundMedia(mediaId: number, play: () => void): () => void {
  roundPlayers.set(mediaId, play)
  return () => {
    if (roundPlayers.get(mediaId) === play) roundPlayers.delete(mediaId)
  }
}

// Элемент, которым сейчас управляют кнопки плеера.
function current(): HTMLMediaElement {
  return external ?? audio()
}

// ── Ванильный доступ к воспроизведению (для императивной ленты) ─────────────
// tweb `AudioElement` не знает ни про какое реактивное состояние: он берёт СВОЙ
// медиа-элемент у контроллера (`appMediaPlaybackController.addMedia({message})`,
// audio.ts:591) и дальше слушает его же события (`addAudioListener`,
// audio.ts:847-849). Порт обязан работать так же — иначе прогресс волны и
// подпись времени поедут через сторовые ре-рендеры, которых в ленте нет.
//
// Отличие от оригинала (следствие нашей модели, не вкусовщина): у tweb <audio>
// СВОЙ на каждое сообщение, поэтому `audio.paused` сам по себе отвечает «играю
// ли я». У нас элемент один на приложение (плюс внешний <video> кружка), значит
// «мой ли он сейчас» — отдельный факт, и его объявляет владелец: `currentTrack`
// + подписка ниже. Второго состояния это не заводит — `subscribeCurrentTrack`
// читает ровно ту запись, которую контроллер и так делает в стор.

/** Медиа-элемент, который сейчас ведёт воспроизведение (tweb — результат `addMedia`). */
export function getPlaybackMedia(): HTMLMediaElement {
  return current()
}

/** Трек, который сейчас в плеере (`null` — плеер пуст). */
export function getCurrentTrack(): AudioTrack | null {
  return useAudioStore.getState().track
}

/** Подписка на СМЕНУ текущего трека; возвращает отписку. */
export function subscribeCurrentTrack(cb: (track: AudioTrack | null) => void): () => void {
  return useAudioStore.subscribe((s, p) => {
    if (s.track !== p.track) cb(s.track)
  })
}

// Отцепить внешний элемент (опционально ставя его на паузу).
function detachExternal(pause: boolean) {
  if (!external) return
  stopProgress()
  if (pause) external.pause()
  unwireExternal?.()
  unwireExternal = null
  external = null
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
    const objectUrl = URL.createObjectURL(new Blob([buf], { type: secret.mime }))
    secretUrlCache.set(mediaId, objectUrl)
    return objectUrl
  })()
  secretInflight.set(mediaId, job)
  void job.catch(() => {}).finally(() => secretInflight.delete(mediaId))
  return job
}

// Load + play a track. src выставляем СИНХРОННО в рамках жеста, где можем: обычный
// трек — синхронный media-URL (токен уже primed фидом), секретный — из кэша
// префетча. Только при промахе кэша/токена уходим в await (активация может
// теряться, но это редкий путь).
async function load(track: AudioTrack, autoplay: boolean) {
  const a = audio()
  let url: string
  if (track.secret) {
    url = secretUrlCache.get(track.mediaId) ?? await prefetchSecretAudio(track.mediaId, track.secret)
  } else {
    const resolved = resolveStreamUrl(track.mediaId)
    url = typeof resolved === 'string' ? resolved : await resolved
  }
  a.src = url
  // tweb setMedia (:1113-1121): скорость берётся из playbackRates[тип трека].
  a.playbackRate = useAudioStore.getState().rate
  a.muted = useAudioStore.getState().muted
  a.volume = useAudioStore.getState().volume
  if (autoplay) await a.play().catch((e) => console.error('[audio] play() failed', e))
}

// Перевести очередь на индекс i и запустить трек (dir — направление обхода при
// пропуске). Кружок играет своим <video> в бабле: зовём зарегистрированный
// «сыграй со звуком», а бабл сам вернётся сюда через playExternal. Если бабл не
// смонтирован (кружок уехал из окна ленты) — трек пропускаем, как tweb пропускает
// элемент, для которого нет медиа.
function goTo(i: number, dir: 1 | -1): void {
  const { queue } = useAudioStore.getState()
  for (let j = i; j >= 0 && j < queue.length; j += dir) {
    const track = queue[j]
    if (track.type === 'round') {
      const play = roundPlayers.get(track.mediaId)
      if (!play) continue
      useAudioStore.setState({ index: j, track, currentTime: 0, duration: 0, rate: storedRate('voice') })
      play()
      return
    }
    detachExternal(true)
    useAudioStore.setState({ index: j, track, currentTime: 0, duration: 0, rate: storedRate(playbackMediaType(track)) })
    void load(track, true)
    return
  }
  // Очередь кончилась — tweb onEnded зовёт stop() + dispatch('stop')
  // (appMediaPlaybackController.ts:838-846), по которому прячется плашка плеера
  // (chat/audio.tsx:258,272). У нас «спрятать плашку» = сброс track/queue в close().
  mediaPlayback.close()
}

// Императивный контроллер: методы вызывают делегаты audioStore (публичный API
// плеера не меняется), а стейт обновляют через set/_sync.
export const mediaPlayback = {
  playQueue(queue: AudioTrack[], index: number): void {
    if (!queue[index]) return
    useAudioStore.setState({ queue, index: -1 })
    goTo(index, 1)
  },
  playExternal(queue: AudioTrack[], index: number, media: HTMLMediaElement): void {
    const track = queue[index]
    if (!track) return
    // предыдущий источник (внутренний audio или другой кружок) — на паузу
    if (external && external !== media) detachExternal(true)
    else if (!external) audio().pause()
    unwireExternal?.()
    const onPlay = () => { useAudioStore.getState()._sync({ playing: true }); startProgress(media) }
    const onPause = () => { stopProgress(); useAudioStore.getState()._sync({ playing: false, currentTime: media.currentTime }) }
    const onTimeUpdate = () => { if (media.paused) syncProgress(media) }
    // кружок докручен до конца — едем по общей очереди voice+round дальше
    // (tweb onEnded → next(), appMediaPlaybackController.ts:826-846)
    const onEnded = () => { stopProgress(); mediaPlayback.next() }
    media.addEventListener('timeupdate', onTimeUpdate)
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', onPause)
    media.addEventListener('ended', onEnded)
    external = media
    unwireExternal = () => {
      media.removeEventListener('timeupdate', onTimeUpdate)
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', onPause)
      media.removeEventListener('ended', onEnded)
    }
    const rate = storedRate(playbackMediaType(track))
    media.playbackRate = rate
    useAudioStore.setState({
      queue, index, track, rate,
      playing: !media.paused,
      currentTime: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration || 0 : 0,
    })
    if (!media.paused) startProgress(media)
  },
  toggle(): void {
    const a = current()
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  },
  seekFraction(f: number): void {
    const a = current()
    const d = useAudioStore.getState().duration || a.duration || 0
    if (d > 0) {
      a.currentTime = Math.max(0, Math.min(1, f)) * d
      useAudioStore.setState({ currentTime: a.currentTime })
    }
  },
  cycleRate(): void {
    mediaPlayback.setRate(RATES[(RATES.indexOf(useAudioStore.getState().rate) + 1) % RATES.length])
  },
  setRate(r: number): void {
    current().playbackRate = r
    useAudioStore.setState({ rate: r })
    persistRate(playbackMediaType(useAudioStore.getState().track), r)
  },
  toggleMute(): void {
    const m = !useAudioStore.getState().muted
    current().muted = m
    useAudioStore.setState({ muted: m })
  },
  setVolume(v: number): void {
    const vol = Math.max(0, Math.min(1, v))
    const a = current()
    a.volume = vol
    a.muted = vol === 0
    useAudioStore.setState({ volume: vol, muted: vol === 0 })
  },
  next(): void {
    goTo(useAudioStore.getState().index + 1, 1)
  },
  prev(): void {
    // tweb previous() → seekToStart (:1017): дальше 5-й секунды кнопка перематывает
    // текущий трек в начало, и только «в начале» уходит к предыдущему.
    const { index, currentTime } = useAudioStore.getState()
    if (currentTime > 5 || index <= 0) {
      mediaPlayback.seekFraction(0)
      void current().play().catch(() => {})
      return
    }
    goTo(index - 1, -1)
  },
  close(): void {
    detachExternal(true)
    const a = audio()
    a.pause()
    a.removeAttribute('src')
    stopProgress()
    useAudioStore.setState({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
  },
}
