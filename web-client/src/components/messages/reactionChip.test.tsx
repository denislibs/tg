import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReactionChip } from './MessageRow'

// Emoji и StackedAvatars тянут контекст (managers) — мокаем: тестируем ветвление
// «аватары vs число» в самом чипе (tweb count<4 → renderAvatars, иначе renderCounter).
vi.mock('../emoji/Emoji', () => ({ default: ({ e }: { e: string }) => <span>{e}</span> }))
vi.mock('./StackedAvatars', () => ({
  default: ({ peers }: { peers: { id: number }[] }) => (
    <div data-testid="stacked">{peers.length}</div>
  ),
}))

afterEach(cleanup)

const noop = () => {}

describe('ReactionChip — аватары vs счётчик', () => {
  const recent = [{ id: 2, name: 'B' }, { id: 3, name: 'C' }]

  it('count<4 и есть recent → аватары вместо числа', () => {
    render(<ReactionChip r={{ emoji: '👍', count: 2, mine: false, recent }} live={false} onToggle={noop} onShow={noop} />)
    // ветка аватаров взята: замоканный StackedAvatars рендерит длину peers (2).
    expect(screen.getByTestId('stacked').textContent).toBe('2')
  })

  it('count>=4 → число, не аватары (даже если recent есть)', () => {
    const { container } = render(<ReactionChip r={{ emoji: '👍', count: 5, mine: false, recent }} live={false} onToggle={noop} onShow={noop} />)
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('5')
  })

  it('нет recent → число', () => {
    const { container } = render(<ReactionChip r={{ emoji: '❤️', count: 2, mine: false }} live={false} onToggle={noop} onShow={noop} />)
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })
})
