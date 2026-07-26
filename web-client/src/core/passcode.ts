// Код-пароль (порт tweb src/lib/passcode/utils.ts + actions.ts): PBKDF2
// (SHA-256, 100000 итераций, соль 16 байт), хеш+соль — в IndexedDB msgr/kv,
// флаг enabled — в settings-сторе. Лимит попыток и таймаут — как экран
// блокировки tweb (5 попыток, 60 секунд).
import { idbGet, idbSet, idbDel } from './store/idbKv'
import { useSettingsStore } from '../settings'
import { useLockStore } from '../stores/lockStore'

export const MAX_PASSCODE_LENGTH = 32 // tweb MAX_PASSCODE_LENGTH
export const MAX_ATTEMPTS = 5 // tweb MAX_ATTEMPTS
export const ATTEMPTS_TIMEOUT_MS = 60_000 // tweb MAX_ATTEMPTS_TIMEOUT_SEC

const STORE_KEY = 'passcode'
const SALT_LENGTH = 16
const ITERATIONS = 100_000

interface StoredPasscode {
  verificationHash: number[] // сериализуемо в IndexedDB
  verificationSalt: number[]
}

async function hashPasscode(passcode: string, salt: Uint8Array): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, material, 256)
  return new Uint8Array(bits)
}

export async function enablePasscode(passcode: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const hash = await hashPasscode(passcode, salt)
  await idbSet(STORE_KEY, {
    verificationHash: [...hash],
    verificationSalt: [...salt],
  } satisfies StoredPasscode)
  useSettingsStore.getState().update({ passcodeEnabled: true })
}

export async function isMyPasscode(passcode: string): Promise<boolean> {
  const stored = await idbGet<StoredPasscode>(STORE_KEY)
  if (!stored) return false
  const hash = await hashPasscode(passcode, new Uint8Array(stored.verificationSalt))
  const want = stored.verificationHash
  if (hash.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ want[i]
  return diff === 0
}

export async function disablePasscode(): Promise<void> {
  await idbDel(STORE_KEY)
  useSettingsStore.getState().update({ passcodeEnabled: false, passcodeAutoLockMins: 0 })
  useLockStore.getState().unlock()
}

export async function changePasscode(newPasscode: string): Promise<void> {
  await enablePasscode(newPasscode)
}

// Блокировка при старте: если код включён — приложение открывается запертым
// (tweb: хранилища зашифрованы, у нас — lock-оверлей).
export function lockOnStartIfEnabled(): void {
  if (useSettingsStore.getState().passcodeEnabled) {
    useLockStore.getState().lock()
  }
}
