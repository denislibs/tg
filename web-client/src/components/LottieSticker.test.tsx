// Пины `LottieSticker.tsx` (Этап 2 плана «один движок lottie»,
// docs/superpowers/plans/2026-09-05-lottie-single-engine.md): движок —
// tlottie (`@lib/lottie/lottieLoader`), мокаем модуль целиком, тот же приём,
// что `PasswordMonkey.test.tsx`/`TrackingMonkey.solid.test.tsx` (Этап 1), а
// не `lottie-web` (глобальный мок в `test/setup.ts` этого компонента больше
// не касается — движок сменился, локальная карта `ASSETS` снята).
//
// Норма проводки: ассет грузится по ИМЕНИ (не факт вызова, а конкретное
// значение `LottieAssetName` для каждого потребителя-примера), click —
// `playOrRestart()` (не безусловный `goToAndPlay(0)` — так и в оригинале,
// `lottieAnimation.tsx`'s `restartOnClick`), уничтожение на размонтировании
// — включая гонку «ассет догрузился после cleanup».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import type { LottieAssetName } from '@lib/lottie/lottieLoader'

const { loadAnimationAsAsset } = vi.hoisted(() => ({
  loadAnimationAsAsset: vi.fn(),
}))
vi.mock('@lib/lottie/lottieLoader', () => ({
  default: { loadAnimationAsAsset },
}))

import LottieSticker from './LottieSticker'

function makeFakePlayer() {
  return {
    playOrRestart: vi.fn(),
    remove: vi.fn(),
  }
}

type FakePlayer = ReturnType<typeof makeFakePlayer>

beforeEach(() => {
  loadAnimationAsAsset.mockReset()
})

afterEach(cleanup)

describe('LottieSticker: загрузка ассета по имени', () => {
  it('грузит ИМЕННО переданное имя с заданным размером, group:"none" и loop по умолчанию false', async () => {
    const player = makeFakePlayer()
    loadAnimationAsAsset.mockResolvedValue(player)

    render(<LottieSticker name="UtyanPasscode" size={86} />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

    const [params, name] = loadAnimationAsAsset.mock.calls[0]
    expect(name).toBe('UtyanPasscode' satisfies LottieAssetName)
    expect(params).toMatchObject({ width: 86, height: 86, loop: false, autoplay: true, group: 'none' })
  })

  it('loop=true доезжает до loadAnimationAsAsset без искажений (PeerSelector/InviteLinkScreens)', async () => {
    const player = makeFakePlayer()
    loadAnimationAsAsset.mockResolvedValue(player)

    render(<LottieSticker name="UtyanSearch" size={140} loop />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

    const [params, name] = loadAnimationAsAsset.mock.calls[0]
    expect(name).toBe('UtyanSearch' satisfies LottieAssetName)
    expect(params).toMatchObject({ loop: true })
  })

  it('"key" (не капитализированный алиас "Key") — реальное имя вендорного типа (PasskeyIntroPopup)', async () => {
    const player = makeFakePlayer()
    loadAnimationAsAsset.mockResolvedValue(player)

    render(<LottieSticker name="key" size={120} />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

    expect(loadAnimationAsAsset.mock.calls[0][1]).toBe('key' satisfies LottieAssetName)
  })
})

describe('LottieSticker: клик перезапускает анимацию', () => {
  it('клик по контейнеру зовёт playOrRestart(), не безусловный goToAndPlay', async () => {
    const player = makeFakePlayer()
    loadAnimationAsAsset.mockResolvedValue(player)

    const { container } = render(<LottieSticker name="Folders_1" size={86} />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(container.firstChild).not.toBeNull())

    fireEvent.click(container.firstChild as HTMLElement)
    expect(player.playOrRestart).toHaveBeenCalledTimes(1)
  })
})

describe('LottieSticker: размонтирование', () => {
  it('анимация снимается на cleanup', async () => {
    const player = makeFakePlayer()
    loadAnimationAsAsset.mockResolvedValue(player)

    render(<LottieSticker name="Folders_2" size={86} />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

    cleanup()
    await vi.waitFor(() => expect(player.remove).toHaveBeenCalledTimes(1))
  })

  it('размонтирование ДО того как ассет догрузился — гонка не оставляет живой анимации', async () => {
    const player = makeFakePlayer()
    let resolveLoad!: (p: FakePlayer) => void
    loadAnimationAsAsset.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))

    render(<LottieSticker name="UtyanDisappear" size={120} />)
    cleanup() // синхронно, раньше, чем резолвится загрузка

    resolveLoad(player)
    await new Promise((r) => setTimeout(r, 0))

    expect(player.remove).toHaveBeenCalledTimes(1)
    expect(player.playOrRestart).not.toHaveBeenCalled()
  })

  it('реджект загрузки (NO_WASM/сеть) гасится компонентом — не валит прогон необработанным отклонением', async () => {
    loadAnimationAsAsset.mockRejectedValue(new Error('NO_WASM'))

    render(<LottieSticker name="UtyanLinks" size={120} loop />)
    await vi.waitFor(() => expect(loadAnimationAsAsset).toHaveBeenCalledTimes(1))

    // ничего не бросилось наружу — если бы `.catch` не стоял, необработанное
    // отклонение засорило бы прогон (см. `test/setup.ts` про ту же болезнь).
    cleanup()
  })
})
