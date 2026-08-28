// Форматная половина гейта конвертации (порт `apiFileManager.ts:670`) и путь
// «байты файла → wav». Платформенная половина живёт у вызывающего и проверяется
// в `core/audio/mediaPlaybackController.opus.test.ts` — здесь её нет намеренно:
// один гейт, разложенный по двум местам, обязан краснеть в двух разных тестах,
// иначе снятие любой половины пройдёт незамеченным.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const meta = vi.fn<(id: number) => Promise<{ mime: string }>>()
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { meta: (id: number) => meta(id) } } }),
}))

const ensureMediaUrl = vi.fn<(id: number) => Promise<string>>()
vi.mock('./ensureMediaUrl', () => ({ ensureMediaUrl: (id: number) => ensureMediaUrl(id) }))

const decode = vi.fn<(bytes: Uint8Array) => Promise<{ url: string }>>()
vi.mock('../audio/opusDecodeController', () => ({ default: { decode: (b: Uint8Array) => decode(b) } }))

let voiceOpus: typeof import('./voiceOpus')

beforeEach(async () => {
  vi.resetModules()
  meta.mockReset()
  ensureMediaUrl.mockReset()
  decode.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer })))
  voiceOpus = await import('./voiceOpus')
})

afterEach(() => { vi.unstubAllGlobals() })

describe('isOggContainer — форматная половина гейта', () => {
  it('ogg — да, включая mime с параметрами кодека', () => {
    expect(voiceOpus.isOggContainer('audio/ogg')).toBe(true)
    expect(voiceOpus.isOggContainer('audio/ogg;codecs=opus')).toBe(true)
    expect(voiceOpus.isOggContainer(' audio/ogg ; codecs=opus')).toBe(true)
  })

  it('всё прочее — нет: в декодер libopus нельзя утащить mp3 или webm', () => {
    for (const mime of ['audio/mpeg', 'audio/webm;codecs=opus', 'audio/mp4', 'video/mp4', '', undefined]) {
      expect(voiceOpus.isOggContainer(mime), String(mime)).toBe(false)
    }
  })
})

describe('voicePlaybackUrl', () => {
  it('не-ogg — undefined: файл играется как есть, лишнего скачивания нет', async () => {
    meta.mockResolvedValue({ mime: 'audio/mpeg' })

    await expect(voiceOpus.voicePlaybackUrl(7)).resolves.toBeUndefined()
    expect(ensureMediaUrl).not.toHaveBeenCalled()
    expect(decode).not.toHaveBeenCalled()
  })

  it('ogg — байты через ensureMediaUrl уезжают в декодер, наружу идёт его URL', async () => {
    meta.mockResolvedValue({ mime: 'audio/ogg' })
    ensureMediaUrl.mockResolvedValue('blob:ogg-7')
    decode.mockResolvedValue({ url: 'blob:wav-7' })

    await expect(voiceOpus.voicePlaybackUrl(7)).resolves.toBe('blob:wav-7')
    expect(ensureMediaUrl).toHaveBeenCalledWith(7)
    expect(fetch).toHaveBeenCalledWith('blob:ogg-7')
    expect(decode.mock.calls[0][0]).toEqual(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))
  })

  it('второй бабл того же файла берёт готовый URL — libopus не поднимается дважды', async () => {
    meta.mockResolvedValue({ mime: 'audio/ogg' })
    ensureMediaUrl.mockResolvedValue('blob:ogg-7')
    decode.mockResolvedValue({ url: 'blob:wav-7' })

    await voiceOpus.voicePlaybackUrl(7)
    await expect(voiceOpus.voicePlaybackUrl(7)).resolves.toBe('blob:wav-7')
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('одновременные запросы одного файла склеиваются в одну конвертацию', async () => {
    meta.mockResolvedValue({ mime: 'audio/ogg' })
    ensureMediaUrl.mockResolvedValue('blob:ogg-7')
    decode.mockResolvedValue({ url: 'blob:wav-7' })

    const [a, b] = await Promise.all([voiceOpus.voicePlaybackUrl(7), voiceOpus.voicePlaybackUrl(7)])

    expect([a, b]).toEqual(['blob:wav-7', 'blob:wav-7'])
    expect(decode).toHaveBeenCalledTimes(1)
  })

  it('сорвавшаяся конвертация не залипает: следующая попытка идёт заново', async () => {
    meta.mockResolvedValue({ mime: 'audio/ogg' })
    ensureMediaUrl.mockResolvedValue('blob:ogg-7')
    decode.mockRejectedValueOnce(new Error('opus decode timeout'))

    await expect(voiceOpus.voicePlaybackUrl(7)).rejects.toThrow('opus decode timeout')

    decode.mockResolvedValue({ url: 'blob:wav-7' })
    await expect(voiceOpus.voicePlaybackUrl(7)).resolves.toBe('blob:wav-7')
  })

  it('смена сессии отзывает блобы прошлого пользователя и чистит кэш', async () => {
    const revoke = vi.fn()
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    meta.mockResolvedValue({ mime: 'audio/ogg' })
    ensureMediaUrl.mockResolvedValue('blob:ogg-7')
    decode.mockResolvedValue({ url: 'blob:wav-7' })
    await voiceOpus.voicePlaybackUrl(7)

    voiceOpus.resetVoiceOpusCache()

    expect(revoke).toHaveBeenCalledWith('blob:wav-7')
    decode.mockResolvedValue({ url: 'blob:wav-7-again' })
    await expect(voiceOpus.voicePlaybackUrl(7)).resolves.toBe('blob:wav-7-again')
    vi.restoreAllMocks()
  })

  it('oggBytesToWavUrl — прямой вход для расшифрованного секретного голосового', async () => {
    decode.mockResolvedValue({ url: 'blob:wav-secret' })

    await expect(voiceOpus.oggBytesToWavUrl(new Uint8Array([1, 2]))).resolves.toBe('blob:wav-secret')
    expect(meta).not.toHaveBeenCalled()
    expect(ensureMediaUrl).not.toHaveBeenCalled()
  })
})
