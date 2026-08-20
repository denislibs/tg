// src/core/hooks/useGlobalSearch.test.tsx
//
// Регресс: страница, запрошенная onScroll для старого query, не должна
// дописываться в список после смены query, пока эта страница ещё в полёте.
// До фикса (alive-флаг гасит только первую страницу эффекта, но не onScroll)
// это ломает список — см. useGlobalSearch.ts:47-50.
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGlobalSearch, type SearchFilter } from './useGlobalSearch'
import { ManagersProvider } from './useManagers'
import type { MyMessage } from '../models'
import { makeMessage } from '../messages/testMessage'

function msg(id: number, text: string): MyMessage {
  return makeMessage({ id, peerId: 1, fromId: 1, text })
}

type SearchPage = { messages: MyMessage[]; count: number }

// Управляемый deferred-промис: тест сам решает, когда и в каком порядке
// резолвить страницы searchGlobal (иначе гонку не воспроизвести).
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

// Каждый вызов searchGlobal кладёт свой deferred в calls — тест резолвит их
// напрямую по индексу вызова, в любом порядке.
function fakeManagers(calls: ReturnType<typeof deferred<SearchPage>>[]) {
  return {
    messages: {
      searchGlobal: (_q: string, _filter: string, _offset: number, _limit: number) => {
        const d = deferred<SearchPage>()
        calls.push(d)
        return d.promise
      },
    },
  }
}

// Мок скролл-события у нижнего края: onScroll читает только currentTarget.
function bottomScrollEvent(): React.UIEvent<HTMLDivElement> {
  return {
    currentTarget: { scrollHeight: 1000, scrollTop: 900, clientHeight: 100 },
  } as unknown as React.UIEvent<HTMLDivElement>
}

function mount(managers: unknown, q: string, tab: number, filter: SearchFilter = '') {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ManagersProvider, { managers: managers as never, children })
  return renderHook(
    (props: { q: string; tab: number; filter: SearchFilter }) => useGlobalSearch(props.q, props.tab, props.filter),
    { wrapper, initialProps: { q, tab, filter } },
  )
}

describe('useGlobalSearch', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('гонка пагинации: страница старого query не дописывается в список после смены query', async () => {
    const calls: ReturnType<typeof deferred<SearchPage>>[] = []
    const managers = fakeManagers(calls)
    const { result, rerender } = mount(managers, 'old', 0)

    // 1) дебаунс 250мс -> первый вызов searchGlobal('old', offset=0)
    act(() => { vi.advanceTimersByTime(250) })
    expect(calls).toHaveLength(1)

    // 2) резолвим первую страницу 'old' -> msgs = страница A
    const pageA = [msg(1, 'a1'), msg(2, 'a2')]
    await act(async () => {
      calls[0]!.resolve({ messages: pageA, count: 100 })
      await Promise.resolve()
    })
    expect(result.current.msgs).toEqual(pageA)

    // 3) скролл к нижнему краю -> второй вызов searchGlobal('old', offset=2) — НЕ резолвим
    act(() => { result.current.onScroll(bottomScrollEvent()) })
    expect(calls).toHaveLength(2)

    // 4) rerender с q='new' -> дебаунс -> третий вызов searchGlobal('new', offset=0);
    //    резолвим его -> msgs = страница B
    rerender({ q: 'new', tab: 0, filter: '' })
    act(() => { vi.advanceTimersByTime(250) })
    expect(calls).toHaveLength(3)

    const pageB = [msg(10, 'b1')]
    await act(async () => {
      calls[2]!.resolve({ messages: pageB, count: 1 })
      await Promise.resolve()
    })
    expect(result.current.msgs).toEqual(pageB)

    // 5) резолвим зависшую страницу шага 3 (запрошенную для 'old')
    const staleTail = [msg(3, 'a3'), msg(4, 'a4')]
    await act(async () => {
      calls[1]!.resolve({ messages: staleTail, count: 100 })
      await Promise.resolve()
    })

    // Ассерт: список остаётся страницей B — страница старого запроса отброшена.
    expect(result.current.msgs).toEqual(pageB)
  })
})
