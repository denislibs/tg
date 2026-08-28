import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider } from '../chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'
import { useFeedPageHotkeys } from './useFeedPageHotkeys'

afterEach(cleanup)

const desc = (id: number): ChatInstanceDesc => ({ id, peerId: 1, type: 'chat' })

function Harness({ onPageDown }: { onPageDown: () => void }) {
  useFeedPageHotkeys({ enabled: true, onPageUp: () => {}, onPageDown })
  return null
}

const press = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true }))

describe('useFeedPageHotkeys', () => {
  it('срабатывает только у активного инстанса', () => {
    const onPageDown = vi.fn()
    render(
      <>
        <ChatInstanceProvider value={{ desc: desc(1), isActive: false }}>
          <Harness onPageDown={onPageDown} />
        </ChatInstanceProvider>
        <ChatInstanceProvider value={{ desc: desc(2), isActive: true }}>
          <Harness onPageDown={onPageDown} />
        </ChatInstanceProvider>
      </>,
    )

    press()

    expect(onPageDown).toHaveBeenCalledTimes(1)
  })

  it('при enabled=false не слушает вовсе', () => {
    const onPageDown = vi.fn()
    function Off() {
      useFeedPageHotkeys({ enabled: false, onPageUp: () => {}, onPageDown })
      return null
    }
    render(<Off />)

    press()

    expect(onPageDown).not.toHaveBeenCalled()
  })

  it('без Ctrl/Cmd не срабатывает', () => {
    const onPageDown = vi.fn()
    render(<Harness onPageDown={onPageDown} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))

    expect(onPageDown).not.toHaveBeenCalled()
  })
})
