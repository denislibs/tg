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
    // `useShouldAnimate` (:138-140, без overscan) — idx∈[9,16]. Это тест на
    // равномерный сдвиг САМ ПО СЕБЕ (:161-171) — НЕ на строгость границ
    // `isActuallyVisible` (:31): при равномерном сдвиге граница окна может
    // «съехать» в любую сторону, диф оставшегося пересечения всё равно
    // консистентен, поэтому мутация `>=`→`>`/`<=`→`<` этот тест не красит —
    // за неё отвечают отдельные тесты ниже («граница видимости»).
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

  it('единственный видимый элемент исчезает из списка → true, onScrollShift не звался', () => {
    // Изолирует ИМЕННО ветку `prevIdx === -1 || currentIdx === -1` (:156-159).
    // Раньше здесь стоял тест «E убран с конца пятиэлементного списка» — он
    // РАЗВАЛИВАЕТСЯ как изоляция: соседи A..D тоже меняют относительный набор
    // (диф каждого из них — 0), и без проверки `currentIdx === -1` фиктивный
    // диф пропавшего E (`prevIdx - (-1)`) оказывается РАВЕН 5, что расходится
    // с диффом соседей (0) — тест ловил мутацию через ДРУГУЮ ветку
    // (`prevDiff !== diff`, :168-171), а не через ту, что заявлял комментарий.
    // Здесь единственный видимый элемент — без соседей, создающих расходящийся
    // диф: без явной проверки на -1 фиктивный `diff = 0 - (-1) = 1` был бы
    // ПЕРВЫМ и единственным в цикле → `allChangedTheSameAmount` остался бы
    // `true`, и мутация красит именно эту ветку.
    const onScrollShift = vi.fn()
    const [e] = makeItems(1)
    const before = [e]
    const after: object[] = [] // e полностью пропал из списка

    // hostHeight=50, itemHeight=100 → видим только idx=0 (единственный элемент).
    const { result, rerender } = setup({ list: before, scrollAmount: 0, hostHeight: 50, itemHeight: 100, onScrollShift })
    rerender({ list: after, scrollAmount: 0, hostHeight: 50, itemHeight: 100, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('граница видимости, левая (>=): элемент РОВНО на кромке окна ломает единый диф → true, onScrollShift не звался', () => {
    // Мутация `>=` → `>` в `isActuallyVisible` (:31) проходит все остальные
    // тесты зелёными: при равномерном сдвиге диф оставшегося пересечения
    // консистентен независимо от того, где именно проходит граница окна.
    // Здесь граница — часть самого расхождения: B стоит РОВНО на равенстве
    // `(idx+1)*itemHeight === scrollAmount` в `before` (idx=9, 10*100=1000) —
    // корректная реализация обязана его ВКЛЮЧИТЬ (`>=`), и тогда его диф (9)
    // сталкивается с равномерным дифом контрольной группы C (1) → расхождение,
    // `true`. Под мутацией (`>`) равенство перестаёт проходить — B выпадает из
    // окна и в `before`, и (тем же равенством) выпадает C[0] из `current`, но
    // C[0] остаётся в объединении через `visiblePrev` (он видим в `before` на
    // idx=10 — далеко от границы, не равенство) — с одним B, диф всех C
    // консистентен (1) → мутированная реализация вернула бы `false` и звала бы
    // `onScrollShift(100)`.
    const itemHeight = 100
    const scrollAmount = 1000
    const hostHeight = 1000 // правая граница окна (idx<=20) далеко, не мешает
    const onScrollShift = vi.fn()

    const [b, c0, c1, c2, c3, c4] = makeItems(6)
    const before = [
      ...makeItems(9), // idx0-8: невидимы (idx<9 при любой трактовке границы)
      b, // idx9: РОВНО на равенстве левой границы
      c0,
      c1,
      c2,
      c3,
      c4, // idx10-14: контрольная группа, устойчиво видима (не равенство)
    ]
    const current = [
      b, // idx0: далеко вне окна при любой трактовке границы
      ...makeItems(8), // idx1-8: тоже вне окна
      c0,
      c1,
      c2,
      c3,
      c4, // idx9-13: контрольная группа сдвинута на -1 (диф с before = +1)
    ]

    const { result, rerender } = setup({ list: before, scrollAmount, hostHeight, itemHeight, onScrollShift })
    rerender({ list: current, scrollAmount, hostHeight, itemHeight, onScrollShift })

    expect(result.current).toBe(true)
    expect(onScrollShift).not.toHaveBeenCalled()
  })

  it('граница видимости, правая (<=): элемент РОВНО на кромке окна ломает единый диф → true, onScrollShift не звался', () => {
    // Зеркало теста выше для правой границы `idx*itemHeight <= scrollAmount + hostHeight`
    // (:31). Контрольная группа C НЕПОДВИЖНА (диф=0) в обоих кадрах; B стоит
    // РОВНО на равенстве правой границы (idx=13: 13*100=1300) только в `before`,
    // в `current` полностью вне окна (диф с B = 13). Корректная реализация
    // обязана включить B в `before` (`<=`) → диф B (13) расходится с дифом C
    // (0) → `true`. Под мутацией (`<`) равенство перестаёт проходить, B никогда
    // не попадает в объединение (в `current` он и так вне окна по левой
    // границе) → остаётся только консистентная C (диф 0) → мутированная
    // реализация вернула бы `false` и звала бы `onScrollShift(0)`.
    const itemHeight = 100
    const scrollAmount = 650
    const hostHeight = 650 // левая граница (idx>=6) без равенства — не мешает
    const onScrollShift = vi.fn()

    const [bb, c0, c1, c2, c3, c4, c5, c6] = makeItems(8)
    const before = [
      ...makeItems(6), // idx0-5: невидимы (idx<6 при любой трактовке границы)
      c0,
      c1,
      c2,
      c3,
      c4,
      c5,
      c6, // idx6-12: контрольная группа, устойчиво видима (не равенство)
      bb, // idx13: РОВНО на равенстве правой границы
    ]
    const current = [
      bb, // idx0: вне окна по ЛЕВОЙ границе (не равенство) при любой трактовке
      ...makeItems(5), // idx1-5: тоже вне окна
      c0,
      c1,
      c2,
      c3,
      c4,
      c5,
      c6, // idx6-12: контрольная группа НА ТЕХ ЖЕ индексах (диф=0)
    ]

    const { result, rerender } = setup({ list: before, scrollAmount, hostHeight, itemHeight, onScrollShift })
    rerender({ list: current, scrollAmount, hostHeight, itemHeight, onScrollShift })

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
