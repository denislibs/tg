// Feature-detect WebCodecs для редактирования видео (порт tweb support.ts).
// Без WebCodecs видео-правки/энкод недоступны — редактор мягко деградирует к
// возврату исходного файла. Синхронные проверки принимают инъектируемый global,
// чтобы тестировать без WebCodecs в jsdom.
import { DEFAULT_CODEC, HIGH_RES_CODEC } from './videoMath'

interface CodecsGlobal {
  VideoEncoder?: { isConfigSupported?: unknown }
  VideoFrame?: unknown
  AudioEncoder?: { isConfigSupported?: unknown }
  AudioData?: unknown
}

/** Есть ли конструкторы VideoEncoder/VideoFrame и статик isConfigSupported. */
export function hasVideoCodecs(g: CodecsGlobal = globalThis as CodecsGlobal): boolean {
  return typeof g.VideoEncoder === 'function'
    && typeof g.VideoFrame === 'function'
    && typeof (g.VideoEncoder as { isConfigSupported?: unknown }).isConfigSupported === 'function'
}

/** Есть ли конструкторы AudioEncoder/AudioData и статик isConfigSupported. */
export function hasAudioCodecs(g: CodecsGlobal = globalThis as CodecsGlobal): boolean {
  return typeof g.AudioEncoder === 'function'
    && typeof g.AudioData === 'function'
    && typeof (g.AudioEncoder as { isConfigSupported?: unknown }).isConfigSupported === 'function'
}

let videoP: Promise<boolean> | undefined
let audioP: Promise<boolean> | undefined

/** Поддерживается ли энкод видео (avc-пресеты редактора). Результат кэшируется. */
export function supportsVideoEncoding(): Promise<boolean> {
  return videoP ??= (async () => {
    if (!hasVideoCodecs()) return false
    for (const c of [HIGH_RES_CODEC, DEFAULT_CODEC]) {
      try {
        const res = await VideoEncoder.isConfigSupported({ codec: c.codec, width: c.width, height: c.height, bitrate: c.bitrate })
        if (!res.supported) return false
      } catch {
        return false
      }
    }
    return true
  })()
}

/** Поддерживается ли энкод аудио (opus). Результат кэшируется. */
export function supportsAudioEncoding(): Promise<boolean> {
  return audioP ??= (async () => {
    if (!hasAudioCodecs()) return false
    try {
      const res = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })
      return !!res.supported
    } catch {
      return false
    }
  })()
}
