import { type KeyPair, dhGenerate, dhPublic, dh } from './primitives'
import { SymmetricState, type CipherState } from './symmetricState'

export const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_BLAKE2s'

const EMPTY = new Uint8Array(0)

// Noise_NK, роль initiator (клиент). Паттерн: <- s (pre-message), -> e, es ; <- e, ee.
export class NKInitiator {
  private readonly ss = new SymmetricState(PROTOCOL_NAME)
  private readonly e: KeyPair
  private readonly rs: Uint8Array

  constructor(opts: { prologue: Uint8Array; remoteStatic: Uint8Array; ephemeral?: KeyPair }) {
    this.rs = opts.remoteStatic.slice() // defensive copy: не зависим от мутаций буфера вызывающего
    // Инъекция эфемерного ключа для детерминизма в тестах; иначе генерим.
    this.e = opts.ephemeral
      ? { privateKey: opts.ephemeral.privateKey, publicKey: dhPublic(opts.ephemeral.privateKey) }
      : dhGenerate()
    this.ss.mixHash(opts.prologue)
    // pre-message NK: статик ответчика известен заранее.
    this.ss.mixHash(this.rs)
  }

  // -> e, es
  writeMessage1(payload: Uint8Array = EMPTY): Uint8Array {
    this.ss.mixHash(this.e.publicKey)
    this.ss.mixKey(dh(this.e.privateKey, this.rs)) // es
    const encPayload = this.ss.encryptAndHash(payload)
    const out = new Uint8Array(this.e.publicKey.length + encPayload.length)
    out.set(this.e.publicKey, 0); out.set(encPayload, this.e.publicKey.length)
    return out
  }

  // <- e, ee
  readMessage2(message: Uint8Array): Uint8Array {
    // NK msg2 = 32-байтный ephemeral + 16-байтный AEAD-тег (пустой payload) = 48.
    if (message.length !== 48) throw new Error('dnp: malformed message2 (expected 48 bytes)')
    const re = message.slice(0, 32)
    this.ss.mixHash(re)
    this.ss.mixKey(dh(this.e.privateKey, re)) // ee
    return this.ss.decryptAndHash(message.slice(32))
  }

  // Для initiator: send = k1 (init->resp), recv = k2 (resp->init).
  split(): { send: CipherState; recv: CipherState } {
    const [c1, c2] = this.ss.split()
    return { send: c1, recv: c2 }
  }
}
