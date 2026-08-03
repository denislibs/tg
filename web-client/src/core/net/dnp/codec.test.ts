import { describe, it, expect } from 'vitest'
import { frameLen, unframeLen, sealFrame, openFrame } from './codec'
import { CipherState } from './noise/symmetricState'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (u: Uint8Array) => new TextDecoder().decode(u)

describe('dnp codec length-framing', () => {
  it('frameLen/unframeLen round-trip incl. empty', () => {
    for (const p of [new Uint8Array(0), new Uint8Array([1]), enc('hello world')]) {
      expect(unframeLen(frameLen(p))).toEqual(p)
    }
  })
  it('frameLen writes a 4-byte big-endian length prefix', () => {
    const out = frameLen(new Uint8Array([9, 9, 9]))
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 3])
  })
  it('unframeLen rejects short header and length mismatch', () => {
    expect(() => unframeLen(new Uint8Array([0, 0]))).toThrow()
    expect(() => unframeLen(new Uint8Array([0, 0, 0, 10, 1, 2]))).toThrow()
  })
})

describe('dnp codec seal/open', () => {
  it('round-trips a JSON frame across two CipherStates with the same key', () => {
    const key = new Uint8Array(32).fill(9)
    const send = new CipherState(key); const recv = new CipherState(key)
    const wire = sealFrame(send, enc('{"t":"ping"}'))
    expect(wire.length).toBeGreaterThan(4 + 16) // len prefix + tag
    expect(dec(openFrame(recv, wire))).toBe('{"t":"ping"}')
  })
})
