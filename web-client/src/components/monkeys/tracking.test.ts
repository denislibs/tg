/**
 * `TrackingMonkey` над обычным полем (порт tweb `monkeys/tracking.ts`, ветка
 * `InputField`): ввод двигает кадр по длине значения (idle прячется), уход
 * фокуса возвращает к нулю.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadAnimationAsAsset = vi.hoisted(() => vi.fn())
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset, waitForFirstFrame: (player: unknown) => Promise.resolve(player) },
}))

import InputField from '@components/inputField'
import TrackingMonkey from './tracking'

function makePlayer() {
  const player = {
    canvas: [document.createElement('canvas')],
    direction: 1,
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn((d: number) => { player.direction = d }),
    addEventListener: vi.fn(),
    remove: vi.fn(),
  }
  return player
}

let idle: ReturnType<typeof makePlayer>
let tracking: ReturnType<typeof makePlayer>
beforeEach(() => {
  idle = makePlayer()
  tracking = makePlayer()
  loadAnimationAsAsset.mockReset().mockImplementation(async(_params: unknown, name: string) =>
    name === 'TwoFactorSetupMonkeyIdle' ? idle : tracking)
})

describe('TrackingMonkey над InputField', () => {
  it('ввод: кадр по длине значения, idle скрыт; blur — назад к нулю с разгоном', async() => {
    const field = new InputField({ plainText: true, label: 'LoginPassword' })
    const monkey = new TrackingMonkey(field, 157)
    await monkey.load()
    const input = field.input as HTMLInputElement

    // пустое поле: tracking-канва скрыта с самого начала (tweb :129-131)
    expect(tracking.canvas[0].style.display).toBe('none')

    input.value = 'abc'
    input.dispatchEvent(new Event('input'))
    // 3 символа → round(3 * 165/45 + 11.33) = 22
    expect(tracking.setDirection).toHaveBeenLastCalledWith(1)
    expect(tracking.play).toHaveBeenCalledTimes(1)
    expect(idle.canvas[0].style.display).toBe('none')
    expect(tracking.canvas[0].style.display).toBe('')

    input.dispatchEvent(new Event('blur'))
    expect(tracking.setDirection).toHaveBeenLastCalledWith(-1)
    expect(tracking.setSpeed).toHaveBeenLastCalledWith(7)
  })

  it('грузит обе анимации в один контейнер', async() => {
    const monkey = new TrackingMonkey(new InputField({ plainText: true }), 157)
    await monkey.load()
    expect(loadAnimationAsAsset.mock.calls.map((c) => [c[0].container, c[1]])).toEqual([
      [monkey.container, 'TwoFactorSetupMonkeyIdle'],
      [monkey.container, 'TwoFactorSetupMonkeyTracking'],
    ])
    monkey.remove()
    expect(idle.remove).toHaveBeenCalled()
    expect(tracking.remove).toHaveBeenCalled()
  })
})
