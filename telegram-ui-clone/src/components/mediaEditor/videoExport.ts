// Энкод результата видео: покадрово по диапазону трима — seek → композит кадра
// (даёт вызывающий через renderFrameTo) → new VideoFrame → VideoEncoder(avc);
// аудио из исходника (decodeAudioData → вырезка → AudioEncoder opus) при !mute;
// мукс в mp4 через mediabunny. Порт tweb finalRender/renderToActualVideo,
// упрощённый: кадры берём seek'ом (детерминированно), без requestVideoFrameCallback.
// mediabunny и WebCodecs — только здесь, за динамическим import + feature-detect,
// чтобы модульные тесты (без WebCodecs в jsdom) не тянули этот код.
import { calcCodecAndBitrate, frameCount, frameMediaTime, frameTimestampUs, type TrimRange } from './videoMath'
import { supportsAudioEncoding } from './videoSupport'

export interface VideoExportOptions {
  /** Размер выходного кадра (чётные, из outputSize). */
  width: number
  height: number
  fps: number
  trim: TrimRange
  muted: boolean
  /** Исходный blob — источник аудиодорожки. */
  sourceBlob: Blob
  /** Перемотать исходник на abs-время (сек) и дождаться готовности кадра. */
  seekVideo: (sec: number) => Promise<void>
  /** Нарисовать композит текущего кадра в canvas; relSec — время от начала трима. */
  renderFrameTo: (canvas: HTMLCanvasElement, relSec: number) => void
  onProgress?: (p: number) => void
  /** Кооперативная отмена (проверяется между кадрами). */
  signal?: { canceled: boolean }
}

export interface VideoExportResult {
  blob: Blob
  hasSound: boolean
}

// Дренаж очереди энкодера, чтобы не копить кадры в памяти на медленной машине.
async function drain(encoder: VideoEncoder): Promise<void> {
  while (encoder.encodeQueueSize > 4) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

export async function exportVideoToMp4(opts: VideoExportOptions): Promise<VideoExportResult> {
  const { width, height, fps, trim, muted, sourceBlob, seekVideo, renderFrameTo, onProgress, signal } = opts

  const { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } =
    await import('mediabunny')

  // Аудиодорожка из исходника (если не mute и есть поддержка).
  let audioBuffer: AudioBuffer | undefined
  if (!muted && (await supportsAudioEncoding())) {
    try {
      audioBuffer = await extractAudioFragment(sourceBlob, trim.startSec, trim.endSec)
    } catch {
      audioBuffer = undefined
    }
  }

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })

  const videoSource = new EncodedVideoPacketSource('avc')
  output.addVideoTrack(videoSource, { frameRate: fps })

  const audioSource = audioBuffer ? new EncodedAudioPacketSource('opus') : undefined
  if (audioSource) output.addAudioTrack(audioSource)

  await output.start()

  // Пакеты добавляются последовательно (порядок декодирования + backpressure),
  // но колбэк энкодера синхронный — сериализуем через промис-цепочку.
  let videoChain: Promise<unknown> = Promise.resolve()
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      videoChain = videoChain.then(() => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta))
      videoChain.catch(() => {})
    },
    error: (e) => console.error('VideoEncoder error:', e),
  })

  const { codec, bitrate } = calcCodecAndBitrate(width, height, fps)
  encoder.configure({ codec, width, height, bitrate, framerate: fps })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const total = frameCount(trim.durationSec, fps)
  for (let i = 0; i < total; i++) {
    if (signal?.canceled) throw new Error('canceled')
    const mediaTime = frameMediaTime(trim, i, fps)
    await seekVideo(mediaTime)
    renderFrameTo(canvas, mediaTime - trim.startSec)
    const frame = new VideoFrame(canvas, { timestamp: frameTimestampUs(i, fps), duration: Math.round(1e6 / fps) })
    encoder.encode(frame)
    frame.close()
    onProgress?.((i + 1) / total)
    await drain(encoder)
  }

  if (audioBuffer && audioSource) {
    await encodeAudio(audioBuffer, (chunk, meta) => audioSource.add(EncodedPacket.fromEncodedChunk(chunk), meta))
  }

  await encoder.flush()
  encoder.close()
  await videoChain
  await output.finalize()

  const buffer = output.target.buffer
  if (!buffer) throw new Error('mux produced no buffer')
  return { blob: new Blob([buffer], { type: 'video/mp4' }), hasSound: !!audioBuffer }
}

// Вырезать фрагмент [startTime, endTime] исходного аудио (порт tweb).
async function extractAudioFragment(blob: Blob, startTime: number, endTime: number): Promise<AudioBuffer> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AC()
  try {
    const arrayBuffer = await blob.arrayBuffer()
    const full = await audioContext.decodeAudioData(arrayBuffer)
    const sampleRate = full.sampleRate
    const startSample = Math.floor(startTime * sampleRate)
    const endSample = Math.floor(endTime * sampleRate)
    const frameCountA = Math.max(1, endSample - startSample)
    const numChannels = full.numberOfChannels
    const fragment = audioContext.createBuffer(numChannels, frameCountA, sampleRate)
    for (let ch = 0; ch < numChannels; ch++) {
      fragment.copyToChannel(full.getChannelData(ch).subarray(startSample, endSample), ch)
    }
    return fragment
  } finally {
    void audioContext.close()
  }
}

// Энкод AudioBuffer → opus, пакеты — через onChunk (порт tweb encodeAndMuxAudio).
async function encodeAudio(
  audioBuffer: AudioBuffer,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => Promise<void>,
): Promise<void> {
  const sampleRate = audioBuffer.sampleRate
  const numChannels = audioBuffer.numberOfChannels
  const totalFrames = audioBuffer.length

  // Интерливинг каналов для WebCodecs (формат f32).
  const interleaved = new Float32Array(totalFrames * numChannels)
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < totalFrames; i++) interleaved[i * numChannels + ch] = channelData[i]
  }

  let addChain: Promise<unknown> = Promise.resolve()
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      addChain = addChain.then(() => onChunk(chunk, meta))
      addChain.catch(() => {})
    },
    error: (e) => console.error('AudioEncoder error:', e),
  })
  encoder.configure({ codec: 'opus', sampleRate, numberOfChannels: numChannels, bitrate: 128000 })

  const audioData = new AudioData({
    format: 'f32',
    sampleRate,
    numberOfFrames: totalFrames,
    numberOfChannels: numChannels,
    timestamp: 0,
    data: interleaved,
  })
  encoder.encode(audioData)
  audioData.close()

  await encoder.flush()
  encoder.close()
  await addChain
}
