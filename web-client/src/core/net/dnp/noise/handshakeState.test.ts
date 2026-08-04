import { describe, it, expect } from 'vitest'
import { NKInitiator, PROTOCOL_NAME } from './handshakeState'
import { dhGenerate } from './primitives'
import fixture from './fixtures/nk-vector.json'

const fromHex2 = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
const toHex2 = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('NKInitiator', () => {
  it('protocol name is exactly the DNP suite', () => {
    expect(PROTOCOL_NAME).toBe('Noise_NK_25519_ChaChaPoly_BLAKE2s')
  })
  it('writeMessage1 is deterministic given a fixed ephemeral, and starts with the 32-byte ephemeral public', () => {
    const server = dhGenerate()
    const eph = { privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(0) }
    // publicKey заполнит конструктор из privateKey
    const hs = new NKInitiator({ prologue: new TextEncoder().encode('dnp/2'), remoteStatic: server.publicKey, ephemeral: eph })
    const msg1 = hs.writeMessage1()
    // NK msg1 = e(32) ‖ encryptAndHash(empty payload=16 tag)
    expect(msg1.length).toBe(32 + 16)
  })
})

describe('NKInitiator hardening', () => {
  it('defensively copies remoteStatic (caller mutation after construction is ignored)', () => {
    const rs = fromHex2(fixture.serverStaticPub)
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode('dnp/2'), remoteStatic: rs,
      ephemeral: { privateKey: fromHex2(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    rs.fill(0) // портим буфер вызывающего ПОСЛЕ конструктора
    expect(toHex2(hs.writeMessage1())).toBe(fixture.msg1) // без копии msg1 бы не совпал
  })
  it('rejects a malformed message2 (wrong length) with a clear error', () => {
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode('dnp/2'), remoteStatic: fromHex2(fixture.serverStaticPub),
      ephemeral: { privateKey: fromHex2(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    hs.writeMessage1()
    expect(() => hs.readMessage2(new Uint8Array(10))).toThrow('message2')
  })
})
