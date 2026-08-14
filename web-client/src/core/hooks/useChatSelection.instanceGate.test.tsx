// src/core/hooks/useChatSelection.instanceGate.test.tsx
//
// Ревью Task 6 (пункт Important 4): useChatSelection кладёт обработчик выхода из
// мультиселекта в ГЛОБАЛЬНЫЙ LIFO Esc-стек (core/hotkeys.pushEsc) без гейта на
// активность инстанса. В стеке инстансов чата одновременно смонтировано
// несколько копий — мультиселект, оставленный включённым в фоновом (скрытом)
// инстансе, продолжал бы держать свой обработчик на верху стека и перехватывал
// бы Esc у активного инстанса. Тест бьёт по НАСТОЯЩЕМУ хуку (не копирует гейт в
// тесте) — мокает `pushEsc` из core/hotkeys и проверяет сам факт вызова.
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider } from '../chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

const pushEsc = vi.fn((_handler: () => void) => () => {})
vi.mock('../hotkeys', () => ({ pushEsc: (handler: () => void) => pushEsc(handler) }))

import { useChatSelection } from './useChatSelection'

afterEach(() => {
  cleanup()
  pushEsc.mockClear()
})

const desc = (key: string): ChatInstanceDesc => ({ key, peerId: 1, type: 'chat' })

function Harness() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const sel = useChatSelection(scrollRef)
  return <button onClick={() => sel.setSelectionMode(true)}>select</button>
}

function mount(isActive: boolean) {
  return render(
    <ChatInstanceProvider value={{ desc: desc('a'), isActive }}>
      <Harness />
    </ChatInstanceProvider>,
  )
}

describe('useChatSelection: pushEsc гейтирован активностью инстанса', () => {
  it('фоновый (isActive: false) инстанс НЕ кладёт обработчик в глобальный Esc-стек', () => {
    const { getByRole } = mount(false)

    act(() => { getByRole('button').click() })

    expect(pushEsc).not.toHaveBeenCalled()
  })

  it('активный (isActive: true) инстанс кладёт обработчик в глобальный Esc-стек', () => {
    const { getByRole } = mount(true)

    act(() => { getByRole('button').click() })

    expect(pushEsc).toHaveBeenCalledTimes(1)
  })
})
