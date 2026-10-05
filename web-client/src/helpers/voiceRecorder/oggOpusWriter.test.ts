// OGG/Opus-мультиплексор нативного рекордера голоса (порт tweb `oggOpusWriter.ts`):
// страницы по RFC 3533 с верной CRC, заголовки OpusHead/OpusTags первыми двумя страницами,
// гранула — сумма длительностей пакетов, снимок на паузе закрыт EOS и не трогает писателя.
import { describe, expect, it } from 'vitest'
import OggOpusWriter from './oggOpusWriter'

type Page = { headerType: number, granule: number, sequence: number, segments: number[], payload: Uint8Array, crcOk: boolean }

function crc(bytes: Uint8Array) {
  let c = 0
  for(const b of bytes) {
    c ^= b << 24
    for(let i = 0; i < 8; ++i) c = (c & 0x80000000) ? ((c << 1) ^ 0x04C11DB7) : (c << 1)
    c >>>= 0
  }
  return c >>> 0
}

function parsePages(ogg: Uint8Array): Page[] {
  const pages: Page[] = []
  let off = 0
  while(off < ogg.length) {
    const view = new DataView(ogg.buffer, ogg.byteOffset + off)
    expect(String.fromCharCode(...ogg.subarray(off, off + 4))).toBe('OggS')
    const segCount = ogg[off + 26]
    const segments = Array.from(ogg.subarray(off + 27, off + 27 + segCount))
    const payloadLen = segments.reduce((a, b) => a + b, 0)
    const size = 27 + segCount + payloadLen
    const page = ogg.slice(off, off + size)
    const storedCrc = view.getUint32(22, true)
    new DataView(page.buffer).setUint32(22, 0, true)
    pages.push({
      headerType: ogg[off + 5],
      granule: view.getUint32(6, true) + view.getUint32(10, true) * 0x100000000,
      sequence: view.getUint32(18, true),
      segments,
      payload: ogg.slice(off + 27 + segCount, off + size),
      crcOk: crc(page) === storedCrc,
    })
    off += size
  }
  return pages
}

const packet = (len: number, fill = 7) => new Uint8Array(len).fill(fill)

describe('OggOpusWriter', () => {
  it('BOS-страница с OpusHead, затем OpusTags, затем данные; CRC каждой страницы сходится', () => {
    const writer = new OggOpusWriter({ channels: 1, inputSampleRate: 48000, serialNumber: 42 })
    writer.writePacket(packet(30), 960)
    writer.writePacket(packet(40), 960)
    const pages = parsePages(writer.finalize())

    expect(pages.map((p) => p.sequence)).toEqual([0, 1, 2])
    expect(pages.every((p) => p.crcOk)).toBe(true)
    expect(pages[0].headerType).toBe(0x02)
    expect(String.fromCharCode(...pages[0].payload.subarray(0, 8))).toBe('OpusHead')
    expect(pages[0].payload[9]).toBe(1) // каналы
    expect(String.fromCharCode(...pages[1].payload.subarray(0, 8))).toBe('OpusTags')
    // последняя страница — EOS, гранула = сумма длительностей пакетов
    expect(pages[2].headerType).toBe(0x04)
    expect(pages[2].granule).toBe(1920)
    expect(pages[2].segments).toEqual([30, 40])
  })

  it('пакет длиннее 255 байт режется на сегменты 255 + остаток', () => {
    const writer = new OggOpusWriter({ channels: 1, inputSampleRate: 48000 })
    writer.writePacket(packet(600), 960)
    const pages = parsePages(writer.finalize())
    expect(pages[2].segments).toEqual([255, 255, 90])
  })

  it('OpusHead от энкодера заменяет собранный по умолчанию', () => {
    const writer = new OggOpusWriter({ channels: 1, inputSampleRate: 48000 })
    const head = new Uint8Array([0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 0x38, 0x01, 0x80, 0xBB, 0, 0, 0, 0, 0])
    writer.setOpusHead(head)
    writer.writePacket(packet(10), 960)
    expect(parsePages(writer.finalize())[0].payload).toEqual(head)
  })

  it('страница сбрасывается по секунде звука (pageGranularitySamples), гранулы растут', () => {
    const writer = new OggOpusWriter({ channels: 1, inputSampleRate: 48000 })
    for(let i = 0; i < 75; ++i) writer.writePacket(packet(20), 960) // 1,5 с по 20 мс
    const pages = parsePages(writer.finalize())
    const data = pages.slice(2)
    expect(data.map((p) => p.granule)).toEqual([48000, 72000])
    expect(data.map((p) => p.headerType)).toEqual([0, 0x04])
  })

  it('снимок на паузе закрыт EOS-страницей, а писатель продолжает с того же места', () => {
    const writer = new OggOpusWriter({ channels: 1, inputSampleRate: 48000 })
    expect(writer.snapshot()).toHaveLength(0) // до первого пакета играть нечего
    writer.writePacket(packet(20), 960)

    const snap = parsePages(writer.snapshot())
    expect(snap[snap.length - 1].headerType).toBe(0x04)
    expect(snap[snap.length - 1].granule).toBe(960)
    expect(snap.every((p) => p.crcOk)).toBe(true)

    writer.writePacket(packet(20), 960)
    const final = parsePages(writer.finalize())
    expect(final.map((p) => p.sequence)).toEqual([0, 1, 2])
    expect(final[2].granule).toBe(1920)
    expect(final[2].segments).toEqual([20, 20])
  })
})
