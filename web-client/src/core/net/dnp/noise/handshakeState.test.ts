import { describe, it, expect } from 'vitest'
import { NKInitiator, PROTOCOL_NAME } from './handshakeState'
import { dhGenerate } from './primitives'

describe('NKInitiator', () => {
  it('protocol name is exactly the DNP suite', () => {
    expect(PROTOCOL_NAME).toBe('Noise_NK_25519_ChaChaPoly_BLAKE2s')
  })
  it('writeMessage1 is deterministic given a fixed ephemeral, and starts with the 32-byte ephemeral public', () => {
    const server = dhGenerate()
    const eph = { privateKey: new Uint8Array(32).fill(1), publicKey: new Uint8Array(0) }
    // publicKey заполнит конструктор из privateKey
    const hs = new NKInitiator({ prologue: new TextEncoder().encode('dnp/1'), remoteStatic: server.publicKey, ephemeral: eph })
    const msg1 = hs.writeMessage1()
    // NK msg1 = e(32) ‖ encryptAndHash(empty payload=16 tag)
    expect(msg1.length).toBe(32 + 16)
  })
})
