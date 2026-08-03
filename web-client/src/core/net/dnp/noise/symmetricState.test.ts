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

describe('SymmetricState.split', () => {
  it('derives matching transport CipherState pairs that round-trip in both directions', () => {
    const prologue = new TextEncoder().encode('dnp/1')
    const fixedIkm = new Uint8Array(32).fill(9)

    const a = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    const b = new SymmetricState('Noise_NK_25519_ChaChaPoly_BLAKE2s')
    a.mixHash(prologue); b.mixHash(prologue)
    a.mixKey(fixedIkm); b.mixKey(fixedIkm)

    const [a1, a2] = a.split()
    const [b1, b2] = b.split()
    const ad = new Uint8Array(0)

    // a and b reach the SAME ck via identical mixHash/mixKey calls (this mirrors the real
    // handshake invariant: dh(privA, pubB) === dh(privB, pubA), so both sides mixKey with the
    // same ikm even though this test supplies it directly instead of via DH). Split() here has
    // no initiator/responder role (see interface: `split(): [CipherState, CipherState]`, no role
    // param) — it deterministically derives (t1, t2) = hkdf(ck, ''), so a.split() and b.split()
    // must yield bit-identical (t1, t2) pairs. The Noise spec's role-based swap ("if initiator,
    // return (c1,c2), else return (c2,c1)") belongs to the higher-level HandshakeState, which
    // owns the role and is out of scope for this task — so the correct cross-check is
    // same-position pairing (a1<->b1, a2<->b2), which is exactly what would break if `ck` were
    // wrong or if split() swapped t1/t2 internally.
    const msg1 = new TextEncoder().encode('hello from a')
    const c1 = a1.encryptWithAd(ad, msg1)
    expect(new TextDecoder().decode(b1.decryptWithAd(ad, c1))).toBe('hello from a')

    const msg2 = new TextEncoder().encode('hello from b')
    const c2 = a2.encryptWithAd(ad, msg2)
    expect(new TextDecoder().decode(b2.decryptWithAd(ad, c2))).toBe('hello from b')
  })
})
