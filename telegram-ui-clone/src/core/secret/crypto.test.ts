import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportPublicKey, deriveSecret } from './crypto'

describe('secret/crypto ECDH', () => {
  it('обе стороны выводят одинаковый ключ и fingerprint', async () => {
    const a = await generateKeyPair()
    const b = await generateKeyPair()
    const aPub = await exportPublicKey(a.publicKey)
    const bPub = await exportPublicKey(b.publicKey)

    const sa = await deriveSecret(a.privateKey, bPub)
    const sb = await deriveSecret(b.privateKey, aPub)

    expect(Array.from(sa.fingerprint)).toEqual(Array.from(sb.fingerprint))
    expect(sa.fingerprint.length).toBe(32)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sa.key, new TextEncoder().encode('hi'))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sb.key, ct)
    expect(new TextDecoder().decode(pt)).toBe('hi')
  })
})
