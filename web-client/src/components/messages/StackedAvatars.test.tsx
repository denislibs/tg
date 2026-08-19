import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StackedAvatars from './StackedAvatars'
import { applyPeerOps, resetPeerMirror } from '../../core/peerCache'
import type { UserReal } from '../../core/peers/peer'

// Стек принимает КЛЮЧИ (порт `StackedAvatars.render(peerIds)`), а имя и фото
// берёт из зеркала пиров — там же, где их берёт `PeerTitle` оригинала. Пробел
// зеркала объявляет `usePeers`, поэтому менеджеры нужны даже в юните.
vi.mock('../../core/hooks/useManagers', () => ({
  useManagers: () => ({ peers: { fillMirror: async () => {} } }),
}))
// Фото аватарки идёт через воркерный конвейер медиа — в юните он не нужен.
vi.mock('../../core/hooks/useMediaUrl', () => ({ useMediaUrl: () => '' }))

const user = (id: number, first: string): UserReal => ({ _: 'user', id, first_name: first })

afterEach(() => { cleanup(); resetPeerMirror() })

describe('StackedAvatars', () => {
  const peerIds = [4, 3, 2]
  const seed = () => applyPeerOps([{ op: 'upsert', peers: [user(4, 'D'), user(3, 'C'), user(2, 'B')] }])

  it('рендерит по аватару на ключ', () => {
    seed()
    render(<StackedAvatars peerIds={peerIds} />)
    expect(screen.getByTestId('stacked-avatars').children).toHaveLength(3)
  })

  it('имя берётся из зеркала пиров, а не приезжает пропом', () => {
    seed()
    const { container } = render(<StackedAvatars peerIds={peerIds} />)
    const items = container.querySelectorAll<HTMLElement>('[data-testid="stacked-avatars"] > div')
    expect(Array.from(items).map((el) => el.textContent)).toEqual(['D', 'C', 'B'])
  })

  it('порядок DOM сохраняется — перекрытие даёт row-reverse, а не z-index', () => {
    // tweb `_stackedAvatars.scss`: flex-direction: row-reverse, поэтому первый
    // пир оказывается справа и поверх остальных без ручных z-index.
    seed()
    const { container } = render(<StackedAvatars peerIds={peerIds} />)
    const items = container.querySelectorAll<HTMLElement>('[data-testid="stacked-avatars"] > div')
    expect(Array.from(items).every((el) => !el.style.zIndex)).toBe(true)
  })

  it('пустой список → ничего не рендерит', () => {
    const { container } = render(<StackedAvatars peerIds={[]} />)
    expect(container.querySelector('[data-testid="stacked-avatars"]')).toBeNull()
  })

  it('прокидывает размер в --avatar-size (tweb)', () => {
    seed()
    render(<StackedAvatars peerIds={peerIds} size={24} />)
    const stack = screen.getByTestId('stacked-avatars')
    expect(stack.style.getPropertyValue('--avatar-size')).toBe('24px')
  })
})
