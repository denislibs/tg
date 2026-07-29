// src/core/audio/mediaPlaybackController.ts
//
// Императивный движок воспроизведения (порт tweb appMediaPlaybackController):
// владеет общим <audio>-элементом, подключением внешнего элемента (видео-кружок),
// кэшем расшифрованных секретных треков и логикой play/pause/seek/rate/очереди.
// Реактивное состояние (track/queue/playing/currentTime/…) живёт отдельно в
// audioStore — движок его обновляет через set/_sync, UI читает оттуда. Это
// разводит «железо» (медиа-элемент) и стейт, как в tweb.
import { decryptMedia } from '../secret/crypto'
import { mediaContentUrl, primeMediaToken, resolveMediaContentUrl } from '../mediaUrl'
import { useAudioStore, type AudioTrack } from '../../stores/audioStore'

const RATES = [0.5, 1, 1.5, 2]

// A single shared <audio> element drives normal playback.
let el: HTMLAudioElement | null = null
function audio(): HTMLAudioElement {
  if (el) return el
  el = new Audio()
  // Ошибку загрузки/декодирования src (напр. неподдерживаемый кодек) иначе не
  // видно — .play() к тому моменту уже зарезолвился. Логируем явно для диагностики.
  el.addEventListener('error', () => console.error('[audio] element error', el?.error?.code, el?.error?.message))
  el.addEventListener('timeupdate', () => { if (!external) useAudioStore.getState()._sync({ currentTime: el!.currentTime }) })
  el.addEventListener('loadedmetadata', () => { if (!external) useAudioStore.getState()._sync({ duration: el!.duration || 0 }) })
  el.addEventListener('play', () => { if (!external) useAudioStore.getState()._sync({ playing: true }) })
  el.addEventListener('pause', () => { if (!external) useAudioStore.getState()._sync({ playing: false }) })
  el.addEventListener('ended', () => { if (!external) mediaPlayback.next() })
  return el
}

// Attached external element (round-video bubble) + its listener teardown.
let external: HTMLMediaElement | null = null
let unwireExternal: (() => void) | null = null

// Элемент, которым сейчас управляют кнопки плеера.
function current(): HTMLMediaElement {
  return external ?? audio()
}

// Отцепить внешний элемент (опционально ставя его на паузу).
function detachExternal(pause: boolean) {
  if (!external) return
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
    const resolved = resolveMediaContentUrl(track.mediaId)
    url = typeof resolved === 'string' ? resolved : await resolved
  }
  a.src = url
  a.playbackRate = useAudioStore.getState().rate
  a.muted = useAudioStore.getState().muted
  a.volume = useAudioStore.getState().volume
  if (autoplay) await a.play().catch((e) => console.error('[audio] play() failed', e))
}

// Императивный контроллер: методы вызывают делегаты audioStore (публичный API
// плеера не меняется), а стейт обновляют через set/_sync.
export const mediaPlayback = {
  playQueue(queue: AudioTrack[], index: number): void {
    const track = queue[index]
    if (!track) return
    detachExternal(true)
    useAudioStore.setState({ queue, index, track, currentTime: 0, duration: 0 })
    void load(track, true)
  },
  playExternal(track: AudioTrack, media: HTMLMediaElement): void {
    // предыдущий источник (внутренний audio или другой кружок) — на паузу
    if (external && external !== media) detachExternal(true)
    else if (!external) audio().pause()
    unwireExternal?.()
    const sync = () => useAudioStore.getState()._sync({ currentTime: media.currentTime, duration: media.duration || 0 })
    const onPlay = () => useAudioStore.getState()._sync({ playing: true })
    const onPause = () => useAudioStore.getState()._sync({ playing: false })
    // кружок докручен до конца — бабл сам вернётся в muted-превью, плашку прячем
    const onEnded = () => { detachExternal(false); useAudioStore.setState({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 }) }
    media.addEventListener('timeupdate', sync)
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', onPause)
    media.addEventListener('ended', onEnded)
    external = media
    unwireExternal = () => {
      media.removeEventListener('timeupdate', sync)
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', onPause)
      media.removeEventListener('ended', onEnded)
    }
    useAudioStore.setState({
      track, queue: [track], index: 0,
      playing: !media.paused,
      currentTime: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration || 0 : 0,
    })
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
    const next = RATES[(RATES.indexOf(useAudioStore.getState().rate) + 1) % RATES.length]
    current().playbackRate = next
    useAudioStore.setState({ rate: next })
  },
  setRate(r: number): void {
    current().playbackRate = r
    useAudioStore.setState({ rate: r })
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
    // для внешнего трека (кружок) очередь одиночная — перемотка в начало
    if (external) {
      mediaPlayback.seekFraction(0)
      return
    }
    const { queue, index } = useAudioStore.getState()
    const ni = index + 1
    if (ni < queue.length) {
      useAudioStore.setState({ index: ni, track: queue[ni], currentTime: 0, duration: 0 })
      void load(queue[ni], true)
    } else {
      useAudioStore.setState({ playing: false })
    }
  },
  prev(): void {
    const { queue, index, currentTime } = useAudioStore.getState()
    // Telegram: >3s in, restart the current track; else go to the previous one.
    if (external || currentTime > 3 || index <= 0) {
      mediaPlayback.seekFraction(0)
      void current().play().catch(() => {})
      return
    }
    const pi = index - 1
    useAudioStore.setState({ index: pi, track: queue[pi], currentTime: 0, duration: 0 })
    void load(queue[pi], true)
  },
  close(): void {
    detachExternal(true)
    const a = audio()
    a.pause()
    a.removeAttribute('src')
    useAudioStore.setState({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
  },
}
