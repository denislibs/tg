// Порт tweb `lib/localStorage.ts` (`LocalStorageController`) + набора
// encryptable-ключей из `lib/sessionStorage.ts:67-75` — в нашем объёме: ключи,
// дающие доступ к аккаунту, при включённом код-пароле лежат ТОЛЬКО в
// зашифрованном слое (`lib/encryptedStorageLayer.ts`, блоб `kv__encrypted`),
// остальные — открыто в `msgr/kv` (`idbKv.ts`), как и раньше.
//
// Encryptable: `session_token` и `accounts` (tweb `account1..4` — ключи
// авторизации всех аккаунтов), `outbox` (неотправленные сообщения: у tweb они в
// сторе `messages` БД аккаунта, тоже шифруемом).
//
// Только воркер — как у tweb (`warnAboutEncrypting`, `localStorage.ts:272-277`):
// вкладка токен не читает вовсе (`persist.scopeToSession` отвечает ей «есть
// сессия» без самого токена).
//
// Расхождения с tweb:
//  1. Флаг «код включён» — наличие записи `passcode` в `msgr/kv` (наш аналог
//     `commonStateStorage`), разрешается лениво при первом обращении
//     (`ensureIsUsingPasscode`): у tweb его разрешает импорт
//     `commonStateStorage.ts:49-51` из `settings.passcode.enabled`, а наши
//     настройки — в localStorage, воркеру недоступном.
//  2. `encryptLeftovers` (tweb `storage.ts:134-153`, eff3c59fa) применён и сюда:
//     первое открытие зашифрованного слоя под кодом вливает оставшиеся открытые
//     значения и стирает их. Это и есть миграция пользователей, включивших код
//     до шифрования: их токены лежат открытыми, пока кода-ключа ещё не было.
//  3. Прокси окно↔воркер (`localStorageProxy`/`encryptedStorageProxy`) не нужен:
//     воркер ходит в IndexedDB сам.
import deferredPromise, { type CancellablePromise } from '@helpers/cancellablePromise'
import EncryptedStorageLayer from '@lib/encryptedStorageLayer'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import { idbDel, idbGet, idbSet } from './idbKv'
import { PASSCODE_KV_KEY } from '../passcode/protocol'

export const ENCRYPTED_KV_KEY = 'kv__encrypted'
export const ENCRYPTABLE_KEYS = ['session_token', 'accounts', 'outbox'] as const
type EncryptableKey = typeof ENCRYPTABLE_KEYS[number]

const isEncryptable = (key: string): key is EncryptableKey =>
  (ENCRYPTABLE_KEYS as readonly string[]).includes(key)

let isUsingPasscodeInit: Promise<void> | undefined

/** Разрешить `DeferredIsUsingPasscode` воркера по записи `passcode`, если его ещё
 *  никто не разрешил (см. расхождение 1 в шапке). IDB недоступен — кода нет. */
export function ensureIsUsingPasscode(): Promise<void> {
  if(typeof DeferredIsUsingPasscode.isUsingPasscodeUndeferred() === 'boolean') return Promise.resolve()
  return isUsingPasscodeInit ??= idbGet(PASSCODE_KV_KEY).then(
    (v) => !!v,
    () => false,
  ).then((value) => {
    if(typeof DeferredIsUsingPasscode.isUsingPasscodeUndeferred() !== 'boolean') {
      DeferredIsUsingPasscode.resolveDeferred(value)
    }
  })
}

class SessionKv {
  private encryptedStorage = new EncryptedStorageLayer(
    { get: idbGet, save: idbSet, delete: idbDel },
    ENCRYPTED_KV_KEY,
  )

  private leftoversPromise: Promise<void> | undefined
  private encryptionDeferred: CancellablePromise<void> | undefined

  private async getEncryptedStorage() {
    await (this.leftoversPromise ??= this.encryptLeftovers())
    return this.encryptedStorage
  }

  private async encryptLeftovers() {
    await this.encryptedStorage.ensureLoaded()
    // * best effort: the store has to open whatever happens here, the leftovers get another try next time
    try {
      const entries = await this.readPlain()
      if(!entries.length) return
      await this.encryptedStorage.mergeDecrypted(Object.fromEntries(entries))
      await Promise.all(entries.map(([key]) => idbDel(key)))
    } catch(err) {
      console.error('[sessionKv] encrypt leftovers error', err)
      this.leftoversPromise = undefined
    }
  }

  private async readPlain(): Promise<[EncryptableKey, unknown][]> {
    const values = await Promise.all(ENCRYPTABLE_KEYS.map((key) => idbGet(key)))
    return ENCRYPTABLE_KEYS
    .map((key, idx) => [key, values[idx]] as [EncryptableKey, unknown])
    .filter((entry) => entry[1] !== undefined && entry[1] !== null)
  }

  private async shouldUseEncryptableStorage(key: string) {
    if(!isEncryptable(key)) return false
    await ensureIsUsingPasscode()
    return DeferredIsUsingPasscode.isUsingPasscode()
  }

  private async waitEncryptionToFinish() {
    if(this.encryptionDeferred) await this.encryptionDeferred
  }

  public async get<T>(key: string): Promise<T | undefined> {
    await this.waitEncryptionToFinish()

    if(await this.shouldUseEncryptableStorage(key)) {
      const result = await (await this.getEncryptedStorage()).get<T>([key])
      return result[0]
    }

    return idbGet<T>(key)
  }

  public async set(key: string, value: unknown): Promise<void> {
    await this.waitEncryptionToFinish()

    if(await this.shouldUseEncryptableStorage(key)) {
      await (await this.getEncryptedStorage()).save(key, value)
      return
    }

    await idbSet(key, value)
  }

  public async delete(key: string): Promise<void> {
    await this.waitEncryptionToFinish()

    if(await this.shouldUseEncryptableStorage(key)) {
      await (await this.getEncryptedStorage()).delete(key)
      return
    }

    await idbDel(key)
  }

  /** tweb `encryptEncryptable` (`localStorage.ts:279-308`): открытые значения — в
   *  слой, открытые копии — стереть. Ключ уже сохранён вызывающим. */
  public async encryptEncryptable() {
    this.encryptionDeferred = deferredPromise<void>()
    try {
      const entries = await this.readPlain()
      await this.encryptedStorage.loadDecrypted(Object.fromEntries(entries))
      await Promise.all(entries.map(([key]) => idbDel(key)))
      // слой только что собран из открытых значений — «хвостов» больше нет
      this.leftoversPromise = Promise.resolve()
    } finally {
      this.encryptionDeferred.resolve!()
      this.encryptionDeferred = undefined
    }
  }

  /** tweb `loadEncryptable` (`:310-315`): прочитать слой СТАРЫМ ключом до его замены. */
  public async loadEncryptable() {
    await this.getEncryptedStorage()
  }

  /** tweb `reEncryptEncryptable` (`:317-327`). */
  public async reEncryptEncryptable() {
    this.encryptionDeferred = deferredPromise<void>()
    try {
      await (await this.getEncryptedStorage()).reEncrypt()
    } finally {
      this.encryptionDeferred.resolve!()
      this.encryptionDeferred = undefined
    }
  }

  /** tweb `decryptEncryptable` (`:329-347`): всё из слоя — обратно открыто, слой стереть. */
  public async decryptEncryptable() {
    this.encryptionDeferred = deferredPromise<void>()
    try {
      const encryptedStorage = await this.getEncryptedStorage()
      const entries = (await encryptedStorage.getAllEntries()).filter(([key]) => isEncryptable(key))
      await Promise.all(entries.map(([key, value]) => idbSet(key, value)))
      await encryptedStorage.clear()
      this.leftoversPromise = undefined
    } finally {
      this.encryptionDeferred.resolve!()
      this.encryptionDeferred = undefined
    }
  }

  /** «Забыли код» (tweb `forceLogOutAll`, `apiManager.ts:372-388`): стереть оба
   *  слоя БЕЗ ключа. */
  public async clearAll() {
    await Promise.all([
      ...ENCRYPTABLE_KEYS.map((key) => idbDel(key)),
      this.encryptedStorage.clear(),
    ])
    this.leftoversPromise = undefined
  }
}

export const sessionKv = new SessionKv()
