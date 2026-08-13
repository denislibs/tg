// Тесты порта tweb `components/verticalVirtualList.tsx:129-189` (useShouldAnimate) —
// см. заголовочный комментарий `useShouldAnimate.ts`. Алгоритм чистый (не требует
// DOM/таймеров), поэтому проверяем его напрямую через `renderHook`: первый рендер
// хука лишь запоминает список как «предыдущий» (mount всегда даёт `true` — сравнивать
// не с чем), интересен ВТОРОЙ рендер (`rerender`) с изменённым списком.
//
// Элементы списков — объекты БЕЗ поля-идентификатора (`{tag}` только для читаемости
// вывода при падении теста): алгоритм обязан сравнивать элементы по ссылке
// (`indexOf`), не по значению/id, — если бы сравнение шло иначе, эти тесты были бы
// бессмысленны (объекты без `id` нечем сравнивать структурно).
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createScrollShiftCompensator, useShouldAnimate } from './useShouldAnimate'

function makeItems(n: number): object[] {
  return Array.from({ length: n }, (_, i) => ({ tag: i }))
}

interface Props {
  list: readonly object[]
  scrollAmount: number
  hostHeight: number
  itemHeight: number
  onScrollShift: (amount: number) => void
}

function setup(initial: Props) {
  return renderHook((props: Props) => useShouldAnimate(props), { initialProps: initial })
}

describe('useShouldAnimate', () => {
  it('монтирование всегда даёт true (сравнивать ещё не с чем) и не зовёт onScrollShift', () => {
    const onScrollShift = vi.fn()
    const list = makeItems(5)
    const { result } = setup({ list, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('все видимые элементы сдвинулись на +1 позицию (элемент вне окна убран сверху) → false, onScrollShift(1 * itemHeight)', () => {
    // itemHeight=100, scrollAmount=1000, hostHeight=600 → окно видимости
    // `useShouldAnimate` (:138-140, без overscan) — idx∈[9,16], ОБЕ границы
    // формулы хиты РОВНО по равенству (idx=9: 10*100>=1000; idx=16: 16*100<=1600) —
    // мутация `>=`→`>` или `<=`→`<` подвинула бы окно и сломала бы тест.
    const itemHeight = 100
    const scrollAmount = 1000
    const hostHeight = 600
    const onScrollShift = vi.fn()

    const items = makeItems(20) // idx 0..19, ссылки сохраняются между списками
    const before = items
    const after = items.slice(1) // элемент idx0 убран ВНЕ окна [9,16] → индексы 1..19 сдвигаются на -1

    const { result, rerender } = setup({ list: before, scrollAmount, hostHeight, itemHeight, onScrollShift })
    rerender({ list: after, scrollAmount, hostHeight, itemHeight, onScrollShift })

    expect(result.current).toBe(false)
    expect(onScrollShift).toHaveBeenCalledTimes(1)
    expect(onScrollShift).toHaveBeenCalledWith(1 * itemHeight)
  })

  it('один swap внутри видимой области (C и D местами, остальные на месте) → true, onScrollShift не звался', () => {
    const onScrollShift = vi.fn()
    const [a, b, c, d, e] = makeItems(5)
    const before = [a, b, c, d, e]
    const after = [a, b, d, c, e] // A, B, E — на прежних индексах; C и D — переставлены

    // hostHeight огромный: весь (короткий) список всегда целиком в окне видимости.
    const { result, rerender } = setup({ list: before, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })
    rerender({ list: after, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('элемент исчез из списка (был виден, стал отсутствовать) → true, onScrollShift не звался', () => {
    const onScrollShift = vi.fn()
    const [a, b, c, d, e] = makeItems(5)
    const before = [a, b, c, d, e]
    const after = [a, b, c, d] // E убран С КОНЦА: у A..D индекс не меняется (без него
    // диффы всех выживших были бы одинаковы = 0, и `allChangedTheSameAmount` остался
    // бы true — тест специально изолирует именно ветку "элемента нет в одном из списков").

    const { result, rerender } = setup({ list: before, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })
    rerender({ list: after, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('видимых нет вовсе (пустое пересечение) → true, onScrollShift не звался', () => {
    const onScrollShift = vi.fn()
    const items = makeItems(5)
    const before = items
    const after = [...items, ...makeItems(1)] // список меняется, но окно далеко внизу — никто не виден ни до, ни после

    const { result, rerender } = setup({
      list: before,
      scrollAmount: 1_000_000,
      hostHeight: 10,
      itemHeight: 100,
      onScrollShift,
    })
    rerender({ list: after, scrollAmount: 1_000_000, hostHeight: 10, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('сдвиг на -2 (два элемента добавлены вне окна сверху) → false, onScrollShift(-2 * itemHeight)', () => {
    const itemHeight = 100
    const scrollAmount = 1000
    const hostHeight = 600 // то же окно idx∈[9,16], что и в тесте на +1
    const onScrollShift = vi.fn()

    const items = makeItems(20)
    const before = items
    const after = [...makeItems(2), ...items] // два новых элемента ВНЕ окна (idx 0,1) — остальные сдвигаются на +2

    const { result, rerender } = setup({ list: before, scrollAmount, hostHeight, itemHeight, onScrollShift })
    rerender({ list: after, scrollAmount, hostHeight, itemHeight, onScrollShift })

    expect(result.current).toBe(false)
    expect(onScrollShift).toHaveBeenCalledTimes(1)
    expect(onScrollShift).toHaveBeenCalledWith(-2 * itemHeight)
  })

  it('reindex: те же ссылки на элементы в НОВОМ массиве (без изменения порядка) → механизм срабатывает (false, onScrollShift(0))', () => {
    // Ключевой сценарий из брифа: зеркало (`reconcileById`) сохраняет ссылки на
    // неизменившиеся диалоги, но пересборка порядка (`reindex`) создаёт НОВЫЙ
    // массив-обёртку. Сравнение по ссылке (`indexOf`) обязано узнать элементы
    // несмотря на то, что сам массив — другой объект.
    const onScrollShift = vi.fn()
    const items = makeItems(5)
    const before = items
    const after = items.map((x) => x) // новый массив, те же ссылки, тот же порядок

    expect(after).not.toBe(before) // страховка: это правда другой массив-объект

    const { result, rerender } = setup({ list: before, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })
    rerender({ list: after, scrollAmount: 0, hostHeight: 100000, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(false)
    expect(onScrollShift).toHaveBeenCalledTimes(1)
    expect(onScrollShift).toHaveBeenCalledWith(0)
  })

  it('список — тот же объект (без изменений) → повторного пересчёта нет, onScrollShift не звался на этом шаге', () => {
    // Гейт по ссылке на САМ массив (аналог `on(list, ...)` оригинала, реагирующего
    // только на смену сигнала `list`): если пропы вызвали ре-рендер, а `list` —
    // та же самая ссылка, что и раньше, повторного сравнения быть не должно.
    const onScrollShift = vi.fn()
    const items = makeItems(20)
    const before = items

    const { result, rerender } = setup({ list: before, scrollAmount: 1000, hostHeight: 600, itemHeight: 100, onScrollShift })
    // Сдвигаем видимое окно (scrollAmount меняется), список — та же ссылка.
    rerender({ list: before, scrollAmount: 1100, hostHeight: 600, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true) // персистится значение с mount-рендера
    expect(onScrollShift).not.toHaveBeenCalled()
  })
})

describe('createScrollShiftCompensator', () => {
  it('порт verticalVirtualList.tsx:49-53 — компенсирующая запись scrollTop буквальным "-="', () => {
    const host = document.createElement('div')
    host.scrollTop = 500

    const onScrollShift = createScrollShiftCompensator(host)
    onScrollShift(120)

    expect(host.scrollTop).toBe(380)
  })

  it('отрицательный сдвиг увеличивает scrollTop', () => {
    const host = document.createElement('div')
    host.scrollTop = 100

    createScrollShiftCompensator(host)(-50)

    expect(host.scrollTop).toBe(150)
  })
})
