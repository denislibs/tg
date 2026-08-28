// Мультиплексор OGG/Opus (порт tweb `helpers/voiceRecorder/oggOpusWriter.ts`).
//
// ЧТО ЛОМАЕТСЯ БЕЗ ЭТОГО. Контейнер — единственная причина, по которой запись
// вообще становится ГОЛОСОВЫМ сообщением (`saveDocument` открывает ветку
// `voice` только на `audio/ogg`), и ошибка в нём не видна на глаз: файл уедет,
// бабл нарисуется, а декодер получит битый поток. Поэтому здесь пинятся именно
// байты страниц — сигнатуры, флаги BOS/EOS, таблица сегментов, granule и CRC.
import { describe, it, expect } from 'vitest'
import OggOpusWriter from './oggOpusWriter'

const ascii = (b: Uint8Array, off: number, len: number) =>
  String.fromCharCode(...b.subarray(off, off + len))

/** Разбор потока на страницы: 27-байтовая шапка + таблица сегментов + данные. */
function pages(stream: Uint8Array) {
  const out: { headerType: number; granule: number; seq: number; crc: number; segments: number[]; payload: Uint8Array; raw: Uint8Array }[] = []
  let off = 0
  while (off < stream.length) {
    const view = new DataView(stream.buffer, stream.byteOffset + off)
    const segCount = stream[off + 26]
    const segments = [...stream.subarray(off + 27, off + 27 + segCount)]
    const payloadLen = segments.reduce((a, b) => a + b, 0)
    const end = off + 27 + segCount + payloadLen
    out.push({
      headerType: stream[off + 5],
      // granule 64-битный; в тестах длительности маленькие — хватает младшего слова
      granule: view.getUint32(6, true),
      seq: view.getUint32(18, true),
      crc: view.getUint32(22, true),
      segments,
      payload: stream.subarray(off + 27 + segCount, end),
      raw: stream.subarray(off, end),
    })
    off = end
  }
  return out
}

/** CRC-32 Ogg (полином 0x04C11DB7, без инверсий) — независимый пересчёт. */
function crc32Ogg(bytes: Uint8Array): number {
  let crc = 0
  for (let i = 0; i < bytes.length; ++i) {
    crc = ((crc << 8) >>> 0) ^ tableEntry((crc >>> 24) ^ bytes[i])
    crc >>>= 0
  }
  return crc >>> 0
}
function tableEntry(index: number): number {
  let r = (index & 0xff) << 24
  for (let j = 0; j < 8; ++j) r = (r & 0x80000000) ? (((r << 1) >>> 0) ^ 0x04c11db7) : ((r << 1) >>> 0)
  return r >>> 0
}

const writer = () => new OggOpusWriter({ channels: 1, inputSampleRate: 48000, serialNumber: 0x11223344 })

describe('OggOpusWriter: заголовочные страницы', () => {
  it('первая страница — BOS с OpusHead, вторая — OpusTags', () => {
    const w = writer()
    w.writePacket(new Uint8Array([1, 2, 3]), 960)
    const [head, tags] = pages(w.finalize())

    expect(ascii(head.raw, 0, 4)).toBe('OggS')
    expect(head.headerType).toBe(0x02) // BOS
    expect(head.seq).toBe(0)
    expect(head.granule).toBe(0)
    expect(ascii(head.payload, 0, 8)).toBe('OpusHead')

    const hv = new DataView(head.payload.buffer, head.payload.byteOffset)
    expect(head.payload[8]).toBe(1) // версия
    expect(head.payload[9]).toBe(1) // каналов
    expect(hv.getUint16(10, true)).toBe(312) // pre-skip (умолчание libopus)
    expect(hv.getUint32(12, true)).toBe(48000)

    expect(tags.headerType).toBe(0)
    expect(tags.seq).toBe(1)
    expect(ascii(tags.payload, 0, 8)).toBe('OpusTags')
  })

  it('setOpusHead кладёт описание энкодера вместо умолчания', () => {
    const w = writer()
    const head = new Uint8Array(19)
    head.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0)
    head[9] = 2 // два канала — маркер «это описание энкодера, а не наше»
    w.setOpusHead(head)
    w.writePacket(new Uint8Array([7]), 960)

    expect(pages(w.finalize())[0].payload[9]).toBe(2)
  })

  it('после первого пакета setOpusHead уже не действует: страницы уехали', () => {
    const w = writer()
    w.writePacket(new Uint8Array([7]), 960)
    const head = new Uint8Array(19)
    head[9] = 2
    w.setOpusHead(head)

    expect(pages(w.finalize())[0].payload[9]).toBe(1)
  })
})

describe('OggOpusWriter: страницы данных', () => {
  it('finalize закрывает поток страницей EOS с итоговым granule', () => {
    const w = writer()
    w.writePacket(new Uint8Array([1, 2]), 960)
    w.writePacket(new Uint8Array([3, 4]), 960)
    const p = pages(w.finalize())
    const last = p[p.length - 1]

    expect(last.headerType).toBe(0x04) // EOS
    expect(last.granule).toBe(1920) // сумма длительностей пакетов
    expect([...last.payload]).toEqual([1, 2, 3, 4])
    expect(last.segments).toEqual([2, 2]) // сегмент на пакет
  })

  it('пакет длиннее 255 байт режется на сегменты по 255 с хвостом', () => {
    const w = writer()
    w.writePacket(new Uint8Array(300), 960)
    const p = pages(w.finalize())

    expect(p[p.length - 1].segments).toEqual([255, 45])
  })

  it('страница закрывается по накопленной длительности (pageGranularitySamples)', () => {
    const w = new OggOpusWriter({ channels: 1, inputSampleRate: 48000, pageGranularitySamples: 1920 })
    w.writePacket(new Uint8Array([1]), 960)
    w.writePacket(new Uint8Array([2]), 960) // здесь порог достигнут → флаш
    w.writePacket(new Uint8Array([3]), 960)
    const p = pages(w.finalize())

    // 2 заголовочные + полная страница + закрывающая
    expect(p.length).toBe(4)
    expect([...p[2].payload]).toEqual([1, 2])
    expect(p[2].headerType).toBe(0)
    expect([...p[3].payload]).toEqual([3])
    expect(p[3].headerType).toBe(0x04)
  })

  it('CRC каждой страницы считается по ней самой с обнулённым полем CRC', () => {
    const w = writer()
    w.writePacket(new Uint8Array([9, 9, 9]), 960)

    for (const page of pages(w.finalize())) {
      const zeroed = new Uint8Array(page.raw)
      zeroed[22] = zeroed[23] = zeroed[24] = zeroed[25] = 0
      expect(page.crc).toBe(crc32Ogg(zeroed))
    }
  })

  it('serial и порядковые номера страниц сквозные', () => {
    const w = writer()
    w.writePacket(new Uint8Array([1]), 960)
    const stream = w.finalize()
    const p = pages(stream)

    p.forEach((page, i) => {
      expect(page.seq).toBe(i)
      expect(new DataView(page.raw.buffer, page.raw.byteOffset).getUint32(14, true)).toBe(0x11223344)
    })
  })

  it('повторный finalize отдаёт тот же поток, второй EOS не дописывается', () => {
    const w = writer()
    w.writePacket(new Uint8Array([1]), 960)
    const first = w.finalize()
    const second = w.finalize()

    expect([...second]).toEqual([...first])
    expect(pages(second).filter((p) => p.headerType === 0x04).length).toBe(1)
  })
})
