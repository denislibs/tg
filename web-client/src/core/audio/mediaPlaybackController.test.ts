// Поведение движка плеера (порт tweb appMediaPlaybackController + MediaProgressLine):
// прогресс по requestAnimationFrame, общая очередь voice+round, скорость по типу медиа.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Сеть/крипта движку в тесте не нужны: URL трека резолвится синхронно, секретных нет.
vi.mock('../mediaUrl', () => ({
  resolveStreamUrl: (id: number) => `blob:media-${id}`,
  mediaContentUrl: (id: number) => `blob:media-${id}`,
  primeMediaToken: () => Promise.resolve(),
}))
vi.mock('../secret/crypto', () => ({ decryptMedia: () => Promise.resolve(new ArrayBuffer(0)) }))

// Кадры анимации — вручную: так видно, что цикл заведён и что он гаснет.
let frames: Array<[number, FrameRequestCallback]> = []
let frameId = 0
const flushFrame = () => {
  const q = frames
  frames = []
  q.forEach(([, cb]) => cb(0))
}

// Элементы <audio>, созданные движком (внутренний плеер он держит приватно).
const created: HTMLMediaElement[] = []

type FakeMedia = HTMLMediaElement & { _playing?: boolean; _time?: number; _dur?: number }

let mediaPlayback: typeof import('./mediaPlaybackController').mediaPlayback
let registerRoundMedia: typeof import('./mediaPlaybackController').registerRoundMedia
let useAudioStore: typeof import('../../stores/audioStore').useAudioStore
let useSettingsStore: typeof import('../../settings').useSettingsStore

beforeAll(async () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push([++frameId, cb])
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter(([i]) => i !== id)
  })

  // Медиа-элементы окружения не играют — подменяем play/pause/currentTime/duration
  // на предсказуемые заглушки, дёргающие настоящие события.
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>
  const define = (key: string, desc: PropertyDescriptor) =>
    Object.defineProperty(proto, key, { configurable: true, ...desc })
  define('paused', { get(this: FakeMedia) { return !this._playing } })
  define('currentTime', {
    get(this: FakeMedia) { return this._time ?? 0 },
    set(this: FakeMedia, v: number) { this._time = v },
  })
  define('duration', {
    get(this: FakeMedia) { return this._dur ?? 0 },
    set(this: FakeMedia, v: number) { this._dur = v },
  })
  proto.play = function (this: FakeMedia) {
    this._playing = true
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  proto.pause = function (this: FakeMedia) {
    if (!this._playing) return
    this._playing = false
    this.dispatchEvent(new Event('pause'))
  }

  const RealAudio = globalThis.Audio
  vi.stubGlobal('Audio', function () {
    const a = new RealAudio()
    created.push(a)
    return a
  })

  const controller = await import('./mediaPlaybackController')
  mediaPlayback = controller.mediaPlayback
  registerRoundMedia = controller.registerRoundMedia
  useAudioStore = (await import('../../stores/audioStore')).useAudioStore
  useSettingsStore = (await import('../../settings')).useSettingsStore
})

const voice = (mediaId: number) => ({ mediaId, title: 't', subtitle: 's', type: 'voice' as const })
const round = (mediaId: number) => ({ mediaId, title: 't', subtitle: 's', type: 'round' as const })
const music = (mediaId: number) => ({ mediaId, title: 't', subtitle: 's', type: 'audio' as const })

/** Дать движку дожевать асинхронный load() (резолв URL + play). */
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Внутренний <audio> движка (создаётся лениво при первом воспроизведении). */
const player = () => created[created.length - 1] as FakeMedia

beforeEach(() => {
  frames = []
  useSettingsStore.getState().update({ playbackRates: { voice: 1, audio: 1 } })
})

afterEach(() => {
  mediaPlayback.close()
})

describe('rAF-прогресс (tweb MediaProgressLine.onPlay)', () => {
  it('цикл стартует по play и обновляет currentTime каждый кадр', async () => {
    mediaPlayback.playQueue([voice(1)], 0)
    await settle()

    expect(useAudioStore.getState().playing).toBe(true)
    // первый кадр — синхронно в onPlay, следующий уже запланирован
    expect(frames).toHaveLength(1)

    player()._time = 1.25
    flushFrame()
    expect(useAudioStore.getState().currentTime).toBe(1.25)
    expect(frames).toHaveLength(1)

    player()._time = 2.5
    flushFrame()
    expect(useAudioStore.getState().currentTime).toBe(2.5)
  })

  it('цикл гаснет по pause (кадр снят, утечки нет)', async () => {
    mediaPlayback.playQueue([voice(1)], 0)
    await settle()
    expect(frames).toHaveLength(1)

    mediaPlayback.toggle() // pause
    expect(useAudioStore.getState().playing).toBe(false)
    expect(frames).toHaveLength(0)

    // timeupdate на паузе всё ещё двигает прогресс (tweb onTimeUpdate) и цикл не заводит
    player()._time = 4
    player().dispatchEvent(new Event('timeupdate'))
    expect(useAudioStore.getState().currentTime).toBe(4)
    expect(frames).toHaveLength(0)
  })

  it('close() снимает кадр', async () => {
    mediaPlayback.playQueue([voice(1)], 0)
    await settle()
    mediaPlayback.close()
    expect(frames).toHaveLength(0)
  })
})

describe('общая очередь voice+round (tweb inputMessagesFilterRoundVoice)', () => {
  it('доигравшее голосовое запускает следующее в очереди', async () => {
    mediaPlayback.playQueue([voice(1), voice(2)], 0)
    await settle()
    expect(useAudioStore.getState().track?.mediaId).toBe(1)

    player().dispatchEvent(new Event('ended'))
    await settle()

    expect(useAudioStore.getState().track?.mediaId).toBe(2)
    expect(useAudioStore.getState().index).toBe(1)
    expect(player().src).toContain('blob:media-2')
    expect(useAudioStore.getState().playing).toBe(true)
  })

  it('после голосового едет кружок — своим элементом из бабла', async () => {
    const play = vi.fn()
    const unregister = registerRoundMedia(2, play)
    mediaPlayback.playQueue([voice(1), round(2)], 0)
    await settle()

    player().dispatchEvent(new Event('ended'))
    await settle()

    expect(play).toHaveBeenCalledTimes(1)
    expect(useAudioStore.getState().index).toBe(1)
    expect(useAudioStore.getState().track?.mediaId).toBe(2)
    unregister()
  })

  it('несмонтированный кружок пропускается, играет следующее голосовое', async () => {
    mediaPlayback.playQueue([voice(1), round(2), voice(3)], 0)
    await settle()

    player().dispatchEvent(new Event('ended'))
    await settle()

    expect(useAudioStore.getState().track?.mediaId).toBe(3)
  })

  it('доигравший кружок едет по той же очереди дальше', async () => {
    const el = document.createElement('video') as FakeMedia
    mediaPlayback.playExternal([round(1), voice(2)], 0, el)
    expect(useAudioStore.getState().track?.mediaId).toBe(1)

    el.dispatchEvent(new Event('ended'))
    await settle()

    expect(useAudioStore.getState().track?.mediaId).toBe(2)
    expect(useAudioStore.getState().playing).toBe(true)
  })

  it('конец очереди — плеер останавливается и плашка сбрасывается', async () => {
    mediaPlayback.playQueue([voice(1)], 0)
    await settle()

    player().dispatchEvent(new Event('ended'))
    await settle()

    expect(useAudioStore.getState().track).toBeNull()
    expect(useAudioStore.getState().playing).toBe(false)
    expect(frames).toHaveLength(0)
  })
})

describe('скорость — своя на тип медиа (tweb playbackRates)', () => {
  it('persist по типу: голос и музыка не мешают друг другу', async () => {
    mediaPlayback.playQueue([voice(1)], 0)
    await settle()

    mediaPlayback.setRate(1.5)
    expect(useSettingsStore.getState().playbackRates).toEqual({ voice: 1.5, audio: 1 })
    expect(player().playbackRate).toBe(1.5)

    // музыка — своя очередь и своя скорость, голосовая на неё не переносится
    mediaPlayback.playQueue([music(9)], 0)
    await settle()
    expect(useAudioStore.getState().rate).toBe(1)

    mediaPlayback.setRate(2)
    expect(useSettingsStore.getState().playbackRates).toEqual({ voice: 1.5, audio: 2 })
  })

  it('запомненная скорость применяется к следующему треку того же типа', async () => {
    useSettingsStore.getState().update({ playbackRates: { voice: 2, audio: 1 } })

    mediaPlayback.playQueue([voice(1)], 0)
    await settle()

    expect(useAudioStore.getState().rate).toBe(2)
    expect(player().playbackRate).toBe(2)
  })

  it('скорость переживает перезагрузку (localStorage)', () => {
    mediaPlayback.playQueue([music(9)], 0)
    mediaPlayback.setRate(0.5)
    const saved = JSON.parse(localStorage.getItem('tg-settings') as string) as {
      playbackRates: Record<string, number>
    }
    expect(saved.playbackRates.audio).toBe(0.5)
  })
})
