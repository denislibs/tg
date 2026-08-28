// Контейнер OGG для пакетов Opus (RFC 7845 «Opus-in-Ogg» + RFC 3533 «Ogg») —
// порт tweb `src/helpers/voiceRecorder/oggOpusWriter.ts` 1:1.
//
// ЗАЧЕМ ОН ВООБЩЕ ЕСТЬ. Тип документа выводится из mime: голосовым сообщение
// становится только при `audio/ogg` (`core/media/messageMedia.ts::saveDocument`,
// порт `appDocsManager.saveDoc:157`). `MediaRecorder` в Chrome/Safari отдаёт
// ТОЛЬКО webm/mp4, поэтому оригинал и не пользуется им для голоса: он кодирует
// opus сам (WebCodecs `AudioEncoder`, а на старых браузерах — opus-recorder на
// WASM) и заворачивает пакеты в ogg вот этим мультиплексором.
//
// ── Отступление от оригинала ────────────────────────────────────────────────
// Метода `snapshot()` (проигрываемый срез недописанного ogg) здесь нет: он
// нужен оригиналу для прослушивания записи на паузе, а у нас этой кнопки нет
// (см. `components/composer/VoiceRecordingPanel.tsx` — заглушка «прослушать
// нельзя»). Появится кнопка — вернётся и срез, вместе с `getSnapshot` рекордера.

const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; ++i) {
    let r = i << 24
    for (let j = 0; j < 8; ++j) {
      r = (r & 0x80000000) ? (((r << 1) >>> 0) ^ 0x04c11db7) : ((r << 1) >>> 0)
    }
    table[i] = r >>> 0
  }
  return table
})()

function oggCrc(bytes: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < bytes.length; ++i) {
    crc = (((crc << 8) >>> 0) ^ OGG_CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0
  }
  return crc >>> 0
}

// OpusHead на случай, когда энкодер не отдал своё описание. Pre-skip 312
// сэмплов — значение libopus по умолчанию для свежего энкодера на 48 кГц.
function buildOpusHead(channels: number, inputSampleRate: number, preSkip: number): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0) // 'OpusHead'
  head[8] = 1
  head[9] = channels
  view.setUint16(10, preSkip, true)
  view.setUint32(12, inputSampleRate, true)
  view.setInt16(16, 0, true)
  head[18] = 0
  return head
}

function buildOpusTags(vendor: string): Uint8Array {
  const enc = new TextEncoder()
  const v = enc.encode(vendor)
  const tags = new Uint8Array(8 + 4 + v.length + 4)
  const view = new DataView(tags.buffer)
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0) // 'OpusTags'
  view.setUint32(8, v.length, true)
  tags.set(v, 12)
  view.setUint32(12 + v.length, 0, true) // комментариев нет
  return tags
}

const OGG_HEADER_TYPE_BOS = 0x02
const OGG_HEADER_TYPE_EOS = 0x04

const MAX_PAGE_SEGMENTS = 255
const MAX_SEGMENT_LEN = 255

export interface OggOpusWriterOptions {
  channels: number
  inputSampleRate: number
  vendor?: string
  preSkip?: number
  serialNumber?: number
  pageGranularitySamples?: number
}

export default class OggOpusWriter {
  private channels: number
  private inputSampleRate: number
  private vendor: string
  private preSkip: number
  private serial: number
  private pageGranularitySamples: number

  private pageSequence = 0
  private granulePosition = 0
  private pageBuffer: Uint8Array[] = []
  private samplesInCurrentPage = 0
  private chunks: Uint8Array[] = []
  private headersWritten = false
  private finalized = false

  constructor(options: OggOpusWriterOptions) {
    this.channels = options.channels
    this.inputSampleRate = options.inputSampleRate
    this.vendor = options.vendor ?? 'tweb'
    this.preSkip = options.preSkip ?? 312
    this.serial = options.serialNumber ?? ((Math.random() * 0xffffffff) >>> 0)
    this.pageGranularitySamples = options.pageGranularitySamples ?? 48000
  }

  /** Подменяет OpusHead по умолчанию тем, что отдал энкодер
   *  (`EncodedAudioChunkMetadata.decoderConfig.description`). Только ДО первого
   *  `writePacket()` — заголовочные страницы уже уехали бы в поток. */
  public setOpusHead(opusHead: Uint8Array): void {
    if (this.headersWritten) return
    this.writeHeaderPagesWith(opusHead)
  }

  private ensureHeadersWritten(): void {
    if (this.headersWritten) return
    this.writeHeaderPagesWith(buildOpusHead(this.channels, this.inputSampleRate, this.preSkip))
  }

  private writeHeaderPagesWith(opusHead: Uint8Array): void {
    this.emitPage([opusHead], 0, OGG_HEADER_TYPE_BOS)
    this.emitPage([buildOpusTags(this.vendor)], 0, 0)
    this.headersWritten = true
  }

  public writePacket(packet: Uint8Array, durationSamples: number): void {
    if (this.finalized) return
    this.ensureHeadersWritten()

    this.pageBuffer.push(packet)
    this.samplesInCurrentPage += durationSamples
    this.granulePosition += durationSamples

    if (this.shouldFlushPage()) {
      this.flushDataPage(false)
    }
  }

  private shouldFlushPage(): boolean {
    if (this.pageBuffer.length >= MAX_PAGE_SEGMENTS) return true
    if (this.samplesInCurrentPage >= this.pageGranularitySamples) return true

    let segmentCount = 0
    for (let i = 0; i < this.pageBuffer.length; ++i) {
      segmentCount += Math.floor(this.pageBuffer[i].length / MAX_SEGMENT_LEN) + 1
      if (segmentCount >= MAX_PAGE_SEGMENTS) return true
    }
    return false
  }

  private flushDataPage(eos: boolean): void {
    if (!this.pageBuffer.length) {
      if (eos) this.emitPage([], this.granulePosition, OGG_HEADER_TYPE_EOS)
      return
    }
    this.emitPage(this.pageBuffer, this.granulePosition, eos ? OGG_HEADER_TYPE_EOS : 0)
    this.pageBuffer = []
    this.samplesInCurrentPage = 0
  }

  private emitPage(packets: Uint8Array[], granulePos: number, headerType: number): void {
    const page = this.buildPage(packets, granulePos, headerType, this.pageSequence++)
    this.chunks.push(page)
  }

  private buildPage(packets: Uint8Array[], granulePos: number, headerType: number, pageSequence: number): Uint8Array {
    const segments: number[] = []
    let payloadLen = 0
    for (let i = 0; i < packets.length; ++i) {
      const len = packets[i].length
      const full = Math.floor(len / MAX_SEGMENT_LEN)
      for (let j = 0; j < full; ++j) segments.push(MAX_SEGMENT_LEN)
      segments.push(len % MAX_SEGMENT_LEN)
      payloadLen += len
    }

    const segCount = segments.length
    const page = new Uint8Array(27 + segCount + payloadLen)
    const view = new DataView(page.buffer)

    page.set([0x4f, 0x67, 0x67, 0x53], 0) // 'OggS'
    page[4] = 0
    page[5] = headerType
    view.setUint32(6, (granulePos >>> 0), true)
    view.setUint32(10, (Math.floor(granulePos / 0x100000000) >>> 0), true)
    view.setUint32(14, this.serial, true)
    view.setUint32(18, pageSequence, true)
    view.setUint32(22, 0, true)
    page[26] = segCount
    for (let i = 0; i < segCount; ++i) page[27 + i] = segments[i]

    let off = 27 + segCount
    for (let i = 0; i < packets.length; ++i) {
      page.set(packets[i], off)
      off += packets[i].length
    }

    view.setUint32(22, oggCrc(page), true)
    return page
  }

  public finalize(): Uint8Array {
    if (this.finalized) return this.concat()
    this.ensureHeadersWritten()
    this.flushDataPage(true)
    this.finalized = true
    return this.concat()
  }

  private concat(): Uint8Array {
    let total = 0
    for (let i = 0; i < this.chunks.length; ++i) total += this.chunks[i].length
    const out = new Uint8Array(total)
    let off = 0
    for (let i = 0; i < this.chunks.length; ++i) {
      out.set(this.chunks[i], off)
      off += this.chunks[i].length
    }
    return out
  }
}
