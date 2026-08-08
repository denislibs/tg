import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReactionChip, MessageReactions } from './MessageReactions'

// Emoji и StackedAvatars тянут контекст (managers) — мокаем: тестируем ветвление
// «аватары vs число» (tweb reaction.ts renderCounter/renderAvatars).
vi.mock('../emoji/Emoji', () => ({ default: ({ e }: { e: string }) => <span>{e}</span> }))
vi.mock('./StackedAvatars', () => ({
  default: ({ peers }: { peers: { id: number }[] }) => (
    <div data-testid="stacked">{peers.length}</div>
  ),
}))

afterEach(cleanup)

const noop = () => {}
const chipProps = { live: false, isLast: true, onToggle: noop, onShow: noop }

describe('ReactionChip — аватары vs счётчик', () => {
  const recent = [{ id: 2, name: 'B' }, { id: 3, name: 'C' }]

  it('аватары показываются, когда это разрешено и реакций мало', () => {
    render(<ReactionChip r={{ emoji: '👍', count: 2, mine: false, recent }} canRenderAvatars {...chipProps} />)
    expect(screen.getByTestId('stacked').textContent).toBe('2')
  })

  it('count >= порога → число, даже если recent есть', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '👍', count: 5, mine: false, recent }} canRenderAvatars {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('5')
  })

  it('аватары запрещены (список скрыт / реакций много) → число', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '👍', count: 2, mine: false, recent }} canRenderAvatars={false} {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })

  it('нет recent → число', () => {
    const { container } = render(
      <ReactionChip r={{ emoji: '❤️', count: 2, mine: false }} canRenderAvatars {...chipProps} />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })
})

describe('MessageReactions — порог считается по сумме реакций сообщения', () => {
  const rowProps = { rowLive: false, canSeeList: true, onToggle: noop, onShow: noop, onStar: noop }
  const recent = [{ id: 2, name: 'B' }]

  it('суммарно меньше порога → аватары', () => {
    render(<MessageReactions reactions={[{ emoji: '👍', count: 2, mine: false, recent }]} {...rowProps} />)
    expect(screen.getByTestId('stacked')).toBeTruthy()
  })

  it('суммарно порог набран разными реакциями → у всех числа', () => {
    const { container } = render(
      <MessageReactions
        reactions={[
          { emoji: '👍', count: 2, mine: false, recent },
          { emoji: '❤️', count: 2, mine: false, recent },
        ]}
        {...rowProps}
      />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
    expect(container.textContent).toContain('2')
  })

  it('список реагировавших недоступен (группа без can_see_list) → числа', () => {
    render(
      <MessageReactions
        reactions={[{ emoji: '👍', count: 1, mine: false, recent }]}
        {...rowProps}
        canSeeList={false}
      />,
    )
    expect(screen.queryByTestId('stacked')).toBeNull()
  })
})
