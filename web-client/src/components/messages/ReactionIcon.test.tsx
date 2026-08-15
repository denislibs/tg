import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReactionIcon from './ReactionIcon'
import type { AvailableReaction } from '../../core/managers/reactionsManager'

// jest-dom (toHaveAttribute/toBeInTheDocument) в проекте не установлен — нигде
// в кодовой базе такие матчеры не используются (chai из коробки у vitest).
// Проверки те же по смыслу, записаны через getAttribute/toBeTruthy.

// Явная аннотация типом каталога (не литеральный вывод) — иначе TS strict не
// пускает переприсваивание с `centerMediaId: undefined` ниже (роль реально
// опциональна — «отсутствующая роль — undefined», reactionsManager.ts:12).
let reactions: AvailableReaction[] = [
  { emoji: '❤', title: 'Red Heart', position: 1, premium: false, inactive: false,
    staticMediaId: 3, centerMediaId: 7, selectMediaId: 9, aroundMediaId: 8 },
]

vi.mock('../StickerMedia', () => ({
  default: ({ mediaId }: { mediaId: number }) => <div data-testid="media" data-media={mediaId} />,
}))
vi.mock('../../core/hooks/useReactions', () => ({ useReactions: () => reactions }))

afterEach(cleanup)

describe('ReactionIcon', () => {
  it('рисует центральный кадр реакции', () => {
    render(<ReactionIcon emoji="❤" play={false} />)
    expect(screen.getByTestId('media').getAttribute('data-media')).toBe('7')
  })

  it('без центрального кадра падает на статичную иконку (tweb reaction.ts:817)', () => {
    reactions = [{ ...reactions[0], centerMediaId: undefined }]
    render(<ReactionIcon emoji="❤" play={false} />)
    expect(screen.getByTestId('media').getAttribute('data-media')).toBe('3')
  })

  it('при play проигрывает анимацию выбора', () => {
    reactions = [{ ...reactions[0], centerMediaId: 7, selectMediaId: 9 }]
    render(<ReactionIcon emoji="❤" play />)
    expect(screen.getByTestId('media').getAttribute('data-media')).toBe('9')
  })

  it('незнакомую реакцию рисует текстовым эмодзи', () => {
    render(<ReactionIcon emoji="🫥" play={false} />)
    expect(screen.queryByTestId('media')).toBeNull()
    expect(screen.getByText('🫥')).toBeTruthy()
  })
})
