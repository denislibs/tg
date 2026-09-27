// Порт tweb `lib/encryptedStorageLayer.ts` — весь набор значений держится в
// памяти одним объектом и на диск ложится ОДНИМ зашифрованным блобом
// (AES-GCM, `lib/crypto/aesLocal.ts`) под ключом `storageKey`; пустой набор —
// блоб удаляется (eff3c59fa). Ключ шифрования берётся из `EncryptionKeyStore`,
// чей `get()` ждёт разблокировки: до неё `ensureLoaded()` не завершится.
//
// Расхождения с tweb:
//  1. Хранилище под блобом — интерфейс `BlobStorage` над нашим `msgr/kv`
//     (`core/store/sessionKv.ts`), а не отдельный object store `…__encrypted`:
//     новый object store требует апгрейда версии БД `msgr`, а старые соединения
//     (idbKv их не закрывает, воркер прошлой сборки жив, пока жива его вкладка)
//     такой апгрейд блокируют.
//  2. Инстанс один, реестр `getInstance(db, store)` не нужен.
//  3. Нет троттла записи (у tweb `STORAGE_THROTTLE_TIME_MS = 0`, то есть его
//     тоже фактически нет) и отладочного лога времени шифрования.
//  4. Шифрование — WebCrypto в своём реалме, без крипто-воркера.
import { decryptLocalData, encryptLocalData } from '@lib/crypto/aesLocal'
import EncryptionKeyStore from '@lib/passcode/keyStore'

export interface BlobStorage {
  get: (key: string) => Promise<unknown>
  save: (key: string, value: Uint8Array) => Promise<void>
  delete: (key: string) => Promise<void>
}

type StoredData = Record<string, unknown>

export default class EncryptedStorageLayer {
  private data: StoredData | undefined

  private loadingDataPromise: Promise<unknown> | undefined

  constructor(private storage: BlobStorage, private storageKey: string) {}

  private static async encrypt(data: StoredData): Promise<Uint8Array | null> {
    if(!Object.keys(data).length) return null

    const key = await EncryptionKeyStore.get()
    if(!key) throw new Error('NO_ENCRYPTION_KEY')
    const dataAsBuffer = new TextEncoder().encode(JSON.stringify(data))

    return encryptLocalData({ key, data: dataAsBuffer })
  }

  private static async decrypt(data: Uint8Array): Promise<StoredData> {
    const key = await EncryptionKeyStore.get()
    if(!key) throw new Error('NO_ENCRYPTION_KEY')

    const result = await decryptLocalData({ key, encryptedData: data })

    return JSON.parse(new TextDecoder().decode(result)) as StoredData
  }

  public loadEncrypted() {
    const promise = this.loadingDataPromise = this.loadFromIDB()
    void promise.finally(() => {
      if(this.loadingDataPromise === promise) this.loadingDataPromise = undefined
    })
  }

  /**
   * Unlike `loadEncrypted`, will not re-read the store when the data is already in memory
   */
  public async ensureLoaded() {
    if(!this.data && !this.loadingDataPromise) this.loadEncrypted()
    await this.waitToLoad()
  }

  public async loadDecrypted(data: StoredData) {
    this.data = data
    await this.saveToIDB()
  }

  /**
   * Folds data that was left in the unencrypted store into this one. \
   * The already encrypted values win, they are the newer ones
   */
  public async mergeDecrypted(data: StoredData) {
    await this.ensureLoaded()

    this.data = { ...data, ...this.data }
    await this.saveToIDB()
  }

  private waitToLoad() {
    return this.loadingDataPromise
  }

  private async saveToIDB() {
    await this.waitToLoad()

    const encryptedData = await EncryptedStorageLayer.encrypt(this.data ?? {})
    if(!encryptedData) { // * nothing left to store, the previous value must not stay behind
      await this.storage.delete(this.storageKey)
      return
    }

    await this.storage.save(this.storageKey, encryptedData)
  }

  private async loadFromIDB() {
    try {
      const storageData = await this.storage.get(this.storageKey)

      if(storageData === null || storageData === undefined) throw null
      if(!(storageData instanceof Uint8Array)) throw new Error('Stored data in encrypted store is not a Uint8Array')

      this.data = await EncryptedStorageLayer.decrypt(storageData)
    } catch(error) {
      if(error) console.warn('[encrypted-storage]', error)
      this.data = {}
    }

    return this.data
  }

  public async reEncrypt() {
    await this.saveToIDB()
  }

  public async save(entryName: string | string[], value: unknown): Promise<void> {
    await this.ensureLoaded()

    const names = Array.isArray(entryName) ? entryName : [entryName]
    const values = Array.isArray(entryName) ? value as unknown[] : [value]

    names.forEach((name, idx) => {
      this.data![name] = values[idx]
    })

    await this.saveToIDB()
  }

  public async get<T>(entryNames: string[]): Promise<T[]> {
    await this.ensureLoaded()

    return entryNames.map((entryName) => this.data![entryName] as T)
  }

  public async getAllEntries(): Promise<[string, unknown][]> {
    await this.ensureLoaded()

    return Object.entries(this.data!)
  }

  public async delete(entryName: string | string[]): Promise<void> {
    await this.ensureLoaded()

    const names = Array.isArray(entryName) ? entryName : [entryName]
    names.forEach((name) => {
      delete this.data![name]
    })

    await this.saveToIDB()
  }

  /**
   * Без ключа и без чтения блоба: выход с экрана блокировки не ждёт разблокировки
   * (tweb `storage.ts:395-406`)
   */
  public async clear(): Promise<void> {
    this.data = undefined
    this.loadingDataPromise = undefined
    await this.storage.delete(this.storageKey)
  }
}
