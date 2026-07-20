import { describe, it, expect } from 'vitest'
import { generateKeyPair, exportPublicKey, deriveSecret, encryptPayload, decryptPayload, encryptMedia, decryptMedia } from './crypto'

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

  it('несвязанная пара даёт другой fingerprint (защита от вырожденной константы)', async () => {
    const a = await generateKeyPair()
    const b = await generateKeyPair()
    const c = await generateKeyPair()

    const sa = await deriveSecret(a.privateKey, await exportPublicKey(b.publicKey))
    const sc = await deriveSecret(c.privateKey, await exportPublicKey(a.publicKey))

    expect(Array.from(sc.fingerprint)).not.toEqual(Array.from(sa.fingerprint))
  })

  it('encryptPayload → decryptPayload round-trip', async () => {
    const a = await generateKeyPair(); const b = await generateKeyPair()
    const sa = await deriveSecret(a.privateKey, await exportPublicKey(b.publicKey))
    const sb = await deriveSecret(b.privateKey, await exportPublicKey(a.publicKey))
    const payload = { text: 'привет 🔒', entities: [{ type: 'bold', offset: 0, length: 6 }] }
    const blob = await encryptPayload(sa.key, payload)
    expect(typeof blob).toBe('string') // base64
    const out = await decryptPayload<typeof payload>(sb.key, blob)
    expect(out).toEqual(payload)
  })

  it('encryptMedia → decryptMedia round-trip с per-file ключом', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(4096))
    const { cipher, keyB64, ivB64 } = await encryptMedia(bytes)
    expect(cipher.byteLength).toBeGreaterThan(0)
    const out = await decryptMedia(cipher, keyB64, ivB64)
    expect(Array.from(new Uint8Array(out))).toEqual(Array.from(bytes))
  })
})
