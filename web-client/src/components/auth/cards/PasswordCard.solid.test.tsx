/** @jsxImportSource solid-js */
/**
 * Пины `PasswordCard.solid.tsx` (порт tweb `pages/cards/PasswordCard.tsx`).
 *
 * Поведенческий пин по сути карточки: пароль → `checkPassword`, ошибка сервера
 * уходит в НАДПИСЬ КНОПКИ (не отдельную строку — так у tweb), «забыли пароль»
 * ведёт на восстановление (`emailRecover`) при удачном запросе кода.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import PasswordCard from './PasswordCard.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(auth: Partial<Managers['auth']> = {}) {
  const navigate = vi.fn()
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

  const passwordInput = () => host!.querySelector('input[name="notsearch_password"]') as HTMLInputElement
  const submitBtn = () => host!.querySelector('button.btn-primary.btn-color-primary') as HTMLButtonElement
  const forgotLink = () => host!.querySelector('a[href="#"]') as HTMLAnchorElement
  return { navigate, toIm, managers, passwordInput, submitBtn, forgotLink }
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
})
