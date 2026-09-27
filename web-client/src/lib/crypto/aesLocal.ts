// Порт tweb `lib/crypto/utils/aesLocal.ts` — AES-GCM, IV 12 байт, на диске
// `iv ‖ ciphertext`. Расхождение: у tweb методы исполняет крипто-воркер
// (`cryptoMessagePort.invokeCryptoNew('aes-local-*')`) и отдают
// `TransferableResult`; крипто-воркера у нас нет — зовём WebCrypto в своём
// реалме и возвращаем байты напрямую.
const IV_LENGTH = 12

export type EncryptLocalDataArgs = {
  key: CryptoKey
  data: Uint8Array
}

export async function encryptLocalData({ key, data }: EncryptLocalDataArgs) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource,
  )

  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)

  return combined
}

export type DecryptLocalDataArgs = {
  key: CryptoKey
  encryptedData: Uint8Array
}

export async function decryptLocalData({ key, encryptedData }: DecryptLocalDataArgs) {
  const iv = encryptedData.slice(0, IV_LENGTH)
  const ciphertext = encryptedData.slice(IV_LENGTH)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  )

  return new Uint8Array(decrypted)
}
