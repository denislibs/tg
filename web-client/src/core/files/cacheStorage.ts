// Порт tweb `src/lib/files/cacheStorage.ts` (CacheStorageController) — 1:1 по
// логике в нашем объёме: корзины CacheStorage с ключами `'/' + entryName`,
// `getFile`/`saveFile` (заголовки `Time-Cached` в секундах + `Content-Length`/
// `Content-Type` при записи, tweb cacheStorage.ts:235-262), `has`/`delete`,
// `deleteAll` через `caches.delete(dbName)` (tweb :172-175), операции под
// таймаутом `defaultOperationTimeout = 15e3` (tweb :299-338) с флагом
// `useStorage`: выключен — мгновенный reject STORAGE_OFFLINE, falsy результат
// `caches.open` (Cache API недоступен) выключает хранилище перманентно.
//
// Шифрование под код-паролем (tweb :17-47, :108-159, :215-262, :370-430):
// корзина с `encryptable: true` при включённом коде шифрует тело AES-GCM
// ключом из `EncryptionKeyStore` (заголовки, в т.ч. исходный `Content-Length`,
// остаются — по ним считает объём экран «Данные и память»); `temporarilyToggle`
// ставит паузу, которую ждут `get`/`save`, пока идёт включение/смена/выключение
// кода; `clearEncryptableStorages` сносит шифруемые корзины, а
// `resetOpenEncryptableCacheStorages` сбрасывает открытые экземпляры.
//
// Адаптации (поведение не менялось):
//   • корзина у нас одна — `cachedFiles` (стрим-чанков и HLS нет);
//   • шифрование — WebCrypto в своём реалме (`lib/crypto/aesLocal.ts`), без
//     крипто-воркера; флаг «код включён» воркер разрешает сам
//     (`ensureIsUsingPasscode`, см. `core/store/sessionKv.ts`);
//   • `minimalBlockingIterateResponses`, `prepareWriting` (MemoryWriter),
//     `temporarilyToggleByName(s)`, `getStats` и вариант `_test`-имени корзины
//     (Modes.test) — не портированы: у их потребителей (HLS, MTProto-тесты)
//     нет аналогов у нас
//   • `HTTPHeaderNames` — в tweb живёт в `lib/constants.ts`; других
//     потребителей у нас нет, константа локальная
//   • строгий tsconfig (в tweb `strict` выключен): `openDbPromise` опционален
//     (обнуляется в `deleteAll`), `getFile` вместо `Promise<any>` типизирован
//     дженериком по методу чтения; вызов `openDatabase()` в конструкторе — с
//     `void` (fire-and-forget прогрев, как в tweb)
import blobConstruct from '@helpers/blob/blobConstruct'
import makeError from '@helpers/makeError'
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import { decryptLocalData, encryptLocalData } from '@lib/crypto/aesLocal'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import { ensureIsUsingPasscode } from '../store/sessionKv'

const HTTPHeaderNames = {
  cachedTime: 'Time-Cached',
  contentLength: 'Content-Length',
  contentType: 'Content-Type',
}

type CacheStorageDbConfigEntry = {
  encryptable: boolean
}

const cacheStorageDbConfig = {
  cachedFiles: {
    encryptable: true,
  },
} satisfies Record<string, CacheStorageDbConfigEntry>

export type CacheStorageDbName = keyof typeof cacheStorageDbConfig

const defaultOperationTimeout = 15e3

type SaveArgs = {
  entryName: string
  response: Response
  size: number
  contentType?: string
}

type GetFileResult = { blob: Blob, json: unknown, text: string }

export default class CacheStorageController {
  private static STORAGES: CacheStorageController[] = []
  private openDbPromise?: Promise<Cache>
  private config: CacheStorageDbConfigEntry

  private useStorage = true

  private static disabledPromise: CancellablePromise<void> | undefined

  constructor(private dbName: CacheStorageDbName) {
    if(CacheStorageController.STORAGES.length) {
      this.useStorage = CacheStorageController.STORAGES[0].useStorage
    }

    this.config = cacheStorageDbConfig[dbName]

    void this.openDatabase()
    CacheStorageController.STORAGES.push(this)
  }

  public forget() {
    CacheStorageController.STORAGES = CacheStorageController.STORAGES.filter((storage) => storage !== this)
  }

  get isEncryptable() {
    return this.config?.encryptable
  }

  private async isEncrypted() {
    if(!this.config?.encryptable) return false
    await ensureIsUsingPasscode()
    return DeferredIsUsingPasscode.isUsingPasscode()
  }

  private static async encrypt(blob: Blob) {
    const key = await EncryptionKeyStore.get()
    if(!key) throw new Error('NO_ENCRYPTION_KEY')
    const dataAsBuffer = new Uint8Array(await blob.arrayBuffer())

    const result = await encryptLocalData({ key, data: dataAsBuffer })

    return new Blob([result as BlobPart], { type: blob.type })
  }

  private static async decrypt(blob: Blob) {
    const key = await EncryptionKeyStore.get()
    if(!key) throw new Error('NO_ENCRYPTION_KEY')
    const dataAsBuffer = new Uint8Array(await blob.arrayBuffer())

    const result = await decryptLocalData({ key, encryptedData: dataAsBuffer })

    return new Blob([result as BlobPart], { type: blob.type })
  }

  private async waitToEnable() {
    // Note: even if initially there was one disabled promise, another one could be added while we are waiting
    while(CacheStorageController.disabledPromise) {
      await CacheStorageController.disabledPromise
    }
  }

  private openDatabase(): Promise<Cache> {
    return this.openDbPromise ?? (this.openDbPromise = caches.open(this.dbName))
  }

  public delete(entryName: string) {
    return this.timeoutOperation((cache) => cache.delete('/' + entryName))
  }

  /**
   * Requires reconnection in order to save to disc again
   */
  public deleteAll() {
    this.openDbPromise = undefined
    // Именно `caches.delete(dbName)`, а не перебор ключей корзины: на слишком
    // большом кэше `cache.keys()` бросает (tweb cacheStorage.ts:390-394)
    return caches.delete(this.dbName)
  }

  public async has(entryName: string) {
    const response = await this.timeoutOperation((cache) => cache.match('/' + entryName))
    return !!response
  }

  public reset() {
    this.openDbPromise = undefined
  }

  public async get(entryName: string) {
    await this.waitToEnable()

    const response = await this.timeoutOperation((cache) => cache.match('/' + entryName))
    if(!response) return undefined

    if(await this.isEncrypted()) {
      return new Response(
        await CacheStorageController.decrypt(await response.blob()),
        {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        },
      )
    }

    return response
  }

  public async save({ entryName, response, size, contentType }: SaveArgs) {
    await this.waitToEnable()

    // Не мутируем read-only заголовки (например, у ответа, вернувшегося из `fetch`)
    let result = new Response(response.body, {
      headers: {
        ...Object.fromEntries(response.headers),
        [HTTPHeaderNames.cachedTime]: Math.floor(Date.now() / 1000 | 0).toString(),
        [HTTPHeaderNames.contentLength]: size.toString(),
        ...(contentType ? { [HTTPHeaderNames.contentType]: contentType } : {}),
      },
      status: response.status,
      statusText: response.statusText,
    })

    if(await this.isEncrypted()) {
      result = new Response(
        await CacheStorageController.encrypt(await result.blob()),
        {
          headers: result.headers,
          status: result.status,
          statusText: result.statusText,
        },
      )
    }

    return this.timeoutOperation((cache) => cache.put('/' + entryName, result))
  }

  public getFile<M extends keyof GetFileResult = 'blob'>(
    fileName: string,
    method: M = 'blob' as M,
  ): Promise<GetFileResult[M]> {
    return this.get(fileName).then((response) => {
      if(!response) {
        throw makeError('NO_ENTRY_FOUND')
      }

      return response[method]() as Promise<GetFileResult[M]>
    })
  }

  public saveFile(fileName: string, blob: Blob | Uint8Array) {
    if(!(blob instanceof Blob)) {
      blob = blobConstruct(blob)
    }

    const response = new Response(blob)

    return this.save({ entryName: fileName, response, size: blob.size }).then(() => blob as Blob)
  }

  public timeoutOperation<T>(callback: (cache: Cache) => Promise<T>, operationTimeout = defaultOperationTimeout) {
    if(!this.useStorage) {
      return Promise.reject(makeError('STORAGE_OFFLINE'))
    }

    // async-исполнитель Promise — как в tweb (cacheStorage.ts:287): reject
    // по таймеру снаружи, тело ждёт открытие корзины и саму операцию; свой
    // reject у async-тела есть (catch ниже), так что подавление безопасно
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<T>(async(resolve, reject) => {
      let rejected = false
      const timeout = setTimeout(() => {
        reject()
        rejected = true
      }, operationTimeout)

      try {
        const cache = await this.openDatabase()
        if(!cache) {
          // Cache API вернул falsy (например, Firefox в приватном режиме) —
          // хранилище выключается перманентно (tweb cacheStorage.ts:296-300)
          this.useStorage = false
          this.openDbPromise = undefined
          throw 'no cache?'
        }

        const res = await callback(cache)

        if(rejected) return
        resolve(res)
      } catch(err) {
        reject(err)
      }

      clearTimeout(timeout)
    })
  }

  public static toggleStorage(enabled: boolean, _clearWrite: boolean) {
    this.STORAGES.forEach((storage) => {
      storage.useStorage = enabled
    })
    return Promise.resolve()
  }

  public static async deleteAllStorages() {
    const storageNames = Object.keys(cacheStorageDbConfig) as CacheStorageDbName[]

    await Promise.all(storageNames.map(async(storageName) => {
      const storage = new CacheStorageController(storageName)
      await storage.deleteAll()
    }))
  }

  public static temporarilyToggle(enabled: boolean) {
    if(enabled) {
      this.disabledPromise?.resolve!()
      this.disabledPromise = undefined
    } else if(!this.disabledPromise) {
      this.disabledPromise = deferredPromise<void>()
    }
  }

  public static async clearEncryptableStorages() {
    const encryptableStorageNames = Object.entries(cacheStorageDbConfig)
    .filter(([, { encryptable }]) => encryptable)
    .map(([name]) => name) as CacheStorageDbName[]

    await Promise.all(encryptableStorageNames.map(async(storageName) => {
      // Make sure we have all storages in current thread, can't get from .STORAGES
      const storage = new CacheStorageController(storageName)

      try {
        await storage.deleteAll()
      } catch(e) {
        console.error(e)
      } finally {
        storage.forget()
      }
    }))
  }

  public static resetOpenEncryptableCacheStorages() {
    this.STORAGES.filter((storage) => storage.isEncryptable).forEach((storage) => storage.reset())
  }
}
