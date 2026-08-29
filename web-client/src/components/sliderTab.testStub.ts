/**
 * Стаб `SliderSuperTabSlider` для тестов вкладок. Вынесен из `sliderTab.test.ts`
 * (был продублирован дословно в `solidJsTabs/scaffoldSolidJSTab.solid.test.tsx`)
 * — оба места конструируют вкладку без настоящего `SidebarSlider`.
 *
 * Корневой `MiddlewareHelper` передаётся явно и остаётся доступен тесту как
 * `rootMiddleware` — так тест может отличить «миддлварь-ребёнок слайдера» от
 * «миддлварь сама по себе» (см. `sliderTab.test.ts`, ВАЖНО-3 ревью шага 4 плана волны 2:
 * мутация `slider.getMiddleware().create()` → плоский `getMiddleware()`
 * проходила зелёной именно потому, что стаб строил middleware анонимно).
 */
import { vi } from 'vitest'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import type { SliderSuperTabSlider } from './sliderTab'

export function createSliderStub(rootMiddleware: MiddlewareHelper = getMiddleware()) {
  return {
    rootMiddleware,
    getMiddleware: vi.fn(() => rootMiddleware.get()),
    addTab: vi.fn(),
    deleteTab: vi.fn(),
    closeTab: vi.fn(),
    selectTab: vi.fn(),
  } satisfies SliderSuperTabSlider & { rootMiddleware: MiddlewareHelper }
}
