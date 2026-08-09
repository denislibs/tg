import { create } from 'zustand'
import { mediaPlayback } from '../core/audio/mediaPlaybackController'

// A track the global player can play (a voice message or audio file).
export interface AudioTrack {
  mediaId: number
  title: string
  subtitle: string
  chatId?: number
  msgId?: number
  /** Вид медиа (tweb doc.type): голосовое, кружок или музыка. Голос и кружок —
   * одна очередь и одна скорость (tweb PlaybackMediaType 'voice'), музыка — своя
   * ('audio'). Отсутствие поля = музыка (плейлисты из поиска/shared media). */
  type?: 'voice' | 'round' | 'audio'
  // Секретный чат (E2E): сервер хранит только ciphertext — байты надо скачать,
  // расшифровать ключом файла и играть blob-URL с верным mime (иначе <audio>
  // получает шифртекст и звук — «мусор»). Как в SecretMediaBubble для фото/видео.
  secret?: { keyB64: string; ivB64: string; mime: string }
}

// Реактивное состояние плеера (UI читает отсюда). Императивный <audio>-движок и
// вся playback-логика — в mediaPlaybackController; действия здесь — тонкие делегаты
// в него, чтобы публичный API стора (useAudioStore.getState().toggle() и т.п.) не
// менялся. _sync/setState движок использует для обновления этого состояния.
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
  // actions (делегаты в mediaPlaybackController)
  playQueue: (queue: AudioTrack[], index: number) => void
  /** Внешний медиа-элемент (видео кружка) как текущий трек: плашка плеера
   * управляет им (pause/seek/close) вместо внутреннего <audio> (tweb: round
   * регистрируется в appMediaPlaybackController). Очередь та же, что у голосовых
   * (tweb inputMessagesFilterRoundVoice) — доиграв, кружок едет по ней дальше. */
  playExternal: (queue: AudioTrack[], index: number, media: HTMLMediaElement) => void
  toggle: () => void
  seekFraction: (f: number) => void
  cycleRate: () => void
  setRate: (r: number) => void
  toggleMute: () => void
  setVolume: (v: number) => void
  next: () => void
  prev: () => void
  close: () => void
  // internal (driven by the <audio> element via the controller)
  _sync: (patch: Partial<AudioState>) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  track: null,
  queue: [],
  index: -1,
  playing: false,
  currentTime: 0,
  duration: 0,
  rate: 1,
  muted: false,
  volume: 1,

  playQueue: (queue, index) => mediaPlayback.playQueue(queue, index),
  playExternal: (queue, index, media) => mediaPlayback.playExternal(queue, index, media),
  toggle: () => mediaPlayback.toggle(),
  seekFraction: (f) => mediaPlayback.seekFraction(f),
  cycleRate: () => mediaPlayback.cycleRate(),
  setRate: (r) => mediaPlayback.setRate(r),
  toggleMute: () => mediaPlayback.toggleMute(),
  setVolume: (v) => mediaPlayback.setVolume(v),
  next: () => mediaPlayback.next(),
  prev: () => mediaPlayback.prev(),
  close: () => mediaPlayback.close(),
  _sync: (patch) => set(patch),
}))

// Префетч секретного аудио — часть движка; ре-экспорт для мест, что импортировали
// его из audioStore (напр. VoiceMessage прогревает URL по наведению).
export { prefetchSecretAudio, registerRoundMedia } from '../core/audio/mediaPlaybackController'
