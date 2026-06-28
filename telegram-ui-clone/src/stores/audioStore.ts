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

// A single shared <audio> element drives all playback.
let el: HTMLAudioElement | null = null
function audio(): HTMLAudioElement {
  if (el) return el
  el = new Audio()
  el.addEventListener('timeupdate', () => useAudioStore.getState()._sync({ currentTime: el!.currentTime }))
  el.addEventListener('loadedmetadata', () => useAudioStore.getState()._sync({ duration: el!.duration || 0 }))
  el.addEventListener('play', () => useAudioStore.getState()._sync({ playing: true }))
  el.addEventListener('pause', () => useAudioStore.getState()._sync({ playing: false }))
  el.addEventListener('ended', () => useAudioStore.getState().next())
  return el
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
    set({ queue, index, track, currentTime: 0, duration: 0 })
    void load(track, true)
  },
  toggle: () => {
    const a = audio()
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  },
  seekFraction: (f) => {
    const a = audio()
    const d = get().duration || a.duration || 0
    if (d > 0) {
      a.currentTime = Math.max(0, Math.min(1, f)) * d
      set({ currentTime: a.currentTime })
    }
  },
  cycleRate: () => {
    const next = RATES[(RATES.indexOf(get().rate) + 1) % RATES.length]
    audio().playbackRate = next
    set({ rate: next })
  },
  setRate: (r) => {
    audio().playbackRate = r
    set({ rate: r })
  },
  toggleMute: () => {
    const m = !get().muted
    audio().muted = m
    set({ muted: m })
  },
  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v))
    const a = audio()
    a.volume = vol
    a.muted = vol === 0
    set({ volume: vol, muted: vol === 0 })
  },
  next: () => {
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
    if (currentTime > 3 || index <= 0) {
      get().seekFraction(0)
      void audio().play().catch(() => {})
      return
    }
    const pi = index - 1
    set({ index: pi, track: queue[pi], currentTime: 0, duration: 0 })
    void load(queue[pi], true)
  },
  close: () => {
    const a = audio()
    a.pause()
    a.removeAttribute('src')
    set({ track: null, queue: [], index: -1, playing: false, currentTime: 0, duration: 0 })
  },
  _sync: (patch) => set(patch),
}))
