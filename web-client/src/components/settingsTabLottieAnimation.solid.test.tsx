/** @jsxImportSource solid-js */
// Порт tweb `src/components/settingsTabLottieAnimation.tsx` (812502980) —
// лотти-заставка вкладки настроек (код-пароль, автоудаление, 2FA).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'

const load = vi.hoisted(() => ({ loadAnimationAsAsset: vi.fn() }))
vi.mock('@lib/lottie/lottieLoader', () => ({ default: load }))

import { PromiseCollector } from './solidJsTabs/promiseCollector.solid'
import SettingsTabLottieAnimation from './settingsTabLottieAnimation.solid'
import styles from './settingsTabLottieAnimation.module.scss'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  load.loadAnimationAsAsset.mockReset()
})

describe('SettingsTabLottieAnimation', () => {
  it('контейнер — класс модуля и --size от size (по умолчанию 100px у LottieAnimation)', () => {
    load.loadAnimationAsAsset.mockReturnValue(new Promise(() => {}))
    dispose = render(() => (
      <>
        <SettingsTabLottieAnimation name="UtyanPasscode" />
        <SettingsTabLottieAnimation name="UtyanDisappear" size={150} class="extra" />
      </>
    ), document.body)
    const [first, second] = [...document.body.children] as HTMLElement[]

    expect(first.classList.contains(styles.Container)).toBe(true)
    expect(first.style.getPropertyValue('--size')).toBe('100px')
    expect(second.classList.contains(styles.Container)).toBe(true)
    expect(second.classList.contains('extra')).toBe(true)
    expect(second.style.getPropertyValue('--size')).toBe('150px')
    expect(load.loadAnimationAsAsset.mock.calls.map((call) => call[1])).toEqual(['UtyanPasscode', 'UtyanDisappear'])
  })

  it('загрузка отдаётся коллектору вкладки: открытие ждёт заставку', async() => {
    let resolve!: (value: unknown) => void
    load.loadAnimationAsAsset.mockReturnValue(new Promise((r) => { resolve = r }))
    const helper = PromiseCollector.createHelper()
    dispose = render(() => (
      <PromiseCollector onCollect={helper.onCollect}>
        <SettingsTabLottieAnimation name="UtyanPasscode" />
      </PromiseCollector>
    ), document.body)

    let opened = false
    const waiting = helper.await().then(() => { opened = true })
    await Promise.resolve()
    expect(opened).toBe(false)

    resolve({ playOrRestart: vi.fn(), remove: vi.fn() })
    await waiting
    expect(opened).toBe(true)
  })

  it('отказ загрузки (нет WASM SIMD) не роняет открытие вкладки', async() => {
    load.loadAnimationAsAsset.mockReturnValue(Promise.reject(new Error('NO_WASM')))
    const helper = PromiseCollector.createHelper()
    dispose = render(() => (
      <PromiseCollector onCollect={helper.onCollect}>
        <SettingsTabLottieAnimation name="UtyanPasscode" />
      </PromiseCollector>
    ), document.body)

    await expect(helper.await()).resolves.toBeDefined()
  })

  it('щелчок перезапускает анимацию (restartOnClick)', async() => {
    const player = { playOrRestart: vi.fn(), remove: vi.fn() }
    load.loadAnimationAsAsset.mockResolvedValue(player)
    dispose = render(() => <SettingsTabLottieAnimation name="UtyanPasscode" />, document.body)

    ;(document.body.firstElementChild as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()

    expect(player.playOrRestart).toHaveBeenCalledOnce()
  })
})
