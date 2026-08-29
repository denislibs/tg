/** @jsxImportSource solid-js */
/**
 * Тесты порта `scaffoldSolidJSTab.solid.tsx`. Стаб слайдера —
 * `sliderTab.testStub.ts` (общий с `sliderTab.test.ts`).
 *
 * Обе фабрики, `scaffoldSolidJSTab` и `scaffoldSolidJSTabEventable`, гоняют
 * ОДИН И ТОТ ЖЕ набор тестов через `describe.each`: до раунда 1 ревью
 * `scaffoldSolidJSTabEventable` не была покрыта вовсе (тесты писали только
 * через базовую), и обе её мутации (снятый `dispose`, снятое ожидание
 * `promiseCollectorHelper.await()`) проходили зелёными — при том что именно
 * эту фабрику берёт шаг 7 плана волны 2 (вкладка «Устройства»).
 *
 * ── Почему тест на размонтирование не полагается ТОЛЬКО на `onCleanup` ──────
 * Запрос идёт через `tab.scrollable.container` — это узел ВНУТРИ поддерева
 * `tab.container`, а не `document`. `tab.container.remove()` (в
 * `onCloseAfterTimeout`, `sliderTab.ts`) отсоединяет ВСЁ поддерево целиком —
 * `.probe` внутри него никуда не девается, поддерево просто больше не в
 * document. Убрать `.probe` ИЗ `tab.scrollable.container` может только
 * `dispose()` (`render()` Solid чистит хост через `element.textContent = ""`).
 * Поэтому DOM-проверка ниже уже сама по себе ловит потерю `dispose` (проверено
 * мутацией — см. коммит); `onCleanup` добавлен как более прямой сигнал именно
 * ПРО ВЫЗОВ dispose, а не про побочный эффект в DOM. (Раньше здесь было
 * утверждение, что DOM-проверка была бы зелёной и без dispose, — это неверно
 * для запроса через `scrollable.container`; верно оно было бы только для
 * запроса через `document`, как в прецеденте `SolidIsland.test.tsx`.)
 */
import { describe, expect, it, vi } from 'vitest'
import { createEffect, createSignal, onCleanup, type Component } from 'solid-js'
import type SliderSuperTab from '@components/sliderTab'
import { createSliderStub } from '@components/sliderTab.testStub'
import { scaffoldSolidJSTab, scaffoldSolidJSTabEventable } from './scaffoldSolidJSTab.solid'
import { usePromiseCollector } from './promiseCollector.solid'
import { useSuperTab } from './superTabProvider.solid'

// `scaffoldSolidJSTab` и `scaffoldSolidJSTabEventable` — генерики с РАЗНЫМИ
// (несовместимыми друг с другом по вызову) сигнатурами; звать значение union-типа
// этих двух функций напрямую TS не даёт (`TS2349`). Общий срез, который реально
// нужен ТЕСТАМ ниже — принять `{title, getComponentModule}` и отдать класс,
// у которого есть `open()`/`scrollable`, — оба варианта ему соответствуют
// СТРУКТУРНО (`SliderSuperTabEventable extends SliderSuperTab`), поэтому кастуем
// именно к этому срезу, а не глушим типы шире.
type MinimalScaffoldArgs = {
  title: string
  getComponentModule: () => Promise<{ default: Component }>
}
type MinimalTabCtor = new (
  ...args: ConstructorParameters<typeof SliderSuperTab>
) => SliderSuperTab & { init(payload: void, overrideTitle?: string): Promise<void> }
type ScaffoldFactory = (args: MinimalScaffoldArgs) => MinimalTabCtor

const factories: Array<[string, ScaffoldFactory]> = [
  ['scaffoldSolidJSTab (SliderSuperTab)', scaffoldSolidJSTab as ScaffoldFactory],
  ['scaffoldSolidJSTabEventable (SliderSuperTabEventable)', scaffoldSolidJSTabEventable as unknown as ScaffoldFactory],
]

describe.each(factories)('%s', (_label, scaffold) => {
  it('на закрытии вкладки Solid-содержимое размонтируется (dispose реально вызван)', async () => {
    const sliderStub = createSliderStub()
    const cleaned = vi.fn()
    const Tab = scaffold({
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
    const Tab = scaffold({
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
    const Tab = scaffold({
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

// scaffoldSolidJSTabEventable — это фабрика, которую берёт шаг 7 плана волны 2 (вкладка
// «Устройства»): её содержимое обычно держит сигналы/эффекты дольше, чем
// просто DOM-узел (подписки на статус сессий и т.п.). `onCleanup` в тесте выше
// уже доказывает, что `dispose()` вызван, но не проверяет НАПРЯМУЮ, что после
// него реактивность острова действительно остановлена, а не просто «узел
// убран, эффект спит, пока никто не трогает сигнал».
describe('scaffoldSolidJSTabEventable — реактивность после закрытия', () => {
  it('сигнал, обновлённый ПОСЛЕ onCloseAfterTimeout(), не будит эффект', async () => {
    const sliderStub = createSliderStub()
    const effect = vi.fn()
    let setValue!: (value: number) => void

    const Tab = scaffoldSolidJSTabEventable({
      title: 'Devices',
      getComponentModule: async () => ({
        default: () => {
          const [value, setter] = createSignal(0)
          setValue = setter
          createEffect(() => {
            effect(value())
          })
          return <div />
        },
      }),
    })
    const tab = new Tab(sliderStub, true)
    await tab.open()
    expect(effect).toHaveBeenCalledTimes(1)

    ;(tab as any).onCloseAfterTimeout()

    setValue(1)

    expect(effect).toHaveBeenCalledTimes(1)
  })
})
