import { HASHLEN, hashBlake2s, hmacBlake2s, aeadSeal, aeadOpen } from './primitives'

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total); let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

// 12-байтный ChaCha20-Poly1305 nonce по Noise: 4 нулевых байта + 8-байтный LE-счётчик.
export const nonce8 = (n: bigint): Uint8Array => {
  const out = new Uint8Array(12)
  const view = new DataView(out.buffer)
  view.setBigUint64(4, n, true /* little-endian */)
  return out
}

// Noise HKDF на HMAC-BLAKE2s (2 выхода).
export const hkdf = (chainingKey: Uint8Array, ikm: Uint8Array, _numOutputs: 2): [Uint8Array, Uint8Array] => {
  const tempKey = hmacBlake2s(chainingKey, ikm)
  const output1 = hmacBlake2s(tempKey, new Uint8Array([1]))
  const output2 = hmacBlake2s(tempKey, concat(output1, new Uint8Array([2])))
  return [output1, output2]
}

export class CipherState {
  private n = 0n
  constructor(private readonly k: Uint8Array) {}
  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    const ct = aeadSeal(this.k, nonce8(this.n), ad, plaintext); this.n++; return ct
  }
  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const pt = aeadOpen(this.k, nonce8(this.n), ad, ciphertext); this.n++; return pt
  }
}

export class SymmetricState {
  private ck: Uint8Array
  private hVal: Uint8Array
  private k: Uint8Array | null = null
  private n = 0n
  get h(): Uint8Array { return this.hVal }

  constructor(protocolName: string) {
    const name = new TextEncoder().encode(protocolName)
    this.hVal = name.length <= HASHLEN
      ? concat(name, new Uint8Array(HASHLEN - name.length))
      : hashBlake2s(name)
    this.ck = this.hVal
  }

  mixHash(data: Uint8Array): void { this.hVal = hashBlake2s(concat(this.hVal, data)) }

  mixKey(ikm: Uint8Array): void {
    const [ck, tempK] = hkdf(this.ck, ikm, 2)
    this.ck = ck; this.k = tempK; this.n = 0n
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    let ct: Uint8Array
    if (this.k) { ct = aeadSeal(this.k, nonce8(this.n), this.hVal, plaintext); this.n++ }
    else ct = plaintext
    this.mixHash(ct); return ct
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    let pt: Uint8Array
    if (this.k) { pt = aeadOpen(this.k, nonce8(this.n), this.hVal, ciphertext); this.n++ }
    else pt = ciphertext
    this.mixHash(ciphertext); return pt
  }

  split(): [CipherState, CipherState] {
    const [t1, t2] = hkdf(this.ck, new Uint8Array(0), 2)
    return [new CipherState(t1), new CipherState(t2)]
  }
}
