import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { blake2s } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'

export const HASHLEN = 32

export interface KeyPair { privateKey: Uint8Array; publicKey: Uint8Array }

// ВАЖНО: точные аксессоры x25519 могут отличаться по версии @noble/curves.
// Контракт — smoke-тест (DH agreement). В установленной версии (2.2.0) генератор
// случайного приватного ключа называется `utils.randomSecretKey` (не `randomPrivateKey`
// как в исходном черновике задачи) — остальной код от этого изолирован.
export const dhGenerate = (): KeyPair => {
  const privateKey = x25519.utils.randomSecretKey()
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}
export const dhPublic = (privateKey: Uint8Array): Uint8Array => x25519.getPublicKey(privateKey)
export const dh = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  x25519.getSharedSecret(privateKey, publicKey)

export const hashBlake2s = (data: Uint8Array): Uint8Array => blake2s(data)
export const hmacBlake2s = (key: Uint8Array, data: Uint8Array): Uint8Array => hmac(blake2s, key, data)

// ChaCha20-Poly1305: 32-байтный ключ, 12-байтный nonce, ad опционально, тег (16) в хвосте.
export const aeadSeal = (key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array =>
  chacha20poly1305(key, nonce, ad).encrypt(plaintext)
export const aeadOpen = (key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array =>
  chacha20poly1305(key, nonce, ad).decrypt(ciphertext)
