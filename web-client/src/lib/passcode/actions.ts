// Порт tweb `lib/passcode/actions.ts` — действия код-пароля вкладки:
// включить, сверить, выключить, сменить, разблокировать. Шифрует и перешифровывает
// хранилища воркер (`core/passcode/passcodeWorker.ts`), здесь — порядок шагов
// 1:1 с оригиналом: пауза корзин → очистка шифруемых корзин → воркер → SW →
// ключ себе → снятие паузы.
//
// Расхождения с tweb:
//  1. Не хук: у tweb действия берут `rootScope`/`apiManagerProxy` из
//     `useLockScreenHotReloadGuard()`; у нас канал к воркеру — синглтон
//     `startClient()` (`client/passcodeClient.ts`), а `passcodeActions(persist)`
//     получает writer офлайн-стора: включение, как и раньше, стирает `msgr-store`
//     (его tweb шифрует — у нас он под кодом не пишется, docs/tweb/passcode-encryption.md П-1).
//  2. Запись кода и флаг «включён»: запись — в `msgr/kv` (`PASSCODE_KV_KEY`), флаг —
//     `useSettingsStore.passcodeEnabled`; воркер и SW судят по записи.
//  3. `updateStorageForLegacy` (легаси-ключи WebA в localStorage) не нужен: открытые
//     копии токенов стирает сам воркер (`sessionKv.encryptEncryptable`).
//  4. `unlockWithPasscode` мигрирует запись без `encryptionSalt` (код включали до
//     шифрования хранилищ): соль создаётся и дописывается, воркер при первом
//     чтении вливает открытые токены в зашифрованный слой и стирает их
//     (`sessionKv.encryptLeftovers`), корзина медиа, писавшаяся открыто, чистится.
import bytesCmpConstTime from '@helpers/bytes/bytesCmpConstTime'
import { idbDel, idbGet, idbSet } from '@core/store/idbKv'
import { PASSCODE_KV_KEY, type PasscodeStorageValue } from '@core/passcode/protocol'
import { clearCachedFiles } from '@core/mediaCache'
import { invokePasscode } from '@/client/passcodeClient'
import { sendPasscodeStateToServiceWorker, toggleServiceWorkerCacheStorage } from '@/client/passcodeServiceWorker'
import { useSettingsStore } from '@/settings'
import DeferredIsUsingPasscode from '@lib/passcode/deferredIsUsingPasscode'
import EncryptionKeyStore from '@lib/passcode/keyStore'
import { SALT_LENGTH } from '@lib/passcode/constants'
import { createEncryptionArtifactsForPasscode, deriveEncryptionKey, hashPasscode } from '@lib/passcode/utils'

async function disableCacheStorages() {
  await invokePasscode({ method: 'toggleCacheStorage', payload: false })
  await toggleServiceWorkerCacheStorage(false)
}

async function enableCacheStorages() {
  await invokePasscode({ method: 'toggleCacheStorage', payload: true })
  await toggleServiceWorkerCacheStorage(true)
}

async function clearCacheStorages() {
  await clearCachedFiles()
  await invokePasscode({ method: 'resetEncryptableCacheStorages' })
}

export async function enablePasscode(passcode: string, persist: { clearAll(): Promise<void> }) {
  const { verificationHash, verificationSalt, encryptionSalt, encryptionKey } =
    await createEncryptionArtifactsForPasscode(passcode)

  passcode = '' // forget

  await idbSet(PASSCODE_KV_KEY, {
    verificationHash,
    verificationSalt,
    encryptionSalt,
  } satisfies PasscodeStorageValue)

  useSettingsStore.getState().update({ passcodeEnabled: true })

  // Офлайн-стор под кодом не пишется (гард `locked()` в core/store/persist.ts) —
  // стираем то, что лежит открытым. Тот же writer, что и обычные записи.
  await persist.clearAll()

  await disableCacheStorages()
  await clearCacheStorages()

  await invokePasscode({ method: 'toggleUsingPasscode', payload: { isUsingPasscode: true, encryptionKey } })

  DeferredIsUsingPasscode.resolveDeferred(true)
  EncryptionKeyStore.save(encryptionKey)
  await sendPasscodeStateToServiceWorker()

  await enableCacheStorages()
}

export async function isMyPasscode(passcode: string) {
  const passcodeData = await idbGet<PasscodeStorageValue>(PASSCODE_KV_KEY)
  if(!passcodeData?.verificationHash || !passcodeData?.verificationSalt) return false

  const hashed = await hashPasscode(passcode, new Uint8Array(passcodeData.verificationSalt))
  passcode = '' // forget

  return bytesCmpConstTime(hashed, new Uint8Array(passcodeData.verificationHash))
}

export async function disablePasscode() {
  useSettingsStore.getState().update({ passcodeEnabled: false, passcodeAutoLockMins: 0 })

  await disableCacheStorages()
  await clearCacheStorages()

  await invokePasscode({ method: 'toggleUsingPasscode', payload: { isUsingPasscode: false } })

  EncryptionKeyStore.save(null)
  DeferredIsUsingPasscode.resolveDeferred(false)
  await sendPasscodeStateToServiceWorker()

  await enableCacheStorages()

  await idbDel(PASSCODE_KV_KEY)
}

/**
 * Note: Re-encrypts everything with a different hash even if the passcode is the same
 */
export async function changePasscode(passcode: string) {
  const { verificationHash, verificationSalt, encryptionSalt, encryptionKey } =
    await createEncryptionArtifactsForPasscode(passcode)
  passcode = '' // forget

  const toStore: PasscodeStorageValue = {
    verificationHash,
    verificationSalt,
    encryptionSalt,
  }

  await disableCacheStorages()
  await clearCacheStorages()

  // запись пишет воркер — до перешифровки (tweb index.worker.ts:276-293)
  await invokePasscode({ method: 'changePasscode', payload: { toStore, encryptionKey } })

  EncryptionKeyStore.save(encryptionKey)
  await sendPasscodeStateToServiceWorker()

  await enableCacheStorages()
}

/**
 * Warning! don't call on an unverified password
 */
export async function unlockWithPasscode(passcode: string) {
  const passcodeData = await idbGet<PasscodeStorageValue>(PASSCODE_KV_KEY)
  if(!passcodeData) throw new Error('No passcode found in storage')

  // миграция записи до шифрования хранилищ (расхождение 4 в шапке)
  const isLegacy = !passcodeData.encryptionSalt
  const encryptionSalt = passcodeData.encryptionSalt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  if(isLegacy) await idbSet(PASSCODE_KV_KEY, { ...passcodeData, encryptionSalt } satisfies PasscodeStorageValue)

  const encryptionKey = await deriveEncryptionKey(passcode, new Uint8Array(encryptionSalt))
  passcode = '' // forget

  DeferredIsUsingPasscode.resolveDeferred(true)
  EncryptionKeyStore.save(encryptionKey)
  await invokePasscode({ method: 'saveEncryptionKey', payload: encryptionKey })

  if(isLegacy) {
    // корзина писалась открытым текстом, пока код был только замком интерфейса
    await disableCacheStorages()
    await clearCacheStorages()
    await enableCacheStorages()
  }

  // Make sure we resolve the passcode state in SW as there is no key there
  await sendPasscodeStateToServiceWorker()

  invokePasscode({ method: 'toggleLockOthers', payload: false }).catch(() => {})
}

export function passcodeActions(persist: { clearAll(): Promise<void> }) {
  return {
    enablePasscode: (passcode: string) => enablePasscode(passcode, persist),
    isMyPasscode,
    disablePasscode,
    changePasscode,
    unlockWithPasscode,
  }
}

export type PasscodeActions = ReturnType<typeof passcodeActions>
