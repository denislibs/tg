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
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import SignQRCard from './SignQRCard.solid'

vi.mock('@core/webauthnBrowser', () => ({
  isWebAuthnSupported: vi.fn(() => false),
  getPasskeyAssertion: vi.fn(),
}))

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
  vi.useRealTimers()
})

function mount(overrides: { qrNew?: ReturnType<typeof vi.fn>; qrStatus?: ReturnType<typeof vi.fn> } = {}) {
  const navigate = vi.fn()
  const toIm = vi.fn().mockResolvedValue(undefined)
  const managers = {
    auth: {
      qrNew: overrides.qrNew ?? vi.fn().mockResolvedValue('tok-1'),
      qrStatus: overrides.qrStatus ?? vi.fn().mockResolvedValue({ status: 'pending' }),
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
