import { describe, it, expect } from 'vitest'
import { hkdf, nonce8, CipherState, SymmetricState } from './symmetricState'
import { hmacBlake2s } from './primitives'

describe('Noise HKDF (HMAC-BLAKE2s)', () => {
  it('matches the Noise 2-output construction', () => {
    const ck = new Uint8Array(32).fill(3); const ikm = new Uint8Array(32).fill(4)
    const [o1, o2] = hkdf(ck, ikm, 2)
    const tempKey = hmacBlake2s(ck, ikm)
    const exp1 = hmacBlake2s(tempKey, new Uint8Array([1]))
    const exp2 = hmacBlake2s(tempKey, new Uint8Array([...exp1, 2]))
    expect(o1).toEqual(exp1); expect(o2).toEqual(exp2)
  })
})

describe('nonce8', () => {
  it('is 12 bytes: 4 zero prefix + 8-byte little-endian counter', () => {
    expect([...nonce8(0n)]).toEqual(Array(12).fill(0))
    const n = nonce8(1n)
    expect([...n.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect(n[4]).toBe(1); expect([...n.slice(5)]).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})

describe('CipherState', () => {
  it('round-trips and advances the nonce', () => {
    const key = new Uint8Array(32).fill(5)
    const send = new CipherState(key); const recv = new CipherState(key)
    const ad = new Uint8Array(0)
    const c1 = send.encryptWithAd(ad, new TextEncoder().encode('one'))
    const c2 = send.encryptWithAd(ad, new TextEncoder().encode('two'))
    expect(new TextDecoder().decode(recv.decryptWithAd(ad, c1))).toBe('one')
    expect(new TextDecoder().decode(recv.decryptWithAd(ad, c2))).toBe('two')
  })
})

describe('SymmetricState', () => {
  it('two independent instances stay in lockstep (mixKey/mixHash/encrypt/decrypt)', () => {
    const a = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    const b = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    a.mixHash(new TextEncoder().encode('dnp/1')); b.mixHash(new TextEncoder().encode('dnp/1'))
    a.mixKey(new Uint8Array(32).fill(9)); b.mixKey(new Uint8Array(32).fill(9))
    const ct = a.encryptAndHash(new TextEncoder().encode('payload'))
    expect(new TextDecoder().decode(b.decryptAndHash(ct))).toBe('payload')
    expect(a.h).toEqual(b.h)
  })
})
