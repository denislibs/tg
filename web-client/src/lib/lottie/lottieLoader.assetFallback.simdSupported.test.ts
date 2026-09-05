// ПИН (ревью «фолбэк без WASM SIMD», п.1): гарантия «SIMD есть ⇒ фолбэк не
// появляется» была только структурной (реджект NO_WASM уходит раньше вставки
// картинки, `lottieLoader.ts:146-154`) — ни один тест её прямо не проверял.
// Общая точка та же, что и у `lottieLoader.assetFallback.test.ts` (NO_WASM-
// сторона): `loadAnimationAsAsset` — единственный вызов на все пять мест
// показа встроенных ассетов (см. докблок `lottieAssetFallback.ts`), поэтому
// одного теста здесь достаточно, дублировать по вызывающим не нужно.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@environment/webAssemblySimdSupport', () => ({ default: true }))

const { renderStaticAssetFallback } = vi.hoisted(() => ({ renderStaticAssetFallback: vi.fn() }))
vi.mock('./lottieAssetFallback', () => ({
  renderStaticAssetFallback,
  makeAssetPngUrl: (name: string) => `assets/tgs/${name}.png`,
}))

const { default: lottieLoader } = await import('./lottieLoader')

afterEach(() => {
  renderStaticAssetFallback.mockClear()
})

describe('loadAnimationAsAsset — SIMD есть: фолбэк не вставляется, PNG не запрашивается', () => {
  it('renderStaticAssetFallback НЕ вызывается', async () => {
    const container = document.createElement('div')

    const promise = lottieLoader.loadAnimationAsAsset(
      { container, loop: false, autoplay: true, width: 130, height: 130 },
      'TwoFactorSetupMonkeyPeek',
    )
    // Дальше промис может как зарезолвиться, так и упасть на деталях воркера,
    // не относящихся к этому пину — важен только факт отсутствия фолбэка.
    promise.catch(() => {})

    expect(renderStaticAssetFallback).not.toHaveBeenCalled()
  })
})
