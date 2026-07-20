// crypto.ts — WebCrypto-обёртки для секретных чатов.
// ECDH P-256 → HKDF-SHA256 → non-extractable AES-256-GCM. Ключи не экспортируемы.
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

export interface DerivedSecret {
  key: CryptoKey // AES-256-GCM, non-extractable
  fingerprint: Uint8Array // SHA-256(sharedBits), 32 байта — для верификации
}

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, false, ['deriveBits', 'deriveKey'])
}

export async function exportPublicKey(pub: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', pub))
}

async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, ECDH, false, [])
}

export async function deriveSecret(priv: CryptoKey, peerPubRaw: Uint8Array): Promise<DerivedSecret> {
  const peerPub = await importPublicKey(peerPubRaw)
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerPub }, priv, 256))
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', bits))
  const hkdfKey = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // пустая соль намеренно: ECDH-секрет уже высокоэнтропийный, RFC 5869 трактует отсутствие соли как нули, доменное разделение даёт info
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('secret-chat-v1'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  bits.fill(0)
  return { key, fingerprint }
}
