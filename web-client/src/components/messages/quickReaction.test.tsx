// Быстрая реакция по ховеру бабла (порт tweb .bubble-hover-reaction):
// появляется с задержкой при наведении, клик ставит реакцию, в «Избранном» и
// секретных чатах её нет вовсе.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import MessageRow, { type FeedFns, type MessageRowProps } from './MessageRow'
import { QUICK_REACTION } from '../../core/reactions'
import type { ConvMsg } from '../../data'

// Содержимое бабла к предмету теста отношения не имеет и тянет пол-приложения
// (медиа, плееры, менеджеры) — подменяем заглушкой.
vi.mock('./MessageContent', () => ({ default: () => <div data-testid="content" /> }))
vi.mock('../emoji/Emoji', () => ({ default: ({ e }: { e: string }) => <span data-testid="emoji">{e}</span> }))

const toggleReaction = vi.fn()
const feedFns = { toggleReaction, forwardMsg: vi.fn() } as unknown as FeedFns

const msg: ConvMsg = { id: 5, type: 'text', text: 'привет', at: '', out: false } as ConvMsg

function renderRow(extra: Partial<MessageRowProps> = {}) {
  const props: MessageRowProps = {
    m: msg,
    out: false,
    firstInGroup: true,
    lastInGroup: true,
    selecting: false,
    isSelected: false,
    isHighlighted: false,
    showName: false,
    isChannel: false,
    isFirstUnread: false,
    canSeeReactionList: true,
    canQuickReact: true,
    feedFns,
    ...extra,
  }
  return render(<MessageRow {...props} />)
}

const hover = (container: HTMLElement) => {
  const content = container.querySelector('.bubble-content')!
  fireEvent.mouseEnter(content)
  return content
}

beforeEach(() => {
  vi.useFakeTimers()
  toggleReaction.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('быстрая реакция по ховеру', () => {
  it('до наведения кружка нет', () => {
    const { container } = renderRow()
    expect(container.querySelector('.bubble-hover-reaction')).toBeNull()
  })

  it('наведение показывает кружок, но видимым он становится после задержки', () => {
    const { container } = renderRow()
    hover(container)

    // узел уже в DOM (CSS держит его прозрачным), класс появления — позже
    const node = container.querySelector('.bubble-hover-reaction')
    expect(node).not.toBeNull()
    expect(node!.className).not.toContain('is-visible')

    act(() => { vi.advanceTimersByTime(400) })
    expect(container.querySelector('.bubble-hover-reaction')!.className).toContain('is-visible')
    // родитель помечается для сдвига кнопки «переслать» (tweb setHoverVisible)
    expect(container.querySelector('.bubble-content')!.className).toContain('hover-reaction-visible')
  })

  it('клик ставит быструю реакцию тем же путём, что чип и полоска меню', () => {
    const { container } = renderRow()
    hover(container)
    act(() => { vi.advanceTimersByTime(400) })

    fireEvent.click(container.querySelector('.bubble-hover-reaction')!)

    expect(toggleReaction).toHaveBeenCalledWith(5, QUICK_REACTION)
  })

  it('уход курсора снимает класс, а узел уходит после анимации', () => {
    const { container } = renderRow()
    const content = hover(container)
    act(() => { vi.advanceTimersByTime(400) })

    fireEvent.mouseLeave(content)
    // Семантика SetTransition из tweb: класс остаётся, но переключается на
    // backwards — под него в партиале написано обратное состояние
    // (видимым CSS считает только `.is-visible.forwards`).
    const exiting = container.querySelector('.bubble-hover-reaction')!.className
    expect(exiting).toContain('backwards')
    expect(exiting).not.toContain('forwards')

    act(() => { vi.advanceTimersByTime(200) })
    expect(container.querySelector('.bubble-hover-reaction')).toBeNull()
  })

  it('в «Избранном»/секретном чате (canQuickReact=false) кружка нет', () => {
    const { container } = renderRow({ canQuickReact: false })
    hover(container)
    act(() => { vi.advanceTimersByTime(400) })

    expect(container.querySelector('.bubble-hover-reaction')).toBeNull()
  })

  it('в режиме выделения кружка нет (tweb: selection отменяет ховер)', () => {
    const { container } = renderRow({ selecting: true })
    hover(container)
    act(() => { vi.advanceTimersByTime(400) })

    expect(container.querySelector('.bubble-hover-reaction')).toBeNull()
  })

  it('у неотправленного сообщения (без серверного id) кружка нет', () => {
    const { container } = renderRow({ m: { ...msg, id: -1 } as ConvMsg })
    hover(container)
    act(() => { vi.advanceTimersByTime(400) })

    expect(container.querySelector('.bubble-hover-reaction')).toBeNull()
  })
})
