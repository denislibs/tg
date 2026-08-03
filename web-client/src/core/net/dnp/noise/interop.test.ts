import { describe, it, expect } from 'vitest'
import { NKInitiator } from './handshakeState'
import fixture from './fixtures/nk-vector.json'

const fromHex = (s: string) => new Uint8Array(s.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
const toHex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

// Эталон — flynn/noise (Go). JS-initiator ОБЯЗАН воспроизвести те же байты.
describe('Noise_NK Go<->JS interop (fixture from flynn/noise)', () => {
  it('JS initiator reproduces msg1, reads msg2, and matches the transport ciphertext', () => {
    const hs = new NKInitiator({
      prologue: new TextEncoder().encode(fixture.prologue),
      remoteStatic: fromHex(fixture.serverStaticPub),
      ephemeral: { privateKey: fromHex(fixture.initEphemeralPriv), publicKey: new Uint8Array(0) },
    })
    const msg1 = hs.writeMessage1()
    expect(toHex(msg1)).toBe(fixture.msg1) // байт-в-байт совпадение с Go

    const payload2 = hs.readMessage2(fromHex(fixture.msg2))
    expect(payload2.length).toBe(0) // пустой payload в NK msg2

    const { send } = hs.split()
    const transport = send.encryptWithAd(new Uint8Array(0), new TextEncoder().encode('ping'))
    expect(toHex(transport)).toBe(fixture.transportFromInit) // тот же ciphertext, что у Go
  })
})
