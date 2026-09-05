/** @jsxImportSource solid-js */
/**
 * Пины `TrackingMonkey.solid.tsx` (порт tweb `monkeys/tracking.ts`).
 *
 * Норма проводки задачи: каждая строка ниже обязана краснить тест, если её
 * испортить — арифметика кадра, направление/разгон скорости, условие паузы
 * `enterFrame`, переключение канв idle↔tracking, проводка focus/blur/input
 * от реактивных пропов до `playAnimation`, уничтожение анимаций на
 * размонтировании (включая гонку «ассет догрузился после cleanup»).
 *
 * Движок — tlottie (`@lib/lottie/lottieLoader`): мокаем модуль целиком (тот
 * же приём, что `wrappers/sticker.test.ts` — `loadAnimationWorker` там,
 * `loadAnimationAsAsset` здесь), а не `lottie-web` (глобальный мок в
 * `test/setup.ts` этого компонента больше не касается — движок сменился).
 * Обе анимации теперь делят ОДИН контейнер (см. докблок компонента про
 * отказ от host-`div` на канву), поэтому идле/tracking-инстансы различаем по
 * ИМЕНИ ассета, вторым аргументом `loadAnimationAsAsset`, а не по узлу.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'

const { loadAnimationAsAsset, waitForFirstFrame } = vi.hoisted(() => ({
  loadAnimationAsAsset: vi.fn(),
  waitForFirstFrame: vi.fn((player: unknown) => Promise.resolve(player)),
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset, waitForFirstFrame },
}))

import TrackingMonkey, {
  computeTrackingFrame,
  computeTrackingStep,
  shouldPauseOnFrame,
} from './TrackingMonkey.solid'

// ───────────────────────── арифметика кадра (пин 1) ─────────────────────────
describe('computeTrackingFrame', () => {
  it('пустое значение — кадр 0', () => {
    expect(computeTrackingFrame(0, 45)).toBe(0)
  })

  it('первый символ — кадр 15 (комментарий оригинала «1st symbol = frame 15»); без слагаемого 11.33 было бы 4', () => {
    expect(computeTrackingFrame(1, 45)).toBe(15)
    // испорченное «+11.33» (например, забытое) дало бы этот результат — фиксируем
    // контраст явно, чтобы мутация на удаление слагаемого точно покраснела.
    expect(Math.round(1 * (165 / 45))).toBe(4)
  })

  it('кламп `Math.min(length, 30)`: rawLength=31 и rawLength=30 дают одинаковый кадр, rawLength=29 — другой', () => {
    const at30 = computeTrackingFrame(30, 45)
    expect(computeTrackingFrame(31, 45)).toBe(at30)
    expect(computeTrackingFrame(29, 45)).not.toBe(at30)
  })

  it('кламп `Math.min(max, length)`: при max=10 rawLength=20 и rawLength=10 совпадают, rawLength=9 — другой', () => {
    const at10 = computeTrackingFrame(10, 10)
    expect(computeTrackingFrame(20, 10)).toBe(at10)
    expect(computeTrackingFrame(9, 10)).not.toBe(at10)
  })
})

// ────────────────── направление и разгон скорости (пин 2) ───────────────────
describe('computeTrackingStep', () => {
  it('движение вперёд (needFrame < frame) — direction 1, без разгона', () => {
    expect(computeTrackingStep(0, 15)).toEqual({ direction: 1, resetSpeed: false })
  })

  it('возврат к нулю (needFrame > 0, frame === 0) — direction -1 И разгон скорости до 7', () => {
    expect(computeTrackingStep(150, 0)).toEqual({ direction: -1, resetSpeed: true })
  })

  it('движение назад к НЕнулевому кадру — direction -1, БЕЗ разгона (разгон только на возврате к нулю)', () => {
    expect(computeTrackingStep(150, 20)).toEqual({ direction: -1, resetSpeed: false })
  })

  it('стартовое состояние (оба нуля) — direction 1, без разгона', () => {
    expect(computeTrackingStep(0, 0)).toEqual({ direction: 1, resetSpeed: false })
  })
})

// ───────────────────── условие паузы enterFrame (пин 3) ─────────────────────
describe('shouldPauseOnFrame', () => {
  it('direction 1: пауза, когда currentFrame догнал needFrame (>=)', () => {
    expect(shouldPauseOnFrame(1, 15, 15)).toBe(true)
    expect(shouldPauseOnFrame(1, 16, 15)).toBe(true)
    expect(shouldPauseOnFrame(1, 14, 15)).toBe(false)
  })

  it('direction -1: пауза, когда currentFrame спустился до needFrame (<=)', () => {
    expect(shouldPauseOnFrame(-1, 15, 15)).toBe(true)
    expect(shouldPauseOnFrame(-1, 14, 15)).toBe(true)
    expect(shouldPauseOnFrame(-1, 16, 15)).toBe(false)
  })
})

// ───────────────────────── компонент: DOM + lottie ───────────────────────────
let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function unmount() {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
}

afterEach(() => {
  unmount()
  loadAnimationAsAsset.mockReset()
  waitForFirstFrame.mockClear()
})

function makeFakePlayer() {
  const player = {
    canvas: [document.createElement('canvas')] as HTMLCanvasElement[],
    direction: 1,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn((d: number) => {
      player.direction = d
    }),
    addEventListener: vi.fn(),
    remove: vi.fn(),
  }
  return player
}

type FakePlayer = ReturnType<typeof makeFakePlayer>

function getEnterFrameCallback(anim: FakePlayer): (currentFrame: number) => void {
  const call = anim.addEventListener.mock.calls.find((c) => c[0] === 'enterFrame')
  if (!call) throw new Error('enterFrame listener не зарегистрирован')
  return call[1] as (currentFrame: number) => void
}

function mount(length = 5) {
  unmount()
  // Два РАЗНЫХ сигнала — намеренно НЕ один: `value` («контролируемое значение
  // поля», может смениться и программно) и `typedValue` («значение в момент
  // настоящего пользовательского ввода», единственный источник движения
  // кадра). См. докблок пропов `TrackingMonkeyProps` — там разбор находки
  // ревью (склейка этих двух сигналов в один давала обезьяне двигаться от
  // программного сброса поля, чего в tweb быть не может).
  const [value, setValue] = createSignal('')
  const [typedValue, setTypedValue] = createSignal('')
  const [focused, setFocused] = createSignal(false)
  host = document.createElement('div')
  document.body.append(host)

  const idleAnim = makeFakePlayer()
  const trackingAnim = makeFakePlayer()

  loadAnimationAsAsset.mockImplementation((_params: unknown, name: LottieAssetName) =>
    Promise.resolve(name === 'TwoFactorSetupMonkeyIdle' ? idleAnim : trackingAnim),
  )

  dispose = render(
    () => (
      <TrackingMonkey size={130} length={length} value={value} typedValue={typedValue} focused={focused} />
    ),
    host,
  )

  // Единственный контейнер — сам `.media-sticker-wrapper` (обе анимации
  // делят его, см. докблок компонента про отказ от host-`div` на канву).
  const containerEl = host.querySelector<HTMLDivElement>('.media-sticker-wrapper')!

  return { setValue, setTypedValue, setFocused, containerEl, idleAnim, trackingAnim }
}

async function mountAndLoad(length = 5) {
  const ctx = mount(length)
  // Обе канвы грузятся асинхронно (`lottieLoader.loadAnimationAsAsset` ×2).
  await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(2))
  return ctx
}

describe('TrackingMonkey.solid: загрузка и начальное состояние', () => {
  it('на пустом значении поля tracking-канва скрыта загрузкой (tweb :129-131)', async () => {
    const { trackingAnim } = await mountAndLoad()
    expect(trackingAnim.canvas[0].style.display).toBe('none')
  })

  it('обе загрузки идут в ОДИН и тот же контейнер (tweb :104/:121 — общий `this.container`)', async () => {
    const { containerEl } = await mountAndLoad()
    for (const call of loadAnimationAsAsset.mock.calls) {
      expect((call[0] as { container: unknown }).container).toBe(containerEl)
    }
  })
})

// ───────────────────── проводка focus/blur/input → playAnimation (пин 5) ────
describe('TrackingMonkey.solid: проводка focus/blur/input', () => {
  it('focus доводит до playAnimation(1): direction 1, без разгона, tracking-канва показана', async () => {
    const { setFocused, idleAnim, trackingAnim } = await mountAndLoad()

    setFocused(true)
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())

    // computeTrackingFrame(1,45) = 15, needFrame стартовал с 0 → direction 1
    expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(1)
    expect(trackingAnim.setSpeed).not.toHaveBeenCalled()
    expect(idleAnim.stop).toHaveBeenCalledWith(true)
    expect(idleAnim.canvas[0].style.display).toBe('none')
    expect(trackingAnim.canvas[0].style.display).toBe('')
  })

  it('blur после focus доводит до playAnimation(0): direction -1 И разгон скорости до 7', async () => {
    const { setFocused, trackingAnim } = await mountAndLoad()

    setFocused(true)
    await vi.waitFor(() => expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(1))

    trackingAnim.play.mockClear()
    setFocused(false)
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())

    // needFrame(15) > frame(0) → direction -1; needFrame!==0 && frame===0 → setSpeed(7)
    expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(-1)
    expect(trackingAnim.setSpeed).toHaveBeenCalledWith(7)
  })

  it('набор цифры (typedValue) доводит до пересчёта кадра через fastRaf', async () => {
    const { setTypedValue, trackingAnim } = await mountAndLoad(5)

    setTypedValue('1')
    // fastRaf планирует внутри requestAnimationFrame (см. AuthCodeCard.solid.test.tsx —
    // тот же приём ожидания rAF в happy-dom через vi.waitFor).
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())
    // frac=(1+1)/5=0.4 → rawLength=18 → кадр 77 > needFrame(0) → direction 1
    expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(1)

    trackingAnim.play.mockClear()
    trackingAnim.setDirection.mockClear()
    setTypedValue('12')
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())
    // frac=(1+2)/5=0.6 → rawLength=27 → кадр 110 > needFrame(77) — всё ещё вперёд
    expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(1)
  })

  // Находка ревью: `value` — контролируемое значение поля, меняется и
  // программным сбросом (карточка кода чистит его на неверном коде) — сам по
  // себе двигать обезьянку НЕ должен, ровно как присваивание `.value` в tweb
  // не рождает DOM-событие `input`. Двигает только `typedValue`.
  it('одно только изменение `value` (без `typedValue`) НЕ доводит до playAnimation', async () => {
    const { setValue, trackingAnim } = await mountAndLoad(5)

    setValue('12345')
    // Даём шанс любому отложенному эффекту/fastRaf сработать, если бы он был.
    await new Promise((r) => setTimeout(r, 50))

    expect(trackingAnim.play).not.toHaveBeenCalled()
    expect(trackingAnim.setDirection).not.toHaveBeenCalled()
  })
})

// ───────────────────── переключение канв idle↔tracking (пин 4) ──────────────
describe('TrackingMonkey.solid: переключение канв idle↔tracking', () => {
  it('focus прячет idle и показывает tracking; blur готовит возврат (разгон), а САМ возврат — на нулевом кадре enterFrame', async () => {
    const { setFocused, idleAnim, trackingAnim } = await mountAndLoad()

    setFocused(true)
    await vi.waitFor(() => expect(trackingAnim.canvas[0].style.display).toBe(''))
    expect(idleAnim.canvas[0].style.display).toBe('none')

    setFocused(false)
    await vi.waitFor(() => expect(trackingAnim.setSpeed).toHaveBeenCalledWith(7))
    // playAnimation(0) сам по себе канвы НЕ трогает (tweb: переключение видимости —
    // только в ветке `if(length)`) — возврат идёт через enterFrame на кадре 0.
    expect(trackingAnim.canvas[0].style.display).toBe('')

    const enterFrame = getEnterFrameCallback(trackingAnim)
    enterFrame(0)

    expect(idleAnim.canvas[0].style.display).toBe('')
    expect(idleAnim.play).toHaveBeenCalled()
    expect(trackingAnim.canvas[0].style.display).toBe('none')
  })

  it('возврат к idle на enterFrame НЕ срабатывает, если needFrame ещё не 0 (кадр 0 достигнут, но цель другая)', async () => {
    const { setTypedValue, trackingAnim, idleAnim } = await mountAndLoad()

    setTypedValue('1')
    await vi.waitFor(() => expect(trackingAnim.play).toHaveBeenCalled())

    const enterFrame = getEnterFrameCallback(trackingAnim)
    // currentFrame случайно 0, но needFrame — не 0 (набор цифры, needFrame=77) —
    // условие `currentFrame===0 && needFrame===0` не выполняется.
    enterFrame(0)

    expect(idleAnim.canvas[0].style.display).not.toBe('')
  })
})

// ─────────────────────── пауза enterFrame, обе ветви (пин 3, компонент) ─────
describe('TrackingMonkey.solid: пауза подыгрывания в enterFrame', () => {
  it('обе ветви направления', async () => {
    const { setFocused, trackingAnim } = await mountAndLoad()

    setFocused(true) // needFrame=15, direction=1
    await vi.waitFor(() => expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(1))
    const enterFrame = getEnterFrameCallback(trackingAnim)

    enterFrame(10) // ещё не догнали needFrame(15)
    expect(trackingAnim.pause).not.toHaveBeenCalled()

    enterFrame(15) // догнали — пауза
    expect(trackingAnim.pause).toHaveBeenCalled()
    expect(trackingAnim.setSpeed).toHaveBeenCalledWith(1)

    trackingAnim.pause.mockClear()
    setFocused(false) // needFrame=0, direction=-1
    await vi.waitFor(() => expect(trackingAnim.setDirection).toHaveBeenLastCalledWith(-1))

    enterFrame(5) // ещё выше needFrame(0) — для direction -1 условие currentFrame<=needFrame не выполняется
    expect(trackingAnim.pause).not.toHaveBeenCalled()

    enterFrame(0) // спустились до 0 — пауза
    expect(trackingAnim.pause).toHaveBeenCalled()
  })
})

// ───────────────────── уничтожение на размонтировании (пин 6) ───────────────
describe('TrackingMonkey.solid: размонтирование', () => {
  it('обе анимации уничтожаются на cleanup', async () => {
    const { idleAnim, trackingAnim } = await mountAndLoad()

    unmount()

    expect(idleAnim.remove).toHaveBeenCalled()
    expect(trackingAnim.remove).toHaveBeenCalled()
  })

  it('размонтирование ДО того как ассет догрузился — гонка не оставляет живой анимации', async () => {
    const idleAnim = makeFakePlayer()
    const trackingAnim = makeFakePlayer()
    // Промисы намеренно НЕ резолвятся синхронно — резолвим их уже ПОСЛЕ unmount(),
    // чтобы поймать именно гонку «ассет догрузился после cleanup». Рендерим
    // НАПРЯМУЮ (не через общий `mount()`, который сам перезаписывает
    // `loadAnimationAsAsset.mockImplementation` резолвящимся моком).
    let resolveIdle!: (p: FakePlayer) => void
    let resolveTracking!: (p: FakePlayer) => void
    loadAnimationAsAsset.mockImplementation((_params: unknown, name: LottieAssetName) =>
      new Promise((resolve) => {
        if (name === 'TwoFactorSetupMonkeyIdle') resolveIdle = resolve
        else resolveTracking = resolve
      }),
    )

    host = document.createElement('div')
    document.body.append(host)
    dispose = render(
      () => (
        <TrackingMonkey
          size={130}
          length={5}
          value={() => ''}
          typedValue={() => ''}
          focused={() => false}
        />
      ),
      host,
    )
    unmount() // синхронно, раньше, чем резолвятся промисы загрузки

    resolveIdle(idleAnim)
    resolveTracking(trackingAnim)
    await new Promise((r) => setTimeout(r, 0))

    // `alive`-гейт: анимация, догрузившаяся уже после cleanup, немедленно снимается.
    expect(idleAnim.remove).toHaveBeenCalled()
    expect(trackingAnim.remove).toHaveBeenCalled()
    expect(idleAnim.play).not.toHaveBeenCalled()
  })
})
