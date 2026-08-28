import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const runNavigationTransition = vi.fn()
vi.mock('../../core/dom/navigationTransition', () => ({
  NAVIGATION_TRANSITION_TIME: 250,
  runNavigationTransition: (...args: unknown[]) => runNavigationTransition(...args),
}))

import ChatsContainer from './ChatsContainer'
import { useChatStackStore, descKey, type ChatInstanceDesc } from '../../stores/chatStackStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }
const renderInstance = (d: ChatInstanceDesc) => <div data-testid={`body-${descKey(d)}`}>{d.type}</div>

beforeEach(() => {
  vi.useFakeTimers()
  runNavigationTransition.mockClear()
  useChatStackStore.setState({ stack: [] }, false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ChatsContainer', () => {
  // Именно ЧТО этот тест проверяет: число узлов и data-type по дескрипторам
  // стека — не более. `runNavigationTransition` в этом файле замокан (см. verh
  // vi.mock выше), а класс `.active` физически раздаёт именно он — значит этот
  // тест не может свидетельствовать про «активен только верхний» (инвариант
  // `.active`, ниже он не проверяется вовсе). Тот инвариант покрыт отдельно,
  // с настоящим переходом — ChatsContainer.positions.test.tsx.
  it('рендерит по узлу на дескриптор — число узлов и data-type совпадают со стеком', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    const tabs = container.querySelectorAll('.chats-container > .chat')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('data-type')).toBe('chat')
    expect(tabs[1].getAttribute('data-type')).toBe('discussion')
  })

  it('контейнер размечен как навигационный вкладочник tweb', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    const el = container.querySelector('.chats-container')
    expect(el?.classList.contains('tabs-container')).toBe(true)
    expect(el?.getAttribute('data-animation')).toBe('navigation')
  })

  it('push играет переход вперёд, pop — назад', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    render(<ChatsContainer renderInstance={renderInstance} />)
    runNavigationTransition.mockClear()

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(1)
    expect(runNavigationTransition.mock.calls[0][0]).toMatchObject({ toRight: true })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(2)
    expect(runNavigationTransition.mock.calls[1][0]).toMatchObject({ toRight: false })
  })

  it('на pop через уровень промежуточный узел убирается сразу', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
      useChatStackStore.getState().setInnerPeer({ peerId: 3, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().popTo(0)
    })

    // остаются дно стека и уходящий верхний; средний (peerId 2) уходит сразу
    const keys = Array.from(container.querySelectorAll('.chats-container > .chat')).map((n) => n.getAttribute('data-type'))
    expect(keys).toHaveLength(2)
    expect(container.querySelector('[data-testid="body-2_7_discussion"]')).toBeNull()
  })

  it('на pop уходящий узел остаётся в DOM до конца перехода', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
  })

  it('ре-рендер родителя (напр. новый renderInstance) во время ожидания таймера не отменяет удаление уходящего узла', () => {
    // Родитель, который меняет пропы ChatsContainer (в App.tsx renderInstance
    // будет инлайн-стрелкой — то есть новой ссылкой на каждый свой ре-рендер).
    // ChatsContainer из-за этого сам обязан пере-рендериться, но это не эффект
    // смены стека — эффект №2 не должен путать такой ре-рендер с новым
    // переходом и не должен снимать уже поставленный таймер удаления узла.
    function Wrapper({ tick }: { tick: number }) {
      const renderTick = (d: ChatInstanceDesc) => <div data-testid={`body-${descKey(d)}`}>{d.type}-{tick}</div>
      return <ChatsContainer renderInstance={renderTick} />
    }

    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container, rerender } = render(<Wrapper tick={0} />)
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(2)

    // посторонний ре-рендер родителя посреди ожидания таймера
    act(() => {
      rerender(<Wrapper tick={1} />)
    })

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
  })

  it('два pop подряд (без прокрутки таймера между ними) не оставляют лишних узлов и не теряют таймер', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
      useChatStackStore.getState().setInnerPeer({ peerId: 3, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    act(() => {
      useChatStackStore.getState().closeTop()
    })

    act(() => {
      vi.advanceTimersByTime(400)
    })
    // от стека [1,2,3] после двух pop подряд остаётся только дно — peerId 1
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
    expect(container.querySelector('[data-testid="body-1_0_chat"]')).not.toBeNull()
  })

  it('таймер удаления от первого pop не обрезает узел второго pop раньше срока', () => {
    // Второй pop должен переустановить таймер обрезки, а не оставить старый
    // тикать параллельно: иначе старый таймер (от первого pop, тикающий с
    // более раннего момента) сработает раньше собственных 250+100мс второго
    // перехода и удалит уходящий узел второго pop преждевременно — до того,
    // как его переход должен был завершиться.
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
      useChatStackStore.getState().setInnerPeer({ peerId: 3, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().closeTop() // [1,2,3] -> [1,2]; таймер обрезки тикает с t=0
    })
    act(() => {
      vi.advanceTimersByTime(200) // t=200: таймер первого pop (350мс) ещё не сработал
    })
    act(() => {
      useChatStackStore.getState().closeTop() // [1,2] -> [1]; должен переустановить таймер (тикает с t=200)
    })
    act(() => {
      vi.advanceTimersByTime(200) // t=400: таймер первого pop (сработал бы на t=350) — уже не должен существовать;
      // таймер второго pop сработает на t=550, ещё рано
    })

    // узел второго pop (peerId 2) обязан дожить хотя бы до своего собственного срока
    const keys = Array.from(container.querySelectorAll('.chats-container > .chat')).map((n) => n.getAttribute('data-type'))
    expect(keys).toHaveLength(2)
    expect(container.querySelector('[data-testid="body-2_7_discussion"]')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(200) // t=600: таймер второго pop (t=550) уже сработал
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
  })
})

// Порт `chatsSelectTab` в части «когда перехода НЕТ». У tweb личность инстанса
// не зависит от пира: обычное открытие чата из списка идёт `chat.setPeer()` на
// `chats[0]`, контейнер остаётся тем же, и `chatsSelectTab` выходит первой же
// строкой — `if(this.prevTab === tab) return` (appImManager.ts:2238-2240).
//
// У нас ключом узла был `${peerId}_${threadId}_${type}`, поэтому каждое
// открытие чата выглядело сменой инстанса: на стенде это давало два узла
// (`...active to` и `...active from`), класс `animating backwards` на
// контейнере и подмену узла .chat — то есть анимацию возврата назад на
// обычном открытии.
describe('ChatsContainer — переход только между ИНСТАНСАМИ', () => {
  it('обычная смена чата не играет перехода и не пересоздаёт узел', () => {
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' }) })
    const nodeA = container.querySelector('.chats-container > .chat')
    expect(nodeA).not.toBeNull()
    runNavigationTransition.mockClear()

    act(() => { useChatStackStore.getState().setPeer({ peerId: 2, type: 'chat' }) })

    expect(runNavigationTransition).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
    // тот же САМЫЙ узел, а не новый с тем же видом
    expect(container.querySelector('.chats-container > .chat')).toBe(nodeA)
    expect(container.querySelector('[data-testid="body-2_0_chat"]')).not.toBeNull()
  })

  it('контроль: вход в тред — по-прежнему новый инстанс и переход вперёд', () => {
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' }) })
    runNavigationTransition.mockClear()

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    expect(runNavigationTransition).toHaveBeenCalledTimes(1)
    expect(runNavigationTransition.mock.calls[0][0]).toMatchObject({ toRight: true })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(2)
  })

  it('уход из треда к ДРУГОМУ пиру схлопывает стек без анимации (appImManager.ts:2786-2789)', () => {
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' }) })
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })
    runNavigationTransition.mockClear()

    act(() => { useChatStackStore.getState().setPeer({ peerId: 5, type: 'chat' }) })

    expect(runNavigationTransition).not.toHaveBeenCalled()
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
    expect(container.querySelector('[data-testid="body-5_0_chat"]')).not.toBeNull()
  })

  it('уход из треда к пиру ДНА — это возврат, и он анимируется (appImManager.ts:2783-2785)', () => {
    render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' }) })
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })
    runNavigationTransition.mockClear()

    act(() => { useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' }) })

    expect(runNavigationTransition).toHaveBeenCalledTimes(1)
    expect(runNavigationTransition.mock.calls[0][0]).toMatchObject({ toRight: false })
  })
})
