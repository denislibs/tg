// Док-бабл во время аплоада (tweb ProgressivePreloader): кольцо прогресса с
// крестиком-отменой на иконке, подстрока «отдано / всего», реальное имя файла.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// mediaUrl на импорте стартует SharedWorker (нет в happy-dom) — мокаем.
vi.mock('../../core/mediaUrl', () => ({
  mediaContentUrl: (id: number) => `/media/${id}`,
  mediaThumbUrl: (id: number) => `/media/${id}?v=thumb`,
  hasMediaToken: () => true,
  primeMediaToken: vi.fn(),
  useMediaTokenVersion: () => 0,
}))

import RealMediaBubble from './RealMediaBubble'
import { useUploadsStore } from '../../stores/uploadsStore'

describe('RealMediaBubble: аплоад документа', () => {
  beforeEach(() => {
    useUploadsStore.setState({ byId: {} })
  })
  afterEach(cleanup) // без vitest globals RTL не чистит DOM сам

  it('пока грузится: имя файла, «отдано / всего», кольцо и крестик-отмена', () => {
    useUploadsStore.getState().setProgress('c-9', 0.5)
    const onCancel = vi.fn()
    const { container } = render(
      <RealMediaBubble
        type="document"
        fileName="оферта.pdf"
        size={2 * 1024 * 1024}
        out
        tickColor="#fff"
        clientId="c-9"
        onCancelUpload={onCancel}
      />,
    )
    expect(screen.getByText('оферта.pdf')).toBeTruthy()
    expect(screen.getByText('1.0 МБ / 2.0 МБ')).toBeTruthy()
    const ring = container.querySelector('[data-radial-progress]')
    expect(ring).toBeTruthy()
    fireEvent.click(ring!.parentElement!)
    expect(onCancel).toHaveBeenCalledWith('c-9')
  })

  it('после аплоада: обычная иконка расширения и размер, без кольца', () => {
    const { container } = render(
      <RealMediaBubble
        type="document"
        mediaId={7}
        fileName="оферта.pdf"
        size={2 * 1024 * 1024}
        out
        tickColor="#fff"
        clientId="c-10"
      />,
    )
    expect(container.querySelector('[data-radial-progress]')).toBeNull()
    expect(screen.getByText('pdf')).toBeTruthy()
    expect(screen.getByText('2.0 МБ')).toBeTruthy()
  })
})
