import { create } from 'zustand'
import { startClient } from '../client/bootstrap'

// A track the global player can play (a voice message or audio file).
export interface AudioTrack {
  mediaId: number
  title: string
  subtitle: string
  chatId?: number
  msgId?: number
}

interface AudioState {
  track: AudioTrack | null
  queue: AudioTrack[]
  index: number
  playing: boolean
  currentTime: number
  duration: number
  rate: number
  muted: boolean
  volume: number
  // actions
  playQueue: (queue: AudioTrack[], index: number) => void
  /** Внешний медиа-элемент (видео кружка) как текущий трек: плашка плеера
   * управляет им (pause/seek/close) вместо внутреннего <audio> (tweb: round
   * регистрируется в appMediaPlaybackController). */
  playExternal: (track: AudioTrack, media: HTMLMediaElement) => void
  toggle: () => void
  seekFraction: (f: number) => void
  cycleRate: () => void
  setRate: (r: number) => void
  toggleMute: () => void
  setVolume: (v: number) => void
  next: () => void
  prev: () => void
  close: () => void
  // internal (driven by the <audio> element)
  _sync: (patch: Partial<AudioState>) => void
}

const RATES = [0.5, 1, 1.5, 2]

// A single shared <audio> element drives normal playback.
let el: HTMLAudioElement | null = null
function audio(): HTMLAudioElement {
  if (el) return el
  el = new Audio()
  el.addEventListener('timeupdate', () => { if (!external) useAudioStore.getState()._sync({ currentTime: el!.currentTime }) })
  el.addEventListener('loadedmetadata', () => { if (!external) useAudioStore.getState()._sync({ duration: el!.duration || 0 }) })
  el.addEventListener('play', () => { if (!external) useAudioStore.getState()._sync({ playing: true }) })
  el.addEventListener('pause', () => { if (!external) useAudioStore.getState()._sync({ playing: false }) })
  el.addEventListener('ended', () => { if (!external) useAudioStore.getState().next() })
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

// Load + play a track's bytes (resolving the media URL via the worker).
async function load(track: AudioTrack, autoplay: boolean) {
  const a = audio()
  const url = await startClient().managers.media.contentUrl(track.mediaId)
  a.src = url
  a.playbackRate = useAudioStore.getState().rate
  a.muted = useAudioStore.getState().muted
  a.volume = useAudioStore.getState().volume
  if (autoplay) await a.play().catch(() => {})
}

export const useAudioStore = create<AudioState>((set, get) => ({
  track: null,
  queue: [],
  index: -1,
  playing: false,
  currentTime: 0,
  duration: 0,
  rate: 1,
  muted: false,
  volume: 1,

  playQueue: (queue, index) => {
    const track = queue[index]
    if (!track) return
    detachExternal(true)
    set({ queue, index, track, currentTime: 0, duration: 0 })
    void load(track, true)
  },
  playExternal: (track, media) => {
    // предыдущий источник (внутренний audio или другой кружок) — на паузу
    if (external && external !== media) detachExternal(true)
    else if (!external) audio().pause()
    unwireExternal?.()
    const sync = () => useAudioStore.getState()._sync({ currentTime: media.currentTime, duration: media.duration || 0 })
    const onPlay = () => useAudioStore.getState()._sync({ playing: true })
    const onPause = () => useAudioStore.getState()._sync({ playing: false })
    // кружок докручен до конца — бабл сам вернётся в muted-превью, плашку прячем
    const onEnded = () => { detachExternal(false); set({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 }) }
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
    set({
      track, queue: [track], index: 0,
      playing: !media.paused,
      currentTime: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration || 0 : 0,
    })
  },
  toggle: () => {
    const a = current()
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  },
  seekFraction: (f) => {
    const a = current()
    const d = get().duration || a.duration || 0
    if (d > 0) {
      a.currentTime = Math.max(0, Math.min(1, f)) * d
      set({ currentTime: a.currentTime })
    }
  },
  cycleRate: () => {
    const next = RATES[(RATES.indexOf(get().rate) + 1) % RATES.length]
    current().playbackRate = next
    set({ rate: next })
  },
  setRate: (r) => {
    current().playbackRate = r
    set({ rate: r })
  },
  toggleMute: () => {
    const m = !get().muted
    current().muted = m
    set({ muted: m })
  },
  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v))
    const a = current()
    a.volume = vol
    a.muted = vol === 0
    set({ volume: vol, muted: vol === 0 })
  },
  next: () => {
    // для внешнего трека (кружок) очередь одиночная — перемотка в начало
    if (external) {
      get().seekFraction(0)
      return
    }
    const { queue, index } = get()
    const ni = index + 1
    if (ni < queue.length) {
      set({ index: ni, track: queue[ni], currentTime: 0, duration: 0 })
      void load(queue[ni], true)
    } else {
      set({ playing: false })
    }
  },
  prev: () => {
    const { queue, index, currentTime } = get()
    // Telegram: >3s in, restart the current track; else go to the previous one.
    if (external || currentTime > 3 || index <= 0) {
      get().seekFraction(0)
      void current().play().catch(() => {})
      return
    }
    const pi = index - 1
    set({ index: pi, track: queue[pi], currentTime: 0, duration: 0 })
    void load(queue[pi], true)
  },
  close: () => {
    detachExternal(true)
    const a = audio()
    a.pause()
    a.removeAttribute('src')
    set({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
  },
  _sync: (patch) => set(patch),
}))
