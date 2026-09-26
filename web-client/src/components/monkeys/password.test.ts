/**
 * `PasswordMonkey` (порт tweb `monkeys/password.ts`) + `PasswordInputField` (порт
 * `passwordInputField.ts`): «глазок» поля показывает пароль и переводит
 * обезьянку в «подглядывает» (кадр 0→16), повторный клик — обратно (16→0);
 * `enterFrame` останавливает анимацию на цели.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadAnimationAsAsset = vi.hoisted(() => vi.fn())
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset, waitForFirstFrame: (player: unknown) => Promise.resolve(player) },
}))

import PasswordInputField from '@components/passwordInputField'
import PasswordMonkey from './password'

function makePlayer() {
  const player = {
    direction: 1,
    curFrame: 0,
    play: vi.fn(),
    pause: vi.fn(),
    setSpeed: vi.fn(),
    setDirection: vi.fn((d: number) => { player.direction = d }),
    addEventListener: vi.fn(),
    remove: vi.fn(),
  }
  return player
}

let player: ReturnType<typeof makePlayer>
beforeEach(() => {
  player = makePlayer()
  loadAnimationAsAsset.mockReset().mockResolvedValue(player)
})

describe('PasswordMonkey + PasswordInputField', () => {
  it('грузит TwoFactorSetupMonkeyPeek в media-sticker-wrapper заданного размера', async() => {
    const field = new PasswordInputField({ label: 'LoginPassword' })
    const monkey = new PasswordMonkey(field, 157)
    await monkey.load()

    expect(monkey.container.className).toBe('media-sticker-wrapper')
    expect(loadAnimationAsAsset).toHaveBeenCalledWith(
      expect.objectContaining({ container: monkey.container, width: 157, height: 157, loop: false, autoplay: false, noCache: true }),
      'TwoFactorSetupMonkeyPeek',
    )
  })

  it('«глазок»: пароль виден и обезьянка подглядывает (0→16), повторный клик — прячет (16→0)', async() => {
    const field = new PasswordInputField({ label: 'LoginPassword' })
    const monkey = new PasswordMonkey(field, 157)
    await monkey.load()
    const input = field.input as HTMLInputElement
    const toggle = field.container.querySelector<HTMLElement>('.toggle-visible')!

    expect(input.type).toBe('password')
    toggle.click()
    expect(input.type).toBe('text')
    expect(player.setDirection).toHaveBeenLastCalledWith(1)
    expect(player.curFrame).toBe(0)
    expect(monkey.needFrame).toBe(16)
    expect(player.play).toHaveBeenCalledTimes(1)

    const enterFrame = player.addEventListener.mock.calls.find((c) => c[0] === 'enterFrame')![1] as (f: number) => void
    enterFrame(16)
    expect(player.pause).toHaveBeenCalledTimes(1)

    toggle.click()
    expect(input.type).toBe('password')
    expect(player.setDirection).toHaveBeenLastCalledWith(-1)
    expect(player.curFrame).toBe(16)
    expect(monkey.needFrame).toBe(0)
  })

  it('remove снимает загруженную анимацию', async() => {
    const monkey = new PasswordMonkey(new PasswordInputField(), 157)
    monkey.remove()
    await monkey.load()
    monkey.remove()
    expect(player.remove).toHaveBeenCalledTimes(1)
  })
})
