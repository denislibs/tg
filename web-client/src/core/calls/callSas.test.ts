import { describe, expect, it } from 'vitest'
import {
  canonicalFingerprints, computeCallSas, createDtlsIdentity, dhCommitment, extractDtlsFingerprints, parsePeerFingerprints,
  sameFingerprints,
} from './callSas'

describe('callSas: отпечатки DTLS', () => {
  it('extractDtlsFingerprints canonicalizes and dedups', () => {
    const sdp = 'v=0\r\na=fingerprint:SHA-256 ab:cd\r\nm=audio\r\na=fingerprint:sha-256 AB:CD\r\na=fingerprint:sha-1 01:02\r\n'
    expect(extractDtlsFingerprints(sdp)).toEqual(['sha-1 01:02', 'sha-256 AB:CD'])
  })

  it('canonicalFingerprints matches SDP form', () => {
    expect(canonicalFingerprints([{ algorithm: 'SHA-256', value: 'ab:cd' }])).toEqual(['sha-256 AB:CD'])
  })

  it('SDP без a=fingerprint даёт пустой набор', () => {
    expect(extractDtlsFingerprints('v=0\r\nm=audio\r\n')).toEqual([])
  })

  it('sameFingerprints: точное равенство множеств, пустой набор не равен непустому', () => {
    expect(sameFingerprints(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameFingerprints(['a'], ['a', 'b'])).toBe(false)
    expect(sameFingerprints(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(sameFingerprints([], ['a'])).toBe(false)
  })
})

describe('callSas: строгий разбор SDP (браузер может быть мягче регэкспа)', () => {
  const ok = 'v=0\r\na=fingerprint:sha-256 AB:CD\r\n'
  it('канонический вид принимается, в том числе с LF и без хвостового перевода', () => {
    expect(extractDtlsFingerprints(ok)).toEqual(['sha-256 AB:CD'])
    expect(extractDtlsFingerprints('a=fingerprint:sha-256 ab:cd')).toEqual(['sha-256 AB:CD'])
    expect(extractDtlsFingerprints('v=0\na=fingerprint:sha-256 AB:CD\nm=audio\n')).toEqual(['sha-256 AB:CD'])
  })
  it.each([
    ['пробел после двоеточия', 'a=fingerprint: sha-256 AB:CD\r\n'],
    ['табуляция', 'a=fingerprint:\tsha-256 AB:CD\r\n'],
    ['пробел перед двоеточием', 'a=fingerprint :sha-256 AB:CD\r\n'],
    ['хвостовой пробел', 'a=fingerprint:sha-256 AB:CD \r\n'],
    ['два пробела между алгоритмом и значением', 'a=fingerprint:sha-256  AB:CD\r\n'],
    ['одиночный \\r внутри строки', 'a=foo\ra=fingerprint:sha-256 AB:CD\r\n'],
    ['необычный регистр ключа', 'A=FINGERPRINT:sha-256 AB:CD\r\n'],
    ['значение не hex', 'a=fingerprint:sha-256 ZZ:CD\r\n'],
    ['значение без двоеточий', 'a=fingerprint:sha-256 ABCD\r\n'],
    ['слово fingerprint в другом атрибуте', 'a=x-fingerprint:sha-256 AB:CD\r\n'],
  ])('отвергает: %s', (_n, extra) => {
    expect(() => extractDtlsFingerprints(ok + extra)).toThrow()
  })
})

describe('callSas: parsePeerFingerprints (чужой кадр)', () => {
  it('принимает канонический набор', () => {
    expect(parsePeerFingerprints(['sha-1 01:02', 'sha-256 AB:CD'])).toEqual(['sha-1 01:02', 'sha-256 AB:CD'])
  })
  it.each([
    ['не массив', 'sha-256 AB'],
    ['пустой', []],
    ['не строка', [1]],
    ['перевод строки внутри (сдвиг границы в склейке)', ['sha-256 AB\nsha-256 CD']],
    ['нулевой байт', ['sha-256 AB\u0000']],
    ['нижний регистр значения', ['sha-256 ab:cd']],
    ['не по возрастанию', ['sha-256 BB', 'sha-256 AA']],
    ['повтор', ['sha-256 AA', 'sha-256 AA']],
    ['слишком длинный', Array.from({ length: 9 }, (_, i) => `sha-${i} AA`)],
  ])('отвергает: %s', (_n, v) => {
    expect(parsePeerFingerprints(v)).toBeNull()
  })
})

describe('callSas: коммитмент и SAS', () => {
  it('dhCommitment binds key and fingerprints', async () => {
    const pub = new Uint8Array([1, 2, 3])
    expect(await dhCommitment(pub, [])).toBe('A5BYxvLAy0ksUzsKTRTvd8wPeKvMztUofYShogEc+4E=') // SHA-256(010203)
    expect(await dhCommitment(pub, ['sha-256 AA'])).not.toBe(await dhCommitment(pub, ['sha-256 AB']))
    expect(await dhCommitment(new Uint8Array([1, 2, 4]), ['sha-256 AA'])).not.toBe(await dhCommitment(pub, ['sha-256 AA']))
  })

  it('computeCallSas depends on both sets and roles', async () => {
    const dh = new Uint8Array(32).fill(7)
    const a = await computeCallSas(dh, ['sha-256 AA'], ['sha-256 BB'])
    expect(a).toEqual(await computeCallSas(dh, ['sha-256 AA'], ['sha-256 BB']))
    expect(a).not.toEqual(await computeCallSas(dh, ['sha-256 AA'], ['sha-256 BC']))
    expect(a).not.toEqual(await computeCallSas(dh, ['sha-256 BB'], ['sha-256 AA']))
    expect(a).not.toEqual(await computeCallSas(new Uint8Array(32).fill(8), ['sha-256 AA'], ['sha-256 BB']))
  })

  it('computeCallSas: граница между наборами однозначна (перенос строки между наборами меняет SAS)', async () => {
    const dh = new Uint8Array(32).fill(7)
    expect(await computeCallSas(dh, ['x', 'y'], ['z'])).not.toEqual(await computeCallSas(dh, ['x'], ['y', 'z']))
  })
})

describe('callSas: createDtlsIdentity', () => {
  it('берёт отпечатки из SDP временного pc с этим сертификатом и закрывает его', async () => {
    const closed: string[] = []
    class PC {
      static generateCertificate = async () => ({ expires: 1, tag: 'cert-1' })
      certs: unknown[]
      constructor(cfg?: { certificates?: Array<{ tag: string }> }) { this.certs = cfg?.certificates ?? [] }
      createDataChannel() { return {} }
      async createOffer() {
        const tag = (this.certs[0] as { tag: string }).tag
        return { type: 'offer', sdp: `v=0\r\na=fingerprint:sha-256 ${tag === 'cert-1' ? 'ab:cd' : 'ff'}\r\n` }
      }
      close() { closed.push('x') }
    }
    const prev = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
    ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = PC
    try {
      const id = await createDtlsIdentity()
      expect(id.fps).toEqual(['sha-256 AB:CD'])
      expect((id.cert as unknown as { tag: string }).tag).toBe('cert-1')
      expect(closed).toHaveLength(1)
    } finally {
      ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = prev
    }
  })

  it('бросает, если generateCertificate недоступен', async () => {
    const prev = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
    ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = class {}
    try {
      await expect(createDtlsIdentity()).rejects.toThrow()
    } finally {
      ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = prev
    }
  })

  it('бросает, если в SDP нет a=fingerprint, и закрывает pc', async () => {
    let closed = 0
    class PC {
      static generateCertificate = async () => ({})
      createDataChannel() { return {} }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' } }
      close() { closed++ }
    }
    const prev = (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
    ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = PC
    try {
      await expect(createDtlsIdentity()).rejects.toThrow()
      expect(closed).toBe(1)
    } finally {
      ;(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = prev
    }
  })
})
