// Протокол канала код-пароля вкладка ↔ воркер (`core/passcode/passcodeWorker.ts`,
// `client/passcodeClient.ts`) — порт сигнатур tweb `mainWorker/mainMessagePort.ts:60-99`.
// Отдельный файл без рантайм-зависимостей: вкладка берёт отсюда имя канала и
// ключ записи, не затягивая в свой бандл воркерный код.

/** Ключ записи кода в `msgr/kv` (наш аналог `commonStateStorage` ключа `passcode`). */
export const PASSCODE_KV_KEY = 'passcode'

export const PASSCODE_CHANNEL = 'passcode'

/** Запись кода в `msgr/kv` — tweb `PasscodeStorageValue` (`commonStateStorage.ts:11-30`). */
export interface PasscodeStorageValue {
  verificationHash: Uint8Array | number[]
  verificationSalt: Uint8Array | number[]
  /** Нет у записей, созданных до шифрования хранилищ (миграция — `lib/passcode/actions.ts`). */
  encryptionSalt?: Uint8Array | number[]
}

export type ToggleUsingPasscodePayload = { isUsingPasscode: boolean, encryptionKey?: CryptoKey | null }

/** Вкладка → воркер. */
export type PasscodeTask =
  | { method: 'isLocked' }
  | { method: 'toggleUsingPasscode', payload: ToggleUsingPasscodePayload }
  | { method: 'changePasscode', payload: { toStore: PasscodeStorageValue, encryptionKey: CryptoKey } }
  | { method: 'saveEncryptionKey', payload: CryptoKey }
  | { method: 'toggleLockOthers', payload: boolean }
  | { method: 'toggleCacheStorage', payload: boolean }
  | { method: 'resetEncryptableCacheStorages' }
  | { method: 'forceLogout' }
  | { method: 'terminate' }

/** Воркер → вкладка. */
export type PasscodeEvent =
  | { method: 'saveEncryptionKey', payload: CryptoKey | null }
  | { method: 'toggleLock', payload: boolean }
  | { method: 'toggleUsingPasscode', payload: ToggleUsingPasscodePayload }
  | { method: 'reload' }
