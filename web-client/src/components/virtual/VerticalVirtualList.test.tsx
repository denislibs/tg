// Тесты порта tweb `components/verticalVirtualList.tsx:15-112` (см. шапку
// `VerticalVirtualList.tsx`). Норма: строка проводки без теста, чья мутация
// краснеет, — нарушение (`web-client/CLAUDE.md`, «Тесты»).
//
// happy-dom не считает layout: `offsetHeight` (его читает `useElementSize`) и
// `scrollHeight`/`clientHeight` задаются стабами через `Object.defineProperty` —
// тот же приём, что в `components/scrollable.test.ts`. `scrollTop` happy-dom
// хранит честно, его можно писать напрямую.
//
// Троттлинг измерения скролла уходит либо в `setTimeout(24)`, либо в
// `requestAnimationFrame` — какую ветку выберет `IS_OVERLAY_SCROLL_SUPPORTED()`,
// в живом браузере решает окружение. Обе ветки боевые (rAF — это десктопный
// Chrome с классическим скроллбаром, то есть основной прод-путь), поэтому модуль
// поддержки overlay-скролла здесь замокан флагом: по умолчанию ветка
// `setTimeout(24)` (её и выбирает happy-dom сам по себе — тогда ждём реальным
// таймером с запасом, `flushThrottle`, тот же приём, что в `scrollable.test.ts`),
// а отдельный describe переключает флаг и проверяет rAF-ветку.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'

const { overlayFlag } = vi.hoisted(() => ({ overlayFlag: { value: true } }))

vi.mock('@environment/overlayScrollSupport', () => ({
  IS_OVERLAY_SCROLL_SUPPORTED: () => overlayFlag.value,
  USE_CUSTOM_SCROLL: () => !overlayFlag.value,
  USE_NATIVE_SCROLL: false,
}))

import VerticalVirtualList, { type VirtualListItemProps } from './VerticalVirtualList'

type Row = { id: number }

function makeRows(n: number, from = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: from + i }))
}

const getKey = (item: Row) => item.id

const renderItem = ({ item, idx, itemRef }: VirtualListItemProps<Row>) => (
  <li data-idx={idx} data-id={item.id} ref={itemRef} />
)

let hosts: HTMLElement[] = []

function makeHost(height: number, scrollTop = 0): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  Object.defineProperty(host, 'offsetHeight', { value: height, configurable: true })
  Object.defineProperty(host, 'offsetWidth', { value: 300, configurable: true })
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(host, 'scrollHeight', { value: 1_000_000, configurable: true })
  host.scrollTop = scrollTop
  hosts.push(host)
  return host
}

function renderedIndices(host: HTMLElement): number[] {
  return Array.from(host.querySelectorAll('li[data-idx]')).map((el) =>
    Number((el as HTMLElement).dataset.idx),
  )
}

function rowById(host: HTMLElement, id: number): HTMLElement {
  return host.querySelector(`li[data-id="${id}"]`) as HTMLElement
}

async function flushThrottle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  overlayFlag.value = true
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const host of hosts) host.remove()
  hosts = []
})

describe('VerticalVirtualList — окно видимости (:65-74)', () => {
  it('1000 элементов, хост 720, scrollTop 0, itemHeight 72, pad 288 → ровно индексы 0..13', () => {
    // idx * 72 >= 0 - 288 — верно для всех idx >= 0;
    // (idx + 1) * 72 <= 0 + 720 + 288 = 1008 → idx <= 13 (у idx=13 РОВНО 1008).
    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    expect(renderedIndices(host)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('обе границы окна — хиты РОВНО по равенству (scrollTop 720 → индексы 6..23)', () => {
    // Нижняя: idx * 72 >= 720 - 288 = 432 → idx >= 6 (у idx=6 ровно 432, у idx=5 — 360).
    // Верхняя: (idx + 1) * 72 <= 720 + 720 + 288 = 1728 → idx <= 23 (у idx=23 ровно 1728).
    const host = makeHost(720, 720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    const indices = renderedIndices(host)
    expect(indices[0]).toBe(6)
    expect(indices[indices.length - 1]).toBe(23)
    expect(indices).toHaveLength(18)
  })

  it('нижняя граница при нецелом делении: scrollTop 700 → первый индекс 6, а не 5', () => {
    // Нижняя граница берётся арифметикой (`Math.ceil((scroll - pad) / itemHeight)`),
    // и только на нецелом делении видно, что это именно ceil: (700 - 288) / 72 = 5.72.
    // С `Math.floor` цикл стартовал бы с 5, первый же `isVisible` был бы ложен
    // (5 * 72 = 360 < 412) и окно вышло бы пустым.
    const host = makeHost(720, 700)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    const indices = renderedIndices(host)
    expect(indices[0]).toBe(6)
    expect(indices[indices.length - 1]).toBe(22)
  })

  it('scrollableHost === null (ref ещё не привязан) — не падает, окно считается от нулевой высоты хоста', () => {
    // hostHeight = 0 → (idx + 1) * 72 <= 0 + 0 + 288 → idx <= 3.
    const { container } = render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={null}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
    )

    expect(renderedIndices(container as HTMLElement)).toEqual([0, 1, 2, 3])
  })
})

describe('VerticalVirtualList — высота ul (:90-100)', () => {
  it('height = totalCount * itemHeight + extraPaddingBottom', () => {
    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        extraPaddingBottom={8}
        animate
      />,
      { container: host },
    )

    const ul = host.querySelector('ul') as HTMLElement
    expect(ul.style.height).toBe(1000 * 72 + 8 + 'px')
    expect(ul.style.overflow).toBe('')
  })

  it('пустой список — extraPaddingBottom НЕ добавляется (Number(!!totalCount))', () => {
    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={[]}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        extraPaddingBottom={8}
        animate
      />,
      { container: host },
    )

    expect((host.querySelector('ul') as HTMLElement).style.height).toBe('0px')
  })

  it('forceHostHeight — высота хоста и overflow: hidden', () => {
    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        extraPaddingBottom={8}
        forceHostHeight
        animate
      />,
      { container: host },
    )

    const ul = host.querySelector('ul') as HTMLElement
    expect(ul.style.height).toBe('720px')
    expect(ul.style.overflow).toBe('hidden')
  })
})

describe('VerticalVirtualList — скролл хоста (:36-46)', () => {
  it('событие скролла двигает окно, но не синхронно — измерение отложено (троттлинг, как scrollable.ts:94-109)', async () => {
    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    expect(renderedIndices(host)[0]).toBe(0)

    act(() => {
      host.scrollTop = 720
      host.dispatchEvent(new Event('scroll'))
    })

    // Ещё не пересчитано: измерение отложено на кадр/24 мс.
    expect(renderedIndices(host)[0]).toBe(0)

    await flushThrottle()

    expect(renderedIndices(host)).toEqual(
      Array.from({ length: 18 }, (_, i) => 6 + i),
    )
  })

  it('размонтирование снимает слушатель скролла с хоста', () => {
    const host = makeHost(720)
    const removeSpy = vi.spyOn(host, 'removeEventListener')
    const addSpy = vi.spyOn(host, 'addEventListener')

    const { unmount } = render(
      <VerticalVirtualList
        list={makeRows(10)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    expect(addSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(true)

    unmount()

    expect(removeSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(true)
  })

  it('хост, уже прокрученный до монтирования, учитывается сразу (ветка null-хоста на первом рендере)', () => {
    // Хост приезжает пропом ВТОРЫМ рендером — как это и будет у потребителя
    // (`scrollableHost` берётся из ref). К этому моменту он уже прокручен.
    const host = makeHost(720, 720)

    const props = {
      list: makeRows(1000),
      getKey,
      renderItem,
      itemHeight: 72,
      thresholdPadding: 72 * 4,
      animate: true,
    }

    const { rerender } = render(<VerticalVirtualList {...props} scrollableHost={null} />, {
      container: host,
    })
    rerender(<VerticalVirtualList {...props} scrollableHost={host} />)

    expect(renderedIndices(host)[0]).toBe(6)
  })
})

describe('VerticalVirtualList — вторая ветка троттлинга: requestAnimationFrame', () => {
  // Это основной прод-путь (десктопный Chrome с классическим скроллбаром);
  // happy-dom сам по себе выбирает ветку `setTimeout(24)`, поэтому флаг
  // поддержки overlay-скролла здесь переключается вручную.
  it('измерение откладывается на кадр rAF, а не выполняется синхронно', () => {
    overlayFlag.value = false
    vi.useFakeTimers()

    const host = makeHost(720)
    render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    act(() => {
      host.scrollTop = 720
      host.dispatchEvent(new Event('scroll'))
    })

    expect(renderedIndices(host)[0]).toBe(0)

    act(() => {
      vi.advanceTimersByTime(20) // кадр фейкового rAF — 16 мс
    })

    expect(renderedIndices(host)[0]).toBe(6)
  })

  it('незавершённое измерение снимается при размонтировании (cancelAnimationFrame)', () => {
    overlayFlag.value = false
    vi.useFakeTimers()

    const host = makeHost(720)
    const { unmount } = render(
      <VerticalVirtualList
        list={makeRows(1000)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame')

    act(() => {
      host.scrollTop = 720
      host.dispatchEvent(new Event('scroll'))
    })

    const scheduledId = rafSpy.mock.results[rafSpy.mock.results.length - 1]?.value as number
    expect(typeof scheduledId).toBe('number')

    unmount()

    expect(cancelSpy).toHaveBeenCalledWith(scheduledId)
  })
})

describe('VerticalVirtualList — размер хоста', () => {
  it('размонтирование отцепляет ResizeObserver от хоста', () => {
    const host = makeHost(720)
    const { unmount } = render(
      <VerticalVirtualList
        list={makeRows(10)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    const disconnectSpy = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    unmount()

    // Мутация: убрать `return () => hostSizeRef(null)` — наблюдатель остаётся
    // висеть на хосте после размонтирования списка.
    expect(disconnectSpy).toHaveBeenCalled()
  })
})

describe('VerticalVirtualList — анимация переезда строки (:63, :78)', () => {
  const rows = makeRows(5)
  const swapped = [rows[0], rows[1], rows[3], rows[2], rows[4]] // c и d местами

  function renderSwapCase(animate: boolean) {
    const host = makeHost(720)
    const props = {
      getKey,
      renderItem,
      scrollableHost: host,
      itemHeight: 72,
      thresholdPadding: 72 * 4,
      animate,
    }

    const { rerender } = render(<VerticalVirtualList {...props} list={rows} />, { container: host })
    const el = rowById(host, 3)
    expect(el.style.top).toBe('216px') // idx 3

    rerender(<VerticalVirtualList {...props} list={swapped} />)

    return { host, el }
  }

  it('animate=true — переезд идёт анимацией: --background выставлен, top ещё старый', () => {
    const { el } = renderSwapCase(true)

    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')
    expect(el.style.top).toBe('216px')
  })

  it('animate=false — переезд мгновенный: top сразу новый, --background не ставится', () => {
    const { el } = renderSwapCase(false)

    expect(el.style.top).toBe('144px') // idx 2
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('строка ключуется элементом, а не индексом: при переезде это ТОТ ЖЕ DOM-узел', () => {
    const host = makeHost(720)
    const props = {
      getKey,
      renderItem,
      scrollableHost: host,
      itemHeight: 72,
      thresholdPadding: 72 * 4,
      animate: false,
    }

    const { rerender } = render(<VerticalVirtualList {...props} list={rows} />, { container: host })
    const before = rowById(host, 3)

    rerender(<VerticalVirtualList {...props} list={swapped} />)

    expect(rowById(host, 3)).toBe(before)
  })
})

describe('VerticalVirtualList — анимация выживает переприкрепление ref', () => {
  // React 19 переинициализирует ref keyed-ребёнка, когда тот переезжает в DOM:
  // под StrictMode (его включает `main.tsx`) — на КАЖДОМ таком переезде, а в
  // проде — у любого потребителя, отдавшего нестабильный inline-ref. Если
  // `useAnimatedTop` трактует это как смену узла и синхронизируется с новым
  // `top`, переезд строки перестаёт анимироваться: строка прыгает.
  const rows = makeRows(20)
  const swapped = [...rows.slice(0, 2), rows[3], rows[2], ...rows.slice(4)]

  it('StrictMode: своп соседей по-прежнему анимируется', () => {
    const host = makeHost(720)
    const props = {
      getKey,
      renderItem, // ref СТАБИЛЬНЫЙ (`ref={itemRef}`) — переприкрепление здесь целиком заслуга StrictMode
      scrollableHost: host,
      itemHeight: 72,
      thresholdPadding: 72 * 4,
      animate: true,
    }

    const { rerender } = render(
      <StrictMode>
        <VerticalVirtualList {...props} list={rows} />
      </StrictMode>,
      { container: host },
    )
    // Из пары переставленных строк узел в DOM переезжает ровно одна — та, что
    // уехала ВНИЗ (idx 2 → 3); ей React и переинициализирует ref. Вторая (3 → 2)
    // остаётся на месте и мимо этого дефекта проходит, поэтому проверять надо
    // именно первую.
    const el = rowById(host, 2)
    expect(el.style.top).toBe('144px')

    rerender(
      <StrictMode>
        <VerticalVirtualList {...props} list={swapped} />
      </StrictMode>,
    )

    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')
    expect(el.style.top).toBe('144px') // анимация только началась, значение ещё старое
  })

  it('нестабильный inline-ref потребителя: своп соседей по-прежнему анимируется', () => {
    const host = makeHost(720)
    // Новая ссылка на ref в КАЖДОМ рендере — React на каждом коммите отцепляет
    // старый колбэк (null) и прицепляет новый (тот же самый узел).
    const renderItemWithInlineRef = ({ item, idx, itemRef }: VirtualListItemProps<Row>) => (
      <li data-idx={idx} data-id={item.id} ref={(el) => itemRef(el)} />
    )
    const props = {
      getKey,
      renderItem: renderItemWithInlineRef,
      scrollableHost: host,
      itemHeight: 72,
      thresholdPadding: 72 * 4,
      animate: true,
    }

    const { rerender } = render(<VerticalVirtualList {...props} list={rows} />, { container: host })
    const el = rowById(host, 3)
    expect(el.style.top).toBe('216px')

    rerender(<VerticalVirtualList {...props} list={swapped} />)

    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')
    expect(el.style.top).toBe('216px')
  })
})

describe('VerticalVirtualList — строка не перерисовывается зря', () => {
  it('кадр скролла перерисовывает только въехавшие в окно строки', async () => {
    // В solid на кадре скролла не перерисовывается ни одна строка (мелкозернистая
    // реактивность). У нас цена React'а — перерисовка родителя, но строка окна
    // обёрнута в `memo`: до скролла окно 0..13, после — 6..23, значит рендер
    // положен ровно новым индексам 14..23, а 6..13 обязаны остаться нетронутыми.
    const renders = new Map<number, number>()
    const countingRenderItem = ({ item, idx, itemRef }: VirtualListItemProps<Row>) => {
      renders.set(idx, (renders.get(idx) ?? 0) + 1)
      return <li data-idx={idx} data-id={item.id} ref={itemRef} />
    }

    const host = makeHost(720)
    const list = makeRows(1000)
    render(
      <VerticalVirtualList
        list={list}
        getKey={getKey}
        renderItem={countingRenderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    expect([...renders.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 14 }, (_, i) => i),
    )

    act(() => {
      host.scrollTop = 720
      host.dispatchEvent(new Event('scroll'))
    })
    await flushThrottle()

    expect(renderedIndices(host)[0]).toBe(6) // окно действительно уехало

    // Строки, оставшиеся в окне, не перерисовывались (мутация: снять `memo` со
    // строки — каждая из них отрендерится по второму разу).
    for (let idx = 6; idx <= 13; ++idx) expect(renders.get(idx)).toBe(1)
    // Въехавшие — отрисованы ровно по разу.
    for (let idx = 14; idx <= 23; ++idx) expect(renders.get(idx)).toBe(1)
  })
})

describe('VerticalVirtualList — компенсация равномерного сдвига (:49-53, :55-61)', () => {
  it('все видимые сдвинулись одинаково → анимации нет, scrollTop скомпенсирован', () => {
    // itemHeight 100, хост 600, scrollTop 1000 → окно рендера idx 8..17,
    // окно `useShouldAnimate` (без overscan) — idx 9..16. Убираем элемент 0
    // (он ВНЕ обоих окон) — все видимые уезжают ровно на одну позицию.
    const host = makeHost(600, 1000)
    const rows = makeRows(20)

    const writes: { value: number; tops: (string | undefined)[] }[] = []
    let scrollTopValue = 1000
    Object.defineProperty(host, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value
        writes.push({
          value,
          tops: Array.from(host.querySelectorAll('li[data-idx]')).map((el) => (el as HTMLElement).style.top),
        })
      },
    })

    const props = {
      getKey,
      renderItem,
      scrollableHost: host,
      itemHeight: 100,
      thresholdPadding: 72 * 4,
      animate: true,
    }

    const { rerender } = render(<VerticalVirtualList {...props} list={rows} />, { container: host })
    expect(renderedIndices(host)).toEqual(Array.from({ length: 10 }, (_, i) => 8 + i))
    expect(writes).toHaveLength(0)

    rerender(<VerticalVirtualList {...props} list={rows.slice(1)} />)

    expect(writes).toHaveLength(1)
    expect(writes[0].value).toBe(900)
    // Анимации нет — ни у одной строки не выставлен --background.
    for (const el of host.querySelectorAll('li[data-idx]')) {
      expect((el as HTMLElement).style.getPropertyValue('--background')).toBe('')
    }
    // Замечание ревью: компенсация уходит из обычного useEffect (пост-paint).
    // К моменту записи `scrollTop` строки УЖЕ стоят на новых местах — эффекты
    // детей (useAnimatedTop) отрабатывают раньше эффекта родителя в том же
    // проходе, промежуточного состояния «скролл скомпенсирован, а строки ещё
    // старые» не возникает.
    expect(writes[0].tops).toEqual(renderedIndices(host).map((idx) => idx * 100 + 'px'))
  })
})

describe('VerticalVirtualList — прокинутые наружу ссылки', () => {
  it('listRef и className уезжают на ul', () => {
    const host = makeHost(720)
    let ul: HTMLUListElement | null = null

    render(
      <VerticalVirtualList
        listRef={(el) => {
          ul = el
        }}
        className="chatlist virtual-chatlist"
        list={makeRows(3)}
        getKey={getKey}
        renderItem={renderItem}
        scrollableHost={host}
        itemHeight={72}
        thresholdPadding={72 * 4}
        animate
      />,
      { container: host },
    )

    expect(ul).toBe(host.querySelector('ul'))
    expect((host.querySelector('ul') as HTMLElement).className).toBe('chatlist virtual-chatlist')
  })
})
