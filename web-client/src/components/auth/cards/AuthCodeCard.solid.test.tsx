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
import type { LottieAssetName } from '@lib/lottie/lottieLoader'
import type { Managers } from '@/client/bootstrap'
import { AuthFlowContext, type AuthFlowContextValue } from '../authFlow.solid'
import AuthCodeCard from './AuthCodeCard.solid'

// Обезьянка (`TrackingMonkey`) грузит обе свои анимации через tlottie
// (`@lib/lottie/lottieLoader.loadAnimationAsAsset`) — мокаем модуль целиком,
// тем же приёмом, что `TrackingMonkey.solid.test.tsx`. По умолчанию промис
// не резолвится: тестам этого файла, которые не смотрят на обезьянку (исходы
// ввода кода), не нужен доигранный плеер — им важно лишь не упасть на монтаже.
const { loadAnimationAsAsset, waitForFirstFrame } = vi.hoisted(() => ({
  loadAnimationAsAsset: vi.fn((_params: unknown, _name: LottieAssetName) => new Promise<unknown>(() => {})),
  waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)),
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset, waitForFirstFrame },
}))

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

function makeFakeAnim() {
  const anim = {
    canvas: [document.createElement('canvas')] as HTMLCanvasElement[],
    direction: 1,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn((d: number) => {
      anim.direction = d
    }),
    addEventListener: vi.fn(),
  }
  return anim
}

/**
 * Подменяет `lottieLoader.loadAnimationAsAsset`, чтобы различать idle/
 * tracking-инстансы обезьянки по ИМЕНИ ассета (второй аргумент — обе анимации
 * теперь делят один контейнер, см. `TrackingMonkey.solid.test.tsx` — тот же
 * приём). ВАЖНО: вызывать ДО `mount()` — в отличие от старого `lottie-web`
 * (там за асинхронность отвечал сам динамический `import()` json'ки, а
 * `lottie.loadAnimation` звался синхронно уже ПОСЛЕ его резолва), tlottie-
 * загрузчик зовётся `onMount` синхронно, без отложенного гейта — переставить
 * мок ПОСЛЕ монтажа уже поздно, обезьянка успевает загрузиться на дефолтном
 * (никогда не резолвящемся) моке хука файла. Другие `it` в этом файле тоже
 * монтируют карточку (а значит и обезьянку) на ОБЩЕМ моке `lottieLoader` —
 * счётчик чистим перед тем, как считать СВОИ два вызова (idle+tracking).
 */
function prepareMonkeyMocks() {
  const idleAnim = makeFakeAnim()
  const trackingAnim = makeFakeAnim()
  loadAnimationAsAsset.mockClear()
  loadAnimationAsAsset.mockImplementation((_params: unknown, name: LottieAssetName) =>
    Promise.resolve(name === 'TwoFactorSetupMonkeyIdle' ? idleAnim : trackingAnim),
  )
  return { idleAnim, trackingAnim }
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
    const { idleAnim, trackingAnim } = prepareMonkeyMocks()
    const signIn = vi.fn()
    const { input } = mount(signIn)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(2))

    input().blur()
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())

    trackingAnim.play.mockClear()
    input().focus()
    await vi.waitFor(() => expect(trackingAnim.canvas[0].style.display).toBe(''))
    expect(idleAnim.canvas[0].style.display).toBe('none')
    expect(idleAnim.stop).toHaveBeenCalled()

    loadAnimationAsAsset.mockReset()
  })

  // Важная находка ревью: программный сброс значения поля (неверный код) НЕ
  // должен двигать обезьянку — в tweb `codeInputField.value = ''`
  // (AuthCodeCard.tsx:126/147) присваивает `.value` напрямую и НЕ порождает
  // DOM-событие `input`, поэтому `monkeys/tracking.ts`'s листенер `input`
  // (:35-40) на этот сброс не реагирует вовсе. У нас источник кадра —
  // `TrackingMonkey`'s проп `typedValue` (см. её докблок): его двигает
  // ТОЛЬКО настоящий `onChange` от `CodeInput` (зовётся исключительно из
  // `handleInput`, который сам навешен на реальное DOM-событие `input`), а
  // `AuthCodeCard.solid.tsx`'s `catch` в `submitCode` пишет ТОЛЬКО в `value`
  // (управляет полем/дисаблом), `typedValue` не трогает.
  it('программный сброс значения (неверный код) НЕ доводит до playAnimation — движение только от настоящего ввода', async () => {
    const { trackingAnim } = prepareMonkeyMocks()
    const signIn = vi.fn().mockRejectedValue(new Error('PHONE_CODE_INVALID'))
    const { typeCode } = mount(signIn)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(2))

    typeCode('00000')
    // Набор кода целиком двигает кадр строго вперёд (needFrame растёт
    // 0→…→121) — direction всегда 1, ни разу -1.
    await vi.waitFor(() => expect(trackingAnim.setDirection).toHaveBeenCalledWith(1))

    await vi.waitFor(() => expect(host!.textContent).toContain('Invalid code'))
    // Если бы сброс на пустую строку дошёл до playAnimation, needFrame(121)
    // упал бы к frame(44) — родился бы вызов setDirection(-1), которого в
    // tweb быть не может (сброс `.value` без события).
    expect(trackingAnim.setDirection).not.toHaveBeenCalledWith(-1)

    loadAnimationAsAsset.mockReset()
  })
})
