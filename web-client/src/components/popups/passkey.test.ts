/**
 * `createPasskey` (`popups/passkey.ts`, порт tweb `popups/passkey.tsx:9-32`):
 * начало регистрации → WebAuthn → завершение с сессией начала; тост успеха и
 * созданный ключ, а на отказе — тост ошибки и проброс (кнопка вкладки и попап
 * не должны счесть ключ созданным).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Passkey } from '@layer'
import type { Managers } from '@/client/bootstrap'
import { createPasskey } from './passkey'

const createCredential = vi.hoisted(() => vi.fn<(options: unknown) => Promise<unknown>>())
vi.mock('@core/webauthnBrowser', () => ({ createPasskey: createCredential }))

const toastNew = vi.hoisted(() => vi.fn())
vi.mock('@components/toast', () => ({ toastNew }))

const created: Passkey = { _: 'passkey', id: '7', name: 'Chrome', date: 1_700_000_000 }

let auth: {
  passkeyRegisterBegin: ReturnType<typeof vi.fn>
  passkeyRegisterFinish: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  createCredential.mockReset().mockResolvedValue({ id: 'cred' })
  toastNew.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  auth = {
    passkeyRegisterBegin: vi.fn(async() => ({ session: 's1', options: { publicKey: {} } })),
    passkeyRegisterFinish: vi.fn(async() => created),
  }
})

const managers = () => ({ auth } as unknown as Managers)

describe('createPasskey', () => {
  it('begin → credentials.create(options) → finish(session, credential); тост Passkey.Created, ключ — результат', async() => {
    await expect(createPasskey(managers())).resolves.toBe(created)

    expect(createCredential).toHaveBeenCalledWith({ publicKey: {} })
    expect(auth.passkeyRegisterFinish).toHaveBeenCalledWith('s1', { id: 'cred' })
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Passkey.Created' })
  })

  it('отказ WebAuthn — тост Passkey.CreationError, ошибка пробрасывается, finish не зовётся', async() => {
    const err = new Error('NotAllowedError')
    createCredential.mockRejectedValue(err)

    await expect(createPasskey(managers())).rejects.toBe(err)

    expect(auth.passkeyRegisterFinish).not.toHaveBeenCalled()
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Passkey.CreationError' })
    expect(toastNew).not.toHaveBeenCalledWith({ langPackKey: 'Passkey.Created' })
  })

  it('отказ сервера на завершении — тоже тост ошибки и проброс', async() => {
    auth.passkeyRegisterFinish.mockRejectedValue(new Error('500'))

    await expect(createPasskey(managers())).rejects.toThrow('500')
    expect(toastNew).toHaveBeenCalledWith({ langPackKey: 'Passkey.CreationError' })
  })
})
