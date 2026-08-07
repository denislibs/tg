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

  it('z-index убывает слева направо (левый перекрывает)', () => {
    const { container } = render(<StackedAvatars peers={peers} />)
    const items = container.querySelectorAll<HTMLElement>('[data-testid="stacked-avatars"] > div')
    const z = Array.from(items).map((el) => Number(el.style.zIndex))
    expect(z).toEqual([3, 2, 1])
  })

  it('пустой список → ничего не рендерит', () => {
    const { container } = render(<StackedAvatars peers={[]} />)
    expect(container.querySelector('[data-testid="stacked-avatars"]')).toBeNull()
  })

  it('прокидывает размер в --sa-size', () => {
    render(<StackedAvatars peers={peers} size={24} />)
    const stack = screen.getByTestId('stacked-avatars')
    expect(stack.style.getPropertyValue('--sa-size')).toBe('24px')
  })
})
