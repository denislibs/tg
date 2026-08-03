import { describe, it, expect } from 'vitest'
import { dhGenerate, dhPublic, dh, hashBlake2s, hmacBlake2s, aeadSeal, aeadOpen } from './primitives'

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('noise primitives (@noble adapter)', () => {
  it('x25519 DH agreement + pubkey derivation, 32-byte keys', () => {
    const a = dhGenerate(); const b = dhGenerate()
    expect(a.publicKey.length).toBe(32)
    expect(dhPublic(a.privateKey)).toEqual(a.publicKey)
    expect(dh(a.privateKey, b.publicKey)).toEqual(dh(b.privateKey, a.publicKey))
  })
  it('BLAKE2s-256 known-answer for "abc"', () => {
    // Стандартный вектор BLAKE2s-256("abc"). Если установленная либа не сходится —
    // сперва перепроверь вектор, потом ищи баг.
    expect(hex(hashBlake2s(new TextEncoder().encode('abc'))))
      .toBe('508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982')
  })
  it('HMAC-BLAKE2s is deterministic and 32 bytes', () => {
    const k = new Uint8Array(32).fill(1); const m = new Uint8Array(8).fill(2)
    const a = hmacBlake2s(k, m); const b = hmacBlake2s(k, m)
    expect(a).toEqual(b); expect(a.length).toBe(32)
  })
  it('ChaCha20-Poly1305 seal/open round-trip with AAD, tag appended', () => {
    const key = new Uint8Array(32).fill(7)
    const nonce = new Uint8Array(12); nonce[4] = 1
    const ad = new Uint8Array([9, 9]); const pt = new TextEncoder().encode('hello')
    const ct = aeadSeal(key, nonce, ad, pt)
    expect(ct.length).toBe(pt.length + 16) // Poly1305 tag
    expect(aeadOpen(key, nonce, ad, ct)).toEqual(pt)
  })
})
