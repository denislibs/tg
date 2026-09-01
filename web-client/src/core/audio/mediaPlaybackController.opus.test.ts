// ПЛАТФОРМЕННАЯ половина гейта конвертации (`!IS_OPUS_SUPPORTED` из tweb
// `apiFileManager.ts:670`) — та, что живёт в `ensureSrc`.
//
// Файл отдельный, потому что гейт считается на импорте среды и в одном модуле
// два его значения не сосуществуют. Обратное направление (гейт открыт → в
// декодер не ходим вовсе и src подаётся синхронно) проверяет
// `mediaPlaybackController.test.ts`, где тот же модуль подменён на `true`:
// снятие любой из двух веток красит РАЗНЫЕ файлы, поэтому «упростить» условие
// незаметно нельзя.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../mediaUrl', () => ({
  resolveStreamUrl: (id: number) => `blob:stream-${id}`,
  mediaContentUrl: (id: number) => `blob:cipher-${id}`,
  primeMediaToken: () => Promise.resolve(),
}))
vi.mock('../secret/crypto', () => ({
  decryptMedia: () => Promise.resolve(new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer),
}))
vi.mock('@components/animationIntersector', () => ({ default: { toggleMediaPause: () => {} } }))

// Платформа БЕЗ ogg — WebKit ниже 18.4.
vi.mock('@environment/opusSupport', () => ({ default: false }))

const voicePlaybackUrl = vi.fn<(id: number) => Promise<string | undefined>>()
const oggBytesToWavUrl = vi.fn<(b: Uint8Array) => Promise<string>>()
vi.mock('../media/voiceOpus', () => ({
  voicePlaybackUrl: (id: number) => voicePlaybackUrl(id),
  oggBytesToWavUrl: (b: Uint8Array) => oggBytesToWavUrl(b),
  isOggContainer: (mime: string | undefined) => mime === 'audio/ogg',
  resetVoiceOpusCache: () => {},
}))

let mediaPlayback: typeof import('./mediaPlaybackController').mediaPlayback
let resetPlayback: typeof import('./mediaPlaybackController').resetPlayback

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })))
  const controller = await import('./mediaPlaybackController')
  mediaPlayback = controller.mediaPlayback
  resetPlayback = controller.resetPlayback
})

afterEach(() => {
  resetPlayback()
  voicePlaybackUrl.mockReset()
  oggBytesToWavUrl.mockReset()
})

const track = (mediaId: number) => ({ mediaId, title: 't', date: 1755255240, type: 'voice' as const })
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('платформа не играет ogg — src берётся из конвертера', () => {
  it('ogg-файл: элемент получает wav из декодера, а не стрим с сервера', async () => {
    voicePlaybackUrl.mockResolvedValue('blob:wav-1')

    mediaPlayback.addMedia({ track: track(1) })
    await settle()

    expect(voicePlaybackUrl).toHaveBeenCalledWith(1)
    expect(mediaPlayback.getMedia(1)!.src).toBe('blob:wav-1')
  })

  it('не-ogg (конвертер сказал «нечего») — обычный стрим, без подмены', async () => {
    voicePlaybackUrl.mockResolvedValue(undefined)

    mediaPlayback.addMedia({ track: track(2) })
    await settle()

    expect(voicePlaybackUrl).toHaveBeenCalledWith(2)
    expect(mediaPlayback.getMedia(2)!.src).toBe('blob:stream-2')
  })

  it('секретное голосовое: расшифрованные байты идут в декодер, а не в <audio> как есть', async () => {
    oggBytesToWavUrl.mockResolvedValue('blob:wav-secret')

    const secret = { keyB64: 'k', ivB64: 'i', mime: 'audio/ogg' }
    mediaPlayback.addMedia({ track: { ...track(3), secret } })
    await settle()

    expect(oggBytesToWavUrl).toHaveBeenCalledTimes(1)
    expect(mediaPlayback.getMedia(3)!.src).toBe('blob:wav-secret')
    // Файл на сервере зашифрован — качать его конвейером downloadMediaURL нечем.
    expect(voicePlaybackUrl).not.toHaveBeenCalled()
  })

  it('секретное НЕ-ogg (кружок, музыка) — блоб с исходным mime, декодер не трогаем', async () => {
    const secret = { keyB64: 'k', ivB64: 'i', mime: 'audio/mpeg' }
    mediaPlayback.addMedia({ track: { ...track(4), secret } })
    await settle()

    expect(oggBytesToWavUrl).not.toHaveBeenCalled()
    expect(mediaPlayback.getMedia(4)!.src).toMatch(/^blob:/)
  })
})
