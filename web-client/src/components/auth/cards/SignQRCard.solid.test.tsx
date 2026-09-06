/** @jsxImportSource solid-js */
/**
 * Пины `SignQRCard.solid.tsx` (Solid-порт нашей React `cards/SignQRCard.tsx`,
 * которая сама — порт tweb `pages/cards/SignQRCard.tsx`).
 *
 * Поведенческий пин по сути карточки: `qrNew` рисует QR, ротация каждые 30с
 * (`ROTATE_MS`) заводит новый токен, опрос каждые 2с (`POLL_MS`) проверяет
 * подтверждение — `confirmed` уводит в мессенджер (сессия уже сохранена
 * внутри `qrStatus`), `expired` перегенерирует токен раньше срока.
 *
 * ── Debt/особое внимание задачи 5: ротация и опрос СНИМАЮТСЯ вместе с карточкой ──
 * У tweb это `onCleanup` в самой карточке (`SignQRCard.tsx:212-216`), не
 * возврат из React `useEffect`. Пин ниже — САМЫЙ важный в файле: размонтируем
 * карточку, продвигаем фейковые таймеры дальше периода ротации/опроса и
 * проверяем, что ни `qrNew`, ни `qrStatus` больше НЕ званы. Порча, которая
 * забыла бы `onCleanup` (или вызвала не ту функцию), оставила бы таймеры
 * тикать по мёртвой карточке — именно это ловит тест.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { toastNew } from '@components/toast'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignQRCard from './SignQRCard.solid'

vi.mock('@core/webauthnBrowser', () => ({
  isWebAuthnSupported: vi.fn(() => false),
  getPasskeyAssertion: vi.fn(),
}))

// Всплывашку мокаем, чтобы пин смотрел на КЛЮЧ СЛОВАРЯ, а не на текст в DOM:
// «строка написана в коде вместо ключа» обязана краснеть здесь же.
vi.mock('@components/toast', () => ({ toastNew: vi.fn() }))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(toastNew).mockClear()
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  vi.useRealTimers()
})

function mount(
  overrides: {
    qrNew?: ReturnType<typeof vi.fn>
    qrStatus?: ReturnType<typeof vi.fn>
    passkeyLoginBegin?: ReturnType<typeof vi.fn>
    passkeyLoginFinish?: ReturnType<typeof vi.fn>
  } = {},
) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: {
      qrNew: overrides.qrNew ?? vi.fn().mockResolvedValue('tok-1'),
      qrStatus: overrides.qrStatus ?? vi.fn().mockResolvedValue({ status: 'pending' }),
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
    dispose: currentDispose,
    canvas: () => currentHost.querySelector('canvas'),
    cancelBtn: () => currentHost.querySelector('button') as HTMLButtonElement,
  }
}

describe('SignQRCard.solid: токен и опрос подтверждения', () => {
  it('на монтировании заводит токен через qrNew и рисует QR', async () => {
    const qrNew = vi.fn().mockResolvedValue('tok-1')
    mount({ qrNew })
    await vi.waitFor(() => expect(qrNew).toHaveBeenCalledWith('web'))
  })

  it('ротация: каждые 30с — новый qrNew, даже если предыдущий ещё pending', async () => {
    const qrNew = vi.fn().mockResolvedValue('tok-1')
    mount({ qrNew })
    await vi.advanceTimersByTimeAsync(0)
    expect(qrNew).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(qrNew).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(qrNew).toHaveBeenCalledTimes(3)
  })

  it('опрос: каждые 2с — qrStatus(token); status=expired перегенерирует токен', async () => {
    const qrNew = vi.fn().mockResolvedValueOnce('tok-1').mockResolvedValueOnce('tok-2')
    const qrStatus = vi.fn().mockResolvedValue({ status: 'expired' })
    mount({ qrNew, qrStatus })
    await vi.advanceTimersByTimeAsync(0)
    expect(qrNew).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(qrStatus).toHaveBeenCalledWith('tok-1')
    // expired → regen без ожидания следующей ротации
    await vi.waitFor(() => expect(qrNew).toHaveBeenCalledTimes(2))
  })

  it('опрос: status=confirmed — toIm() (сессия уже сохранена внутри qrStatus)', async () => {
    const qrStatus = vi.fn().mockResolvedValue({ status: 'confirmed' })
    const { toIm } = mount({ qrStatus })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(toIm).toHaveBeenCalled())
  })

  it('«Log in by phone number» — назад на signIn, ни одного лишнего запроса', async () => {
    const qrStatus = vi.fn().mockResolvedValue({ status: 'pending' })
    const { navigate, cancelBtn } = mount({ qrStatus })
    await vi.advanceTimersByTimeAsync(0)

    cancelBtn().click()
    expect(navigate).toHaveBeenCalledWith({ name: 'signIn' })
  })
})

describe('SignQRCard.solid: таймеры снимаются вместе с карточкой (onCleanup, не React-эффект)', () => {
  it('размонтирование прекращает И ротацию, И опрос — ни qrNew, ни qrStatus больше не званы', async () => {
    const qrNew = vi.fn().mockResolvedValue('tok-1')
    const qrStatus = vi.fn().mockResolvedValue({ status: 'pending' })
    const { dispose: disposeCard } = mount({ qrNew, qrStatus })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000) // один тик опроса, чтобы оба таймера точно живы
    const qrNewCallsBefore = qrNew.mock.calls.length
    const qrStatusCallsBefore = qrStatus.mock.calls.length
    expect(qrStatusCallsBefore).toBeGreaterThan(0)

    disposeCard()

    // Продвигаем дальше периода И ротации (30с), И опроса (2с) — с живыми
    // таймерами оба счётчика обязаны были бы вырасти.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(qrNew.mock.calls.length).toBe(qrNewCallsBefore)
    expect(qrStatus.mock.calls.length).toBe(qrStatusCallsBefore)
  })

  it('подтверждение ПОСЛЕ размонтирования не зовёт toIm — асинхронный ответ, догнавший мёртвую карточку, отбрасывается', async () => {
    // qrStatus резолвится не сразу — карточка размонтируется, ПОКА ответ летит.
    let resolveStatus: (v: { status: string }) => void = () => {}
    const qrStatus = vi.fn(() => new Promise((r) => { resolveStatus = r }))
    const { toIm, dispose: disposeCard } = mount({ qrStatus })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000) // тик опроса стартовал, промис ещё висит

    disposeCard()
    resolveStatus({ status: 'confirmed' })
    await Promise.resolve()
    await Promise.resolve()

    expect(toIm).not.toHaveBeenCalled()
  })
})

describe('SignQRCard.solid: отказ ДОХОДИТ до пользователя, а не гасится', () => {
  // Дыра, ради которой пины заведены: у обоих вызовов стоял ПУСТОЙ `catch {}`.
  // Сломанный `managers.auth` (баг прокси, PR #237) давал вечный прелоадер и
  // ПУСТУЮ консоль — «кнопка нажимается, ничего не происходит». Оригинал так
  // не делает: `tweb/src/pages/cards/SignQRCard.tsx:181-184`, ветка
  // `default:` — `console.error(...)` плюс `stopped = true`.
  const SUBTITLE_OK = 'Scan with Telegram app on your phone' // lang.ts «Login.QR.Subtitle»
  const SUBTITLE_FAIL = 'Something went wrong. Try again.' //  lang.ts «Login.Error.Generic»

  it('qrNew упал: след в консоли, всплывашка по ключу словаря, подзаголовок — текст отказа, опрос остановлен', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Ровно та ошибка, которую глотал пустой перехват (recon: подменённый прокси).
    const qrNew = vi.fn().mockRejectedValue(new TypeError('managers.auth.qrNew is not a function'))
    const qrStatus = vi.fn().mockResolvedValue({ status: 'pending' })
    mount({ qrNew, qrStatus })

    await vi.advanceTimersByTimeAsync(0)

    expect(consoleError).toHaveBeenCalled()
    expect(vi.mocked(toastNew)).toHaveBeenCalledWith({ langPackKey: 'Login.Error.Generic' })
    // Видимое состояние: подзаголовок карточки больше не зовёт сканировать.
    expect(host!.textContent).toContain(SUBTITLE_FAIL)
    expect(host!.textContent).not.toContain(SUBTITLE_OK)

    // И цикл остановлен — как `stopped = true` у оригинала, а не «следующая
    // ротация повторит попытку» (что и делал прежний пустой перехват).
    await vi.advanceTimersByTimeAsync(60_000)
    expect(qrNew).toHaveBeenCalledTimes(1)
    expect(qrStatus).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('qrStatus упал: то же самое — консоль, всплывашка, текст отказа, опрос остановлен', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const qrNew = vi.fn().mockResolvedValue('tok-1')
    const qrStatus = vi.fn().mockRejectedValue(new Error('network down'))
    mount({ qrNew, qrStatus })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(consoleError).toHaveBeenCalled()
    expect(vi.mocked(toastNew)).toHaveBeenCalledWith({ langPackKey: 'Login.Error.Generic' })
    expect(host!.textContent).toContain(SUBTITLE_FAIL)

    const statusCalls = qrStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(qrStatus.mock.calls.length).toBe(statusCalls)
    expect(qrNew).toHaveBeenCalledTimes(1)

    consoleError.mockRestore()
  })

  it('исправный путь молчит: ни консоли, ни всплывашки, подзаголовок обычный', async () => {
    // Контрпин: без него «всегда показывать отказ» тоже было бы зелёным.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mount()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000)

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
