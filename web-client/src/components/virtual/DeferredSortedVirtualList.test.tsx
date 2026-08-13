// Тесты порта tweb `components/deferredSortedVirtualList.tsx:44-356` (см. шапку
// `DeferredSortedVirtualList.tsx`). Норма: строка проводки без теста, чья мутация
// краснеет, — нарушение (`web-client/CLAUDE.md`, «Тесты»).
//
// Геометрия во всех тестах одна: itemSize 72, хост 720, thresholdPadding 72*4 =
// 288 → при scrollTop 0 в окне ровно индексы 0..13 (см. `VerticalVirtualList.test.tsx`).
// happy-dom не считает layout — `offsetHeight` хоста задаётся стабом.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

import DeferredSortedVirtualList, {
  type DeferredSortedVirtualListItem,
  type DeferredSortedVirtualListRenderItemProps,
} from './DeferredSortedVirtualList'
import styles from './DeferredSortedVirtualList.module.scss'

type Chat = { title: string }

function makeItems(n: number, from = 0): DeferredSortedVirtualListItem<Chat>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: from + i,
    index: 1000 - (from + i),
    value: { title: `chat ${from + i}` },
  }))
}

const renderItem = ({ id, value, itemRef }: DeferredSortedVirtualListRenderItemProps<Chat>) => (
  <div data-testid="row" data-id={id} title={value.title} ref={itemRef} />
)

let hosts: HTMLElement[] = []

function makeHost(height = 720): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  Object.defineProperty(host, 'offsetHeight', { value: height, configurable: true })
  Object.defineProperty(host, 'offsetWidth', { value: 300, configurable: true })
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(host, 'scrollHeight', { value: 1_000_000, configurable: true })
  hosts.push(host)
  return host
}

function rows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll('[data-testid="row"]')) as HTMLElement[]
}

function rowIds(host: HTMLElement): (string | undefined)[] {
  return rows(host).map((el) => el.dataset.id)
}

function skeletons(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll('.loading-dialog-skeleton')) as HTMLElement[]
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  for (const host of hosts) host.remove()
  hosts = []
})

describe('DeferredSortedVirtualList — дырки под незагруженными индексами (:73-81, :306-324)', () => {
  it('totalCount 100 при 10 загруженных: в окне 10 строк и скелетоны на остальных видимых индексах', () => {
    const host = makeHost()
    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={makeItems(10)}
        totalCount={100}
        wasAtLeastOnceFetched
        itemSize={72}
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    expect(rowIds(host)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
    // Окно — 0..13, значит дырок ровно 4: 10, 11, 12, 13.
    expect(skeletons(host).map((el) => el.style.top)).toEqual(['720px', '792px', '864px', '936px'])
  })

  it('высота ul считается по totalCount, а не по числу загруженных', () => {
    const host = makeHost()
    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={makeItems(10)}
        totalCount={100}
        wasAtLeastOnceFetched
        itemSize={72}
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    // extraPaddingBottom по умолчанию — 8 (`:55`).
    expect((host.querySelector('ul') as HTMLElement).style.height).toBe(100 * 72 + 8 + 'px')
  })

  it('wasAtLeastOnceFetched=false → forceHostHeight: ul ростом с хост и overflow hidden (:269)', () => {
    const host = makeHost()
    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={[]}
        totalCount={0}
        wasAtLeastOnceFetched={false}
        itemSize={72}
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    const ul = host.querySelector('ul') as HTMLElement
    expect(ul.style.height).toBe('720px')
    expect(ul.style.overflow).toBe('hidden')
  })
})

describe('DeferredSortedVirtualList — requestItemForIdx (:287-291)', () => {
  it('зовётся для незагруженного видимого индекса и НЕ зовётся для загруженного', () => {
    const host = makeHost()
    const requestItemForIdx = vi.fn()

    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={makeItems(10)}
        totalCount={100}
        wasAtLeastOnceFetched
        itemSize={72}
        animate
        requestItemForIdx={requestItemForIdx}
        renderItem={renderItem}
      />,
      { container: host },
    )

    const requested = requestItemForIdx.mock.calls.map(([idx]) => idx as number)
    expect([...new Set(requested)].sort((a, b) => a - b)).toEqual([10, 11, 12, 13])
    // Вторым аргументом — сколько всего загружено (`items.length`).
    for (const call of requestItemForIdx.mock.calls) expect(call[1]).toBe(10)
  })

  it('индекс уменьшен на число закреплённых — владелец про них не знает', () => {
    vi.useFakeTimers()
    const host = makeHost()
    const pinnedItems: DeferredSortedVirtualListItem<Chat>[] = [
      { id: 'archive', index: Number.MAX_SAFE_INTEGER, value: { title: 'Archived' } },
    ]

    const props = {
      scrollableHost: host,
      items: [],
      pinnedItems,
      totalCount: 100,
      wasAtLeastOnceFetched: true,
      itemSize: 72 as const,
      animate: true,
      renderItem,
    }

    // Первый прогон — пока волна reveal не дошла до закреплённого (revealIdx
    // фиксируется на items.length === 0, `:92-96`), он тоже считается непоказанным.
    const { rerender } = render(<DeferredSortedVirtualList {...props} requestItemForIdx={() => {}} />, {
      container: host,
    })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Волна прошла, закреплённый раскрыт. Новая ссылка на `requestItemForIdx`
    // перезапускает эффект запроса у всех непоказанных строк — снимаем именно их.
    const requestItemForIdx = vi.fn()
    rerender(<DeferredSortedVirtualList {...props} requestItemForIdx={requestItemForIdx} />)

    // Длина списка — totalCount ПЛЮС число закреплённых (`:78`): 100 дырок под
    // диалоги и ещё одна строка сверху под архив.
    expect((host.querySelector('ul') as HTMLElement).style.height).toBe(101 * 72 + 8 + 'px')

    // Окно 0..13; idx 0 занят закреплённым, дырки — 1..13 → запросы 0..12.
    const requested = requestItemForIdx.mock.calls.map(([idx]) => idx as number)
    expect([...new Set(requested)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    for (const call of requestItemForIdx.mock.calls) expect(call[1]).toBe(0)
  })
})

describe('DeferredSortedVirtualList — закреплённые сверху (:76)', () => {
  it('идут первыми, их top — idx * itemHeight, загруженные едут следом', () => {
    // Фейковые таймеры — чтобы прокрутить волну reveal: `revealIdx` встаёт на
    // `items.length` (`:95`), закреплённые в этой длине не учтены, поэтому
    // последняя строка раскрывается волной. Это поведение оригинала 1:1.
    vi.useFakeTimers()
    const host = makeHost()
    const pinnedItems: DeferredSortedVirtualListItem<Chat>[] = [
      { id: 'archive', index: Number.MAX_SAFE_INTEGER, value: { title: 'Archived' } },
    ]

    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={makeItems(3)}
        pinnedItems={pinnedItems}
        totalCount={3}
        wasAtLeastOnceFetched
        itemSize={72}
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(rowIds(host)).toEqual(['archive', '0', '1', '2'])
    expect(rows(host).map((el) => el.style.top)).toEqual(['0px', '72px', '144px', '216px'])
    // Длина списка — totalCount + число закреплённых (`:78`).
    expect((host.querySelector('ul') as HTMLElement).style.height).toBe(4 * 72 + 8 + 'px')
  })
})

describe('DeferredSortedVirtualList — волна раскрытия (:199-223)', () => {
  it('после первой загрузки индексы раскрываются по одному с шагом 1000/60/2', () => {
    vi.useFakeTimers()
    const host = makeHost()

    const props = {
      scrollableHost: host,
      totalCount: 100,
      wasAtLeastOnceFetched: true,
      itemSize: 72 as const,
      animate: true,
      requestItemForIdx: () => {},
      renderItem,
    }

    // Первая отдача пустая: revealIdx фиксируется на items.length === 0 (`:92-96`).
    const { rerender } = render(<DeferredSortedVirtualList {...props} items={[]} />, { container: host })
    expect(rowIds(host)).toEqual([])

    // Приезжают 10 штук — ни одна ещё не раскрыта.
    const items = makeItems(10)
    rerender(<DeferredSortedVirtualList {...props} items={items} />)
    expect(rowIds(host)).toEqual([])

    // Шаг — 1000/60/2 ≈ 8.33 мс; фейковые таймеры vitest усекают дробную
    // задержку до целых миллисекунд (проверено: таймер на 1000/60/2 срабатывает
    // ровно на 8-й мс, не на 9-й), поэтому граница здесь 7/8, а не 8/9. Обе
    // соседние величины шага краснят этот тест: 1000/60 → на 8-й мс ещё пусто,
    // 1000/60/4 → раскрывается уже на 7-й.
    act(() => {
      vi.advanceTimersByTime(7)
    })
    expect(rowIds(host)).toEqual([])

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(rowIds(host)).toEqual(['0'])

    act(() => {
      vi.advanceTimersByTime(8)
    })
    expect(rowIds(host)).toEqual(['0', '1'])

    act(() => {
      vi.advanceTimersByTime(8)
    })
    expect(rowIds(host)).toEqual(['0', '1', '2'])
  })

  it('уже загруженное на момент первой отдачи раскрывается целиком, без волны', () => {
    vi.useFakeTimers()
    const host = makeHost()

    const props = {
      scrollableHost: host,
      items: makeItems(10),
      totalCount: 100,
      itemSize: 72 as const,
      animate: true,
      requestItemForIdx: () => {},
      renderItem,
    }

    const { rerender } = render(<DeferredSortedVirtualList {...props} wasAtLeastOnceFetched={false} />, {
      container: host,
    })
    rerender(<DeferredSortedVirtualList {...props} wasAtLeastOnceFetched />)

    expect(rowIds(host)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })
})

describe('DeferredSortedVirtualList — класс позиционирования (:176, :309)', () => {
  it('навешивается снаружи и на строку, и на скелетон', () => {
    const host = makeHost()
    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={makeItems(1)}
        totalCount={100}
        wasAtLeastOnceFetched
        itemSize={72}
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    expect(rows(host)[0].classList.contains(styles.Item)).toBe(true)
    expect(skeletons(host)[0].classList.contains(styles.Item)).toBe(true)
  })

  it('переживает смену className строки (React переписывает атрибут class целиком)', () => {
    const host = makeHost()
    const items = makeItems(1)

    const renderWithClass = (className: string) => (p: DeferredSortedVirtualListRenderItemProps<Chat>) => (
      <div data-testid="row" data-id={p.id} className={className} ref={p.itemRef} />
    )

    const props = {
      scrollableHost: host,
      items,
      totalCount: 1,
      wasAtLeastOnceFetched: true,
      itemSize: 72 as const,
      animate: true,
      requestItemForIdx: () => {},
    }

    const { rerender } = render(<DeferredSortedVirtualList {...props} renderItem={renderWithClass('row')} />, {
      container: host,
    })
    expect(rows(host)[0].classList.contains(styles.Item)).toBe(true)

    rerender(<DeferredSortedVirtualList {...props} renderItem={renderWithClass('row active')} />)

    expect(rows(host)[0].className).toContain('active')
    expect(rows(host)[0].classList.contains(styles.Item)).toBe(true)
  })
})

describe('DeferredSortedVirtualList — animate прокидывается в список (:270)', () => {
  const items = makeItems(5)
  const swapped = [items[0], items[1], items[3], items[2], items[4]]

  function renderSwapCase(animate: boolean) {
    const host = makeHost()
    const props = {
      scrollableHost: host,
      totalCount: 5,
      wasAtLeastOnceFetched: true,
      itemSize: 72 as const,
      requestItemForIdx: () => {},
      renderItem,
    }

    const { rerender } = render(<DeferredSortedVirtualList {...props} items={items} animate={animate} />, {
      container: host,
    })
    const el = rows(host).find((r) => r.dataset.id === '3') as HTMLElement
    expect(el.style.top).toBe('216px')

    rerender(<DeferredSortedVirtualList {...props} items={swapped} animate={animate} />)

    return el
  }

  it('animate=true — переезд анимируется', () => {
    const el = renderSwapCase(true)
    expect(el.style.getPropertyValue('--background')).toBe('var(--surface-color)')
  })

  it('animate=false — переезд мгновенный (глушилка blockAnimation снаружи)', () => {
    const el = renderSwapCase(false)
    expect(el.style.top).toBe('144px')
    expect(el.style.getPropertyValue('--background')).toBe('')
  })
})

describe('DeferredSortedVirtualList — параметры скелетона (:308-316)', () => {
  it('size и noAvatar доезжают до скелетона', () => {
    const host = makeHost()
    render(
      <DeferredSortedVirtualList
        scrollableHost={host}
        items={[]}
        totalCount={100}
        wasAtLeastOnceFetched
        itemSize={64}
        noAvatar
        animate
        requestItemForIdx={() => {}}
        renderItem={renderItem}
      />,
      { container: host },
    )

    const skeleton = skeletons(host)[0]
    expect(skeleton.className).toContain('size64')
    expect(skeleton.className).toContain('noAvatar')
    // itemHeight === itemSize (`:267`): шаг позиционирования — 64, не 72,
    // и вся арифметика списка тоже считается по 64:
    // высота ul — 100 * 64 + 8, окно — (idx + 1) * 64 <= 720 + 288 → idx <= 14.
    expect(skeletons(host).map((el) => el.style.top).slice(0, 3)).toEqual(['0px', '64px', '128px'])
    expect((host.querySelector('ul') as HTMLElement).style.height).toBe(100 * 64 + 8 + 'px')
    expect(skeletons(host)).toHaveLength(15)
  })
})
