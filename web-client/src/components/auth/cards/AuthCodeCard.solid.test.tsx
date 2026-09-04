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
import lottie from 'lottie-web'
import type { AnimationItem } from 'lottie-web'
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

  it('неверный код — ошибка показана, поле сброшено, ФОКУС ВОЗВРАЩЁН на поле', async () => {
    const signIn = vi.fn().mockRejectedValue(new Error('PHONE_CODE_INVALID'))
    const { typeCode, input } = mount(signIn)
    // Счётчик, а не `document.activeElement`: happy-dom не блюрит элемент при
    // простановке `disabled` (в реальном браузере — блюрит, поэтому у tweb
    // возврат фокуса вообще нужен), так что `activeElement` остался бы
    // «сфокусирован» и без фикса — пин был бы зелёным всегда. Спай на
    // `.focus()` проверяет, что код РЕАЛЬНО зовёт возврат фокуса — независимо
    // от того, симулирует ли окружение сам блюр.
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, 'focus')
    const callsBeforeError = focusSpy.mock.calls.length

    typeCode('00000')
    await vi.waitFor(() => expect(host!.textContent).toContain('Invalid code'))
    expect(input().value).toBe('')
    // tweb AuthCodeCard.tsx:144-149: `codeInputField.disabled = false` (снять,
    // прежде фокусить — выключенный инпут фокус не берёт) →
    // `fastRaf(() => codeInputField.input.focus())`. Без этого юзер заперт:
    // набрать код заново без мыши нельзя (инпут выключен на время busy()).
    await vi.waitFor(() => expect(focusSpy.mock.calls.length).toBeGreaterThan(callsBeforeError))
    focusSpy.mockRestore()
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

describe('AuthCodeCard.solid: проводка фокуса поля до обезьянки (TrackingMonkey)', () => {
  // Замыкает цепочку, которую TrackingMonkey.solid.test.tsx и
  // CodeInput.solid.test.tsx пинят каждый только НА СВОЕЙ половине: тут — что
  // САМА КАРТОЧКА реально соединяет их (`onFocusChange={setFocused}` →
  // `<TrackingMonkey focused={focused}>`), а не просто держит оба куска кода
  // рядом нетронутыми проводами. `codeInputEl?.focus()` из `onMount` карточки
  // уже держит поле в фокусе к моменту первого рендер-прохода — TrackingMonkey
  // видит `true` СВОИМ первым чтением сигнала и не проигрывает его (см.
  // `defer:true` в её докблоке), поэтому пин дёргает blur→focus: настоящую
  // ПЕРЕМЕНУ состояния после маунта, а не совпадение стартового значения.
  it('фокус/блюр настоящего DOM-инпута доходит до playAnimation и переключает канвы обезьянки', async () => {
    const signIn = vi.fn()
    const { input } = mount(signIn)

    const idleAnim = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), destroy: vi.fn(), setSpeed: vi.fn(), setDirection: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const trackingAnim = { play: vi.fn(), pause: vi.fn(), stop: vi.fn(), destroy: vi.fn(), setSpeed: vi.fn(), setDirection: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const hosts = host!.querySelectorAll<HTMLDivElement>('.media-sticker-wrapper > div')
    const idleHostEl = hosts[0]
    const trackingHostEl = hosts[1]
    // Другие `it` в этом файле тоже монтируют карточку (а значит и обезьянку) и
    // копят вызовы на ОБЩЕМ моке `lottie-web` из `setup.ts` — счётчик чистим
    // перед тем, как считать СВОИ два вызова (idle+tracking).
    vi.mocked(lottie.loadAnimation).mockClear()
    vi.mocked(lottie.loadAnimation).mockImplementation(
      (opts) => (opts.container === idleHostEl ? idleAnim : trackingAnim) as unknown as AnimationItem,
    )
    await vi.waitFor(() => expect(lottie.loadAnimation).toHaveBeenCalledTimes(2))

    input().blur()
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())

    trackingAnim.play.mockClear()
    input().focus()
    await vi.waitFor(() => expect(trackingHostEl.style.display).toBe(''))
    expect(idleHostEl.style.display).toBe('none')
    expect(idleAnim.stop).toHaveBeenCalled()

    vi.mocked(lottie.loadAnimation).mockReset()
  })
})
