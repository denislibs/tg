// Ported 1:1 from tweb's src/helpers/audioAssetPlayer.ts (self-contained: the
// safePlay / deepEqual / tsNow helpers are inlined). Plays short UI sound assets
// (message sent, notification, call tones) from public/assets/audio. One shared
// off-screen container holds the <audio> elements.

const ASSETS_PATH = `${import.meta.env.BASE_URL}assets/audio/`

const now = () => Date.now() / 1000

// Browsers reject autoplay until a user gesture; swallow the rejected promise so
// a blocked sound never throws (tweb's safePlay).
function safePlay(audio: HTMLAudioElement): void {
  const p = audio.play()
  if (p && typeof p.catch === 'function') p.catch(() => {})
}

interface PlayOptions<AssetMap extends Record<string, string>> {
  name: keyof AssetMap
  loop?: boolean
  volume?: number
}

export default class AudioAssetPlayer<AssetMap extends Record<string, string>> {
  private static container: HTMLElement | undefined
  private audio: HTMLAudioElement | undefined
  private tempId = 0
  private assetName: keyof AssetMap | undefined
  private lastOptions: PlayOptions<AssetMap> | undefined
  private nextAt = 0

  constructor(private assets: AssetMap) {
    if (typeof document === 'undefined') return
    if (!AudioAssetPlayer.container) {
      const c = document.createElement('div')
      c.id = 'audio-asset-player'
      document.body.append(c)
      AudioAssetPlayer.container = c
    }
  }

  play(options: PlayOptions<AssetMap>): void {
    if (!AudioAssetPlayer.container) return
    ++this.tempId
    this.assetName = options.name
    this.lastOptions = options
    try {
      const audio = this.createAudio()
      audio.autoplay = true
      audio.src = ASSETS_PATH + this.assets[options.name]
      audio.loop = options.loop ?? false
      audio.volume = options.volume ?? 1
      audio.setAttribute('name', options.name as string)
      AudioAssetPlayer.container.append(audio)
      safePlay(audio)
    } catch (e) {
      console.error('playSound', options.name, e)
    }
  }

  // Don't replay the same sound more often than `throttle` ms (e.g. a burst of
  // sent messages → one "pak", not ten).
  playWithThrottle(options: PlayOptions<AssetMap>, throttle: number): void {
    const t = now()
    if (this.nextAt && t < this.nextAt && this.lastOptions?.name === options.name) return
    this.nextAt = t + throttle / 1000
    this.play(options)
  }

  playIfDifferent(options: PlayOptions<AssetMap>): void {
    if (this.assetName !== options.name) this.play(options)
  }

  private createAudio(): HTMLAudioElement {
    if (this.audio) return this.audio
    this.audio = new Audio()
    return this.audio
  }

  stop(): void {
    this.audio?.pause()
  }

  cancelDelayedPlay(): void {
    ++this.tempId
  }

  playWithTimeout(options: PlayOptions<AssetMap>, timeout: number): void {
    const tempId = ++this.tempId
    setTimeout(() => {
      if (this.tempId !== tempId) return
      this.play(options)
    }, timeout)
  }
}
