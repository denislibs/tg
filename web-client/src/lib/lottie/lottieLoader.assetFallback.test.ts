// ПИН (backlogs/frontend/lottie-no-wasm-fallback.md, часть 2 — встроенные
// иллюстрации задачи «фолбэк без WASM SIMD»): `loadAnimationAsAsset` —
// ЕДИНСТВЕННАЯ точка входа встроенных ассетов (все пять мест показа зовут
// именно её, см. докблок `lottieAssetFallback.ts`), поэтому это единственное
// место, где нужно проверить факт вставки фолбэка на NO_WASM — сама вставка
// уже пропинена изолированно в `lottieAssetFallback.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@environment/webAssemblySimdSupport', () => ({ default: false }))

const { renderStaticAssetFallback } = vi.hoisted(() => ({ renderStaticAssetFallback: vi.fn() }))
vi.mock('./lottieAssetFallback', () => ({
  renderStaticAssetFallback,
  makeAssetPngUrl: (name: string) => `assets/tgs/${name}.png`,
}))

const { default: lottieLoader } = await import('./lottieLoader')

afterEach(() => {
  renderStaticAssetFallback.mockClear()
})

describe('loadAnimationAsAsset — без WASM SIMD вставляет статичный фолбэк ДО реджекта NO_WASM', () => {
  it('зовёт renderStaticAssetFallback(container, name), затем реджектится NO_WASM', async () => {
    const container = document.createElement('div')

    const promise = lottieLoader.loadAnimationAsAsset(
      { container, loop: false, autoplay: true, width: 130, height: 130 },
      'TwoFactorSetupMonkeyPeek',
    )

    // Фолбэк вставляется СИНХРОННО внутри loadAnimationAsAsset — до всякого await.
    expect(renderStaticAssetFallback).toHaveBeenCalledTimes(1)
    expect(renderStaticAssetFallback).toHaveBeenCalledWith(container, 'TwoFactorSetupMonkeyPeek')

    await expect(promise).rejects.toMatchObject({ type: 'NO_WASM' })
  })
})
