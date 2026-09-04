/** @jsxImportSource solid-js */
/**
 * Пины `SignInCard.solid.tsx` (порт tweb `pages/cards/SignInCard.tsx`).
 *
 * Карточка теперь самодостаточна (владеет страной/телефоном сама — см.
 * докблок карточки), поэтому монтируем её напрямую под самодельным
 * `AuthFlowContext.Provider`, а не через хост/`navigateAuth`.
 *
 * Три первых теста переносят СМЫСЛОМ пины страны по IP из React
 * `AuthFlow.test.tsx` (`describe('AuthFlow: страна по умолчанию')`) — тот же
 * контракт (пустой ответ → фолбэк +7, 'DE' → +49, тронутое поле не
 * перебивается), другая точка входа (карточка, а не хост).
 *
 * Четвёртый — поведенческий пин по сути карточки: ввод номера → отправка кода
 * → переход на карточку authCode с телефоном в payload.
 *
 * Пятый (ревью задачи 4, находка 3) — вход по ключу доступа: begin →
 * `getPasskeyAssertion` → finish → `toIm()`. `@core/webauthnBrowser` замокан
 * модульно — `isWebAuthnSupported` в happy-dom без `PublicKeyCredential`
 * всегда вернул бы `false` и скрыл кнопку, а `getPasskeyAssertion` реально
 * ходит в `navigator.credentials.get`.
 *
 * Шестой (задача 6, снос React `AuthFlow.tsx`) переносит СМЫСЛОМ второй пин
 * React `AuthFlow.test.tsx` (`describe('подзаголовок экрана входа: перенос
 * строки внутри одного ключа')`): `Login.StartText` — ОДИН ключ словаря с
 * `\n` внутри, `<br>` строит ЯДРО i18n (`I18n.superFormatter`), а не
 * вызывающая карточка. У Solid-версии тот же `i18n()` из `@lib/langPack`
 * (см. комментарий у вызова в `SignInCard.solid.tsx`), поэтому предмет пина
 * не изменился — изменилась только точка входа (карточка, а не хост).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignInCard from './SignInCard.solid'

vi.mock('@core/webauthnBrowser', () => ({
  isWebAuthnSupported: vi.fn(() => true),
  getPasskeyAssertion: vi.fn().mockResolvedValue({ assertion: true }),
}))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(
  overrides: {
    nearestCountry?: () => Promise<string>
    requestCode?: ReturnType<typeof vi.fn>
    passkeyLoginBegin?: ReturnType<typeof vi.fn>
    passkeyLoginFinish?: ReturnType<typeof vi.fn>
  } = {},
) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: {
      nearestCountry: overrides.nearestCountry ?? vi.fn().mockResolvedValue(''),
      requestCode: overrides.requestCode ?? vi.fn().mockResolvedValue(undefined),
      passkeyLoginBegin: overrides.passkeyLoginBegin ?? vi.fn(),
      passkeyLoginFinish: overrides.passkeyLoginFinish ?? vi.fn(),
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
        <SignInCard spec={{ name: 'signIn' }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const tel = () => host!.querySelectorAll('[contenteditable]')[1] as HTMLElement // [0] — CountryInput
  return { tel, navigate, toIm, managers }
}

describe('SignInCard.solid: страна по умолчанию', () => {
  it('пустой ответ ручки — остаётся фолбэк (+7)', async () => {
    const { tel } = mount({ nearestCountry: () => Promise.resolve('') })
    await new Promise((r) => setTimeout(r, 0))
    expect(tel().textContent).toBe('+7')
  })

  it('код страны с сервера подставляется в номер', async () => {
    const { tel } = mount({ nearestCountry: () => Promise.resolve('DE') })
    await vi.waitFor(() => expect(tel().textContent).toBe('+49'))
  })

  it('поле, которое уже трогали, ответом не перебивается', async () => {
    let resolve!: (v: string) => void
    const { tel } = mount({ nearestCountry: () => new Promise<string>((r) => (resolve = r)) })
    const el = tel()
    el.textContent = '+380 50'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    resolve('DE')
    await new Promise((r) => setTimeout(r, 0))
    expect(tel().textContent).not.toBe('+49')
  })
})

describe('SignInCard.solid: ввод номера → отправка кода и переход', () => {
  it('отправляет fullPhone и переходит на authCode с введённым номером', async () => {
    const { navigate, managers } = mount()
    const button = host!.querySelector('button.btn-primary.btn-color-primary') as HTMLButtonElement
    expect(button.disabled).toBe(false) // страна по умолчанию делает поле валидным сразу

    button.click()
    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())

    expect(managers.auth.requestCode).toHaveBeenCalledWith('+7')
    expect(navigate).toHaveBeenCalledWith({ name: 'authCode', payload: { phone: '+7' } })
  })

  it('ошибка сервера — поле уходит в error, перехода нет', async () => {
    const { navigate, managers } = mount()
    ;(managers.auth.requestCode as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'))
    const button = host!.querySelector('button.btn-primary.btn-color-primary') as HTMLButtonElement

    button.click()
    const tel = () => host!.querySelectorAll('[contenteditable]')[1] as HTMLElement
    await vi.waitFor(() => expect(tel().className).toMatch(/error/))
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('SignInCard.solid: вход по ключу доступа', () => {
  it('begin → getPasskeyAssertion → finish → toIm()', async () => {
    const passkeyLoginBegin = vi.fn().mockResolvedValue({ session: 's1', options: { publicKey: {} } })
    const passkeyLoginFinish = vi.fn().mockResolvedValue(undefined)
    const { toIm } = mount({ passkeyLoginBegin, passkeyLoginFinish })

    const buttons = [...host!.querySelectorAll('button')]
    const passkeyBtn = buttons.find((b) => b.textContent?.includes('Passkey'))
    expect(passkeyBtn, 'кнопка passkey должна быть видна при isWebAuthnSupported() === true').not.toBeUndefined()

    passkeyBtn!.click()
    await vi.waitFor(() => expect(passkeyLoginFinish).toHaveBeenCalled())

    expect(passkeyLoginBegin).toHaveBeenCalled()
    expect(passkeyLoginFinish).toHaveBeenCalledWith('s1', { assertion: true }, 'web', 'browser')
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })
})

describe('SignInCard.solid: подзаголовок — перенос строки внутри одного ключа словаря', () => {
  it('Login.StartText разворачивается в две половины через <br>, не двумя ключами', () => {
    mount()

    const subtitle = [...host!.querySelectorAll('span')]
      .find((node) => node.textContent?.includes('country code'))
    expect(subtitle, 'узел с текстом Login.StartText не найден').not.toBeUndefined()

    expect(subtitle!.textContent).toBe('Please confirm your country codeand enter your phone number.')
    expect(subtitle!.querySelectorAll('br')).toHaveLength(1)
  })
})
