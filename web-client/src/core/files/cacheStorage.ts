// Порт tweb `src/lib/files/cacheStorage.ts` (CacheStorageController) — 1:1 по
// логике в нашем объёме: корзины CacheStorage с ключами `'/' + entryName`,
// `getFile`/`saveFile` (заголовки `Time-Cached` в секундах + `Content-Length`/
// `Content-Type` при записи, tweb cacheStorage.ts:226-231,247), `has`/`delete`,
// `deleteAll` через `caches.delete(dbName)` (tweb :158-161), операции под
// таймаутом `defaultOperationTimeout = 15e3` (tweb :282-313) с флагом
// `useStorage`: выключен — мгновенный reject STORAGE_OFFLINE, falsy результат
// `caches.open` (Cache API недоступен) выключает хранилище перманентно
// (tweb :283-301). Статики `toggleStorage`/`deleteAllStorages`.
//
// Адаптации (поведение не менялось):
//   • passcode-шифрование содержимого (encrypt/decrypt, DeferredIsUsingPasscode,
//     waitToEnable/temporarilyToggle*) не портировано — у нас нет пасскода с
//     шифрованием кэша; поэтому от конфига корзин tweb (флаг `encryptable`)
//     остаются только имена — `cacheStorageDbNames`. Будущая корзина
//     (например, стрим-чанки) добавляется туда без переделки класса
//   • `minimalBlockingIterateResponses`, `prepareWriting` (MemoryWriter),
//     `forget`/`reset` и вариант `_test`-имени корзины (Modes.test) — не
//     портированы: у их потребителей (HLS, passcode-очистка, MTProto-тесты)
//     нет аналогов у нас
//   • `HTTPHeaderNames` — в tweb живёт в `lib/constants.ts`; других
//     потребителей у нас нет, константа локальная
//   • строгий tsconfig (в tweb `strict` выключен): `openDbPromise` опционален
//     (обнуляется в `deleteAll`), `getFile` вместо `Promise<any>` типизирован
//     дженериком по методу чтения; вызов `openDatabase()` в конструкторе — с
//     `void` (fire-and-forget прогрев, как в tweb)
import blobConstruct from '@helpers/blob/blobConstruct'
import makeError from '@helpers/makeError'

const HTTPHeaderNames = {
  cachedTime: 'Time-Cached',
  contentLength: 'Content-Length',
  contentType: 'Content-Type',
}

// Имена корзин CacheStorage (см. шапку: от конфига tweb без шифрования
// остаются только имена)
const cacheStorageDbNames = ['cachedFiles'] as const

export type CacheStorageDbName = typeof cacheStorageDbNames[number]

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

  private useStorage = true

  constructor(private dbName: CacheStorageDbName) {
    if(CacheStorageController.STORAGES.length) {
      this.useStorage = CacheStorageController.STORAGES[0].useStorage
    }

    void this.openDatabase()
    CacheStorageController.STORAGES.push(this)
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

  public get(entryName: string) {
    return this.timeoutOperation((cache) => cache.match('/' + entryName))
  }

  public async save({ entryName, response, size, contentType }: SaveArgs) {
    // Не мутируем read-only заголовки (например, у ответа, вернувшегося из `fetch`)
    const result = new Response(response.body, {
      headers: {
        ...Object.fromEntries(response.headers),
        [HTTPHeaderNames.cachedTime]: Math.floor(Date.now() / 1000 | 0).toString(),
        [HTTPHeaderNames.contentLength]: size.toString(),
        ...(contentType ? { [HTTPHeaderNames.contentType]: contentType } : {}),
      },
      status: response.status,
      statusText: response.statusText,
    })

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
    await Promise.all(cacheStorageDbNames.map(async(storageName) => {
      const storage = new CacheStorageController(storageName)
      await storage.deleteAll()
    }))
  }
}
