// Число аккаунтов в ОТКРЫТОМ слое (`number_of_accounts`) — порт tweb
// `AccountController.update` (lib/accounts/accountController.ts:90-94) и
// `getUnencryptedTotalAccounts` (:22-24). Реестр `accounts` под код-паролем
// зашифрован, а экрану блокировки число нужно до ключа: «выйти» или «выйти из
// всех аккаунтов» (`PasscodeLock.ForgotPasscode.*`). Предмет — что запись
// реестра сама обновляет число, а открытое число читается без реестра.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const idb = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../store/idbKv', () => ({
  idbGet: async(key: string) => idb.get(key),
  idbSet: async(key: string, val: unknown) => { idb.set(key, val) },
  idbDel: async(key: string) => { idb.delete(key) },
}))
// зашифрованный слой — отдельная карта: число НЕ должно браться из него
const encrypted = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../store/sessionKv', () => ({
  sessionKv: {
    get: async(key: string) => encrypted.get(key),
    set: async(key: string, val: unknown) => { encrypted.set(key, val) },
  },
}))

import { removeAccount, upsertAccount } from './accounts'
import { getUnencryptedTotalAccounts, NUMBER_OF_ACCOUNTS_KEY } from './numberOfAccounts'

const account = (id: number) => ({ token: 't' + id, id, name: 'n' + id, photoId: 0, phone: '' })

beforeEach(() => {
  idb.clear()
  encrypted.clear()
})

describe('number_of_accounts', () => {
  it('добавление и удаление аккаунта переписывают открытое число', async() => {
    expect(await getUnencryptedTotalAccounts()).toBeUndefined()

    await upsertAccount(account(1))
    await upsertAccount(account(2))
    await upsertAccount(account(2)) // обновление профиля — не новый аккаунт
    expect(idb.get(NUMBER_OF_ACCOUNTS_KEY)).toBe(2)
    expect(await getUnencryptedTotalAccounts()).toBe(2)
    expect(idb.has('accounts')).toBe(false) // реестр в открытый слой не течёт

    await removeAccount(1)
    expect(await getUnencryptedTotalAccounts()).toBe(1)
  })
})
