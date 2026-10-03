// Воркерная половина код-пароля — порт хендлеров tweb
// `mainWorker/index.worker.ts:246-333` (isLocked, toggleUsingPasscode,
// changePasscode, saveEncryptionKey, toggleLockOthers, toggleCacheStorage,
// resetEncryptableCacheStorages, forceLogout, terminate).
//
// Канал отдельный от реестра менеджеров (`registerManagers`), потому что
// хендлеру нужен ИСТОЧНИК вызова: как у tweb, изменение рассылается всем
// вкладкам, КРОМЕ той, что его сделала (`invokeExceptSourceAsync`), а ключ на
// `isLocked` уходит ровно спросившей. Вкладка зовёт `smp.invoke('passcode', …)`
// (`client/passcodeClient.ts`), воркер отвечает событиями `passcode` на порт.
//
// Ключ — только в памяти воркера (`EncryptionKeyStore`); `terminate` уносит
// его вместе с воркером.
//
// Расхождения с tweb:
//  1. `isLocked` возвращает ещё и `isUsingPasscode`: вкладка у нас узнаёт флаг от
//     воркера (у tweb — из своего `commonStateStorage`).
//  2. `toggleCacheStorage` вкладкам не пересылается: `CacheStorageController`
//     у нас живёт только в воркере (вкладка корзину лишь считает и сносит,
//     `core/mediaCache.ts`), SW получает паузу своим сообщением.
//  3. `forceLogout` — это `ApiManager.forceLogOutAll` (tweb `apiManager.ts:372-388`)
//     плюс стирание записи `passcode` (у tweb её уносит
//     `commonStateStorage.clear()`), после чего вкладкам — `reload`, а воркер
//     завершается: его память (флаг кода, ждущая ключа загрузка токена) принадлежит
//     стёртому состоянию, новый воркер поднимется с чистого диска.
//  4. `setAutoLockSettings` — задачи у tweb нет: настройки автоблокировки воркер у
//     оригинала читает сам (`commonStateStorage`), у нас их сообщает вкладка
//     (расхождение 1 `lib/mainWorker/useAutoLock.ts`). Сама автоблокировка —
//     `useAutoLock` в `core/workerCore.ts`, ей отсюда нужны `getIsLocked` и настройки.
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import CacheStorageController from '../files/cacheStorage'
import { ensureIsUsingPasscode, sessionKv } from '../store/sessionKv'
import { idbDel, idbSet } from '../store/idbKv'
import { PASSCODE_CHANNEL, PASSCODE_KV_KEY, type AutoLockSettingsPayload, type PasscodeEvent, type PasscodeTask } from './protocol'

export interface PasscodePort { emit(event: string, payload: unknown): void }

export interface PasscodeWorkerDeps {
  /** Живой список портов вкладок (`workerCore.ts::ports`). */
  ports: readonly PasscodePort[]
  /** Стереть офлайн-стор `msgr-store` (`persistClearAll`). */
  clearPersist: () => Promise<void>
  /** `self.close()` воркера; инъекцией — ради тестов. */
  selfTerminate: () => void
}

export function newPasscodeWorker({ ports, clearPersist, selfTerminate }: PasscodeWorkerDeps) {
  // tweb index.worker.ts:54 — воркер стартует запертым
  let isLocked = true
  let autoLockSettings: AutoLockSettingsPayload | undefined

  const emit = (port: PasscodePort, event: PasscodeEvent) => port.emit(PASSCODE_CHANNEL, event)
  const emitExceptSource = (source: PasscodePort, event: PasscodeEvent) => {
    for(const port of ports.slice()) if(port !== source) emit(port, event)
  }

  async function handle(source: PasscodePort, task: PasscodeTask): Promise<unknown> {
    switch(task.method) {
      case 'isLocked': {
        await ensureIsUsingPasscode()
        const isUsingPasscode = await DeferredIsUsingPasscode.isUsingPasscode()
        if(!isUsingPasscode) return { isUsingPasscode, isLocked: false }
        // ключ уходит спросившей ДО ответа — тот же порт, событие обработается первым
        if(!isLocked) emit(source, { method: 'saveEncryptionKey', payload: await EncryptionKeyStore.get() })
        return { isUsingPasscode, isLocked }
      }

      case 'toggleUsingPasscode': {
        const payload = task.payload
        DeferredIsUsingPasscode.resolveDeferred(payload.isUsingPasscode)
        // * when disabling, the old key stays until everything is decrypted
        if(payload.isUsingPasscode) EncryptionKeyStore.save(payload.encryptionKey)

        await (payload.isUsingPasscode ? sessionKv.encryptEncryptable() : sessionKv.decryptEncryptable())

        if(!payload.isUsingPasscode) EncryptionKeyStore.save(null)

        emitExceptSource(source, { method: 'toggleUsingPasscode', payload })
        isLocked = false
        return
      }

      case 'changePasscode': {
        const { toStore, encryptionKey } = task.payload
        await idbSet(PASSCODE_KV_KEY, toStore)
        // * the storage has to be read while the old key is still around
        await sessionKv.loadEncryptable()
        EncryptionKeyStore.save(encryptionKey)
        await sessionKv.reEncryptEncryptable()
        emitExceptSource(source, { method: 'saveEncryptionKey', payload: encryptionKey })
        return
      }

      case 'saveEncryptionKey': {
        EncryptionKeyStore.save(task.payload)
        isLocked = false
        emitExceptSource(source, { method: 'saveEncryptionKey', payload: task.payload })
        return
      }

      case 'toggleLockOthers': {
        isLocked = task.payload
        emitExceptSource(source, { method: 'toggleLock', payload: task.payload })
        return
      }

      case 'toggleCacheStorage': {
        CacheStorageController.temporarilyToggle(task.payload)
        return
      }

      case 'resetEncryptableCacheStorages': {
        CacheStorageController.resetOpenEncryptableCacheStorages()
        return
      }

      case 'forceLogout': {
        await Promise.all([
          sessionKv.clearAll(),
          idbDel(PASSCODE_KV_KEY),
          clearPersist(),
          CacheStorageController.deleteAllStorages(),
        ])
        // разбудить всё, что ждёт ключа (загрузка токена), — хранилище уже пусто
        DeferredIsUsingPasscode.resolveDeferred(false)
        EncryptionKeyStore.save(null)
        for(const port of ports.slice()) emit(port, { method: 'reload' })
        selfTerminate()
        return
      }

      case 'terminate': {
        selfTerminate()
        return
      }

      case 'setAutoLockSettings': {
        autoLockSettings = task.payload
        return
      }
    }
  }

  return {
    handle,
    /** tweb `index.worker.ts:388` `getIsLocked: () => isLocked` */
    getIsLocked: () => isLocked,
    /** расхождение 4 */
    getAutoLockSettings: () => autoLockSettings,
  }
}
