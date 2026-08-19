// Плашка закреплённого: превью рисуется ТОЛЬКО у медиа с миниатюрой.
// Правило tweb (replyContainer.ts:79-81): `if(!photo && !(document &&
// document.thumbs?.length)) return {setMedia…}` — у голосового миниатюры нет,
// значит нет ни `<img>`, ни класса `is-media`: плашка вешает его строго по тому
// же признаку (pinnedMessage.tsx:546 → :561 setIsMedia → :223).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import PinnedBar from './PinnedBar'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { Managers } from '../../client/bootstrap'
import type { Message } from '../../core/models'

function msg(over: Partial<Message>): Message {
  return {
    id: 1, peerId: 7, seq: 1, senderId: 2, type: 'text', text: '',
    replyToId: null, mediaId: null, createdAt: new Date().toISOString(), threadRootId: null,
    ...over,
  }
}

/** media-менеджер, у которого миниатюра есть только у перечисленных id.
 * Task 7: превью резолвит воркерный конвейер (downloadMediaURL), не токенный thumbUrl. */
function fakeManagers(withThumb: number[]) {
  const downloadMediaURL = vi.fn(async (id: number, opts?: { thumb?: boolean }) =>
    `blob:media-${id}${opts?.thumb ? '-thumb' : ''}`)
  const meta = vi.fn(async (id: number) => ({ id, hasThumb: withThumb.includes(id) }))
  return { managers: { media: { meta, downloadMediaURL } } as unknown as Managers, downloadMediaURL }
}

function renderBar(managers: Managers, pins: Message[]) {
  return render(
    <ManagersProvider managers={managers}>
      <PinnedBar pins={pins} index={0} searchOpen={false} onFollow={() => {}} onUnpin={() => {}} onOpenList={() => {}} />
    </ManagersProvider>,
  )
}

const plate = (c: HTMLElement) => c.querySelector('.pinned-message')!

afterEach(cleanup)

describe('PinnedBar — превью медиа', () => {
  it('голосовое (миниатюры нет): ни <img>, ни класса is-media', async () => {
    const { managers, downloadMediaURL } = fakeManagers([])
    const { container } = renderBar(managers, [msg({ type: 'voice', mediaId: 5 })])

    // ждём резолва меты, чтобы не поймать «ещё не успело» вместо «решено не рисовать»
    await waitFor(() => expect((managers.media.meta as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(5))
    await waitFor(() => expect(container.textContent).toContain('Голосовое сообщение'))

    expect(container.querySelector('img')).toBeNull()
    expect(plate(container).classList.contains('is-media')).toBe(false)
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('фото (миниатюра есть): <img> с thumb-URL и класс is-media', async () => {
    const { managers, downloadMediaURL } = fakeManagers([9])
    const { container } = renderBar(managers, [msg({ type: 'photo', mediaId: 9 })])

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(downloadMediaURL).toHaveBeenCalledWith(9, { thumb: true })
    expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:media-9-thumb')
    expect(plate(container).classList.contains('is-media')).toBe(true)
  })

  it('переключение на текстовый пин снимает превью и класс', async () => {
    const { managers } = fakeManagers([9])
    const { container, rerender } = renderBar(managers, [msg({ type: 'photo', mediaId: 9 })])
    await waitFor(() => expect(plate(container).classList.contains('is-media')).toBe(true))

    rerender(
      <ManagersProvider managers={managers}>
        <PinnedBar
          pins={[msg({ id: 2, type: 'text', text: 'привет' })]}
          index={0} searchOpen={false} onFollow={() => {}} onUnpin={() => {}} onOpenList={() => {}}
        />
      </ManagersProvider>,
    )

    await waitFor(() => expect(plate(container).classList.contains('is-media')).toBe(false))
    expect(container.querySelector('img')).toBeNull()
  })
})
