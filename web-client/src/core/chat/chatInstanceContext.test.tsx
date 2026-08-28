import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider, useChatInstance, useIsActiveChat } from './chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

afterEach(cleanup)

const desc = (id: number): ChatInstanceDesc => ({ id, peerId: 1, type: 'chat' })

function GlobalEffect({ onFire }: { onFire: () => void }) {
  const isActive = useIsActiveChat()
  useEffect(() => {
    if (!isActive) return
    onFire()
  }, [isActive, onFire])
  return null
}

function InstanceValue() {
  const instance = useChatInstance()
  return (
    <div>
      <div data-testid="desc-key">{instance?.desc.id}</div>
      <div data-testid="is-active">{String(instance?.isActive)}</div>
    </div>
  )
}

describe('chatInstanceContext', () => {
  it('при двух смонтированных инстансах глобальный эффект срабатывает один раз', () => {
    const onFire = vi.fn()

    render(
      <>
        <ChatInstanceProvider value={{ desc: desc(1), isActive: false }}>
          <GlobalEffect onFire={onFire} />
        </ChatInstanceProvider>
        <ChatInstanceProvider value={{ desc: desc(2), isActive: true }}>
          <GlobalEffect onFire={onFire} />
        </ChatInstanceProvider>
      </>,
    )

    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('вне провайдера инстанс считается активным (старые точки монтирования и тесты)', () => {
    const onFire = vi.fn()
    render(<GlobalEffect onFire={onFire} />)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('useChatInstance внутри провайдера возвращает переданное значение', () => {
    const { getByTestId } = render(
      <ChatInstanceProvider value={{ desc: desc(42), isActive: true }}>
        <InstanceValue />
      </ChatInstanceProvider>,
    )

    expect(getByTestId('desc-key').textContent).toBe('42')
    expect(getByTestId('is-active').textContent).toBe('true')
  })

  it('useChatInstance вне провайдера возвращает null', () => {
    const { getByTestId } = render(<InstanceValue />)

    expect(getByTestId('desc-key').textContent).toBe('')
    expect(getByTestId('is-active').textContent).toBe('undefined')
  })
})
