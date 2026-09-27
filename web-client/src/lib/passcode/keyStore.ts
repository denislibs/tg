// Порт tweb `lib/passcode/keyStore.ts` — 1:1. Ключ, выведенный из код-пароля, —
// ТОЛЬКО в памяти своего реалма: у вкладки, воркера и service worker'а по своей
// копии модуля. `get()` ждёт первого `save` — так слой шифрования
// (`lib/encryptedStorageLayer.ts`) физически не может отдать зашифрованные
// значения (токен) до разблокировки. `resetDeferred` (для SW tweb) не портирован:
// наш SW — скрипт вне сборки со своим состоянием (`public/sw.js`).
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'

export default class EncryptionKeyStore {
  private static key: CryptoKey | null = null

  private static deferred: CancellablePromise<void> | undefined = deferredPromise<void>()

  public static async get() {
    if(this.deferred) await this.deferred
    return this.key
  }

  /**
   * Whatever is in memory right now, `null` while nothing has been saved yet
   */
  public static getUndeferred() {
    return this.key
  }

  public static async getAsBase64() {
    const key = await this.get()
    if(!key) return null

    const exportedKey = await crypto.subtle.exportKey('raw', key)
    const base64Key = btoa(String.fromCharCode(...new Uint8Array(exportedKey)))

    return base64Key
  }

  public static save(key?: CryptoKey | null) {
    this.key = key || null
    this.deferred?.resolve!()
    this.deferred = undefined
  }
}
