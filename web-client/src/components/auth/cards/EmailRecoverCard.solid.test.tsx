/** @jsxImportSource solid-js */
/**
 * Пины `EmailRecoverCard.solid.tsx` (порт tweb `pages/cards/EmailRecoverCard.tsx`,
 * задача 5). Поведенческий пин по сути карточки: заполнение кода до полной
 * длины (6 цифр) → `managers.auth.confirmPasswordRecovery(token, code, 'web',
 * 'browser')`, успех — `toIm()`, отказ — ошибка текстом (без сброса на пустую
 * карточку, код обнуляется). «Cancel» — переход на `password`.
 *
 * ── Debt-пин задачи 5: маска почты едет ПАЙЛОАДОМ, а не модульным Map ───────
 * `PasswordCard.solid.tsx` (задача 4, находка 1 ревью) хранил маску в
 * closure/модульном кэше — неверный слой, живущий до перезагрузки страницы.
 * Штатный путь — `CardPayloadMap`: маска и `hint` приходят В ЭТУ карточку
 * пропом `spec.payload` (не откуда-то ещё), и «Cancel» обязана вернуть ИХ ЖЕ,
 * а не какое-то производное значение, обратно на `password`. Мутация,
 * вернувшая Cancel к `navigate({name:'password'})` без payload — или вообще к
 * модульной переменной, — обязана красить второй тест ниже.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import EmailRecoverCard from './EmailRecoverCard.solid'

vi.mock('@components/dotRenderer', () => ({ default: { attachBluffTextSpoilerTarget: vi.fn() } }))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(confirmPasswordRecovery: ReturnType<typeof vi.fn>) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = { auth: { confirmPasswordRecovery } } as unknown as Managers
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
        <EmailRecoverCard
          spec={{ name: 'emailRecover', payload: { token: 'tok1', emailPattern: 'a***@b.com', hint: 'my hint' } }}
        />
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
  const cancelBtn = () => host!.querySelector('button') as HTMLButtonElement
  return { navigate, toIm, typeCode, input, cancelBtn }
}

describe('EmailRecoverCard.solid: ввод кода с почты', () => {
  it('маска почты нарисована спойлером в подзаголовке', () => {
    mount(vi.fn())
    expect(host!.querySelectorAll('.bluff-spoiler').length).toBeGreaterThan(0)
  })

  it('код набран целиком — confirmPasswordRecovery(token, code) и toIm()', async () => {
    const confirmPasswordRecovery = vi.fn().mockResolvedValue({ user: {} })
    const { toIm, typeCode } = mount(confirmPasswordRecovery)

    typeCode('123456')
    await vi.waitFor(() => expect(confirmPasswordRecovery).toHaveBeenCalled())
    expect(confirmPasswordRecovery).toHaveBeenCalledWith('tok1', '123456', 'web', 'browser')
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('неверный код — ошибка текстом, поле сброшено', async () => {
    const confirmPasswordRecovery = vi.fn().mockResolvedValue({ error: 'invalid_code' })
    const { typeCode, input } = mount(confirmPasswordRecovery)

    typeCode('000000')
    await vi.waitFor(() => expect(host!.textContent).toContain('Invalid code'))
    expect(input().value).toBe('')
  })

  it('код/сессия восстановления истекли — отдельная строка ошибки', async () => {
    const confirmPasswordRecovery = vi.fn().mockResolvedValue({ error: 'recovery_expired' })
    const { typeCode } = mount(confirmPasswordRecovery)

    typeCode('000000')
    await vi.waitFor(() => expect(host!.textContent).toContain('Code expired'))
  })
})

describe('EmailRecoverCard.solid: Cancel — возврат на password С ПОЛНОЙ нагрузкой (debt-пин задачи 5)', () => {
  it('Cancel несёт token/hint/emailPattern ИЗ СВОЕГО PAYLOAD, а не из модульного/закрытого состояния', () => {
    const { navigate, cancelBtn } = mount(vi.fn())

    cancelBtn().click()

    expect(navigate).toHaveBeenCalledWith({
      name: 'password',
      payload: { token: 'tok1', hint: 'my hint', emailPattern: 'a***@b.com' },
    })
  })

  it('ДРУГОЙ payload (другая попытка входа) — Cancel возвращает ЕГО значения, не запомненные с прошлого рендера', () => {
    const navigate = vi.fn()
    const toIm = vi.fn().mockResolvedValue(undefined)
    const managers = { auth: { confirmPasswordRecovery: vi.fn() } } as unknown as Managers
    const ctx: AuthFlowContextValue = { managers, current: () => null, navigate, back: async () => {}, toIm }

    host = document.createElement('div')
    document.body.append(host)
    dispose = render(
      (() => (
        <AuthFlowContext.Provider value={ctx}>
          <EmailRecoverCard
            spec={{ name: 'emailRecover', payload: { token: 'tok2', emailPattern: 'z***@w.com', hint: 'other hint' } }}
          />
        </AuthFlowContext.Provider>
      )) as () => never,
      host,
    )

    ;(host.querySelector('button') as HTMLButtonElement).click()

    expect(navigate).toHaveBeenCalledWith({
      name: 'password',
      payload: { token: 'tok2', hint: 'other hint', emailPattern: 'z***@w.com' },
    })
  })
})
