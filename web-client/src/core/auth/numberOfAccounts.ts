// Порт tweb `AccountController.getUnencryptedTotalAccounts` (lib/accounts/
// accountController.ts:22-24) и записи `number_of_accounts` (:90-94): число
// аккаунтов в ОТКРЫТОМ слое `msgr/kv`. Сам реестр (`accounts`, с токенами) под
// код-паролем лежит только в зашифрованном слое, а экрану блокировки число нужно
// до ключа — выбрать «выйти» или «выйти из всех» (`PasscodeLock.ForgotPasscode.*`).
// Пишет воркер (`core/auth/accounts.ts`) на каждом изменении реестра, читает
// вкладка: сам токенов тут нет, только число.
import { idbGet, idbSet } from '../store/idbKv'

export const NUMBER_OF_ACCOUNTS_KEY = 'number_of_accounts'

export async function getUnencryptedTotalAccounts(): Promise<number | undefined> {
  try {
    return await idbGet<number>(NUMBER_OF_ACCOUNTS_KEY)
  } catch{
    return undefined // idb недоступен — у tweb `undefined` даёт текст «один аккаунт»
  }
}

export async function setUnencryptedTotalAccounts(count: number): Promise<void> {
  await idbSet(NUMBER_OF_ACCOUNTS_KEY, count)
}
