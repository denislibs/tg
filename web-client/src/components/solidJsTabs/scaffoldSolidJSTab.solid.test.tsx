/** @jsxImportSource solid-js */
/**
 * Тесты порта `scaffoldSolidJSTab.solid.tsx`. Стаб слайдера — тот же приём,
 * что в `sliderTab.test.ts` (`createSliderStub`): корневой `MiddlewareHelper`
 * передаётся явно, но здесь он не проверяется — задача этих тестов другая:
 * жизненный цикл Solid-острова внутри вкладки, а не сам `SliderSuperTab`.
 *
 * ── Почему тест на размонтирование спрашивает про `onCleanup`, а не про DOM ──
 * `tab['onCloseAfterTimeout']()` в любом случае снимает `tab.container`
 * (и вместе с ним — вставленный в scrollable `div` с Solid-содержимым) через
 * `this.container.remove()` (`sliderTab.ts`, `onCloseAfterTimeout`), НЕЗАВИСИМО
 * от того, был ли вызван `dispose` Solid-острова. Проверка
 * «`.probe` больше нет в DOM» была бы зелёной даже без вызова `this.dispose()`
 * — ровно тот пустой тест волны 0 (см. докблок `SolidIsland.test.tsx`).
 * Поэтому здесь ловушку `onCleanup` — она регистрируется на владельце Solid
 * и срабатывает РОВНО при вызове `dispose()`, а не при удалении узла снаружи.
 */
import { describe, expect, it, vi } from 'vitest'
import { onCleanup } from 'solid-js'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import type { SliderSuperTabSlider } from '@components/sliderTab'
import { scaffoldSolidJSTab } from './scaffoldSolidJSTab.solid'
import { usePromiseCollector } from './promiseCollector.solid'
import { useSuperTab } from './superTabProvider.solid'

// см. `sliderTab.test.ts` — тот же стаб, буквально скопированная сигнатура.
function createSliderStub(rootMiddleware: MiddlewareHelper = getMiddleware()) {
  return {
    rootMiddleware,
    getMiddleware: vi.fn(() => rootMiddleware.get()),
    addTab: vi.fn(),
    deleteTab: vi.fn(),
    closeTab: vi.fn(),
    selectTab: vi.fn(),
  } satisfies SliderSuperTabSlider & { rootMiddleware: MiddlewareHelper }
}

describe('scaffoldSolidJSTab', () => {
  it('на закрытии вкладки Solid-содержимое размонтируется (dispose реально вызван)', async () => {
    const sliderStub = createSliderStub()
    const cleaned = vi.fn()
    const Tab = scaffoldSolidJSTab({
      title: 'Devices',
      getComponentModule: async () => ({
        default: () => {
          onCleanup(cleaned)
          return <div class="probe" />
        },
      }),
    })
    const tab = new Tab(sliderStub, true)
    await tab.open()
    expect(tab.scrollable.container.querySelector('.probe')).not.toBeNull()

    ;(tab as any).onCloseAfterTimeout()

    expect(cleaned).toHaveBeenCalledTimes(1)
    expect(tab.scrollable.container.querySelector('.probe')).toBeNull()
  })

  it('init не завершается, пока собранный промис не разрешился', async () => {
    const sliderStub = createSliderStub()
    let resolve!: () => void
    const Tab = scaffoldSolidJSTab({
      title: 'Devices',
      getComponentModule: async () => ({
        default: () => {
          usePromiseCollector().collect(
            new Promise<void>((r) => {
              resolve = r
            }),
          )
          return <div />
        },
      }),
    })
    const tab = new Tab(sliderStub, true)
    const opened = vi.fn()
    const p = tab.open().then(opened)

    // Не считаем тики микрозадач вручную — их число зависит от того, сколько
    // `await` встроено внутрь `init`/`open`, и по мутации (без ожидания
    // `promiseCollectorHelper.await()`) их МЕНЬШЕ, а не 0: `getComponentModule`
    // и разрешение промиса самого `init` всё равно проходят по микрозадачам.
    // Счёт тиков — ровно та хрупкая проверка, которая однажды не покраснела
    // на этой же мутации. `setTimeout` — граница макрозадачи: она гарантированно
    // сливает ВСЮ очередь микрозадач, сколько бы их ни было, поэтому ловит
    // мутацию НЕЗАВИСИМО от точного числа промежуточных `await`.
    await new Promise((r) => setTimeout(r, 0))
    expect(opened).not.toHaveBeenCalled()

    resolve()
    await p
    expect(opened).toHaveBeenCalled()
  })

  it('содержимое получает свою вкладку через useSuperTab', async () => {
    const sliderStub = createSliderStub()
    let seen: unknown
    const Tab = scaffoldSolidJSTab({
      title: 'Devices',
      getComponentModule: async () => ({
        default: () => {
          ;[seen] = useSuperTab()
          return <div />
        },
      }),
    })
    const tab = new Tab(sliderStub, true)
    await tab.open()

    expect(seen).toBe(tab)
  })
})
