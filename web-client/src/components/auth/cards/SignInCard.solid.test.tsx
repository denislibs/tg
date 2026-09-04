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
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignInCard from './SignInCard.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

function mount(overrides: { nearestCountry?: () => Promise<string> } = {}) {
  const navigate = vi.fn()
  const managers = {
    auth: {
      nearestCountry: overrides.nearestCountry ?? vi.fn().mockResolvedValue(''),
      requestCode: vi.fn().mockResolvedValue(undefined),
      passkeyLoginBegin: vi.fn(),
      passkeyLoginFinish: vi.fn(),
    },
  } as unknown as Managers

  const ctx: AuthFlowContextValue = {
    managers,
    current: () => null,
    navigate,
    back: async () => {},
    toIm: async () => {},
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
  return { tel, navigate, managers }
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
