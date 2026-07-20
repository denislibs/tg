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

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Блоб = iv(12) || ciphertext, в base64. IV случайный на каждое сообщение.
export async function encryptPayload(key: CryptoKey, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const blob = new Uint8Array(iv.length + ct.length)
  blob.set(iv, 0); blob.set(ct, iv.length)
  return b64encode(blob)
}

export async function decryptPayload<T>(key: CryptoKey, blob: string): Promise<T> {
  const raw = b64decode(blob)
  const iv = raw.subarray(0, 12) as BufferSource
  const ct = raw.subarray(12) as BufferSource
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt)) as T
}
