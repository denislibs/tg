/** @jsxImportSource solid-js */
/**
 * Пины `SignQRCard.solid.tsx` — порт tweb `pages/cards/SignQRCard.tsx`: один
 * цикл `iterate()` (:135-192) с шагом `FETCH_INTERVAL = 3` с, перерисовка QR
 * только при смене токена (:162-166), `success` -> в мессенджер, `password` ->
 * карточка пароля, остановка вместе с карточкой (`onCleanup`, :212-216).
 *
 * Самый важный пин файла — «после dispose вызовов нет»: порча, которая забыла бы
 * `stopped = true` в `onCleanup`, оставила бы цикл опрашивать сервер по мёртвой
 * карточке.
 *
 * ТЕСТЫ ПРО ЧАСЫ КЛИЕНТА ЗДЕСЬ НЕТ: пауза при `diff <= 0` (смещение серверного
 * времени) ждёт решения пользователя, см. TODO в карточке.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { toastNew } from '@components/toast'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignQRCard from './SignQRCard.solid'
import rootScope from '@lib/rootScope'
import { RT } from '@core/realtime/events'
import mediaHeaderStyles from '@components/mediaHeader.module.scss'

vi.mock('@core/webauthnBrowser', () => ({
  isWebAuthnSupported: vi.fn(() => false),
  getPasskeyAssertion: vi.fn(),
}))

// Всплывашку мокаем, чтобы пин смотрел на КЛЮЧ СЛОВАРЯ, а не на текст в DOM:
// «строка написана в коде вместо ключа» обязана краснеть здесь же.
vi.mock('@components/toast', () => ({ toastNew: vi.fn() }))

// Рисует ли карточка QR заново, видно по `data`, которое получает QrCode: мок
// считает каждое новое значение (реальная канва в jsdom ничего не покажет).
const qrData = vi.fn()
vi.mock('../QrCode.solid', async () => {
  const { createEffect } = await import('solid-js')
  return {
    default: (props: { data: string }) => {
      createEffect(() => qrData(props.data))
      return <canvas />
    },
  }
})

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(toastNew).mockClear()
  qrData.mockClear()
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  vi.useRealTimers()
})

const PENDING = (token: string, expiresInSec = 60) => ({
  status: 'pending' as const, token, expires: Date.now() / 1000 + expiresInSec,
})

function mount(
  overrides: {
    exportLoginToken?: ReturnType<typeof vi.fn>
    passkeyLoginBegin?: ReturnType<typeof vi.fn>
    passkeyLoginFinish?: ReturnType<typeof vi.fn>
  } = {},
) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const exportLoginToken = overrides.exportLoginToken ?? vi.fn().mockImplementation(async () => PENDING('aa01'))
  const managers = {
    auth: {
      exportLoginToken,
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
        <SignQRCard spec={{ name: 'signQR' }} />
      </AuthFlowContext.Provider>
    )) as () => never,
    host,
  )

  const currentHost = host
  const currentDispose = dispose
  return {
    navigate,
    toIm,
    managers,
    exportLoginToken,
    dispose: currentDispose,
    cancelBtn: () => currentHost.querySelector('button') as HTMLButtonElement,
  }
}

describe('SignQRCard.solid: цикл iterate (tweb SignQRCard.tsx:135-192)', () => {
  it('один цикл с шагом 3 с: первый вызов на старте, второй через 3000 мс, не раньше', async () => {
    const { exportLoginToken } = mount()
    await vi.advanceTimersByTimeAsync(0)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(exportLoginToken).toHaveBeenCalledTimes(2)
  })

  it('до протухания кода меньше шага — ждём остаток (diff), а не шаг', async () => {
    const exportLoginToken = vi.fn().mockImplementation(async () => PENDING('aa01', 1))
    mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exportLoginToken).toHaveBeenCalledTimes(2)
  })

  it('перерисовка только при смене токена', async () => {
    const exportLoginToken = vi.fn()
      .mockImplementationOnce(async () => PENDING('aa01'))
      .mockImplementationOnce(async () => PENDING('aa01'))
      .mockImplementation(async () => PENDING('bb02'))
    mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(qrData).toHaveBeenCalledTimes(1)
    expect(qrData).toHaveBeenLastCalledWith(`${location.origin}/qr/aa01`)

    await vi.advanceTimersByTimeAsync(3_000) // тот же токен
    expect(exportLoginToken).toHaveBeenCalledTimes(2)
    expect(qrData).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000) // новый токен
    expect(qrData).toHaveBeenCalledTimes(2)
    expect(qrData).toHaveBeenLastCalledWith(`${location.origin}/qr/bb02`)
  })

  it('ключ входа: 64 hex, один на экран, в адрес QR не попадает', async () => {
    const { exportLoginToken } = mount()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3_000)
    const keys = exportLoginToken.mock.calls.map((c) => c[0] as string)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(keys[1]).toBe(keys[0])
    for (const call of qrData.mock.calls) expect(call[0]).not.toContain(keys[0])
  })

  it('success -> toIm, цикл остановлен', async () => {
    const exportLoginToken = vi.fn().mockResolvedValue({ status: 'success', user: {} })
    const { toIm } = mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(toIm).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
  })

  it('password -> карточка пароля с token и hint, цикл остановлен', async () => {
    const exportLoginToken = vi.fn().mockResolvedValue({ status: 'password', passwordToken: 'pwt', hint: 'подсказка' })
    const { navigate, toIm } = mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(navigate).toHaveBeenCalledWith({ name: 'password', payload: { token: 'pwt', hint: 'подсказка' } })
    expect(toIm).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
  })

  it('retry (сбой сети/5xx): ждём шаг и повторяем, цикл жив, отказа не показываем', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exportLoginToken = vi.fn()
      .mockResolvedValueOnce({ status: 'retry' })
      .mockImplementation(async () => PENDING('aa01'))
    mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(exportLoginToken).toHaveBeenCalledTimes(2)
    expect(vi.mocked(toastNew)).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('expired (AUTH_TOKEN_EXPIRED): console.warn и цикл идёт дальше без паузы, как у tweb :179-181', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const exportLoginToken = vi.fn()
      .mockResolvedValueOnce({ status: 'expired' })
      .mockImplementation(async () => PENDING('aa01'))
    mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalled()
    expect(exportLoginToken).toHaveBeenCalledTimes(2)
    expect(vi.mocked(toastNew)).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('«Log in by phone number» — назад на signIn, ни одного лишнего запроса', async () => {
    const { navigate, cancelBtn } = mount()
    await vi.advanceTimersByTimeAsync(0)

    cancelBtn().click()
    expect(navigate).toHaveBeenCalledWith({ name: 'signIn' })
  })
})

describe('SignQRCard.solid: цикл снимается вместе с карточкой (onCleanup, не React-эффект)', () => {
  it('после dispose вызовов нет', async () => {
    const { exportLoginToken, dispose: disposeCard } = mount()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3_000)
    const before = exportLoginToken.mock.calls.length
    expect(before).toBeGreaterThan(1)

    disposeCard()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(exportLoginToken.mock.calls.length).toBe(before)
  })

  it('ответ success, догнавший уже мёртвую карточку, отбрасывается — toIm не зван', async () => {
    let resolveExport: (v: unknown) => void = () => {}
    const exportLoginToken = vi.fn(() => new Promise((r) => { resolveExport = r }))
    const { toIm, dispose: disposeCard } = mount({ exportLoginToken })
    await vi.advanceTimersByTimeAsync(0) // запрос в полёте

    disposeCard()
    resolveExport({ status: 'success', user: {} })
    await vi.advanceTimersByTimeAsync(0)

    expect(toIm).not.toHaveBeenCalled()
  })

  // tweb `user_auth` (SignQRCard.tsx:67-72): вход останавливает цикл. Наш аналог —
  // `rt:logged_in`.
  it('rt:logged_in останавливает цикл (аналог user_auth)', async () => {
    const { exportLoginToken } = mount()
    await vi.advanceTimersByTimeAsync(0)
    const before = exportLoginToken.mock.calls.length

    rootScope.dispatchEventSingle(RT.loggedIn, { userId: 3 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(exportLoginToken.mock.calls.length).toBe(before)
  })

  it('вход ключом доступа останавливает цикл (аналог user_auth у tweb)', async () => {
    const webauthn = await import('@core/webauthnBrowser')
    vi.mocked(webauthn.isWebAuthnSupported).mockReturnValue(true)
    vi.mocked(webauthn.getPasskeyAssertion).mockResolvedValue({} as never)
    const passkeyLoginBegin = vi.fn().mockResolvedValue({ session: 's', options: {} })
    const passkeyLoginFinish = vi.fn().mockResolvedValue({})
    const { exportLoginToken, toIm } = mount({ passkeyLoginBegin, passkeyLoginFinish })
    await vi.advanceTimersByTimeAsync(0)
    const before = exportLoginToken.mock.calls.length

    const buttons = [...host!.querySelectorAll('button')]
    buttons[buttons.length - 1].click()
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())

    await vi.advanceTimersByTimeAsync(30_000)
    expect(exportLoginToken.mock.calls.length).toBe(before)

    vi.mocked(webauthn.isWebAuthnSupported).mockReturnValue(false)
  })
})

describe('SignQRCard.solid: отказ ДОХОДИТ до пользователя, а не гасится', () => {
  // Дыра, ради которой пины заведены: у вызовов стоял ПУСТОЙ `catch {}`. Сломанный
  // `managers.auth` давал вечный прелоадер и ПУСТУЮ консоль. Оригинал так не
  // делает: `tweb/src/pages/cards/SignQRCard.tsx:181-184`, ветка `default:` —
  // `console.error(...)` плюс `stopped = true`.
  const SUBTITLE_OK = 'Scan with Telegram app on your phone' // lang.ts «Login.QR.Subtitle»
  const SUBTITLE_FAIL = 'Something went wrong. Try again.' //  lang.ts «Login.Error.Generic»

  it('exportLoginToken упал: след в консоли, всплывашка по ключу словаря, подзаголовок — текст отказа, цикл остановлен', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exportLoginToken = vi.fn().mockRejectedValue(new TypeError('managers.auth.exportLoginToken is not a function'))
    mount({ exportLoginToken })

    await vi.advanceTimersByTimeAsync(0)

    expect(consoleError).toHaveBeenCalled()
    expect(vi.mocked(toastNew)).toHaveBeenCalledWith({ langPackKey: 'Login.Error.Generic' })
    expect(host!.textContent).toContain(SUBTITLE_FAIL)
    expect(host!.textContent).not.toContain(SUBTITLE_OK)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(exportLoginToken).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })

  it('исправный путь молчит: ни консоли, ни всплывашки, подзаголовок обычный', async () => {
    // Контрпин: без него «всегда показывать отказ» тоже было бы зелёным.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(consoleError).not.toHaveBeenCalled()
    expect(vi.mocked(toastNew)).not.toHaveBeenCalled()
    expect(host!.textContent).toContain(SUBTITLE_OK)

    consoleError.mockRestore()
  })

  it('вход по ключу доступа упал: консоль + всплывашка Login.Passkey.Error, кнопка снова активна', async () => {
    const webauthn = await import('@core/webauthnBrowser')
    vi.mocked(webauthn.isWebAuthnSupported).mockReturnValue(true)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // discoverable-логин без единого ключа на устройстве — ровно случай стенда
    // (recon §3.4: в БД 0 passkeys), браузер бросает NotAllowedError.
    const passkeyLoginBegin = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const { toIm } = mount({ passkeyLoginBegin })

    const buttons = [...host!.querySelectorAll('button')]
    const passkeyBtn = buttons[buttons.length - 1]
    passkeyBtn.click()

    await vi.waitFor(() => expect(vi.mocked(toastNew)).toHaveBeenCalled())
    expect(vi.mocked(toastNew)).toHaveBeenCalledWith({ langPackKey: 'Login.Passkey.Error' })
    expect(consoleError).toHaveBeenCalled()
    expect(toIm).not.toHaveBeenCalled()
    // Кнопку отпустило — повторить попытку можно (tweb: `setSubmitting(false)`).
    await vi.waitFor(() => expect(passkeyBtn.disabled).toBe(false))

    consoleError.mockRestore()
    vi.mocked(webauthn.isWebAuthnSupported).mockReturnValue(false)
  })
})

describe('SignQRCard.solid: стрелка на вторичных кнопках приходит из словаря (ревью 5, находка 4)', () => {
  // Прежний докблок утверждал «в tweb стрелки на этих кнопках нет» — неверно:
  // tweb langSign.ts:56 (`Login.QR.Cancel`) и :35 (`Login.Passkey`) несут её
  // ПРЯМО В СТРОКЕ ('...number >' / '...passkey >'), а `superFormatter`
  // (lib/langPack.ts:600-606) разбирает висящий ` >` в `span.tgico.inline-
  // icon`. Наши прежние ключи (`Login.ByPhone`/`Login.Passkey.Action`) этой
  // стрелки не несли — обычная кнопка без иконки, регресс и против
  // оригинала, и против нашей React-версии (`SecondaryButton arrow`).
  it('«Log in by phone number» несёт span.tgico.inline-icon — из ключа Login.QR.Cancel', () => {
    const { cancelBtn } = mount()
    expect(cancelBtn().querySelector('.tgico.inline-icon')).not.toBeNull()
  })

  it('кнопка passkey несёт ту же стрелку — из ключа Login.Passkey', async () => {
    const webauthn = await import('@core/webauthnBrowser')
    const isWebAuthnSupported = vi.mocked(webauthn.isWebAuthnSupported)
    isWebAuthnSupported.mockReturnValue(true)

    mount()
    const buttons = [...host!.querySelectorAll('button')]
    const passkeyBtn = buttons[buttons.length - 1]
    expect(passkeyBtn.querySelector('.tgico.inline-icon')).not.toBeNull()

    isWebAuthnSupported.mockReturnValue(false)
  })
})

describe('SignQRCard.solid: шапка — разметка tweb HEAD 812502980 (О-29)', () => {
  it('заголовок — h1, подзаголовок без модульного .secondary (tweb SignQRCard.tsx:228-234)', () => {
    mount()
    const title = host!.querySelector(`.${mediaHeaderStyles.title}`) as HTMLElement
    expect(title.tagName).toBe('H1')
    // у HEAD заголовок этой карточки — голый h1 с классом модуля, а не MediaHeader.Title
    expect(title.classList.contains('text-center')).toBe(true)
    expect(title.style.marginTop).toBe('0px')
    expect(title.hasAttribute('data-popup-title')).toBe(false)
    const subtitle = host!.querySelector(`.${mediaHeaderStyles.subtitle}`) as HTMLElement
    // глобальный .secondary — только цвет; модульный (14px) карточка не берёт
    expect(subtitle.classList.contains('secondary')).toBe(true)
    expect(subtitle.classList.contains(mediaHeaderStyles.secondary)).toBe(false)
  })
})
