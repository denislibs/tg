// Извлекатель waveform голосового при записи — порт tweb
// (src/helpers/voiceWaveformAnalyser.ts) 1:1. Таппит тот же MediaStream, что и
// энкодер, и считает пики из сырого Float32 PCM (как iOS/Android/tdesktop):
//   • per-chunk амплитуда = пик (max abs)
//   • адаптивный лог-даунсэмплинг (iOS) — держим ≤200 бакетов
//   • финал: normPeak = max(sum*1.8/N, 2500); value = min(31, s*31/normPeak)
//   • 5-битная LSB-first упаковка через границы байт
// Пики считаются один раз при записи и передаются/хранятся (не пересчитываются
// каждым получателем из файла).

export const WAVEFORM_SAMPLES_COUNT = 100
export const WAVEFORM_BYTES_LENGTH = Math.ceil((WAVEFORM_SAMPLES_COUNT * 5) / 8) // 63
const DOWNSAMPLE_THRESHOLD = WAVEFORM_SAMPLES_COUNT * 2 // 200
const SCRIPT_PROCESSOR_BUFFER_LENGTH = 4096

/**
 * 5-битная LSB-first упаковка значений 0..31 через границы байт (1:1 tweb finish).
 * n значений → ceil(n*5/8) байт (100 → 63).
 */
export function pack5bit(values: number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil((values.length * 5) / 8))
  for (let i = 0; i < values.length; ++i) {
    const v = values[i] & 31
    const bitOffset = i * 5
    const byteIndex = bitOffset >> 3
    const bitShift = bitOffset & 7
    out[byteIndex] |= (v << bitShift) & 0xff
    if (bitShift > 3 && byteIndex + 1 < out.length) {
      out[byteIndex + 1] |= (v >> (8 - bitShift)) & 0xff
    }
  }
  return out
}

/** Обратная распаковка 5-битных значений (0..31). count — сколько извлечь. */
export function unpack5bit(bytes: Uint8Array, count = WAVEFORM_SAMPLES_COUNT): number[] {
  const out: number[] = []
  for (let i = 0; i < count; ++i) {
    const bitOffset = i * 5
    const byteIndex = bitOffset >> 3
    const bitShift = bitOffset & 7
    let v = bytes[byteIndex] >> bitShift
    if (bitShift > 3 && byteIndex + 1 < bytes.length) {
      v |= bytes[byteIndex + 1] << (8 - bitShift)
    }
    out.push(v & 31)
  }
  return out
}

/** Нормализует бакеты пиков (сырые ~0..32767) в 100 значений 0..31 (1:1 tweb finish). */
export function normalizePeaks(peaks: number[]): number[] {
  const p = peaks.slice(0, WAVEFORM_SAMPLES_COUNT)
  while (p.length < WAVEFORM_SAMPLES_COUNT) p.push(0)
  let sum = 0
  for (let i = 0; i < p.length; ++i) sum += p[i]
  let normPeak = (sum * 1.8) / p.length
  if (normPeak < 2500) normPeak = 2500
  const out: number[] = []
  for (let i = 0; i < p.length; ++i) {
    const clamped = p[i] < normPeak ? p[i] : normPeak
    out.push(Math.min(31, (clamped * 31) / normPeak) | 0)
  }
  return out
}

export default class VoiceWaveformAnalyser {
  private sourceNode: AudioNode
  private scriptProcessor: ScriptProcessorNode
  private peaks: number[] = []
  private currentPeak = 0
  private currentPeakCount = 0
  private peakCompressionFactor = 1
  private finished = false
  private paused = false

  constructor(sourceNode: AudioNode) {
    this.sourceNode = sourceNode
    const context = sourceNode.context
    this.scriptProcessor = context.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER_LENGTH, 1, 1)
    this.scriptProcessor.onaudioprocess = this.onAudioProcess
    sourceNode.connect(this.scriptProcessor)
    // ScriptProcessor шлёт onaudioprocess только будучи в графе; выходной буфер не
    // трогаем — destination получает тишину.
    this.scriptProcessor.connect(context.destination)
  }

  public setPaused(paused: boolean): void {
    this.paused = paused
  }

  /** Сырые текущие пики (для UI-визуализатора во время записи/паузы). */
  public getCurrentPeaks(): number[] {
    return this.peaks.slice()
  }

  private onAudioProcess = (e: AudioProcessingEvent) => {
    if (this.finished || this.paused) return
    const channel = e.inputBuffer.getChannelData(0)
    const len = channel.length
    let peak = this.currentPeak
    let count = this.currentPeakCount
    for (let i = 0; i < len; ++i) {
      const sample = Math.abs(channel[i]) * 32767
      if (sample > peak) peak = sample
      if (++count === this.peakCompressionFactor) {
        this.peaks.push(peak)
        peak = 0
        count = 0
        if (this.peaks.length >= DOWNSAMPLE_THRESHOLD) {
          for (let j = 0; j < WAVEFORM_SAMPLES_COUNT; ++j) {
            const a = this.peaks[j * 2]
            const b = this.peaks[j * 2 + 1]
            this.peaks[j] = a > b ? a : b
          }
          this.peaks.length = WAVEFORM_SAMPLES_COUNT
          this.peakCompressionFactor *= 2
        }
      }
    }
    this.currentPeak = peak
    this.currentPeakCount = count
  }

  /** Останавливает анализ, возвращает 63-байтовый 5-битный waveform. */
  public finish(): Uint8Array {
    if (this.finished) return new Uint8Array(WAVEFORM_BYTES_LENGTH)
    this.finished = true
    try {
      this.sourceNode.disconnect(this.scriptProcessor)
    } catch {
      /* уже отключён */
    }
    this.scriptProcessor.disconnect()
    this.scriptProcessor.onaudioprocess = null
    return pack5bit(normalizePeaks(this.peaks))
  }
}
