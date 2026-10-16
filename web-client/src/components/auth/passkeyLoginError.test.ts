import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toastNew } from '@components/toast'
import { reportPasskeyLoginError } from './passkeyLoginError'

vi.mock('@components/toast', () => ({ toastNew: vi.fn() }))

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.mocked(toastNew).mockClear()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

// Ф7-И2 (правка 10): порт tweb passkeyLoginButton.tsx:72-76.
describe('reportPasskeyLoginError', () => {
  it('PASSKEY_CREDENTIAL_NOT_FOUND строкой из результата — тост Login.Passkey.Error.NotFound', () => {
    reportPasskeyLoginError('SignInCard', 'PASSKEY_CREDENTIAL_NOT_FOUND')
    expect(vi.mocked(toastNew)).toHaveBeenCalledWith({ langPackKey: 'Login.Passkey.Error.NotFound' })
  })

  it('прочее (строка или исключение WebAuthn) — тост Login.Passkey.Error и след в консоли', () => {
    reportPasskeyLoginError('SignInCard', 'UNKNOWN')
    reportPasskeyLoginError('SignQRCard', new Error('NotAllowedError'))
    expect(vi.mocked(toastNew)).toHaveBeenNthCalledWith(1, { langPackKey: 'Login.Passkey.Error' })
    expect(vi.mocked(toastNew)).toHaveBeenNthCalledWith(2, { langPackKey: 'Login.Passkey.Error' })
    expect(consoleError).toHaveBeenCalledTimes(2)
  })
})
