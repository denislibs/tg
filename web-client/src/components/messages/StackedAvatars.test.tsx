import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StackedAvatars from './StackedAvatars'

// UserAvatar тянет useManagers()-контекст (токенизация media-url); в юните нам
// важна только логика стека — мокаем аватар в простой div с data-id.
vi.mock('../UserAvatar', () => ({
  default: ({ id, name }: { id: number; name: string }) => (
    <div data-testid="ua" data-id={id}>{name}</div>
  ),
}))

afterEach(cleanup)

describe('StackedAvatars', () => {
  const peers = [
    { id: 4, name: 'D' },
    { id: 3, name: 'C' },
    { id: 2, name: 'B' },
  ]

  it('рендерит по аватару на пира', () => {
    render(<StackedAvatars peers={peers} />)
    expect(screen.getAllByTestId('ua')).toHaveLength(3)
  })

  it('порядок DOM сохраняется — перекрытие даёт row-reverse, а не z-index', () => {
    // tweb `_stackedAvatars.scss`: flex-direction: row-reverse, поэтому первый
    // пир оказывается справа и поверх остальных без ручных z-index.
    const { container } = render(<StackedAvatars peers={peers} />)
    const items = container.querySelectorAll<HTMLElement>('[data-testid="stacked-avatars"] > div')
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['D', 'C', 'B'])
    expect(Array.from(items).every((el) => !el.style.zIndex)).toBe(true)
  })

  it('пустой список → ничего не рендерит', () => {
    const { container } = render(<StackedAvatars peers={[]} />)
    expect(container.querySelector('[data-testid="stacked-avatars"]')).toBeNull()
  })

  it('прокидывает размер в --avatar-size (tweb)', () => {
    render(<StackedAvatars peers={peers} size={24} />)
    const stack = screen.getByTestId('stacked-avatars')
    expect(stack.style.getPropertyValue('--avatar-size')).toBe('24px')
  })
})
