/** @jsxImportSource solid-js */
/**
 * Пины `AuthCodeCard.solid.tsx` (порт tweb `pages/cards/AuthCodeCard.tsx`).
 *
 * Поведенческий пин по сути карточки: набор кода до полной длины →
 * `managers.auth.signIn(fullPhone, code, 'web','browser')`, и три исхода —
 * успех (toIm), «пароль нужен» (navigate('password', {token, hint})),
 * регистрация (navigate('signUp', {token})). Плюс — неверный код возвращает
 * карточку в исходное состояние (значение сброшено, показана ошибка), а
 * карандаш у номера уводит на signIn без единого запроса к серверу.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import AuthCodeCard from './AuthCodeCard.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(signIn: ReturnType<typeof vi.fn>) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = { auth: { signIn } } as unknown as Managers
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
        <AuthCodeCard spec={{ name: 'authCode', payload: { phone: '+7 701 234 56 78' } }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const input = () => host!.querySelector('input')!
  const typeCode = (code: string) => {
    const el = input()
    el.value = code
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  }
  return { navigate, toIm, typeCode, input }
}

describe('AuthCodeCard.solid: исходы ввода кода', () => {
  it('успешный вход — signIn(fullPhone, code) и toIm()', async () => {
    const signIn = vi.fn().mockResolvedValue({ user: {} })
    const { toIm, typeCode } = mount(signIn)

    typeCode('12345')
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled())

    expect(signIn).toHaveBeenCalledWith('+77012345678', '12345', 'web', 'browser')
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('SESSION_PASSWORD_NEEDED — переход на password с token/hint', async () => {
    const signIn = vi.fn().mockResolvedValue({ passwordNeeded: true, passwordToken: 't1', hint: 'h1' })
    const { navigate, typeCode } = mount(signIn)

    typeCode('12345')
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ name: 'password', payload: { token: 't1', hint: 'h1' } }),
    )
  })

  it('authorizationSignUpRequired — переход на signUp с token', async () => {
    const signIn = vi.fn().mockResolvedValue({ signUpRequired: true, signUpToken: 'su1' })
    const { navigate, typeCode } = mount(signIn)

    typeCode('12345')
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ name: 'signUp', payload: { token: 'su1' } }))
  })

  it('неверный код — ошибка показана, поле сброшено', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('PHONE_CODE_INVALID'))
    const { typeCode, input } = mount(signIn)

    typeCode('00000')
    await vi.waitFor(() => expect(host!.textContent).toContain('Invalid code'))
    expect(input().value).toBe('')
  })

  it('карандаш у номера — назад на signIn без запроса к серверу', () => {
    const signIn = vi.fn()
    const { navigate } = mount(signIn)

    const editBtn = host!.querySelector('[role="button"]') as HTMLElement
    editBtn.click()

    expect(navigate).toHaveBeenCalledWith({ name: 'signIn' })
    expect(signIn).not.toHaveBeenCalled()
  })
})
