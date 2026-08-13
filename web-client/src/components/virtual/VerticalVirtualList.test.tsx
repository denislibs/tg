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
// решает реальное окружение теста, поэтому здесь не мокаются таймеры, а ждётся
// реальный таймер с запасом (`flushThrottle`) — с тем же обоснованием, что в
// `scrollable.test.ts`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

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

afterEach(() => {
  cleanup()
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
