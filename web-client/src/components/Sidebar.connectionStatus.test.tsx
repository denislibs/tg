// src/components/Sidebar.connectionStatus.test.tsx
// Проводка автомата состояния соединения в живом Sidebar: ref → statusRef →
// construct/destroy. Отдельный файл (как `workerCore.connectionStatus.test.ts`
// рядом с `workerCore.test.ts`) — чтобы тянуть тяжёлое дерево Sidebar только
// сюда, а не в тесты самого автомата.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import ConnectionStatusComponent from './connectionStatus'
import { ManagersProvider } from '../core/hooks/useManagers'
import rootScope from '@lib/rootScope'
import { RT } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'

// Весь слой менеджеров — рекурсивный Proxy: любой `managers.<ns>.<method>(...)`
// отдаёт промис. Настоящий ответ нужен ровно одному методу — тому, который
// автомат пуллит.
function fakeManagers(status: unknown) {
  const getStatus = vi.fn(async () => status)
  const managers = new Proxy({}, {
    get: (_target, ns: string) => new Proxy({}, {
      get: (_t, method: string) => (ns === 'realtime' && method === 'getStatus' ? getStatus : async () => undefined),
    }),
  }) as unknown as Managers
  return { managers, getStatus }
}

// Во время кросс-фейда в DOM два плейсхолдера сразу; уходящий помечен `is-hiding`.
const placeholder = () => {
  const visible = [...document.querySelectorAll<HTMLElement>('.input-search .input-search-placeholder')]
    .filter((n) => !n.classList.contains('is-hiding'))
  return visible.length ? visible[visible.length - 1].textContent : null
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Sidebar — проводка ConnectionStatusComponent', () => {
  it('стартовый pull автомата доезжает до плейсхолдера поля поиска', async () => {
    const { managers } = fakeManagers({ state: 'connecting', retryAt: undefined, syncing: false })
    render(
      <ManagersProvider managers={managers}>
        <Sidebar onToggleMode={() => {}} />
      </ManagersProvider>,
    )

    // плейсхолдер стоит с первого кадра — construct() зовётся из слоя раскладки
    expect(placeholder()).toBe('Search')

    // ни одного RT.*-уведомления: работает только стартовый pull по INITIAL_DELAY
    await act(async () => { vi.advanceTimersByTime(ConnectionStatusComponent.INITIAL_DELAY) })
    act(() => { vi.advanceTimersByTime(16 + ConnectionStatusComponent.CHANGE_STATE_DELAY) })

    expect(placeholder()).toBe('Waiting for network...')
  })

  it('размонтирование Sidebar уничтожает автомат — уведомления больше не пуллят', async () => {
    const { managers, getStatus } = fakeManagers({ state: 'ready', retryAt: undefined, syncing: false })
    const view = render(
      <ManagersProvider managers={managers}>
        <Sidebar onToggleMode={() => {}} />
      </ManagersProvider>,
    )

    await act(async () => { rootScope.dispatchEventSingle(RT.state, { state: 'ready' }) })
    expect(getStatus).toHaveBeenCalledTimes(1)

    view.unmount()
    await act(async () => { rootScope.dispatchEventSingle(RT.state, { state: 'ready' }) })
    expect(getStatus).toHaveBeenCalledTimes(1)
  })
})
