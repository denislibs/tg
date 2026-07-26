import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { generateKeyPair, exportPublicKey, deriveSecret } from './crypto'
import { saveKey, loadKey, deleteKey } from './keyStore'

describe('secret keyStore', () => {
  it('сохраняет и читает CryptoKey + fingerprint по chatId', async () => {
    const a = await generateKeyPair(); const b = await generateKeyPair()
    const s = await deriveSecret(a.privateKey, await exportPublicKey(b.publicKey))
    await saveKey(42, { key: s.key, fingerprint: s.fingerprint })
    const loaded = await loadKey(42)
    expect(loaded).not.toBeNull()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, loaded!.key, new TextEncoder().encode('x') as BufferSource)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, loaded!.key, ct)
    expect(new TextDecoder().decode(pt)).toBe('x')
    await deleteKey(42)
    expect(await loadKey(42)).toBeNull()
  })
})
