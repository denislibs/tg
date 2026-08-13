import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider, useIsActiveChat } from './chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

afterEach(cleanup)

const desc = (key: string): ChatInstanceDesc => ({ key, peerId: 1, type: 'chat' })

function GlobalEffect({ onFire }: { onFire: () => void }) {
  const isActive = useIsActiveChat()
  useEffect(() => {
    if (!isActive) return
    onFire()
  }, [isActive, onFire])
  return null
}

describe('chatInstanceContext', () => {
  it('при двух смонтированных инстансах глобальный эффект срабатывает один раз', () => {
    const onFire = vi.fn()

    render(
      <>
        <ChatInstanceProvider value={{ desc: desc('a'), isActive: false }}>
          <GlobalEffect onFire={onFire} />
        </ChatInstanceProvider>
        <ChatInstanceProvider value={{ desc: desc('b'), isActive: true }}>
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
})
