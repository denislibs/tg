// Рекордер голосового на штатной платформе, без WASM — порт tweb
// `src/helpers/voiceRecorder/nativeVoiceRecorder.ts`:
//   getUserMedia → AudioContext(48k) → AudioWorklet (отвод PCM) →
//     WebCodecs AudioEncoder (opus) → мультиплексор OGG/Opus.
//
// ПОЧЕМУ НЕ MediaRecorder. Голосовым сообщение делает mime `audio/ogg`
// (`core/media/messageMedia.ts::saveDocument`, порт `appDocsManager.saveDoc:157`),
// а `MediaRecorder` отдаёт ogg только в Firefox — в Chrome это webm, в Safari
// mp4. Оригинал по этой же причине пишет голос своим кодеком: WebCodecs, где он
// есть (`chatRecording.ts:141`), и opus-recorder на WASM там, где его нет
// (`chatRecording.ts:150`, чанк грузится лениво — `bootstrapIm.ts:34-37`).
//
// ── Отступления от оригинала ────────────────────────────────────────────────
//  • поток открываем `navigator.mediaDevices.getUserMedia`, а не через
//    `getStream` звонков: у оригинала это общая точка с самолечением выбранного
//    в настройках микрофона, а у нас выбора микрофона нет вовсе — вместе с ним
//    не портирован и `setMicrophoneId`;
//  • `getSnapshot()` (проигрываемый срез недописанного ogg) нет — см. ту же
//    причину, что у `snapshot()` в `oggOpusWriter.ts`;
//  • `notifySamples` нет: живую волну у нас снимает `AnalyserNode`, повешенный
//    на `sourceNode` рекордера, — ровно так же, как оригинал вешает на него
//    свои анализаторы (`chatRecording.ts:1027-1029`).
import OggOpusWriter from './oggOpusWriter'

const WORKLET_SOURCE = `
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.bufferSize = opts.bufferSize || 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if(!input || !input[0] || input[0].length === 0) return true;
    const channel = input[0];
    let i = 0;
    while(i < channel.length) {
      const remaining = this.bufferSize - this.bufferIndex;
      const toCopy = remaining < (channel.length - i) ? remaining : (channel.length - i);
      this.buffer.set(channel.subarray(i, i + toCopy), this.bufferIndex);
      this.bufferIndex += toCopy;
      i += toCopy;
      if(this.bufferIndex === this.bufferSize) {
        this.port.postMessage(this.buffer.slice(0));
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
`

const WORKLET_PROCESSOR_NAME = 'voice-capture-processor'
const WORKLET_BUFFER_SIZE = 2048
const ENCODER_SAMPLE_RATE = 48000
const DEFAULT_BITRATE = 32000
const DEFAULT_FRAME_DURATION_US = 20000
const DEFAULT_OPUS_FRAME_SAMPLES = (DEFAULT_FRAME_DURATION_US * ENCODER_SAMPLE_RATE) / 1_000_000

interface RecorderGlobal {
  AudioEncoder?: unknown
  AudioData?: unknown
  AudioWorkletNode?: unknown
  AudioContext?: unknown
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
}

/** Порт tweb `isNativeVoiceRecorderSupported` (`voiceRecorder/isNativeSupported.ts`).
 *  Инъекция global — наш тестовый шов (как в `mediaEditor/videoSupport.ts`):
 *  в среде тестов WebCodecs и AudioWorklet нет. */
export function isNativeVoiceRecorderSupported(g: RecorderGlobal = globalThis as RecorderGlobal): boolean {
  return typeof g.AudioEncoder === 'function'
    && typeof g.AudioData === 'function'
    && typeof g.AudioWorkletNode === 'function'
    && typeof g.AudioContext === 'function'
    && typeof g.navigator?.mediaDevices?.getUserMedia === 'function'
}

export interface NativeVoiceRecorderConfig {
  encoderSampleRate?: number
  numberOfChannels?: number
  encoderBitRate?: number
  mediaTrackConstraints?: boolean | MediaTrackConstraints
}

type State = 'inactive' | 'recording' | 'paused'

export default class NativeVoiceRecorder {
  /** Узел графа, с которого снимают волну (порт: на него оригинал вешает свои
   *  анализаторы — `chatRecording.ts:1027-1029`). */
  public sourceNode!: MediaStreamAudioSourceNode
  public state: State = 'inactive'

  public onstop: () => void = () => {}
  public ondataavailable: (data: Uint8Array) => void = () => {}

  private config: Required<NativeVoiceRecorderConfig>

  private stream!: MediaStream
  private audioContext!: AudioContext
  private workletNode!: AudioWorkletNode
  private encoder!: AudioEncoder
  private writer!: OggOpusWriter
  private workletUrl?: string
  private encoderTimestampUs = 0
  private opusHeadCaptured = false

  constructor(config: NativeVoiceRecorderConfig = {}) {
    this.config = {
      encoderSampleRate: config.encoderSampleRate ?? ENCODER_SAMPLE_RATE,
      numberOfChannels: config.numberOfChannels ?? 1,
      encoderBitRate: config.encoderBitRate ?? DEFAULT_BITRATE,
      mediaTrackConstraints: config.mediaTrackConstraints ?? true,
    }
  }

  public async start(): Promise<void> {
    if (this.state !== 'inactive') return

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: this.config.mediaTrackConstraints })

    this.audioContext = new AudioContext({ sampleRate: this.config.encoderSampleRate })
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)

    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' })
    this.workletUrl = URL.createObjectURL(blob)
    await this.audioContext.audioWorklet.addModule(this.workletUrl)

    this.workletNode = new AudioWorkletNode(this.audioContext, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [this.config.numberOfChannels],
      processorOptions: { bufferSize: WORKLET_BUFFER_SIZE },
    })

    this.writer = new OggOpusWriter({
      channels: this.config.numberOfChannels,
      inputSampleRate: this.config.encoderSampleRate,
    })

    this.encoder = new AudioEncoder({
      output: (chunk, metadata) => this.onEncoderChunk(chunk, metadata),
      error: (err) => console.error('[NativeVoiceRecorder] encoder error:', err),
    })

    this.encoder.configure({
      codec: 'opus',
      sampleRate: this.config.encoderSampleRate,
      numberOfChannels: this.config.numberOfChannels,
      bitrate: this.config.encoderBitRate,
    })

    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => this.onWorkletMessage(e.data)

    this.sourceNode.connect(this.workletNode)
    // AudioWorkletNode вызывает process() только будучи в графе с потребителем;
    // выход молчит — в него мы ничего не пишем.
    this.workletNode.connect(this.audioContext.destination)

    this.state = 'recording'
    this.encoderTimestampUs = 0
    this.opusHeadCaptured = false
  }

  private onWorkletMessage(samples: Float32Array): void {
    if (this.state !== 'recording') return
    const numberOfFrames = samples.length / this.config.numberOfChannels
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: this.config.encoderSampleRate,
      numberOfFrames,
      numberOfChannels: this.config.numberOfChannels,
      timestamp: this.encoderTimestampUs,
      data: samples.slice(),
    })
    this.encoderTimestampUs += (numberOfFrames * 1_000_000) / this.config.encoderSampleRate
    try {
      this.encoder.encode(audioData)
    } catch (err) {
      console.error('[NativeVoiceRecorder] encode error:', err)
    }
    audioData.close()
  }

  private onEncoderChunk(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void {
    if (!this.opusHeadCaptured && metadata?.decoderConfig?.description) {
      const desc = metadata.decoderConfig.description
      const bytes = desc instanceof ArrayBuffer
        ? new Uint8Array(desc)
        : new Uint8Array((desc as ArrayBufferView).buffer as ArrayBuffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength)
      this.writer.setOpusHead(bytes)
      this.opusHeadCaptured = true
    }

    const data = new Uint8Array(chunk.byteLength)
    chunk.copyTo(data)

    const durationUs = chunk.duration ?? DEFAULT_FRAME_DURATION_US
    const durationSamples = Math.round((durationUs * ENCODER_SAMPLE_RATE) / 1_000_000) || DEFAULT_OPUS_FRAME_SAMPLES
    this.writer.writePacket(data, durationSamples)
  }

  /** Пауза держит цепочку worklet → энкодер собранной и просто перестаёт
   *  принимать PCM; энкодер флашится, чтобы снятый ogg оставался проигрываемым. */
  public async pause(): Promise<void> {
    if (this.state !== 'recording') return
    this.state = 'paused'
    if (this.encoder && this.encoder.state !== 'closed') {
      try {
        await this.encoder.flush()
      } catch { /* энкодер уже закрыт */ }
    }
  }

  public resume(): void {
    if (this.state !== 'paused') return
    this.state = 'recording'
  }

  public async stop(): Promise<void> {
    if (this.state === 'inactive') return
    this.state = 'inactive'

    try {
      this.sourceNode?.disconnect()
    } catch { /* уже отключён */ }
    if (this.workletNode) {
      try {
        this.workletNode.disconnect()
      } catch { /* уже отключён */ }
      this.workletNode.port.onmessage = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
    }

    if (this.encoder && this.encoder.state !== 'closed') {
      try {
        await this.encoder.flush()
      } catch (e) {
        console.error('[NativeVoiceRecorder] flush error:', e)
      }
      try {
        this.encoder.close()
      } catch { /* уже закрыт */ }
    }

    const ogg = this.writer ? this.writer.finalize() : new Uint8Array(0)

    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = undefined
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close()
      } catch { /* уже закрыт */ }
    }

    this.ondataavailable(ogg)
    this.onstop()
  }
}
