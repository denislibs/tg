/** @jsxImportSource solid-js */
/**
 * Пины `PasswordCard.solid.tsx` (порт tweb `pages/cards/PasswordCard.tsx`).
 *
 * Поведенческий пин по сути карточки: пароль → `checkPassword`, ошибка сервера
 * уходит в НАДПИСЬ КНОПКИ (не отдельную строку — так у tweb), «забыли пароль»
 * ведёт на восстановление (`emailRecover`) при удачном запросе кода.
 *
 * `confirmationPopup` (`components/popups/popupPeer.ts`) замокан модульно —
 * его собственное поведение (DOM попапа, кнопки, resolve/reject) покрыто
 * `popupPeer.test.ts`; здесь проверяется ТОЛЬКО оркестровка карточки
 * (кто/когда/с какими аргументами его зовёт), а не сам попап.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import PasswordCard from './PasswordCard.solid'

vi.mock('../../popups/popupPeer', () => ({
  confirmationPopup: vi.fn(),
}))
import { confirmationPopup } from '../../popups/popupPeer'
const confirmationPopupMock = confirmationPopup as unknown as ReturnType<typeof vi.fn>

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  confirmationPopupMock.mockReset()
})

function mount(auth: Partial<Managers['auth']> = {}, navigate = vi.fn()) {
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: {
      checkPassword: vi.fn().mockResolvedValue({ user: {} }),
      requestPasswordRecovery: vi.fn(),
      resetAccount: vi.fn(),
      ...auth,
    },
  } as unknown as Managers

  const ctx: AuthFlowContextValue = {
    managers,
    current: () => null,
    navigate,
    back: async () => {},
    toIm,
  }

  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    (() => (
      <AuthFlowContext.Provider value={ctx}>
        <PasswordCard spec={{ name: 'password', payload: { token: 'tok1', hint: 'my hint' } }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const currentHost = host
  const currentDispose = dispose
  const passwordInput = () => currentHost.querySelector('input[name="notsearch_password"]') as HTMLInputElement
  const submitBtn = () => currentHost.querySelector('button.btn-primary.btn-color-primary') as HTMLButtonElement
  const forgotLink = () => currentHost.querySelector('a[href="#"]') as HTMLAnchorElement
  return { navigate, toIm, managers, passwordInput, submitBtn, forgotLink, dispose: currentDispose }
}

function setValue(el: HTMLInputElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('PasswordCard.solid: ввод пароля', () => {
  it('верный пароль → checkPassword(token, password) и toIm()', async () => {
    const { toIm, managers, passwordInput, submitBtn } = mount()
    setValue(passwordInput(), 'secret123')
    submitBtn().click()

    await vi.waitFor(() => expect(managers.auth.checkPassword).toHaveBeenCalled())
    expect(managers.auth.checkPassword).toHaveBeenCalledWith('tok1', 'secret123', 'web', 'browser')
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('неверный пароль — ошибка уходит в надпись кнопки, не в отдельную строку', async () => {
    const { passwordInput, submitBtn } = mount({
      checkPassword: vi.fn().mockRejectedValue(new Error('nope')),
    })
    setValue(passwordInput(), 'wrong')
    submitBtn().click()

    await vi.waitFor(() => expect(submitBtn().textContent).toContain('Incorrect password'))
    expect(passwordInput().className).toMatch(/error/)
  })

  it('пустой пароль — только .error на инпуте, кнопка НЕ пишет «Incorrect password» (tweb :145-148 не трогает nextKey)', () => {
    const { managers, submitBtn, passwordInput } = mount()
    submitBtn().click()

    expect(passwordInput().className).toMatch(/error/)
    expect(submitBtn().textContent).not.toContain('Incorrect password')
    expect(submitBtn().textContent).toContain('Next')
    expect(managers.auth.checkPassword).not.toHaveBeenCalled()
  })
})

describe('PasswordCard.solid: «забыли пароль»', () => {
  it('успешный запрос кода восстановления — переход на emailRecover с маской почты', async () => {
    const { navigate, forgotLink } = mount({
      requestPasswordRecovery: vi.fn().mockResolvedValue({ emailPattern: 'a***@b.com' }),
    })

    forgotLink().click()
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        name: 'emailRecover',
        payload: { token: 'tok1', emailPattern: 'a***@b.com' },
      }),
    )
  })

  it('resend_too_soon ПОСЛЕ remount с тем же токеном — возвращает emailRecover с прежней маской, а не общую ошибку (находка 1 ревью)', async () => {
    // Карточка размонтируется на каждый navigate (AuthCardsHost.solid.tsx,
    // mode="outin") — переиграть это в тесте нельзя иначе, кроме как реально
    // dispose()/mount() между двумя попытками, тем же `token` (одна и та же
    // сессия сброса пароля).
    const requestPasswordRecovery = vi
      .fn()
      .mockResolvedValueOnce({ emailPattern: 'a***@b.com' })
      .mockResolvedValueOnce({ error: 'resend_too_soon' })
    const auth = { requestPasswordRecovery }

    const first = mount(auth)
    first.forgotLink().click()
    await vi.waitFor(() =>
      expect(first.navigate).toHaveBeenCalledWith({
        name: 'emailRecover',
        payload: { token: 'tok1', emailPattern: 'a***@b.com' },
      }),
    )
    first.dispose()

    const second = mount(auth)
    second.forgotLink().click()
    await vi.waitFor(() =>
      expect(second.navigate).toHaveBeenCalledWith({
        name: 'emailRecover',
        payload: { token: 'tok1', emailPattern: 'a***@b.com' },
      }),
    )
  })
})

describe('PasswordCard.solid: сброс аккаунта без привязанной почты (находка 3 ревью)', () => {
  it('PASSWORD_RECOVERY_NA → две плашки ПОДРЯД → resetAccount(token) → navigate(signIn)', async () => {
    confirmationPopupMock.mockResolvedValueOnce(undefined) // первая подтверждена
    confirmationPopupMock.mockResolvedValueOnce(undefined) // вторая подтверждена
    const resetAccount = vi.fn().mockResolvedValue({ ok: true })
    const { navigate, forgotLink } = mount({
      requestPasswordRecovery: vi.fn().mockResolvedValue({ error: 'password_recovery_na' }),
      resetAccount,
    })

    forgotLink().click()

    await vi.waitFor(() => expect(confirmationPopupMock).toHaveBeenCalledTimes(2))
    expect(confirmationPopupMock.mock.calls[0][0]).toMatchObject({
      titleLangKey: 'Login.ResetPassword.Title',
      descriptionLangKey: 'Login.ResetPassword.NoEmailText',
    })
    expect(confirmationPopupMock.mock.calls[1][0]).toMatchObject({
      titleLangKey: 'Login.ResetAccount.Title',
      descriptionLangKey: 'Login.ResetAccount.Text',
    })

    await vi.waitFor(() => expect(resetAccount).toHaveBeenCalledWith('tok1'))
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signIn' }))
  })

  it('первая плашка отклонена (Cancel/Esc/оверлей) — вторая НЕ показывается, resetAccount не звана', async () => {
    confirmationPopupMock.mockRejectedValueOnce(undefined)
    const resetAccount = vi.fn()
    const { forgotLink } = mount({
      requestPasswordRecovery: vi.fn().mockResolvedValue({ error: 'password_recovery_na' }),
      resetAccount,
    })

    forgotLink().click()
    await vi.waitFor(() => expect(confirmationPopupMock).toHaveBeenCalledTimes(1))
    // Дать необработанному отклонению улечься, прежде чем проверять, что
    // второго вызова не случилось.
    await new Promise((r) => setTimeout(r, 0))
    expect(confirmationPopupMock).toHaveBeenCalledTimes(1)
    expect(resetAccount).not.toHaveBeenCalled()
  })
})
